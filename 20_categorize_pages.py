"""
===============================================================================
Module: 2_categorize_pages.py
Timetable Page Classification and Text Extraction Pipeline
===============================================================================

Overview
--------
This module is a core stage in the automated timetable processing pipeline.
Given a collection of page images extracted from a multi-page timetable document
(e.g., PDF or scanned documents), this script determines which pages contain
actual activity timetables (schedules of courses, labs, seminars) versus
introductory, informational, or administrative pages (such as cover pages,
week parity announcements, room legend tables, and tutor contact info).

Under the Hood: Architecture & Mechanics
-----------------------------------------
1. Natural Numeric Page Sorting:
   Document extraction scripts (such as `extract-timetable/main.sh` via `getImages.py`)
   save page images as numbered filenames (e.g., `1.jpeg`, `2.jpeg`, ..., `104.jpeg`).
   Because standard lexicographical sorting places `10.jpeg` before `2.jpeg`, this
   module applies natural numeric ordering by extracting the first contiguous integer
   from each filename. This guarantees that pages are evaluated in their true
   chronological publication order.

2. Multimodal Vision LLM & Structured Output:
   Each candidate page is converted into a base64-encoded Data URL (`data:image/...;base64,...`)
   and dispatched to a multimodal vision model hosted on OpenRouter (e.g.,
   `dots-studio/dots-3-note-preview:free` or `deepseek/deepseek-v4.1-flash`) using
   `langchain_openrouter.ChatOpenRouter`.
   The model is constrained via strict JSON schema structured output
   (`model.with_structured_output(CategorizationResponse, method="json_schema")`),
   guaranteeing a type-safe `CategorizationResponse` instance directly containing:
     - `is_timetable` (bool): True if the page qualifies as an activity timetable.
     - `text_content` (Optional[str]): Verbatim markdown representation of non-timetable text.

3. Prompt Engineering & Categorization Rules:
   The LLM prompt in a `SystemMessage` defines explicit, domain-specific criteria:
     - Criterion (1) Table Coverage: Over 80% of the page area must be occupied by a single table.
     - Criterion (2) Activities & Time: The table must define schedule intervals (days/hours)
       and course/lab activities.
     - Edge Case: Blank or skeleton timetables with hours and days but no activities are still
       classified as timetables (`is_timetable=True`).
     - Verbatim Markdown Extraction: For any page that is NOT a timetable (`is_timetable=False`),
       the vision model transcribes all textual content word-for-word into Markdown,
       faithfully reproducing formatting (headers, italics, tables, lists).

4. Early-Stopping Sequential Scanning Heuristic:
   University timetable publications adhere to a predictable structural convention:
   administrative announcements, legend notes, and general information appear exclusively
   at the beginning of the document (pages 1 to K). Once the first actual timetable appears
   at page K+1, all subsequent pages (K+1 to N) are also timetables (e.g., different groups,
   specializations, or years).
   
   Exploiting this invariant:
     - The script evaluates pages sequentially starting from page 1.
     - Non-timetable pages (`is_timetable=False`) are processed and their extracted markdown
       text is recorded.
     - The moment the first timetable is encountered (`is_timetable=True`), the sequential
       vision model querying terminates immediately (`break`).
     - All remaining pages in the dataset are automatically marked as `is_timetable=True`
       without invoking the LLM.
   
   Impact: For a 104-page document where only the first 3 pages are announcements,
   this heuristic reduces LLM API calls from 104 to only 4, yielding a >96% reduction
   in API latency, token consumption, and cost while preserving 100% classification accuracy.

5. Resilience & Rate-Limit Backoff:
   API invocations are wrapped in exponential backoff retries (`backoff.expo`) on
   `errors.TooManyRequestsResponseError` to gracefully handle OpenRouter rate limits.

6. Output Contract:
   Results are written to `<PIPELINE_DATA_DIR>/categorization.json` in the following format:
   [
     {
       "path": "/absolute/path/to/output/pages/1.jpeg",
       "is_timetable": false,
       "text_content": "# Actualizat: MI 30.09.2026..."
     },
     {
       "path": "/absolute/path/to/output/pages/4.jpeg",
       "is_timetable": true
     },
     ...
   ]
"""

import asyncio
import functools
import json
import logging
import os
import pprint
import re
import sys
import textwrap
from pathlib import Path
from typing import Any, Optional

import backoff
import colorlog
import nest_asyncio
import openrouter.components.chatsystemmessage as csm
from langchain.messages import HumanMessage, SystemMessage
from langchain_openrouter import ChatOpenRouter
from openrouter import errors
from pydantic import BaseModel, Field

import utils
from utils import imagePath2imageURL, is_image, loadEnv

nest_asyncio.apply()

# Relax client-side Pydantic validation on ChatSystemMessage to allow multimodal content
# (OpenRouter API supports images in system messages, but Speakeasy models default content to text-only)
csm.ChatSystemMessage.model_fields["content"].annotation = Any
csm.ChatSystemMessage.model_rebuild(force=True)

logger = utils.create_logger()

# ---------------------------------------------------------------------------
# Global Configurations
# ---------------------------------------------------------------------------
VISION_MODEL = os.getenv("VISION_MODEL", "dots-studio/dots-3-note-preview:free")
PIPELINE_DATA_DIR = Path(os.getenv("PIPELINE_DATA_DIR", "output"))


# ---------------------------------------------------------------------------
# Response Schema
# ---------------------------------------------------------------------------
class CategorizationResponse(BaseModel):
    """
    Type-safe structured response enforced via JSON Schema for multimodal page categorization.
    """
    is_timetable: bool = Field(
        description="True if the image is an activity timetable (occupies >80% of page with activity and time table); False otherwise."
    )
    text_content: Optional[str] = Field(
        default=None,
        description="Faithful verbatim markdown transcription of all text in the image if is_timetable is False; None/omitted otherwise."
    )


# ---------------------------------------------------------------------------
# Prompt Definition
# ---------------------------------------------------------------------------
CATEGORIZATION_PROMPT = textwrap.dedent("""\
<Context>
You are an AI agent whose task is to determine if the received image is a timetable or not.
</Context>

<OutputFormat>
Your answer will be a JSON payload following this TypeScript schema:

<Schema>
    interface Response {
        is_timetable: boolean;
        text_content?: string;
    }
</Schema>
</OutputFormat>

<Rules>
An image is a timetable if:
    (1) most of the image (more than 80%) is covered with one single table and
    (2) that table shows information on one or more activities (courses, labs etc) and their time. 

The timetable could, of course, contain more information, like the title of the timetable, the teachers, the location etc., 
but the most defining characteristics are the activity and the time.

If the image doesn't follow the 2 criteria mentioned previously, the image is NOT a timetable, and your final
answer MUST set the `is_timetable` field to False.

If the image IS a timetable, you set `is_timetable` to True and leave `text_content` as undefined.

A notable edge case is when the timetable contains no activities, but is obvious it is a timetable because we have
rows and columns denoting the time and the table covers most of the image. In this case, we treat the image as a regular
timetable and set `is_timetable` to True and `text_content` to undefined.


If the image is NOT a timetable, we are interested in the textual content residing in it. As such, you will read the image
and create a markdown document containing everything there is in the image, word-for-word, without any reformulations or
adjustments. 

Moreover, you should also match the textual elements in the image with the most appropriate markdown formatting. For example,
if the image contains a table, the markdown document will also have a table. Similarly, if the text in the image is italic, the
correspondig text in the markdown will also be italic.

The markdown document you write for the images that are not timetables will be written in the `text_content` field.
</Rules>

<Example>
To see an example of a timetable, I provided you with an image. Please note that not all timetables will look like this one
and you should use the guidelines provided to evaluate if an image is indeed a timetable or not.
</Example>""")


def resolve_pages_directory(base_dir: Path) -> tuple[Path, Path]:
    """
    Determines the directory containing page images and the output path for categorization.json.

    Resolution Logic:
    1. If `base_dir / 'pages'` exists and contains image files, `base_dir / 'pages'` is used
       and `categorization.json` will be saved to `base_dir / 'categorization.json'`.
    2. Otherwise, an informative FileNotFoundError is raised explaining what happened,
       why the pages are important, and how to fix it.

    Returns:
        tuple[Path, Path]: `(pages_dir, output_json_path)`
    """
    pages_subdir = base_dir / "pages"
    if pages_subdir.is_dir() and any(is_image(p) for p in pages_subdir.iterdir() if p.is_file()):
        return pages_subdir, base_dir / "categorization.json"

    error_msg = textwrap.dedent(f"""\
        [Page Categorization Directory Resolution Error]
        ----------------------------------------------------------------------
        • What happened:
          Could not find any page images in '{pages_subdir}'.

        • Why this is important:
          The categorization step requires extracted timetable page images located
          in the 'pages/' subdirectory of PIPELINE_DATA_DIR to differentiate
          introductory non-timetable pages from actual activity schedules.
          Without these page images, the pipeline cannot classify pages or produce
          'categorization.json' for subsequent activity extraction steps.

        • How to fix it:
          1. Run the page extraction step first (e.g., './run-pipeline.sh <link>' or
             'cd extract-timetable && ./main.sh -o ../output/pages/ ...').
          2. Verify that the PIPELINE_DATA_DIR environment variable (currently '{base_dir}')
             points to the directory containing the 'pages/' folder with image files.
        ----------------------------------------------------------------------
    """)
    logger.critical(error_msg)
    raise FileNotFoundError(error_msg)


# ---------------------------------------------------------------------------
# Core Classification Logic
# ---------------------------------------------------------------------------
@backoff.on_exception(
    backoff.expo,
    errors.TooManyRequestsResponseError,
    max_tries=5,
    logger=logger,
)
async def categorize_file(file_path: Path | str) -> CategorizationResponse:
    """
    Categorizes a single image file using the vision model.

    Under the Hood:
    1. Converts the local file into a base64 Data URL.
    2. Constructs a `SystemMessage` containing both the instruction prompt and the image Data URL.
    3. Invokes the vision model asynchronously (`ainvoke`) with JSON Schema validation.
    4. Automatically retries with exponential backoff on HTTP 429 rate limits.
    5. Returns the validated `CategorizationResponse` directly.

    Args:
        file_path (Path | str): Path to the image file to evaluate.

    Returns:
        CategorizationResponse: Pydantic model with `is_timetable` and optional `text_content`.
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Image file does not exist: {file_path}")

    logger.debug(f"Encoding image to data URL: {file_path}")
    image_url = imagePath2imageURL(str(file_path))

    model = ChatOpenRouter(
        model=VISION_MODEL,
        max_retries=3,
        reasoning={"summary": "auto"},
    )
    model = model.with_structured_output(CategorizationResponse, method="json_schema")

    messages = [
        SystemMessage(
            content=[
                {"type": "text", "text": CATEGORIZATION_PROMPT},
                {"type": "image", "url": imagePath2imageURL('example-timetable.png')},
            ]
        ),
        HumanMessage(
            content=[
                {"type": "text", "text": "Here is the input you will work on: \n"},
                {"type": "image", "url": image_url},
            ]
        )
    ]

    logger.debug(f"Sending categorization request for {file_path.name} to {VISION_MODEL}...")
    resp: CategorizationResponse = await model.ainvoke(messages)
    logger.debug(f"Received response for {file_path.name}: {resp}")

    return resp


# ---------------------------------------------------------------------------
# Main Pipeline Routine
# ---------------------------------------------------------------------------
async def main():
    """
    Executes the complete page categorization and extraction pipeline.

    Workflow:
    1. Loads environment variables (OPENROUTER_API_KEY, PIPELINE_DATA_DIR).
    2. Resolves image directory and output file destination (or raises informative error).
    3. Finds all valid image files and sorts them naturally by first integer in filename.
    4. Evaluates pages sequentially using the early-stopping heuristic:
       - If a page is NOT a timetable, extracts verbatim markdown into results.
       - If a page IS a timetable, breaks immediately from scanning.
    5. Marks all remaining unscanned pages as timetables without calling the LLM.
    6. Persists the final categorization list to `categorization.json`.
    """
    logger.info("Initializing Page Categorization Pipeline...")
    loadEnv()

    pages_dir, output_json_path = resolve_pages_directory(PIPELINE_DATA_DIR)

    # 1. Discover all image files and sort numerically
    image_files = [
        p for p in pages_dir.iterdir()
        if p.is_file() and not p.name.startswith(".") and is_image(p)
    ]
    if not image_files:
        error_msg = (
            f"No valid image files found in '{pages_dir}'. "
            f"Ensure image files (.jpeg, .png, etc.) are present."
        )
        logger.error(error_msg)
        raise FileNotFoundError(error_msg)

    image_files.sort(key=utils.extract_first_number)
    logger.info(
        f"Discovered {len(image_files)} image files in {pages_dir}. "
        f"First: {image_files[0].name}, Last: {image_files[-1].name}"
    )

    result: list[dict[str, Any]] = []
    processed_files: set[Path] = set()

    # 2. Sequential scan with early-stopping heuristic
    for file in image_files:
        logger.info(f"Evaluating page {file.name}...")
        res = await categorize_file(file)
        if not res.is_timetable:
            processed_files.add(file)
            result.append({
                "path": str(file.resolve()),
                "is_timetable": False,
                "text_content": res.text_content,
            })
            logger.info(
                f"Page {file.name} is NOT a timetable. "
                f"Extracted markdown text ({len(res.text_content or '')} characters)."
            )
        else:
            logger.info(
                f"Page {file.name} IS a timetable! Early-stopping classification scan."
            )
            break

    # 3. Label all remaining unscanned pages as timetables
    remaining_count = 0
    for file in image_files:
        if file not in processed_files:
            result.append({
                "path": str(file.resolve()),
                "is_timetable": True,
            })
            remaining_count += 1

    logger.info(
        f"Categorization complete: {len(processed_files)} non-timetable page(s) extracted, "
        f"{remaining_count} page(s) marked as timetable(s) (total: {len(result)})."
    )

    # 4. Save results to JSON
    output_json_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    logger.info(f"Saved categorization results to {output_json_path}")
    return result


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
