import numpy as np
import cv2 as cv
from pprint import pprint

IMAGE_PATH = "image1.png"

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


def extract_table_grid(gray, thresh_val=140):
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


images = []
for index in range(1, 6):
    image_path = f"image{index}.png"

    im_orig = cv.imread(image_path)
    im = cv.cvtColor(im_orig, cv.COLOR_BGR2GRAY)
    thresh = extract_table_grid(im, 140)

    contours, hierarchy = cv.findContours(thresh, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)

    # im2 = cv.drawContours(im_orig.copy(), contours, -1, (0, 255, 0), 2)
    im2 = draw_contour_hierarchy(im_orig, contours, hierarchy, thickness=2)
    
    # images.append(im2)
    pprint({"Contours": contours, "Hierarchy": hierarchy})
    show_img(im2)

# show_img(*images)
    

