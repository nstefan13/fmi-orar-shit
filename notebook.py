# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "marimo>=0.25.1",
# ]
# ///

import marimo

__generated_with = "0.23.9"
app = marimo.App()


@app.cell
def _():
    import asyncio
    import functools
    import os
    from pathlib import Path
    from pprint import pprint

    import aiometer
    import cv2 as cv
    import numpy as np  # ty:ignore[unresolved-import]
    import importlib
    import marimo as mo  # ty:ignore[unresolved-import]
    import add_brders as app

    importlib.reload(app)

    image_slider = mo.ui.slider(start=1, stop=104, label="Image No.", value=95, debounce=True)
    return app, cv, image_slider, mo


@app.cell
def _(image_slider, mo):
    image_path = f'Orar-Shi2/extracted_images/{image_slider.value}.jpg'
    thickness = 2
    alpha = 0.5

    mo.hstack([image_slider, mo.md(image_path)])
    return alpha, image_path, thickness


@app.cell
def _(app, cv, image_path, mo):
    im_orig = cv.imread(str(image_path))
    im_gray = cv.cvtColor(im_orig, cv.COLOR_BGR2GRAY)
    im_grid = app.extract_table_grid(im_gray, 130)
    mo.image(im_grid)
    return im_grid, im_orig


@app.cell
def _(app, cv, im_grid, im_orig, mo, thickness):
    contours, hierarchy = cv.findContours(im_grid, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE)
    im_with_contours = app.draw_contour_hierarchy(im_orig, contours, hierarchy, thickness=thickness)
    mo.image(im_with_contours)
    return contours, hierarchy


@app.cell
def _(alpha, app, contours, cv, hierarchy, im_orig, image_slider, mo):
    def filter_activity_contours(contours, hierarchy=None):
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
            img_h, img_w = im_orig.shape[:2]
            candidate_contours = [
                c for c in contours
                if cv.boundingRect(c)[2] < img_w * 0.9 and cv.boundingRect(c)[3] < img_h * 0.9
            ]

        if not candidate_contours:
            return []

        # Find grid boundaries
        min_x = min(cv.boundingRect(c)[0] for c in candidate_contours)
        min_y = min(cv.boundingRect(c)[1] for c in candidate_contours)

        # Exclude leftmost Day column (x <= min_x + 50) and top Hours header row (y <= min_y + 40)
        activity_contours = [
            c for c in candidate_contours
            if cv.boundingRect(c)[0] > min_x + 50 and cv.boundingRect(c)[1] > min_y + 40
        ]
        return activity_contours

    activity_contours = filter_activity_contours(contours, hierarchy)

    img_activities = app.draw_colored_rectangles(im_orig, activity_contours, alpha=alpha)

    mo.vstack([image_slider, mo.image(img_activities)])
    return (activity_contours,)


@app.cell
def _(activity_contours, app, cv, im_orig, mo):
    # Sort activity contours in reading order (top-to-bottom, left-to-right)
    sorted_activity_contours = sorted(
        activity_contours,
        key=lambda c: (cv.boundingRect(c)[1] // 30, cv.boundingRect(c)[0]),
    )
    activity_crops = list(app.crop_activity_cells(im_orig, sorted_activity_contours, margin=2, sort=False))
    crop_slider = mo.ui.slider(
        start=0,
        stop=max(0, len(activity_crops) - 1),
        label="Crop Index",
        value=0,
    )
    return activity_crops, crop_slider, sorted_activity_contours


@app.cell
def _(app, contours, hierarchy, im_orig, mo):
    # Detect and draw intersections (not very useful now)
    if False:
        # Detect intersection points where vertical and horizontal level 2 contours meet
        intersections = app.find_contour_intersections(contours, hierarchy)
        # Draw medium-sized red dots at each intersection point
        im_with_intersections = app.draw_intersection_points(im_orig, intersections)

        snapped_intersections = app.snap_to_grid(intersections)
        im_with_snapped_intersections = app.draw_intersection_points(im_orig, snapped_intersections)
        mo.image_compare(im_with_intersections, im_with_snapped_intersections)
    return


@app.cell
def _(activity_crops, app, crop_slider, im_orig, mo, sorted_activity_contours):
    def is_crop_an_activity(crop):
        return app.is_crop_an_activity(crop)

    idx = int(crop_slider.value)
    selected_crop = activity_crops[idx] if activity_crops else None
    selected_contour = sorted_activity_contours[idx] if sorted_activity_contours else None

    # Highlight the currently selected cropped activity on the original image
    image_highlight_cropped_activit = app.draw_colored_rectangles(
        im_orig,
        [selected_contour] if selected_contour is not None else [],
        alpha=0.45,
        border_thickness=3,
    )

    mo.vstack([
        mo.md(f"Total activity cells cropped: **{len(activity_crops)}**"),
        crop_slider,
        mo.hstack([
            mo.vstack([mo.md("### Cropped Cell"), mo.image(selected_crop)]) if selected_crop is not None else mo.md("No crops available"),
            mo.vstack([mo.md("### Timetable Location"), mo.image(image_highlight_cropped_activit)]),
        ]),
    ])
    return


@app.cell
def _(activity_crops, app, mo, sorted_activity_contours):
    def identify_real_activities(crops):
        """
        Filters crops, yielding only those containing real timetable activities.
        Uses text and ink detection heuristics to exclude empty background space.
        """
        for item in crops:
            crop = item[0] if isinstance(item, (tuple, list)) else item
            # Heuristic 1: Run text/ink detection on this crop
            if app.is_crop_an_activity(crop):
                yield item

    # Pair each crop with its contour to track both the image slice and its timetable location
    real_activity_pairs = list(
        identify_real_activities(list(zip(activity_crops, sorted_activity_contours)))
    )
    real_crops = [p[0] for p in real_activity_pairs]
    real_contours = [p[1] for p in real_activity_pairs]

    real_slider = mo.ui.slider(
        start=0,
        stop=max(0, len(real_crops) - 1),
        label="Real Activity Index",
        value=0,
    )
    return real_contours, real_crops, real_slider


@app.cell
def _(
    activity_crops,
    app,
    im_orig,
    mo,
    real_contours,
    real_crops,
    real_slider,
):
    _idx = int(real_slider.value)
    _selected_crop = real_crops[_idx] if real_crops else None
    _selected_contour = real_contours[_idx] if real_contours else None

    # Highlight only the selected real activity on the timetable
    image_highlight_real_activity = app.draw_colored_rectangles(
        im_orig,
        [_selected_contour] if _selected_contour is not None else [],
        alpha=0.45,
        border_thickness=3,
    )

    empty_count = len(activity_crops) - len(real_crops)
    mo.vstack([
        mo.md(
            f"🎯 Identified **{len(real_crops)}** real activities "
            f"(filtered out **{empty_count}** empty slots)."
        ),
        real_slider,
        mo.hstack([
            mo.vstack([mo.md("### Real Activity Crop"), mo.image(_selected_crop)])
            if _selected_crop is not None
            else mo.md("No activities detected"),
            mo.vstack([mo.md("### Timetable Location"), mo.image(image_highlight_real_activity)]),
        ]),
    ])
    return


@app.cell
def _(app, im_orig, mo):
    def atomic_activity_dimensions(img_orig):
        # Receives the original image
        # It uses that code for detecting the snapped intersections and gets a list of all intersections
        # We are interested in the intersections points from the far left - same x, different y
        # and those from the top - same y, different x
        # they are for the time interval and weekdays and their average distance tells us what is the size of a cell
        # WE then divide the height by 4 (because it is frequent for activities to be placed in quarters)
        # and we return a tuple (atomic_width, atomic_height)
        return app.atomic_activity_dimensions(img_orig)

    atomic_width, atomic_height = atomic_activity_dimensions(im_orig)

    im_atomic_refs = app.draw_atomic_activity_references(im_orig)

    mo.vstack([
        mo.md(
            f"""
            ### 📐 Atomic Activity Dimensions
            | Dimension | Value (px) | Description |
            | :--- | :--- | :--- |
            | **Atomic Width** | **`{atomic_width:.2f} px`** | Base cell width (average 1-hour column distance) |
            | **Atomic Height** | **`{atomic_height:.2f} px`** | Quarter-slot height (`1/4` of weekday row) |
            | *Full Day Height* | *`{atomic_height * 4:.2f} px`* | Total weekday row height |
            """
        ),
        mo.md("#### 📍 Grid Reference Intersections (Top hours in Cyan, Left weekdays in Orange):"),
        mo.image(im_atomic_refs),
    ])
    return atomic_height, atomic_width


@app.cell
def crop_to_activity_info(
    app,
    atomic_height,
    atomic_width,
    contours,
    hierarchy,
    im_orig,
    image_path,
    image_slider,
    mo,
    real_contours,
):
    from main import Time
    from enum import Enum
    from pydantic import BaseModel

    class ActivityCovering(Enum):
        FULL = "full"
        HALVES = "halves"
        QUARTERS = "quarters"

    class ActivityInfo(BaseModel):
        start_time: Time
        end_time: Time
        covering: ActivityCovering
        index_in_covering: int

    def activity_boundry_to_activity_info(timetable_intersection_points, activity_boundry_as_intersection_points, atomic_size):
        """
        This function calculates the timetable schedule information for a single activity.

        It receives three arguments. The first argument is timetable_intersection_points, which is a list of four corner intersection points for the main activity area of the timetable. The second argument is activity_boundry_as_intersection_points, which contains four intersection points representing the top-left, top-right, bottom-left, and bottom-right corners of the activity rectangle. The third argument is atomic_size, which is a pair of numbers containing the atomic width of one hour column and the atomic height of one quarter-slot.

        The function works by measuring coordinates on the timetable grid. First, it finds the left edge and top edge of the whole timetable. Next, it looks at the horizontal position of the activity top-left corner and subtracts the timetable left edge. When we divide this distance by the atomic width, we get the start column index. Because column zero represents the time interval from 8:00 to 8:50, each next column increases the time by one hour. The width of the activity divided by the atomic width shows how many columns the activity spans. The start hour begins at minute 0, and the end hour ends at minute 50 of the final covered column.

        Next, the function finds the day of the week by looking at the vertical position of the activity top-left corner compared to the top edge of the timetable. One full day row has a height equal to four atomic quarters, and the timetable has five weekdays from Monday to Friday. The function calculates which day row contains the activity and chooses the corresponding Romanian weekday name.

        Finally, the function determines the vertical covering and the position index. It calculates the height of the activity in terms of atomic quarter units. If the activity covers four quarters, it is classified as full covering with an index of 0. If it covers two quarters, it is classified as halves, where an index of 0 means it occupies the top half and an index of 1 means it occupies the bottom half. If it covers one quarter, it is classified as quarters, where the index is 0, 1, 2, or 3 depending on which vertical quarter slot it fills from top to bottom.

        The function returns an ActivityInfo object that contains the start time, the end time, the covering type, and the vertical slot index inside that covering.
        """
        return app.activity_boundry_to_activity_info(
            timetable_intersection_points,
            activity_boundry_as_intersection_points,
            atomic_size,
        )

    # 1. Detect all snapped intersections for the timetable grid
    raw_intersections = app.find_contour_intersections(contours, hierarchy)
    _snapped_intersections = app.snap_to_grid(raw_intersections)

    # 2. Get the 4 corners of the actual timetable activity grid
    timetable_corners = app.get_timetable_corners(_snapped_intersections)

    # 3. Snap each real activity contour to 4 corner intersection points
    activity_boundaries = [
        app.snap_contour_to_corners(cnt, _snapped_intersections)
        for cnt in real_contours
    ]

    # 4. Generate ActivityInfo for all real activities
    activity_infos = [
        activity_boundry_to_activity_info(
            timetable_corners,
            bound,
            (atomic_width, atomic_height),
        )
        for bound in activity_boundaries
    ]

    # 5. Create the visualization image:
    # Original image overlay with translucent colored rectangles defined by the corner intersection points
    # and red dots at the four corners
    img_snapped_activities = app.draw_activity_corner_rectangles(
        im_orig,
        activity_boundaries,
        alpha=0.35,
        border_thickness=2,
        draw_corner_dots=True,
    )

    rows = []
    for _idx, (info, bound) in enumerate(zip(activity_infos, activity_boundaries)):
        tl, tr, bl, br = bound
        rows.append(
            f"| #{_idx + 1} | **{info.start_time.weekday}** | `{info.start_time.hour}:{info.start_time.minute:02d} - {info.end_time.hour}:{info.end_time.minute:02d}` | `{info.covering.value}` | `{info.index_in_covering}` | `[{tl}, {br}]` |"
        )
    table_rows = "\n".join(rows)

    table_md = f"""#### 📋 Extracted Activity Schedules

    | # | Weekday | Time Interval | Covering | Slot Index | Grid Corners (TL -> BR) |
    | :---: | :--- | :---: | :---: | :---: | :--- |
    {table_rows}"""

    table_card = mo.Html(
        f"""<div style="min-width: 0; max-height: 600px; overflow-y: auto; overflow-x: auto; width: 100%; border: 1px solid rgba(128, 128, 128, 0.2); border-radius: 8px; padding: 6px; box-sizing: border-box;">
    {mo.md(table_md).text}
    </div>"""
    )

    image_card = mo.image(
        img_snapped_activities,
        style={
            "width": "100%",
            "max-width": "100%",
            "height": "auto",
            "object-fit": "contain",
            "border-radius": "8px",
            "display": "block",
            "box-shadow": "0 2px 10px rgba(0, 0, 0, 0.12)",
        },
    )

    left_column = mo.vstack([table_card])
    right_column = mo.vstack([
        mo.md("#### 🖼️ Snapped Activities Overlay"),
        image_card,
    ])

    mo.vstack([
        mo.hstack([image_slider, image_path]),
        mo.md("### 🏷️ Activity Identification by Corner Intersection Points"),
        mo.md(
            f"Successfully snapped **{len(activity_boundaries)}** real activities to grid corners. "
            "Each activity is identified by its 4 corner intersection points instead of raw contours."
        ),
        mo.hstack(
            [left_column, right_column],
            widths=[1, 1],
            align="start",
            gap=1.0,
        ),
    ])
    return


if __name__ == "__main__":
    app.run()
