"""
===============================================================================
Module: 30_preprocessed_activities.py
Deterministic Timetable Grid Parsing & Activity Cell Preprocessing Pipeline
===============================================================================

Overview
--------
This module constitutes the high-precision computer vision stage in the automated
timetable extraction pipeline. Operating directly on timetable page images identified
by `20_categorize_pages.py`, this module extracts, aligns, validates, and serializes
individual activity cells (courses, laboratories, seminars).

Rather than delegating layout extraction to nondeterministic vision LLMs, this module
implements a deterministic computer vision pipeline built upon OpenCV and NumPy.
It calculates timetable coordinates, snaps bounding boxes to consensus grid lines,
determines time intervals, calculates vertical slot coverings (full, halves, quarters),
and discards empty grid slots using ink density heuristics.

Under the Hood: Architecture & Mechanics
-----------------------------------------
1. Pipeline Ingestion & Categorization Filtering:
   The pipeline reads `<PIPELINE_DATA_DIR>/categorization.json` (produced in Step 2).
   Pages flagged with `is_timetable=True` are selected for processing. Non-timetable
   pages (such as announcements, legend guides, and tutor lists) are skipped.

2. Morphological Grid Extraction (`extract_table_grid`):
   Document scans and rendered PDF pages contain letters, icons, and table grid borders.
   Using binary inverse thresholding followed by morphological open operations with
   directional rectangular structuring elements (`MORPH_RECT` with lengths proportional
   to image dimensions: `w // 30` horizontally, `h // 20` vertically), all textual
   characters are eliminated while preserving continuous horizontal and vertical grid lines.
   Combining the two directional masks yields an isolated table grid.

3. Topological Hierarchy & Contour Isolation:
   Using `cv.findContours(..., cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)`, contours are
   organized into a parent-child tree hierarchy. Level 2 contours correspond precisely
   to inner activity cells bounded by the table grid, filtering out outer page frames
   (Level 0) and main table boundaries (Level 1).

4. Contour Intersection & Sub-Pixel Consensus Grid Snapping (`snap_to_grid`):
   Slight skew, anti-aliasing, and rasterization jitter can introduce 1-3 pixel offsets
   between adjoining cell borders. The pipeline detects horizontal and vertical line
   segment intersections across all Level 2 contours and applies a 1D mode-clustering
   algorithm (`snap_to_grid`). Coordinates within a 10px threshold are snapped to their
   most frequent consensus grid line, establishing a coordinate grid.

5. Atomic Activity Dimensions (`atomic_activity_dimensions`):
   A university timetable follows a structured modular layout:
     - Horizontal axis: 1-hour columns starting from 8:00 (column 0: 8:00-8:50, column 1: 9:00-9:50, etc.).
       The distance between adjacent snapped vertical grid lines defines the `atomic_width`.
     - Vertical axis: 5 weekday rows (Monday through Friday). Each day row is divided into
       4 quarter subslots (frequency of half or quarter parity activities). The total weekday row
       height divided by 4 defines the `atomic_height`.

6. Real Activity Discrimination (`is_crop_an_activity`):
   Most timetable cells are empty slots. An empty white cell must not produce a false activity.
   A multi-criteria ink verification heuristic distinguishes real activities from empty cells:
     - Standard deviation (contrast) threshold: uniform white space yields std < 5.0.
     - Canny edge density: text produces sharp high-frequency edges.
     - Relative ink ratio: text pixels are darker than the local background median.
     - Connected component analysis: characters form distinct letter-sized bounding boxes.
   Cells failing these heuristics are filtered out.

7. Schedule Invariant Derivation (`activity_boundry_to_activity_info`):
   Each valid activity contour is snapped to its four corner grid intersections:
     - Weekday: Derived from vertical offset from the timetable top edge divided by full day height.
     - Start/End Time: Column offset defines start hour (8 + start_col) and end hour (8 + end_col),
       with standard timetable minute conventions (00 to 50).
     - Covering: The height in atomic quarter units determines:
       * `full`: spans all 4 quarters (full day height, index 0).
       * `halves`: spans 2 quarters (index 0 for top half, index 1 for bottom half).
       * `quarters`: spans 1 quarter (indices 0, 1, 2, 3 from top to bottom).

8. Reading-Order Spatial Sorting & Output Asset Serialization:
   Activities are sorted in reading order (top-to-bottom, left-to-right).
   For each activity on page P (e.g., page 6) at 0-indexed position A (e.g., activity 7):
     - File naming pattern: `IMG-<PPP>_AC-<AA>.png` (e.g. `IMG-006_AC-07.png`).
     - Image crop: Written to `<OUTPUT_DIR>/images/IMG-006_AC-07.png`.
     - Output manifest: The `act_record` items are collected and saved into `<OUTPUT_DIR>/data.json`.

9. Asynchronous Concurrency:
   Worker routines wrap CPU-intensive OpenCV tasks via `asyncio.to_thread` and execute
   concurrently across CPU cores using `aiometer.run_all` with configurable concurrency.
"""

import asyncio
from collections import Counter
from enum import Enum
import functools
import json
import logging
import os
from pathlib import Path
from typing import Any, Literal, Optional

import aiometer
import cv2 as cv
import nest_asyncio
import numpy as np
from pydantic import BaseModel, Field

import utils
from utils import loadEnv

nest_asyncio.apply()

logger = utils.create_logger()

# ---------------------------------------------------------------------------
# Global Configurations
# ---------------------------------------------------------------------------
PIPELINE_DATA_DIR = Path(os.getenv("PIPELINE_DATA_DIR", "output"))
OUTPUT_DIR = PIPELINE_DATA_DIR / "preprocessed-activities"
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", os.cpu_count() or 8))

WEEKDAYS = ["Luni", "Marti", "Miercuri", "Joi", "Vineri"]


# ---------------------------------------------------------------------------
# Data Models & Schemas
# ---------------------------------------------------------------------------
class ActivityCovering(str, Enum):
    FULL = "full"
    HALVES = "halves"
    QUARTERS = "quarters"


class Time(BaseModel):
    weekday: Literal["Luni", "Marti", "Miercuri", "Joi", "Vineri"]
    hour: int
    minute: int


class ActivityInfo(BaseModel):
    start_time: Time
    end_time: Time
    covering: ActivityCovering
    index_in_covering: int


class PreprocessedActivity(BaseModel):
    path: str = Field(description="Absolute path to the cropped activity image file.")
    weekday: str
    covering: str
    index_in_covering: int
    start_time: Time
    end_time: Time
    corners: list[list[int]]


class TimetableResponse(BaseModel):
    timetable_path: str = Field(description="Absolute path to the original timetable page image.")
    preprocessed_activities: list[PreprocessedActivity] = Field(
        default_factory=list,
        description="List of preprocessed activity items extracted from this timetable.",
    )


# ---------------------------------------------------------------------------
# Computer Vision Grid Extraction & Geometric Heuristics
# ---------------------------------------------------------------------------
def extract_table_grid(gray: np.ndarray, thresh_val: int = 130) -> np.ndarray:
    """
    Extracts only the horizontal and vertical grid lines of the timetable,
    filtering out all text, numbers, and letter characters using morphological operations.
    Preserves vertical line dividers in hour header cells and horizontal dividers in day cells.
    """
    _, thresh_inv = cv.threshold(gray, thresh_val, 255, cv.THRESH_BINARY_INV)

    # Structuring element kernels proportional to image dimensions, but bounded so that:
    # 1. v_kernel_len does not exceed hour header cell height (~67px), preserving 1-hour column dividers
    # 2. h_kernel_len does not exceed day header cell width (~114px)
    # 3. kernels remain long enough to eliminate alphanumeric text characters (height <= 35-45px)
    h_kernel_len = max(min(gray.shape[1] // 40, 50), 30)
    v_kernel_len = max(min(gray.shape[0] // 35, 40), 25)

    h_kernel = cv.getStructuringElement(cv.MORPH_RECT, (h_kernel_len, 1))
    v_kernel = cv.getStructuringElement(cv.MORPH_RECT, (1, v_kernel_len))

    # Keep only continuous horizontal and vertical lines
    h_lines = cv.morphologyEx(thresh_inv, cv.MORPH_OPEN, h_kernel)
    v_lines = cv.morphologyEx(thresh_inv, cv.MORPH_OPEN, v_kernel)

    # Combine grid lines
    table_grid = cv.add(h_lines, v_lines)

    # Invert back so cells are white and grid lines are black
    clean_thresh = cv.bitwise_not(table_grid)
    return clean_thresh


def find_contour_intersections(
    contours,
    hierarchy=None,
    target_level: int = 2,
    tolerance: int = 3,
    cluster_dist: int = 5,
) -> list[tuple[int, int]]:
    """
    Filters contours to the specified hierarchy level (Level 2 inner cells by default)
    and computes the intersection points where horizontal and vertical contour lines meet
    (cross junctions, T-junctions, and L-corners).
    """
    if (
        isinstance(contours, np.ndarray)
        and contours.ndim == 3
        and contours.shape[2] == 4
        and isinstance(hierarchy, (list, tuple))
    ):
        contours, hierarchy = hierarchy, contours

    if contours is None or len(contours) == 0:
        return []

    # Filter to target hierarchy level (depth == target_level) if hierarchy is provided
    if hierarchy is not None and len(hierarchy) > 0:
        h = hierarchy[0]
        depths = []
        for idx in range(len(contours)):
            depth = 0
            parent = h[idx][3]
            while parent != -1:
                depth += 1
                parent = h[parent][3]
            depths.append(depth)
        target_contours = [contours[i] for i, d in enumerate(depths) if d == target_level]
    else:
        target_contours = list(contours)

    if not target_contours:
        return []

    # Extract horizontal and vertical segments
    h_segments = []
    v_segments = []

    for cnt in target_contours:
        if cnt is None or len(cnt) == 0:
            continue

        bx, by, bw, bh = cv.boundingRect(cnt)
        h_segments.append((by, bx, bx + bw))
        h_segments.append((by + bh, bx, bx + bw))
        v_segments.append((bx, by, by + bh))
        v_segments.append((bx + bw, by, by + bh))

        # Check fine contour polygon edges for non-rectangular contours
        pts = cnt.reshape(-1, 2)
        n = len(pts)
        if n >= 3:
            for i in range(n):
                p1, p2 = pts[i], pts[(i + 1) % n]
                dx = abs(p1[0] - p2[0])
                dy = abs(p1[1] - p2[1])
                if dy <= 2 and dx > 5:
                    y = int(round((p1[1] + p2[1]) / 2))
                    h_segments.append((y, min(p1[0], p2[0]), max(p1[0], p2[0])))
                elif dx <= 2 and dy > 5:
                    x = int(round((p1[0] + p2[0]) / 2))
                    v_segments.append((x, min(p1[1], p2[1]), max(p1[1], p2[1])))

    # Find intersections where horizontal and vertical segments touch or cross
    raw_points = []
    for y_h, x1, x2 in h_segments:
        min_x, max_x = min(x1, x2) - tolerance, max(x1, x2) + tolerance
        for x_v, y1, y2 in v_segments:
            min_y, max_y = min(y1, y2) - tolerance, max(y1, y2) + tolerance
            if min_x <= x_v <= max_x and min_y <= y_h <= max_y:
                raw_points.append((x_v, y_h))

    # Cluster duplicate / neighboring intersection points
    clusters: list[dict[str, Any]] = []
    for pt in raw_points:
        found = False
        for cl in clusters:
            cx, cy = cl["centroid"]
            if abs(pt[0] - cx) <= cluster_dist and abs(pt[1] - cy) <= cluster_dist:
                cl["points"].append(pt)
                pts_list = cl["points"]
                cl["centroid"] = (
                    int(round(sum(p[0] for p in pts_list) / len(pts_list))),
                    int(round(sum(p[1] for p in pts_list) / len(pts_list))),
                )
                found = True
                break
        if not found:
            clusters.append({"centroid": pt, "points": [pt]})

    return sorted(set(cl["centroid"] for cl in clusters), key=lambda p: (p[1], p[0]))


def snap_to_grid(points: list[tuple[int, int]], threshold: int = 10) -> list[tuple[int, int]]:
    """
    Aligns near-identical X and Y coordinates to consensus grid lines using
    frequency mode clustering within the given threshold distance.
    Eliminates rasterization and contour jitter (1-2px offsets).
    """
    if not points:
        return []

    def cluster_1d(raw_values: list[int]) -> dict[int, int]:
        counts = Counter(raw_values)
        unique_sorted = sorted(counts.keys())

        clusters: list[list[int]] = []
        for v in unique_sorted:
            if not clusters or v - clusters[-1][-1] > threshold:
                clusters.append([v])
            else:
                clusters[-1].append(v)

        mapping = {}
        for cl in clusters:
            # Pick the coordinate that appears most frequently in this cluster
            consensus = max(cl, key=lambda v: counts[v])
            for v in cl:
                mapping[v] = consensus
        return mapping

    x_map = cluster_1d([p[0] for p in points])
    y_map = cluster_1d([p[1] for p in points])
    snapped = [(x_map[p[0]], y_map[p[1]]) for p in points]
    return sorted(set(snapped), key=lambda p: (p[1], p[0]))


def extract_grid_structure(
    contours,
    hierarchy,
    snapped_intersections: list[tuple[int, int]],
    image_shape: tuple[int, int],
) -> tuple[list[int], list[tuple[int, int]], tuple[float, float]]:
    """
    Identifies the canonical hour cells in the top header row and day cells in the left header column.

    Returns:
        col_dividers: list of X-coordinates bounding the 1-hour columns (8:00 to 19:50).
        day_intervals: list of (y_top, y_bottom) tuples for Monday through Friday.
        (atomic_width, atomic_height): base modular unit dimensions.
    """
    if hierarchy is None or len(hierarchy) == 0 or not contours:
        return [], [], (0.0, 0.0)

    h = hierarchy[0]
    depths = []
    for idx in range(len(contours)):
        depth = 0
        p = h[idx][3]
        while p != -1:
            depth += 1
            p = h[p][3]
        depths.append(depth)

    l2_cnts = [contours[i] for i, d in enumerate(depths) if d == 2]
    if not l2_cnts:
        return [], [], (0.0, 0.0)

    boxes = [cv.boundingRect(c) for c in l2_cnts]
    min_x = min(b[0] for b in boxes)
    min_y = min(b[1] for b in boxes)

    # 1. Header cells (hours in top row)
    top_cells = [b for b in boxes if abs(b[1] - min_y) <= 15]
    header_h = float(np.median([b[3] for b in top_cells])) if top_cells else 0.0
    hour_cells = sorted([b for b in top_cells if b[0] > min_x + 50], key=lambda b: b[0])

    # 2. Day cells (weekdays in leftmost column)
    day_cells = sorted(
        [b for b in boxes if abs(b[0] - min_x) <= 20 and b[1] >= min_y + header_h - 10],
        key=lambda b: b[1],
    )

    xs = sorted(set(p[0] for p in snapped_intersections)) if snapped_intersections else []
    ys = sorted(set(p[1] for p in snapped_intersections)) if snapped_intersections else []

    # Build col_dividers from hour cells
    if hour_cells:
        raw_dividers = [hour_cells[0][0]] + [c[0] + c[2] for c in hour_cells]
        if xs:
            col_dividers = [min(xs, key=lambda x: abs(x - div)) for div in raw_dividers]
        else:
            col_dividers = raw_dividers
        cleaned_divs = [col_dividers[0]]
        for d in col_dividers[1:]:
            if d > cleaned_divs[-1]:
                cleaned_divs.append(d)
        col_dividers = cleaned_divs
        atomic_w = float(
            np.mean([col_dividers[i + 1] - col_dividers[i] for i in range(len(col_dividers) - 1)])
        )
    else:
        col_dividers = []
        atomic_w = 0.0

    # Build day_intervals from day cells
    if day_cells:
        raw_intervals = [(c[1], c[1] + c[3]) for c in day_cells]
        if ys:
            day_intervals = [
                (min(ys, key=lambda y: abs(y - d[0])), min(ys, key=lambda y: abs(y - d[1])))
                for d in raw_intervals
            ]
        else:
            day_intervals = raw_intervals
        avg_day_h = float(np.mean([d[1] - d[0] for d in day_intervals]))
        atomic_h = avg_day_h / 4.0
    else:
        day_intervals = []
        atomic_h = 0.0

    return col_dividers, day_intervals, (round(atomic_w, 2), round(atomic_h, 2))


def atomic_activity_dimensions(
    img_orig: np.ndarray,
    intersections: list[tuple[int, int]] | None = None,
) -> tuple[float, float]:
    """
    Computes the base modular unit dimensions `(atomic_width, atomic_height)` of timetable cells.
    Uses canonical hour cells (8..19) and day cells (Monday..Friday) when available,
    falling back to snapped intersection diffs.
    """
    if img_orig is not None:
        gray = cv.cvtColor(img_orig, cv.COLOR_BGR2GRAY) if img_orig.ndim == 3 else img_orig
        thresh = extract_table_grid(gray, thresh_val=130)
        contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
        if intersections is None:
            raw_intersections = find_contour_intersections(contours, hierarchy)
            snapped = snap_to_grid(raw_intersections)
        else:
            snapped = snap_to_grid(intersections)

        _, _, dims = extract_grid_structure(contours, hierarchy, snapped, img_orig.shape[:2])
        if dims[0] > 0 and dims[1] > 0:
            return dims
    else:
        snapped = snap_to_grid(intersections) if intersections else []

    if not snapped or len(snapped) < 2:
        return (0.0, 0.0)

    # Fallback to top row and far left diffs
    min_y = min(p[1] for p in snapped)
    top_row = sorted([p for p in snapped if p[1] == min_y], key=lambda p: p[0])

    min_x = min(p[0] for p in snapped)
    far_left = sorted([p for p in snapped if p[0] == min_x], key=lambda p: p[1])

    if len(top_row) > 1:
        col_diffs = [top_row[i + 1][0] - top_row[i][0] for i in range(len(top_row) - 1)]
        atomic_width = float(np.mean(col_diffs))
    else:
        atomic_width = 0.0

    if len(far_left) > 1:
        row_diffs = [far_left[i + 1][1] - far_left[i][1] for i in range(len(far_left) - 1)]
        avg_day_height = float(np.mean(row_diffs))
        atomic_height = avg_day_height / 4.0
    else:
        atomic_height = 0.0

    return (round(atomic_width, 2), round(atomic_height, 2))


def get_timetable_corners(
    intersections: list[tuple[int, int]],
    col_dividers: list[int] | None = None,
    day_intervals: list[tuple[int, int]] | None = None,
) -> list[tuple[int, int]]:
    """
    Finds the four corner intersection points bounding the actual timetable activity area,
    excluding the day header column on the left and the hour header row on top.
    Returns: [top-left, top-right, bottom-left, bottom-right].
    """
    if col_dividers and day_intervals and len(col_dividers) >= 2 and len(day_intervals) >= 1:
        left_x = col_dividers[0]
        right_x = col_dividers[-1]
        top_y = day_intervals[0][0]
        bottom_y = day_intervals[-1][1]
        return [
            (left_x, top_y),
            (right_x, top_y),
            (left_x, bottom_y),
            (right_x, bottom_y),
        ]

    if not intersections:
        return []
    xs = sorted(set(p[0] for p in intersections))
    ys = sorted(set(p[1] for p in intersections))

    left_x = xs[1] if len(xs) > 1 else xs[0]
    right_x = xs[-1]
    top_y = ys[1] if len(ys) > 1 else ys[0]
    bottom_y = ys[-1]

    return [
        (left_x, top_y),
        (right_x, top_y),
        (left_x, bottom_y),
        (right_x, bottom_y),
    ]


def filter_activity_contours(
    contours,
    hierarchy=None,
    image_shape=None,
    col_dividers: list[int] | None = None,
    day_intervals: list[tuple[int, int]] | None = None,
) -> list:
    """
    Filters out outer page borders, the top header row (hours), and the left
    header column (days), preserving contours for activity cells.
    """
    if contours is None or len(contours) == 0:
        return []

    # If hierarchy is provided, isolate level 2 contours (inner cells)
    if hierarchy is not None and len(hierarchy) > 0:
        h = hierarchy[0]
        depths = []
        for idx in range(len(contours)):
            depth = 0
            parent = h[idx][3]
            while parent != -1:
                depth += 1
                parent = h[parent][3]
            depths.append(depth)
        candidate_contours = [contours[i] for i, d in enumerate(depths) if d == 2]
    else:
        max_w = image_shape[1] * 0.9 if image_shape else 1400
        max_h = image_shape[0] * 0.9 if image_shape else 900
        candidate_contours = [
            c for c in contours
            if cv.boundingRect(c)[2] < max_w and cv.boundingRect(c)[3] < max_h
        ]

    if not candidate_contours:
        return []

    if col_dividers and day_intervals and len(col_dividers) >= 2 and len(day_intervals) >= 1:
        min_act_x = col_dividers[0] - 5
        min_act_y = day_intervals[0][0] - 5
        activity_contours = [
            c for c in candidate_contours
            if cv.boundingRect(c)[0] >= min_act_x and cv.boundingRect(c)[1] >= min_act_y
        ]
    else:
        min_x = min(cv.boundingRect(c)[0] for c in candidate_contours)
        min_y = min(cv.boundingRect(c)[1] for c in candidate_contours)
        activity_contours = [
            c for c in candidate_contours
            if cv.boundingRect(c)[0] > min_x + 50 and cv.boundingRect(c)[1] > min_y + 40
        ]

    return activity_contours


def snap_contour_to_corners(contour, points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """
    Snaps a contour bounding box to the closest four intersection points
    forming an aligned rectangle on the timetable grid.
    Returns: [top-left, top-right, bottom-left, bottom-right].
    """
    bx, by, bw, bh = cv.boundingRect(contour)
    xs = sorted(set(p[0] for p in points))
    ys = sorted(set(p[1] for p in points))

    x_left = min(xs, key=lambda x: abs(x - bx))
    x_right = min(xs, key=lambda x: abs(x - (bx + bw)))
    y_top = min(ys, key=lambda y: abs(y - by))
    y_bottom = min(ys, key=lambda y: abs(y - (by + bh)))

    if x_right <= x_left:
        greater_xs = [x for x in xs if x > x_left]
        x_right = greater_xs[0] if greater_xs else x_left + 1

    if y_bottom <= y_top:
        greater_ys = [y for y in ys if y > y_top]
        y_bottom = greater_ys[0] if greater_ys else y_top + 1

    return [
        (x_left, y_top),
        (x_right, y_top),
        (x_left, y_bottom),
        (x_right, y_bottom),
    ]


def is_crop_an_activity(
    crop: np.ndarray,
    min_contrast: float = 5.0,
    min_text_density: float = 0.005,
) -> bool:
    """
    Determines whether a cropped cell contains an actual didactic activity
    or is empty white/background space using ink density heuristics:
      1. Standard deviation / Contrast: empty cells have near-zero std.
      2. Edge density (Canny): characters produce sharp edges.
      3. Relative ink ratio: text pixels are darker than the local background.
      4. Connected character components: text characters form small bounding boxes.
    """
    if crop is None or crop.size == 0:
        return False

    gray = cv.cvtColor(crop, cv.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

    # 1. Variance / Contrast heuristic
    if float(np.std(gray)) < min_contrast:
        return False

    # 2. Text edge detection
    edges = cv.Canny(gray, 50, 150)
    edge_ratio = float(np.sum(edges > 0)) / edges.size

    # 3. Relative ink detection
    bg_val = float(np.median(gray))
    dark_pixels = (bg_val - gray) > 35
    text_ratio = float(np.sum(dark_pixels)) / gray.size

    # 4. Connected character components
    thresh_cutoff = max(0, min(255, int(bg_val - 35)))
    _, binary = cv.threshold(gray, thresh_cutoff, 255, cv.THRESH_BINARY_INV)
    cnts, _ = cv.findContours(binary, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    letter_cnts = 0
    for c in cnts:
        x, y, w, h = cv.boundingRect(c)
        area = cv.contourArea(c)
        if 5 <= h <= 45 and 2 <= w <= 80 and 8 <= area <= 600:
            letter_cnts += 1

    return (edge_ratio > 0.008 and text_ratio > min_text_density) or letter_cnts >= 3


def activity_boundry_to_activity_info(
    timetable_intersection_points: list[tuple[int, int]],
    activity_boundry_as_intersection_points: list[tuple[int, int]],
    atomic_size: tuple[float, float],
    col_dividers: list[int] | None = None,
    day_intervals: list[tuple[int, int]] | None = None,
) -> ActivityInfo:
    """
    Calculates the schedule information for a single activity from its grid geometry.

    Determines:
      - Weekday (Monday-Friday) from vertical row placement or explicit day cells.
      - Start and end time from horizontal column coverage or canonical hour dividers.
      - Vertical covering ('full', 'halves', 'quarters') and vertical slot index.
    """
    atomic_width, atomic_height = atomic_size

    act_left_x = min(p[0] for p in activity_boundry_as_intersection_points)
    act_top_y = min(p[1] for p in activity_boundry_as_intersection_points)
    act_right_x = max(p[0] for p in activity_boundry_as_intersection_points)
    act_bottom_y = max(p[1] for p in activity_boundry_as_intersection_points)

    # 1. Determine Start & End Hour
    if col_dividers and len(col_dividers) >= 2:
        start_idx = min(range(len(col_dividers) - 1), key=lambda i: abs(col_dividers[i] - act_left_x))
        end_idx = min(range(start_idx + 1, len(col_dividers)), key=lambda i: abs(col_dividers[i] - act_right_x))
        start_hour = 8 + start_idx
        end_hour = 8 + end_idx - 1
    else:
        tt_left_x = min(p[0] for p in timetable_intersection_points)
        start_col = max(0, int(round((act_left_x - tt_left_x) / atomic_width))) if atomic_width > 0 else 0
        num_cols = max(1, int(round((act_right_x - act_left_x) / atomic_width))) if atomic_width > 0 else 1
        end_col = start_col + num_cols - 1
        start_hour = 8 + start_col
        end_hour = 8 + end_col

    # 2. Determine Weekday and Vertical Covering
    act_h = act_bottom_y - act_top_y
    if day_intervals and len(day_intervals) > 0:
        y_mid = (act_top_y + act_bottom_y) / 2.0
        day_index = min(
            range(len(day_intervals)),
            key=lambda d: abs((day_intervals[d][0] + day_intervals[d][1]) / 2.0 - y_mid),
        )
        day_index = max(0, min(len(WEEKDAYS) - 1, day_index))
        weekday = WEEKDAYS[day_index]

        day_top_y, day_bottom_y = day_intervals[day_index]
        day_h = max(1.0, float(day_bottom_y - day_top_y))
        atomic_quarter_h = day_h / 4.0

        num_quarters = max(1, int(round(act_h / atomic_quarter_h)))
        offset_y = act_top_y - day_top_y
        quarter_offset = max(0, min(3, int(round(offset_y / atomic_quarter_h))))
        full_threshold = 0.70 * day_h
        half_threshold = 0.35 * day_h
    else:
        tt_top_y = min(p[1] for p in timetable_intersection_points)
        day_height = 4.0 * atomic_height if atomic_height > 0 else 1.0
        day_index = max(0, min(4, int((act_top_y - tt_top_y + 0.1 * atomic_height) // day_height)))
        weekday = WEEKDAYS[day_index]

        num_quarters = max(1, int(round(act_h / atomic_height))) if atomic_height > 0 else 1
        day_top_y = tt_top_y + day_index * day_height
        offset_y = act_top_y - day_top_y
        quarter_offset = max(0, min(3, int(round(offset_y / atomic_height)))) if atomic_height > 0 else 0
        full_threshold = 0.70 * day_height
        half_threshold = 0.35 * day_height

    if num_quarters >= 4 or act_h >= full_threshold:
        covering = ActivityCovering.FULL
        index_in_covering = 0
    elif num_quarters >= 2 or act_h >= half_threshold:
        covering = ActivityCovering.HALVES
        index_in_covering = 0 if quarter_offset < 2 else 1
    else:
        covering = ActivityCovering.QUARTERS
        index_in_covering = quarter_offset

    start_time = Time(weekday=weekday, hour=start_hour, minute=0)
    end_time = Time(weekday=weekday, hour=end_hour, minute=50)

    return ActivityInfo(
        start_time=start_time,
        end_time=end_time,
        covering=covering,
        index_in_covering=index_in_covering,
    )


# ---------------------------------------------------------------------------
# Core Processing Routine
# ---------------------------------------------------------------------------
def _process_timetable_sync(path_to_timetable: Path, output_dir: Path) -> dict[str, Any]:
    """
    Synchronous worker executing the computer vision extraction pipeline for a single timetable page.
    Saves image crops to `<output_dir>/images/IMG-<PPP>_AC-<AA>.png` and companion metadata.
    """
    path_to_timetable = Path(path_to_timetable)
    output_dir = Path(output_dir)
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    abs_timetable_path = str(path_to_timetable.resolve())

    if not path_to_timetable.is_file():
        logger.error(f"Timetable file not found: {path_to_timetable}")
        return {
            "timetable_path": abs_timetable_path,
            "preprocessed_activities": [],
        }

    im_orig = cv.imread(str(path_to_timetable))
    if im_orig is None:
        logger.error(f"OpenCV failed to read image at: {path_to_timetable}")
        return {
            "timetable_path": abs_timetable_path,
            "preprocessed_activities": [],
        }

    im_gray = cv.cvtColor(im_orig, cv.COLOR_BGR2GRAY)
    thresh = extract_table_grid(im_gray, 130)

    contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)

    # 1. Detect intersection points where vertical and horizontal level 2 contours meet
    raw_intersections = find_contour_intersections(contours, hierarchy)

    # 2. Snap intersection points to consensus grid coordinates
    intersections = snap_to_grid(raw_intersections)
    if not intersections or len(intersections) < 4:
        logger.warning(f"Insufficient grid intersections ({len(intersections)}) on page: {path_to_timetable.name}")
        return {
            "timetable_path": abs_timetable_path,
            "preprocessed_activities": [],
        }

    # 3. Extract canonical hour column dividers and weekday intervals
    col_dividers, day_intervals, struct_dims = extract_grid_structure(
        contours, hierarchy, intersections, im_orig.shape[:2]
    )

    # Base modular cell dimensions (hour column width, quarter slot height)
    if struct_dims[0] > 0 and struct_dims[1] > 0:
        atomic_w, atomic_h = struct_dims
    else:
        atomic_w, atomic_h = atomic_activity_dimensions(im_orig, intersections)

    if atomic_w <= 0 or atomic_h <= 0:
        logger.warning(f"Invalid atomic dimensions ({atomic_w}x{atomic_h}) on page: {path_to_timetable.name}")
        return {
            "timetable_path": abs_timetable_path,
            "preprocessed_activities": [],
        }

    # 4. Get the four corner bounds of the activity table area
    tt_corners = get_timetable_corners(intersections, col_dividers=col_dividers, day_intervals=day_intervals)

    # 5. Filter activity cell contours (excluding table borders and headers)
    activity_cnts = filter_activity_contours(
        contours,
        hierarchy,
        image_shape=im_orig.shape[:2],
        col_dividers=col_dividers,
        day_intervals=day_intervals,
    )
    if not activity_cnts:
        logger.info(f"No activity contours identified on page: {path_to_timetable.name}")
        return {
            "timetable_path": abs_timetable_path,
            "preprocessed_activities": [],
        }

    # 6. Snap contours to corner intersections and filter out empty cells via ink detection
    img_h, img_w = im_orig.shape[:2]
    seen_bounds = set()
    activities: list[dict[str, Any]] = []

    for c in activity_cnts:
        bound = snap_contour_to_corners(c, intersections)
        bound_key = (bound[0], bound[3])
        if bound_key in seen_bounds:
            continue

        x1 = max(0, min(p[0] for p in bound))
        y1 = max(0, min(p[1] for p in bound))
        x2 = min(img_w, max(p[0] for p in bound))
        y2 = min(img_h, max(p[1] for p in bound))

        if x2 <= x1 + 4 or y2 <= y1 + 4:
            continue

        # Inset slightly to avoid border grid lines when verifying ink presence
        check_crop = im_orig[y1 + 2 : y2 - 2, x1 + 2 : x2 - 2]
        if check_crop.size == 0 or not is_crop_an_activity(check_crop):
            continue

        seen_bounds.add(bound_key)
        full_crop = im_orig[y1:y2, x1:x2]
        info = activity_boundry_to_activity_info(
            tt_corners,
            bound,
            (atomic_w, atomic_h),
            col_dividers=col_dividers,
            day_intervals=day_intervals,
        )

        activities.append({
            "bound": bound,
            "info": info,
            "crop": full_crop,
        })

    # 7. Sort activities in reading order (top-to-bottom, left-to-right)
    activities.sort(key=lambda a: (a["bound"][0][1] // 20, a["bound"][0][0]))

    # 8. Extract page identifier prefix and serialize activities
    # Pattern: IMG-<file_prefix_padded_3>_AC-<act_idx_padded_2>
    raw_page_prefix = path_to_timetable.name.split(".")[0]
    padded_page = f"{int(raw_page_prefix):03d}" if raw_page_prefix.isdigit() else raw_page_prefix.zfill(3)

    preprocessed_activities: list[dict[str, Any]] = []

    for act_idx, item in enumerate(activities):
        padded_act = f"{act_idx:02d}"
        base_name = f"IMG-{padded_page}_AC-{padded_act}"

        info: ActivityInfo = item["info"]
        bound = item["bound"]
        crop = item["crop"]

        # Save cropped activity image
        img_file_path = images_dir / f"{base_name}.png"
        cv.imwrite(str(img_file_path), crop)

        act_record = {
            "path": str(img_file_path.resolve()),
            "weekday": info.start_time.weekday,
            "covering": info.covering.value if hasattr(info.covering, "value") else str(info.covering),
            "index_in_covering": info.index_in_covering,
            "start_time": {
                "weekday": info.start_time.weekday,
                "hour": info.start_time.hour,
                "minute": info.start_time.minute,
            },
            "end_time": {
                "weekday": info.end_time.weekday,
                "hour": info.end_time.hour,
                "minute": info.end_time.minute,
            },
            "corners": [list(pt) for pt in bound],
        }

        preprocessed_activities.append(act_record)

    logger.debug(f"Extracted {len(preprocessed_activities)} activities from {path_to_timetable.name}")

    return {
        "timetable_path": abs_timetable_path,
        "preprocessed_activities": preprocessed_activities,
    }


async def process_timetable(path_to_timetable: Path) -> dict[str, Any]:
    """
    Asynchronous entry point to process a single timetable page image.
    Offloads CPU-intensive OpenCV and image serialization work to a worker thread.

    Returns:
        dict: Object adhering to the Response TypeScript interface:
              {
                  timetable_path: string,
                  preprocessed_activities: PreprocessedActivity[],
              }
    """
    return await asyncio.to_thread(_process_timetable_sync, Path(path_to_timetable), OUTPUT_DIR)


# ---------------------------------------------------------------------------
# Main Pipeline Routine
# ---------------------------------------------------------------------------
async def main():
    """
    Main orchestration routine:
      1. Loads environment variables.
      2. Reads `<PIPELINE_DATA_DIR>/categorization.json` to filter pages with `is_timetable=True`.
      3. Dispatches parallel `process_timetable` worker tasks across available CPU cores using `aiometer`.
      4. Saves aggregated preprocessed activity results to `<OUTPUT_DIR>/data.json`.
    """
    logger.info("Initializing Deterministic Timetable Grid Parsing & Activity Cell Preprocessing Pipeline...")
    loadEnv()

    categorization_path = PIPELINE_DATA_DIR / "categorization.json"
    if not categorization_path.is_file():
        raise FileNotFoundError(
            f"Categorization file '{categorization_path}' does not exist. "
            f"Please run '20_categorize_pages.py' first to classify pages before preprocessing activities."
        )

    categorization_data = json.loads(categorization_path.read_text(encoding="utf-8"))
    logger.info(f"Loaded {len(categorization_data)} page records from {categorization_path}")

    # Extract pages classified as timetables (is_timetable=True)
    timetable_paths = [
        Path(item["path"])
        for item in categorization_data
        if item.get("is_timetable") is True
    ]

    logger.info(
        f"Found {len(timetable_paths)} timetable pages to process out of {len(categorization_data)} total pages."
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "images").mkdir(parents=True, exist_ok=True)

    # Launch parallel jobs using aiometer
    logger.info(f"Launching parallel activity extraction jobs (max_at_once={MAX_CONCURRENT})...")
    jobs = [
        functools.partial(process_timetable, path)
        for path in timetable_paths
    ]

    results = await aiometer.run_all(jobs, max_at_once=MAX_CONCURRENT)

    total_activities = sum(len(r.get("preprocessed_activities", [])) for r in results)
    logger.info(
        f"Activity preprocessing complete: extracted {total_activities} activities across {len(results)} timetables."
    )

    # Save summary index to data.json
    summary_output_file = OUTPUT_DIR / "data.json"
    summary_output_file.write_text(
        json.dumps(results, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info(f"Saved aggregated preprocessed activities index to {summary_output_file}")


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
