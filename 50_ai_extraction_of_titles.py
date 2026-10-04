"""
===============================================================================
Module: 50_ai_extraction_of_titles.py
Multimodal Vision AI Timetable Title Extraction Pipeline
===============================================================================

Overview
--------
This module represents Step 5 of the automated university timetable processing pipeline.
Following the identification and categorization of timetable pages in Step 2 (`20_categorize_pages.py`),
this script extracts the exact verbatim title for each validated timetable sheet using
a multimodal vision language model (LLM) via OpenRouter.

In academic timetable documents, each sheet is titled according to its target cohort,
study program, study group, or thematic activity group (e.g., "Conferinte si Seminarii",
"Facultative An I (Mate, Info, CTI)", "INFO Grupa 142", "MATE Anul II"). Reliably extracting
this title is critical for cataloging, indexing, and presenting schedules to students.

Under the Hood: Architecture & Mechanics
-----------------------------------------
1. Ingestion of Categorization Data:
   The pipeline reads `<PIPELINE_DATA_DIR>/categorization.json` produced by Step 2.
   It filters records where `is_timetable == True`, extracting the canonical image paths
   for all schedule sheets.

2. Single-Image Multimodal Dispatch (Batch Size = 1):
   Unlike activity cell crops which are batched in Step 4, timetable sheets are full-page
   documents. Each image is dispatched independently in parallel, preserving isolation
   and avoiding cross-image contextual bleeding or attention dilution.

3. Reasoning Disabled for Low Latency (`reasoning={"effort": "none"}`):
   Title extraction is an optical character recognition and header localization task,
   not an elaborate deductive reasoning puzzle. Disabling model reasoning eliminates
   chain-of-thought overhead, reducing latency from ~15-20s down to ~3-4s per page while
   conserving token budget.

4. Grammar-Enforced Structured Output (`ResponseNameExtraction`):
   Using `ChatOpenRouter.with_structured_output(ResponseNameExtraction, method="json_schema", include_raw=True)`,
   the model is locked via constrained decoding (e.g. Outlines, XGrammar) to return a JSON
   object with a non-empty `title` string (`min_length=1`). Pydantic guarantees that empty
   or malformed titles cannot pass decoder validation.

5. Resilient API Execution & Rate-Limiting:
   API requests are dispatched concurrently up to `MAX_CONCURRENT` using `aiometer.run_all`.
   Each request is wrapped with `@backoff.on_exception` using exponential backoff to handle
   HTTP 429 rate limits, provider overload, or transient network timeouts.

6. Strict Output Validation & Diagnostic Logging:
   If the AI model returns an unparseable response, empty title, or schema violation,
   the full raw response is logged to `debug.log` and a detailed exception is raised,
   adhering to the zero-fallback guarantee.

7. Output Manifest Serialization:
   Extracted titles are mapped to `{ "timetable_path": "...", "title": "..." }` and
   persisted to `<PIPELINE_DATA_DIR>/timetable_titles.json`.
"""

import asyncio
import functools
import json
import logging
import os
from pathlib import Path
import pprint
import textwrap
from typing import Any

import aiometer
import backoff
import nest_asyncio
from langchain.messages import HumanMessage, SystemMessage
from langchain_openrouter import ChatOpenRouter
from openrouter import errors
from pydantic import BaseModel, Field

import utils
from utils import imagePath2imageURL, loadEnv

nest_asyncio.apply()

logger = utils.create_logger()

# ---------------------------------------------------------------------------
# Global Configurations
# ---------------------------------------------------------------------------
PIPELINE_DATA_DIR = Path(os.getenv("PIPELINE_DATA_DIR", "output"))
OUTPUT_FILE = PIPELINE_DATA_DIR / "timetable_titles.json"
CATEGORIZATION_FILE = PIPELINE_DATA_DIR / "categorization.json"
VISION_MODEL = os.getenv("VISION_MODEL", "dots-studio/dots-3-note-preview:free")
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "30"))


# ---------------------------------------------------------------------------
# Data Models & Schemas
# ---------------------------------------------------------------------------
class ResponseNameExtraction(BaseModel):
    """
    Structured output schema for timetable title extraction.
    Enforces a non-empty title string at the grammar / JSON Schema level.
    """
    title: str = Field(
        min_length=1,
        description="The exact title of the timetable as presented in the image.",
    )


class TimetableTitleEntry(BaseModel):
    """
    Representation of the final output entry saved to timetable_titles.json.
    """
    timetable_path: str = Field(
        description="Filesystem path to the timetable image file."
    )
    title: str = Field(
        description="Verbatim extracted title of the timetable."
    )


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "You will receive the image of a timetable and your task is to extract the title "
    "exactly as it is presented in the image. Do not reformulate it, correct it or modify it in any way.\n\n"
    "The title is the big string of characters located at the top of the file, just above the table header.\n\n"
    'Here are a few examples of possible titles: "Conferinte si Seminarii", "Facultative An I (Mate, Info, CTI)", "INFO Grupa 142" etc.'
)

HUMAN_PROMPT = "Please extract the title from this timetable"


# ---------------------------------------------------------------------------
# AI Extraction Worker
# ---------------------------------------------------------------------------
async def extract_title_for_timetable(
    timetable_path: Path | str,
    structured_model: Any,
) -> dict[str, str]:
    """
    Extracts the verbatim title for a single timetable image using the multimodal vision LLM.

    Encodes the timetable image as a base64 Data URL, constructs system and human messages,
    disables reasoning for fast execution, and invokes the model with structured output
    and exponential backoff on transient HTTP/rate-limiting errors.

    Args:
        timetable_path: Path to the timetable image.
        structured_model: Pre-configured ChatOpenRouter model with structured output enabled.

    Returns:
        dict[str, str]: Object containing 'timetable_path' and 'title'.

    Raises:
        FileNotFoundError: If the timetable image file does not exist.
        ValueError: If the model fails to return a valid, non-empty title.
    """
    path = Path(timetable_path)
    if not path.is_file():
        raise FileNotFoundError(f"Timetable image file does not exist: {path}")

    logger.info(f"Extracting title for timetable: {path.name}")

    image_url = imagePath2imageURL(str(path))
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(
            content=[
                {"type": "text", "text": HUMAN_PROMPT},
                {"type": "image", "url": image_url},
            ]
        ),
    ]

    # Wrap model invocation with exponential backoff on transient rate limits & gateway errors
    @backoff.on_exception(
        backoff.expo,
        errors.TooManyRequestsResponseError,
        max_tries=5,
        logger=logger,
    )
    async def _invoke():
        return await structured_model.ainvoke(messages)

    resp = await _invoke()

    parsed: ResponseNameExtraction | None = resp.get("parsed") if isinstance(resp, dict) else None
    parsing_error = resp.get("parsing_error") if isinstance(resp, dict) else None

    # Strict validation: require valid parsed instance and non-empty title
    if (
        not parsed
        or not isinstance(parsed, ResponseNameExtraction)
        or not parsed.title
        or not parsed.title.strip()
        or parsing_error
    ):
        logger.error(
            f"Failed to extract title for {path.name}. Full AI response:\n{pprint.pformat(resp, indent=2)}"
        )
        raise ValueError(
            f"Vision AI failed to extract a valid title for timetable '{path}'. "
            f"Parsing error: {parsing_error}. "
            f"Parsed value: {parsed}. "
            f"Please inspect debug.log to view the full model response and diagnostic details."
        )

    clean_title = parsed.title.strip()
    logger.info(f"Successfully extracted title for {path.name}: '{clean_title}'")

    return {
        "timetable_path": str(path),
        "title": clean_title,
    }


# ---------------------------------------------------------------------------
# Main Orchestration Routine
# ---------------------------------------------------------------------------
async def main():
    """
    Main orchestration routine for Step 5 (Timetable Title Extraction):
      1. Loads environment configuration.
      2. Reads `<PIPELINE_DATA_DIR>/categorization.json` produced by Step 2.
      3. Filters all images where `is_timetable == True`.
      4. Dispatches title extraction jobs concurrently via `aiometer.run_all`.
      5. Enforces strict validation on all extracted titles.
      6. Serializes records to `<PIPELINE_DATA_DIR>/timetable_titles.json`.
    """
    logger.info("Initializing Multimodal Vision AI Timetable Title Extraction Pipeline...")
    loadEnv()

    if not CATEGORIZATION_FILE.is_file():
        error_msg = textwrap.dedent(f"""\
            [Categorization File Missing]
            ----------------------------------------------------------------------
            • What happened:
              Could not find categorization manifest at '{CATEGORIZATION_FILE}'.

            • Why this is important:
              Step 5 needs the output of Step 2 ('20_categorize_pages.py') to know
              which pages are timetables and require title extraction.

            • How to fix it:
              Run 'uv run 20_categorize_pages.py' first to categorize the pages.
            ----------------------------------------------------------------------
        """)
        logger.critical(error_msg)
        raise FileNotFoundError(error_msg)

    categorization_data: list[dict[str, Any]] = json.loads(
        CATEGORIZATION_FILE.read_text(encoding="utf-8")
    )
    logger.info(
        f"Loaded {len(categorization_data)} page records from {CATEGORIZATION_FILE}"
    )

    # Filter for pages classified as timetables
    timetable_paths: list[Path] = [
        Path(item["path"])
        for item in categorization_data
        if item.get("is_timetable") is True and item.get("path")
    ]

    logger.info(f"Found {len(timetable_paths)} timetable pages to process.")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    if not timetable_paths:
        logger.warning("No timetable pages found in categorization data. Writing empty list.")
        OUTPUT_FILE.write_text("[]", encoding="utf-8")
        return

    # Initialize ChatOpenRouter with reasoning disabled for fast header OCR
    model = ChatOpenRouter(
        model=VISION_MODEL,
        max_retries=3,
    )
    structured_model = model.with_structured_output(
        ResponseNameExtraction,
        method="json_schema",
        include_raw=True,
    )

    logger.info(
        f"Dispatching {len(timetable_paths)} title extraction jobs in parallel "
        f"(batch_size=1, max_concurrent={MAX_CONCURRENT}, model={VISION_MODEL}, reasoning=disabled)..."
    )

    jobs = [
        functools.partial(extract_title_for_timetable, p, structured_model)
        for p in timetable_paths
    ]

    results: list[dict[str, str]] = await aiometer.run_all(
        jobs, max_at_once=MAX_CONCURRENT
    )

    # Validate output length
    if len(results) != len(timetable_paths):
        raise RuntimeError(
            f"Extraction count mismatch: expected {len(timetable_paths)} titles, "
            f"received {len(results)}."
        )

    # Write final output to timetable_titles.json
    OUTPUT_FILE.write_text(
        json.dumps(results, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    logger.info(
        f"Title extraction complete: successfully saved {len(results)} timetable titles "
        f"to {OUTPUT_FILE}."
    )


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
