import asyncio
import functools
import os
from pathlib import Path
from pprint import pprint

import aiometer
import cv2 as cv
import numpy as np

IMAGES_PATH = "./Orar-Shi2/extracted_images"
OUTPUT_PATH = "./Orar-Shi2/bordered_images2"
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


def draw_columns(
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


def process_image(image_path: Path, output_file: Path, thickness: int = 2, alpha: float = 0.5):
    im_orig = cv.imread(str(image_path))
    if im_orig is None:
        print(f"Warning: Failed to read {image_path}")
        return 0

    im = cv.cvtColor(im_orig, cv.COLOR_BGR2GRAY)
    thresh = extract_table_grid(im, 130)

    contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
    # im2 = draw_contour_hierarchy(im_orig, contours, hierarchy, thickness=thickness)
    im2 = draw_columns(contours, im_orig, hierarchy=hierarchy, line_thickness=thickness, contour_thickness=thickness, alpha=alpha)

    cv.imwrite(str(output_file), im2)
    return len(contours)


async def worker(image_path, output_dir):
    image_name = Path(image_path).name
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    output_file = output_path / image_name

    num_contours = await asyncio.to_thread(process_image, Path(image_path), output_file)
    print(f"Saved {output_file} (Contours: {num_contours})")
    return num_contours


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

    print(f"Found {len(images)} images in {IMAGES_PATH}. Processing in parallel (max_at_once={MAX_CONCURRENT}) into {OUTPUT_PATH}...")

    jobs = [
        functools.partial(worker, path, OUTPUT_PATH)
        for path in images
    ]
    await aiometer.run_all(jobs, max_at_once=MAX_CONCURRENT)
    print(f"All {len(images)} images processed and saved to {OUTPUT_PATH}.")


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
