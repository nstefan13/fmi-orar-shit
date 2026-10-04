import asyncio
import functools
import json
import os
from collections import Counter
from pathlib import Path
from pprint import pprint

import aiometer
import cv2 as cv
import numpy as np
from enum import Enum
from pydantic import BaseModel
from vision_response import Time

IMAGES_PATH = "./Orar-Shi2/extracted_images"
OUTPUT_PATH = "./Orrash 2 extracted activities"
MAX_CONCURRENT = os.cpu_count() or 8

HIERARCHY_COLORS = [
    (0, 0, 255),      # Level 0: Red
    (0, 255, 0),      # Level 1: Green
    (255, 0, 0),      # Level 2: Blue
    (0, 255, 255),    # Level 3: Yellow
    (255, 0, 255),    # Level 4: Magenta
    (255, 255, 0),    # Level 5: Cyan
    (0, 165, 255),    # Level 6: Orange
    (180, 105, 255),  # Level 7: Pink
]

COLUMN_COLORS = [
    # (255, 0, 0),      # Blue
    (0, 0, 255),      # Red
    # (0, 165, 255),    # Orange
]


def draw_contour_hierarchy(image, contours, hierarchy, thickness=2, draw_legend=True):
    out = image.copy()
    if hierarchy is None or len(contours) == 0:
        return out

    h = hierarchy[0]
    depths = []
    for idx in range(len(contours)):
        depth = 0
        parent = h[idx][3]
        while parent != -1:
            depth += 1
            parent = h[parent][3]
        depths.append(depth)

    # Draw each contour with a color corresponding to its hierarchy depth
    for idx, cnt in enumerate(contours):
        color = HIERARCHY_COLORS[depths[idx] % len(HIERARCHY_COLORS)]
        cv.drawContours(out, [cnt], -1, color, thickness)

    # Draw legend overlay
    if draw_legend:
        present_depths = sorted(set(depths))
        x, y = 30, 40
        box_size = 25
        spacing = 35
        for d in present_depths:
            color = HIERARCHY_COLORS[d % len(HIERARCHY_COLORS)]
            cv.rectangle(out, (x, y), (x + box_size, y + box_size), color, -1)
            cv.rectangle(out, (x, y), (x + box_size, y + box_size), (0, 0, 0), 2)
            label = f"Level {d}"
            cv.putText(out, label, (x + box_size + 12, y + 20), cv.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 3)
            cv.putText(out, label, (x + box_size + 12, y + 20), cv.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            y += spacing

    return out


def extract_table_grid(gray, thresh_val=130):
    """
    Extracts only the horizontal and vertical grid lines of the timetable,
    filtering out all text and letters.
    """
    _, thresh_inv = cv.threshold(gray, thresh_val, 255, cv.THRESH_BINARY_INV)

    # Kernels long enough to eliminate letters while keeping timetable grid lines
    h_kernel_len = max(gray.shape[1] // 30, 80)
    v_kernel_len = max(gray.shape[0] // 20, 80)

    h_kernel = cv.getStructuringElement(cv.MORPH_RECT, (h_kernel_len, 1))
    v_kernel = cv.getStructuringElement(cv.MORPH_RECT, (1, v_kernel_len))

    # Keep only horizontal and vertical lines
    h_lines = cv.morphologyEx(thresh_inv, cv.MORPH_OPEN, h_kernel)
    v_lines = cv.morphologyEx(thresh_inv, cv.MORPH_OPEN, v_kernel)

    # Combine grid lines
    table_grid = cv.add(h_lines, v_lines)

    # Invert back so cells are white and grid lines are black (matching original binary format)
    clean_thresh = cv.bitwise_not(table_grid)
    return clean_thresh


def show_img(*images):
    images = list(images)
    if not images:
        return

    for index, img in enumerate(images):
        cv.namedWindow(str(index), cv.WINDOW_NORMAL)
        cv.imshow(str(index), img)

    cv.waitKey(0)
    cv.destroyAllWindows()


def draw_column_borders(
    contours,
    image,
    hierarchy=None,
    line_thickness: int = 2,
    contour_thickness: int = 2,
    line_colors: tuple | list = COLUMN_COLORS,
    contour_color: tuple = (0, 255, 0),   # Green (BGR)
    alpha: float = 0.5,                   # Line opacity (0.0 transparent to 1.0 opaque)
    line_color: tuple = None,             # Optional single color override for backwards compatibility
):
    """
    Pipeline step that draws the green table contour and thin vertical lines
    separating each timetable column, alternating between different colors with
    reduced opacity so they blend with the text instead of covering it.

    Accepts (contours, image) or (image, contours).
    Optional parameters: hierarchy, line_thickness, contour_thickness, line_colors, contour_color, alpha.
    """
    # Support single line_color override if provided
    if line_color is not None:
        line_colors = [line_color]

    # Support both (contours, image) and (image, contours) argument order
    if isinstance(contours, np.ndarray) and isinstance(image, (list, tuple)):
        contours, image = image, contours

    out = image.copy()
    if contours is None or len(contours) == 0:
        return out

    img_h, img_w = out.shape[:2]

    # Identify tables and their child cells
    tables = []
    if hierarchy is not None and len(hierarchy) > 0 and len(contours) > 0:
        h = hierarchy[0]
        depths = []
        for idx in range(len(contours)):
            d = 0
            p = h[idx][3]
            while p != -1:
                d += 1
                p = h[p][3]
            depths.append(d)

        table_indices = [
            i for i, d in enumerate(depths)
            if d == 1 and cv.contourArea(contours[i]) > 5000
        ]
        for t_idx in table_indices:
            t_cnt = contours[t_idx]
            children = [contours[i] for i in range(len(contours)) if h[i][3] == t_idx]
            tables.append((t_cnt, children))
    else:
        # Fallback if hierarchy is not provided: detect geometrically
        valid = []
        for c in contours:
            bx, by, bw, bh = cv.boundingRect(c)
            if bw >= img_w - 5 and bh >= img_h - 5:
                continue
            valid.append(c)

        candidates = [
            c for c in valid
            if cv.boundingRect(c)[2] > img_w * 0.15 and cv.contourArea(c) > 10000
        ]
        table_cnts = []
        for c in candidates:
            bx, by, bw, bh = cv.boundingRect(c)
            is_inner = False
            for oc in candidates:
                if c is oc:
                    continue
                ox, oy, ow, oh = cv.boundingRect(oc)
                if ox <= bx and oy <= by and ox + ow >= bx + bw and oy + oh >= by + bh:
                    is_inner = True
                    break
            if not is_inner:
                table_cnts.append(c)

        for t_cnt in table_cnts:
            tx, ty, tw, th = cv.boundingRect(t_cnt)
            children = []
            for c in valid:
                if c is t_cnt:
                    continue
                bx, by, bw, bh = cv.boundingRect(c)
                if tx <= bx and ty <= by and bx + bw <= tx + tw + 2 and by + bh <= ty + th + 2:
                    if bw < tw * 0.95 or bh < th * 0.95:
                        children.append(c)
            tables.append((t_cnt, children))

    for t_cnt, children in tables:
        # Draw the green contour around the table
        cv.drawContours(out, [t_cnt], -1, contour_color, contour_thickness)

        tx, ty, tw, th = cv.boundingRect(t_cnt)
        if not children:
            continue

        # Extract vertical boundary candidates from child cells
        child_boxes = [cv.boundingRect(c) for c in children]
        x_candidates = []
        for bx, by, bw, bh in child_boxes:
            if abs(bx - tx) > 10 and abs(bx - (tx + tw)) > 10:
                x_candidates.append(bx)
            if abs(bx + bw - tx) > 10 and abs(bx + bw - (tx + tw)) > 10:
                x_candidates.append(bx + bw)

        if not x_candidates:
            continue

        # Cluster candidate x coordinates
        x_candidates.sort()
        groups = []
        for x in x_candidates:
            if not groups or x > groups[-1][-1] + 8:
                groups.append([x])
            else:
                groups[-1].append(x)

        col_xs = [int(round(np.mean(g))) for g in groups]

        # Determine line alphas (supports per-color alpha if tuple has 4 elements)
        alphas = [
            float(raw[3]) if len(raw) == 4 else float(alpha)
            for raw in [line_colors[i % len(line_colors)] for i in range(len(col_xs))]
        ]

        if len(set(alphas)) == 1 and alphas[0] < 1.0:
            cur_alpha = alphas[0]
            overlay = out.copy()
            for idx, cx in enumerate(col_xs):
                raw_color = line_colors[idx % len(line_colors)]
                line_col = tuple(int(c) for c in raw_color[:3])
                cv.line(overlay, (cx, ty), (cx, ty + th), line_col, line_thickness)
            out = cv.addWeighted(overlay, cur_alpha, out, 1.0 - cur_alpha, 0)
        elif len(set(alphas)) == 1 and alphas[0] >= 1.0:
            for idx, cx in enumerate(col_xs):
                raw_color = line_colors[idx % len(line_colors)]
                line_col = tuple(int(c) for c in raw_color[:3])
                cv.line(out, (cx, ty), (cx, ty + th), line_col, line_thickness)
        else:
            for idx, cx in enumerate(col_xs):
                raw_color = line_colors[idx % len(line_colors)]
                line_col = tuple(int(c) for c in raw_color[:3])
                cur_alpha = float(raw_color[3]) if len(raw_color) == 4 else float(alpha)
                if cur_alpha < 1.0:
                    overlay = out.copy()
                    cv.line(overlay, (cx, ty), (cx, ty + th), line_col, line_thickness)
                    out = cv.addWeighted(overlay, cur_alpha, out, 1.0 - cur_alpha, 0)
                else:
                    cv.line(out, (cx, ty), (cx, ty + th), line_col, line_thickness)

    return out


def find_contour_intersections(
    contours,
    hierarchy=None,
    target_level: int = 2,
    tolerance: int = 3,
    cluster_dist: int = 5,
):
    """
    Pipeline step that filters contours to the specified hierarchy level (Level 2 by default)
    and computes the intersection points wherever horizontal and vertical contour lines meet
    (including cross junctions, T-junctions, and L-corners).

    Accepts:
        contours: list/tuple of contours from cv.findContours
        hierarchy: optional hierarchy array from cv.findContours
        target_level: hierarchy depth to care about (default: 2)
        tolerance: pixel distance threshold for detecting touching/crossing lines
        cluster_dist: pixel distance for merging nearby duplicate points into a single point

    Returns:
        list of (x, y) intersection tuples
    """
    # Defensive argument swapping if hierarchy was passed first
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

        # Cell bounding box boundaries
        bx, by, bw, bh = cv.boundingRect(cnt)
        h_segments.append((by, bx, bx + bw))
        h_segments.append((by + bh, bx, bx + bw))
        v_segments.append((bx, by, by + bh))
        v_segments.append((bx + bw, by, by + bh))

        # Polygon segment boundaries (for non-rectangular / fine contour shapes)
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

    # Find where horizontal and vertical segments meet (crossings, T-junctions, corners)
    raw_points = []
    for y_h, x1, x2 in h_segments:
        min_x, max_x = min(x1, x2) - tolerance, max(x1, x2) + tolerance
        for x_v, y1, y2 in v_segments:
            min_y, max_y = min(y1, y2) - tolerance, max(y1, y2) + tolerance
            if min_x <= x_v <= max_x and min_y <= y_h <= max_y:
                raw_points.append((x_v, y_h))

    # Cluster duplicate / neighboring intersection points
    clusters = []
    for pt in raw_points:
        found = False
        for cl in clusters:
            cx, cy = cl["centroid"]
            if abs(pt[0] - cx) <= cluster_dist and abs(pt[1] - cy) <= cluster_dist:
                cl["points"].append(pt)
                pts = cl["points"]
                cl["centroid"] = (
                    int(round(sum(p[0] for p in pts) / len(pts))),
                    int(round(sum(p[1] for p in pts) / len(pts))),
                )
                found = True
                break
        if not found:
            clusters.append({"centroid": pt, "points": [pt]})

    # Return sorted list of unique (x, y) intersection points
    return sorted(set(cl["centroid"] for cl in clusters), key=lambda p: (p[1], p[0]))


def snap_to_grid(points, threshold: int = 10):
    """
    Pipeline step that aligns near-identical X and Y coordinates to their consensus
    grid line (using frequency/mode clustering within the threshold distance).
    Eliminates rasterization and contour jitter (e.g. 1-2px offsets) so all points
    align to a strict grid.

    Accepts:
        points: list/tuple of (x, y) coordinates
        threshold: maximum distance in pixels to consider two coordinates part of the same grid line

    Returns:
        list of unique, snapped (x, y) coordinates sorted top-to-bottom, left-to-right.
    """
    if not points:
        return []

    def cluster_1d(raw_values):
        counts = Counter(raw_values)
        unique_sorted = sorted(counts.keys())

        clusters = []
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


def draw_intersection_points(
    image,
    points,
    radius: int = 6,
    color: tuple = (0, 0, 255),  # Red in BGR
    thickness: int = -1,         # Solid filled dot
):
    """
    Pipeline step that draws medium-sized red dots at each intersection point
    onto the provided image.

    Accepts (image, points) or (points, image).
    Returns a copy of the image with the intersection points drawn.
    """
    # Support both (image, points) and (points, image) argument order
    if isinstance(image, (list, tuple)) and isinstance(points, np.ndarray):
        image, points = points, image

    if image is None:
        return None

    out = image.copy()
    if points is None:
        return out

    for pt in points:
        if len(pt) >= 2:
            x, y = int(round(pt[0])), int(round(pt[1]))
            cv.circle(out, (x, y), radius, color, thickness)

    return out


def filter_activity_contours(contours, hierarchy=None, image_shape=None):
    """
    Filters out outer borders, the top header row (hours), and the left
    header column (days), leaving only the contours for actual timetable activities.
    """
    if contours is None or len(contours) == 0:
        return []

    # If hierarchy is provided, isolate level 2 contours (inner cells)
    if hierarchy is not None and len(hierarchy) > 0:
        h = hierarchy[0]
        depths = []
        for idx in range(len(contours)):
            d = 0
            p = h[idx][3]
            while p != -1:
                d += 1
                p = h[p][3]
            depths.append(d)
        candidate_contours = [contours[i] for i, d in enumerate(depths) if d == 2]
    else:
        # Fallback if no hierarchy: ignore outer table/image frames
        max_w = image_shape[1] * 0.9 if image_shape else 1400
        max_h = image_shape[0] * 0.9 if image_shape else 900
        candidate_contours = [
            c for c in contours
            if cv.boundingRect(c)[2] < max_w and cv.boundingRect(c)[3] < max_h
        ]

    if not candidate_contours:
        return []

    min_x = min(cv.boundingRect(c)[0] for c in candidate_contours)
    min_y = min(cv.boundingRect(c)[1] for c in candidate_contours)

    # Exclude leftmost Day column (x <= min_x + 50) and top Hours header row (y <= min_y + 40)
    activity_contours = [
        c for c in candidate_contours
        if cv.boundingRect(c)[0] > min_x + 50 and cv.boundingRect(c)[1] > min_y + 40
    ]
    return activity_contours


def crop_activity_cells(
    image,
    activity_contours,
    sort: bool = True,
    margin: int = 0,
    include_bbox: bool = False,
):
    """
    Pipeline step (generator) that receives the activity contours and yields
    the cropped image slice for each activity cell.

    Parameters:
        image: source image (np.ndarray) to crop from.
        activity_contours: list of contours representing the activity cells.
        sort: whether to yield crops in reading order (top-to-bottom, left-to-right).
        margin: optional inset in pixels to trim border lines if desired.
        include_bbox: if True, yields (cropped_image, (x, y, w, h)). If False, yields cropped_image.

    Yields:
        np.ndarray cropped image slice (or tuple with bbox if include_bbox=True).
    """
    if image is None or activity_contours is None or len(activity_contours) == 0:
        return

    contours_to_crop = list(activity_contours)
    if sort:
        contours_to_crop.sort(
            key=lambda c: (cv.boundingRect(c)[1] // 30, cv.boundingRect(c)[0])
        )

    img_h, img_w = image.shape[:2]

    for cnt in contours_to_crop:
        x, y, w, h = cv.boundingRect(cnt)
        x1 = max(0, x + margin)
        y1 = max(0, y + margin)
        x2 = min(img_w, x + w - margin)
        y2 = min(img_h, y + h - margin)

        if x2 > x1 and y2 > y1:
            crop = image[y1:y2, x1:x2]
            if include_bbox:
                yield crop, (x1, y1, x2 - x1, y2 - y1)
            else:
                yield crop


def is_crop_an_activity(crop, min_contrast: float = 5.0, min_text_density: float = 0.005) -> bool:
    """
    Determines whether a cropped cell contains an actual timetable activity
    or is just empty white/background space using text/ink detection heuristics.

    Heuristics:
    1. Low variance/contrast: uniform empty cells have standard deviation near 0.
    2. Edge density: text characters create sharp, high-contrast Canny edges.
    3. Relative ink ratio: text characters are significantly darker than the local background.
    4. Letter-like components: text characters form small connected components.
    """
    if crop is None or crop.size == 0:
        return False

    gray = cv.cvtColor(crop, cv.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

    # 1. Variance / Contrast: uniform empty cells have std near 0
    if float(np.std(gray)) < min_contrast:
        return False

    # 2. Text edge detection (Canny)
    edges = cv.Canny(gray, 50, 150)
    edge_ratio = float(np.sum(edges > 0)) / edges.size

    # 3. Relative ink detection (darker than local background)
    bg_val = float(np.median(gray))
    dark_pixels = (bg_val - gray) > 35
    text_ratio = float(np.sum(dark_pixels)) / gray.size

    # 4. Connected character components
    _, binary = cv.threshold(gray, int(bg_val - 35), 255, cv.THRESH_BINARY_INV)
    cnts, _ = cv.findContours(binary, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    letter_cnts = 0
    for c in cnts:
        x, y, w, h = cv.boundingRect(c)
        area = cv.contourArea(c)
        if 5 <= h <= 45 and 2 <= w <= 80 and 8 <= area <= 600:
            letter_cnts += 1

    return (edge_ratio > 0.008 and text_ratio > min_text_density) or letter_cnts >= 3


def identify_real_activities(activity_crops):
    """
    Generator that filters activity crops, yielding only those containing real activities.
    Supports iterating over raw crops (np.ndarray) or (crop, metadata) tuples.
    """
    for item in activity_crops:
        crop = item[0] if isinstance(item, (tuple, list)) else item
        if is_crop_an_activity(crop):
            yield item


def draw_colored_rectangles(
    image,
    contours,
    alpha: float = 0.35,
    border_thickness: int = 2,
    colors: list = None,
):
    """
    Draws translucent colored rectangles with solid border outlines over the image
    for each contour provided.

    Parameters:
        image: base image (np.ndarray) to draw on.
        contours: list of contours (or single contour) defining the rectangles.
        alpha: opacity of the fill color (0.0 transparent to 1.0 opaque).
        border_thickness: line thickness of the rectangle border (set <= 0 to skip border).
        colors: optional list of BGR color tuples. If None, generates distinct vibrant colors.

    Returns:
        New image copy with the colored rectangles drawn on it.
    """
    if image is None:
        return None
    out = image.copy()
    if contours is None or len(contours) == 0:
        return out

    # Handle single contour passed directly instead of a list
    if (
        isinstance(contours, np.ndarray)
        and contours.ndim in (2, 3)
        and len(contours) > 0
        and isinstance(contours[0][0], (int, np.integer, float, np.floating))
    ):
        contours = [contours]

    overlay = image.copy()
    num_cnts = len(contours)

    for idx, c in enumerate(contours):
        if c is None or len(c) == 0:
            continue
        bx, by, bw, bh = cv.boundingRect(c)

        if colors and len(colors) > idx:
            color = colors[idx]
        elif colors and len(colors) > 0:
            color = colors[idx % len(colors)]
        else:
            # Generate vibrant distinct BGR color using HSV hue spacing
            hue = int((idx * 37) % 180) if num_cnts > 1 else 10
            hsv = np.uint8([[[hue, 220, 240]]])
            bgr = cv.cvtColor(hsv, cv.COLOR_HSV2BGR)[0][0]
            color = (int(bgr[0]), int(bgr[1]), int(bgr[2]))

        # Fill translucent rectangle on overlay
        cv.rectangle(overlay, (bx, by), (bx + bw, by + bh), color, -1)
        # Draw solid contour border outline
        if border_thickness > 0:
            cv.rectangle(out, (bx, by), (bx + bw, by + bh), color, border_thickness)

    out = cv.addWeighted(overlay, alpha, out, 1.0 - alpha, 0)
    return out


def atomic_activity_dimensions(img_orig, intersections=None):
    """
    Computes the atomic (base unit) dimensions (atomic_width, atomic_height) of timetable cells.

    Receives the original image (or image path), and optionally precomputed intersections.
    Uses the snapped intersection points:
      - from the far left (same minimum X, different Y) representing the weekdays;
        their average distance gives the weekday height, which divided by 4 gives atomic_height.
      - from the top (same minimum Y, different X) representing the time intervals;
        their average distance gives atomic_width.

    Returns:
        tuple: (atomic_width, atomic_height)
    """
    if intersections is None:
        if isinstance(img_orig, (str, Path)):
            img_orig = cv.imread(str(img_orig))
        if img_orig is None:
            return (0.0, 0.0)

        gray = cv.cvtColor(img_orig, cv.COLOR_BGR2GRAY) if img_orig.ndim == 3 else img_orig
        thresh = extract_table_grid(gray, thresh_val=130)
        contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
        raw_intersections = find_contour_intersections(contours, hierarchy)
        snapped = snap_to_grid(raw_intersections)
    else:
        snapped = snap_to_grid(intersections)

    if not snapped or len(snapped) < 2:
        return (0.0, 0.0)

    # 1. Intersection points from the far left - same min x, different y (weekdays)
    min_x = min(p[0] for p in snapped)
    far_left = sorted([p for p in snapped if p[0] == min_x], key=lambda p: p[1])

    # 2. Intersection points from the top - same min y, different x (time intervals)
    min_y = min(p[1] for p in snapped)
    top_row = sorted([p for p in snapped if p[1] == min_y], key=lambda p: p[0])

    # Average distance between time intervals (top row)
    if len(top_row) > 1:
        col_diffs = [top_row[i + 1][0] - top_row[i][0] for i in range(len(top_row) - 1)]
        atomic_width = float(np.mean(col_diffs))
    else:
        atomic_width = 0.0

    # Average distance between weekdays (far left) / 4 (quarter slots)
    if len(far_left) > 1:
        row_diffs = [far_left[i + 1][1] - far_left[i][1] for i in range(len(far_left) - 1)]
        avg_day_height = float(np.mean(row_diffs))
        atomic_height = avg_day_height / 4.0
    else:
        atomic_height = 0.0

    return (round(atomic_width, 2), round(atomic_height, 2))


def draw_atomic_activity_references(
    image,
    snapped_intersections=None,
    top_color: tuple = (255, 255, 0),     # Cyan (BGR)
    left_color: tuple = (0, 165, 255),    # Orange (BGR)
    radius: int = 7,
):
    """
    Draws the reference intersection points used to compute the atomic activity dimensions:
    - Top row points along minimum Y in cyan (time interval headers)
    - Far-left points along minimum X in orange (weekday row headers)
    - Connecting reference lines along the headers

    Accepts:
        image: base image (np.ndarray)
        snapped_intersections: optional list of snapped (x, y) points (computed if None)
    """
    if image is None:
        return None

    if snapped_intersections is None:
        gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY) if image.ndim == 3 else image
        thresh = extract_table_grid(gray, thresh_val=130)
        contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
        raw_intersections = find_contour_intersections(contours, hierarchy)
        snapped_intersections = snap_to_grid(raw_intersections)

    out = image.copy()
    if not snapped_intersections:
        return out

    min_x = min(p[0] for p in snapped_intersections)
    min_y = min(p[1] for p in snapped_intersections)

    far_left = sorted([p for p in snapped_intersections if p[0] == min_x], key=lambda p: p[1])
    top_row = sorted([p for p in snapped_intersections if p[1] == min_y], key=lambda p: p[0])

    # Connecting reference line for top row (time intervals)
    if len(top_row) > 1:
        cv.line(out, (top_row[0][0], min_y), (top_row[-1][0], min_y), (200, 200, 0), 2)

    # Connecting reference line for far left (weekdays)
    if len(far_left) > 1:
        cv.line(out, (min_x, far_left[0][1]), (min_x, far_left[-1][1]), (0, 140, 220), 2)

    # Draw top row points
    for pt in top_row:
        cv.circle(out, pt, radius, top_color, -1)
        cv.circle(out, pt, radius + 1, (0, 0, 0), 2)

    # Draw far left points
    for pt in far_left:
        cv.circle(out, pt, radius, left_color, -1)
        cv.circle(out, pt, radius + 1, (0, 0, 0), 2)

    return out


WEEKDAYS = ["Luni", "Marti", "Miercuri", "Joi", "Vineri"]


class ActivityCovering(Enum):
    FULL = "full"
    HALVES = "halves"
    QUARTERS = "quarters"


class ActivityInfo(BaseModel):
    start_time: Time
    end_time: Time
    covering: ActivityCovering
    index_in_covering: int


def snap_contour_to_corners(contour, points):
    """
    Snaps a contour bounding box to the closest four intersection points
    so that it forms a rectangle aligned with the timetable grid.

    Returns:
        A list of four (x, y) intersection tuples in the order:
        [top-left, top-right, bottom-left, bottom-right].
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


def get_timetable_corners(intersections):
    """
    Finds the four corner intersection points that represent the boundaries
    of the actual timetable activity area (excluding the day header column on the left
    and the hour header row on top).

    Returns:
        [top-left, top-right, bottom-left, bottom-right]
    """
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


def draw_activity_corner_rectangles(
    image,
    activity_boundaries,
    alpha: float = 0.35,
    border_thickness: int = 2,
    draw_corner_dots: bool = True,
    corner_radius: int = 4,
    colors: list = None,
):
    """
    Overlays rectangles defined by corner intersection points on top of the original image
    using different vibrant colors, and optionally marks the four corner points.
    """
    if image is None:
        return None
    out = image.copy()
    if not activity_boundaries:
        return out

    overlay = image.copy()
    num = len(activity_boundaries)

    for idx, bound in enumerate(activity_boundaries):
        tl, tr, bl, br = bound
        x1 = min(p[0] for p in bound)
        y1 = min(p[1] for p in bound)
        x2 = max(p[0] for p in bound)
        y2 = max(p[1] for p in bound)

        if colors and len(colors) > idx:
            color = colors[idx]
        elif colors and len(colors) > 0:
            color = colors[idx % len(colors)]
        else:
            hue = int((idx * 37) % 180) if num > 1 else 10
            hsv = np.uint8([[[hue, 220, 240]]])
            bgr = cv.cvtColor(hsv, cv.COLOR_HSV2BGR)[0][0]
            color = (int(bgr[0]), int(bgr[1]), int(bgr[2]))

        cv.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        if border_thickness > 0:
            cv.rectangle(out, (x1, y1), (x2, y2), color, border_thickness)

        if draw_corner_dots:
            for pt in [tl, tr, bl, br]:
                cv.circle(out, pt, corner_radius, (0, 0, 255), -1)
                cv.circle(out, pt, corner_radius + 1, (0, 0, 0), 1)

    out = cv.addWeighted(overlay, alpha, out, 1.0 - alpha, 0)
    return out


def activity_boundry_to_activity_info(timetable_intersection_points, activity_boundry_as_intersection_points, atomic_size):
    """
    This function calculates the timetable schedule information for a single activity.

    It receives three arguments. The first argument is timetable_intersection_points, which is a list of four corner intersection points for the main activity area of the timetable. The second argument is activity_boundry_as_intersection_points, which contains four intersection points representing the top-left, top-right, bottom-left, and bottom-right corners of the activity rectangle. The third argument is atomic_size, which is a pair of numbers containing the atomic width of one hour column and the atomic height of one quarter-slot.

    The function works by measuring coordinates on the timetable grid. First, it finds the left edge and top edge of the whole timetable. Next, it looks at the horizontal position of the activity top-left corner and subtracts the timetable left edge. When we divide this distance by the atomic width, we get the start column index. Because column zero represents the time interval from 8:00 to 8:50, each next column increases the time by one hour. The width of the activity divided by the atomic width shows how many columns the activity spans. The start hour begins at minute 0, and the end hour ends at minute 50 of the final covered column.

    Next, the function finds the day of the week by looking at the vertical position of the activity top-left corner compared to the top edge of the timetable. One full day row has a height equal to four atomic quarters, and the timetable has five weekdays from Monday to Friday. The function calculates which day row contains the activity and chooses the corresponding Romanian weekday name.

    Finally, the function determines the vertical covering and the position index. It calculates the height of the activity in terms of atomic quarter units. If the activity covers four quarters, it is classified as full covering with an index of 0. If it covers two quarters, it is classified as halves, where an index of 0 means it occupies the top half and an index of 1 means it occupies the bottom half. If it covers one quarter, it is classified as quarters, where the index is 0, 1, 2, or 3 depending on which vertical quarter slot it fills from top to bottom.

    The function returns an ActivityInfo object that contains the start time, the end time, the covering type, and the vertical slot index inside that covering.
    """
    atomic_width, atomic_height = atomic_size

    # We read the outer bounds of the timetable activity area
    tt_left_x = min(p[0] for p in timetable_intersection_points)
    tt_top_y = min(p[1] for p in timetable_intersection_points)

    # We read the four corners of the activity boundary
    act_left_x = min(p[0] for p in activity_boundry_as_intersection_points)
    act_top_y = min(p[1] for p in activity_boundry_as_intersection_points)
    act_right_x = max(p[0] for p in activity_boundry_as_intersection_points)
    act_bottom_y = max(p[1] for p in activity_boundry_as_intersection_points)

    # We determine which hour columns are covered by this activity
    # Column 0 represents the 8:00 to 8:50 time interval, so every column adds one hour
    start_col = max(0, int(round((act_left_x - tt_left_x) / atomic_width)))
    num_cols = max(1, int(round((act_right_x - act_left_x) / atomic_width)))
    end_col = start_col + num_cols - 1

    start_hour = 8 + start_col
    end_hour = 8 + end_col

    # We determine the weekday row by checking how far down the activity starts
    # Every day has a height equal to four atomic quarters
    day_height = 4.0 * atomic_height
    day_index = max(0, min(4, int((act_top_y - tt_top_y + 0.1 * atomic_height) // day_height)))
    weekday = WEEKDAYS[day_index]

    start_time = Time(weekday=weekday, hour=start_hour, minute=0)
    end_time = Time(weekday=weekday, hour=end_hour, minute=50)

    # We determine the covering type and the slot index inside that covering
    # The height in atomic units tells us if the activity is full, half, or quarter size
    act_h = act_bottom_y - act_top_y
    num_quarters = max(1, int(round(act_h / atomic_height)))

    day_top_y = tt_top_y + day_index * day_height
    offset_y = act_top_y - day_top_y
    quarter_offset = max(0, min(3, int(round(offset_y / atomic_height))))

    if num_quarters >= 4:
        covering = ActivityCovering.FULL
        index_in_covering = 0
    elif num_quarters >= 2:
        covering = ActivityCovering.HALVES
        index_in_covering = 0 if quarter_offset < 2 else 1
    else:
        covering = ActivityCovering.QUARTERS
        index_in_covering = quarter_offset

    return ActivityInfo(
        start_time=start_time,
        end_time=end_time,
        covering=covering,
        index_in_covering=index_in_covering,
    )


activity_boundary_to_activity_info = activity_boundry_to_activity_info


def process_image(image_path: Path, output_dir: Path) -> int:
    """
    Processes a timetable image and extracts all detected didactic activities into output_dir.

    For each identified activity:
      - Saves the cropped image as an incremental ID: '1.png', '2.png', '3.png', ...
      - Saves the corresponding metadata as: '1.png.json', '2.png.json', ...
        containing start_time, end_time, time_interval, covering, index_in_covering, and corners.

    Returns:
        int: Number of activities extracted.
    """
    image_path = Path(image_path)
    output_dir = Path(output_dir)

    # If root activities directory was passed, route into page subfolder;
    # otherwise, use output_dir directly so caller has full control.
    page_name = image_path.stem
    if output_dir.name in {"Orrash 2 extracted activities", "Orar-Shi2 extracted activities", "extracted_activities"}:
        target_dir = output_dir / page_name
    else:
        target_dir = output_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    im_orig = cv.imread(str(image_path))
    if im_orig is None:
        print(f"Warning: Failed to read {image_path}")
        return 0

    im_gray = cv.cvtColor(im_orig, cv.COLOR_BGR2GRAY)
    thresh = extract_table_grid(im_gray, 130)

    contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)

    # 1. Detect intersection points where vertical and horizontal level 2 contours meet
    raw_intersections = find_contour_intersections(contours, hierarchy)

    # 2. Snap intersection points to eliminate rasterization jitter
    intersections = snap_to_grid(raw_intersections)
    if not intersections or len(intersections) < 4:
        return 0

    # 3. Calculate atomic dimensions (width of hour column, height of quarter slot)
    atomic_w, atomic_h = atomic_activity_dimensions(im_orig, intersections)
    if atomic_w <= 0 or atomic_h <= 0:
        return 0

    # 4. Get the four corners of the actual timetable activity area
    tt_corners = get_timetable_corners(intersections)

    # 5. Filter activity contours (excluding outer table border, top hours row, left days column)
    activity_cnts = filter_activity_contours(contours, hierarchy, image_shape=im_orig.shape[:2])
    if not activity_cnts:
        return 0

    # 6. Snap each contour to corners, filter out empty white cells, and deduplicate
    img_h, img_w = im_orig.shape[:2]
    seen_bounds = set()
    activities = []

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

        # Inset slightly to avoid border grid lines when checking for activity content
        check_crop = im_orig[y1 + 2 : y2 - 2, x1 + 2 : x2 - 2]
        if check_crop.size == 0 or not is_crop_an_activity(check_crop):
            continue

        seen_bounds.add(bound_key)
        full_crop = im_orig[y1:y2, x1:x2]
        info = activity_boundry_to_activity_info(tt_corners, bound, (atomic_w, atomic_h))

        activities.append({
            "bound": bound,
            "info": info,
            "crop": full_crop,
        })

    # 7. Sort activities in reading order (top-to-bottom, left-to-right)
    activities.sort(key=lambda a: (a["bound"][0][1] // 20, a["bound"][0][0]))

    # 8. Save each activity as incremental ID '1.png' and '1.png.json'
    for act_id, item in enumerate(activities, start=1):
        info = item["info"]
        bound = item["bound"]
        crop = item["crop"]

        img_path = target_dir / f"{act_id}.png"
        cv.imwrite(str(img_path), crop)

        json_path = target_dir / f"{act_id}.png.json"
        act_metadata = {
            "id": act_id,
            "page": page_name,
            "weekday": info.start_time.weekday,
            "time_interval": f"{info.start_time.hour}:{info.start_time.minute:02d} - {info.end_time.hour}:{info.end_time.minute:02d}",
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

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(act_metadata, f, indent=2, ensure_ascii=False)

    return len(activities)


async def worker(image_path, output_dir):
    page_name = Path(image_path).stem
    page_dir = Path(output_dir) / page_name
    page_dir.mkdir(parents=True, exist_ok=True)

    num_activities = await asyncio.to_thread(process_image, Path(image_path), page_dir)
    print(f"Page {page_name}: saved {num_activities} activities to {page_dir}")
    return num_activities


async def main():
    images_dir = Path(IMAGES_PATH)
    valid_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
    images = [
        str(p)
        for p in sorted(
            images_dir.iterdir(),
            key=lambda p: int(p.stem) if p.stem.isdigit() else p.name,
        )
        if p.is_file() and p.suffix.lower() in valid_extensions and not p.name.startswith(".")
    ]

    out_path = Path(OUTPUT_PATH)
    out_path.mkdir(parents=True, exist_ok=True)

    print(f"Found {len(images)} images in {IMAGES_PATH}. Processing in parallel (max_at_once={MAX_CONCURRENT}) into {OUTPUT_PATH}...")

    jobs = [
        functools.partial(worker, path, out_path)
        for path in images
    ]
    results = await aiometer.run_all(jobs, max_at_once=MAX_CONCURRENT)
    total_activities = sum(results)
    print(f"All {len(images)} pages processed. Total {total_activities} activities extracted and saved to {OUTPUT_PATH}.")


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
