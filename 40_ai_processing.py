"""
===============================================================================
Module: 40_ai_processing.py
Multimodal Vision AI Timetable Activity Extraction & Semantic Analysis Pipeline
===============================================================================

Overview
--------
This module represents Step 4 of the automated timetable extraction pipeline.
Building upon the deterministic computer vision extraction performed in Step 3
(`30_preprocessed_activities.py`), this stage leverages state-of-the-art multimodal
vision language models (LLMs) via OpenRouter to perform semantic information extraction
on individual activity cell crops (courses, laboratories, seminars, and conferences).

While Step 3 reliably identifies the geometric grid coordinates, temporal bounds,
weekday rows, and slot coverings (full, halves, quarters) without hallucination,
deciphering cropped activity contents—such as instructor names, course abbreviations,
room designations, subgroup partitions, and biweekly parity—demands nuanced optical
character recognition and semantic understanding.

This module automates:
  1. Ingestion of Step 3 preprocessed activity crops and timetable manifests.
  2. Batch windowing and base64 multimodal payload encoding.
  3. Structured output enforcement with Pydantic and OpenRouter JSON schema constraints.
  4. Resilient API execution with exponential backoff against rate limits (HTTP 429).
  5. 1-to-1 deterministic identifier alignment between image paths and extracted activities.
  6. Relational reconstruction and persistence of enriched timetable manifests.

Under the Hood: Architecture & Mechanics
-----------------------------------------
1. Pipeline Ingestion & Relational Mapping:
   The pipeline reads `<PIPELINE_DATA_DIR>/preprocessed-activities/data.json` (produced
   by `30_preprocessed_activities.py`). It validates file availability and constructs
   a bidirectional relationship between each parent timetable page (`timetable_path`)
   and its constituent activity image cell crops (`path`). Spatial reading order
   (top-to-bottom, left-to-right) established in Step 3 is strictly preserved.

2. Batch Partitioning & Multimodal Token Optimization:
   Multimodal vision LLM contexts incur per-image token overhead. Submitting individual
   images incurs significant HTTP latency and prompt duplication, whereas excessively
   large batches exceed context windows and degrade cross-image attention.
   The pipeline flattens activity paths across timetables and partitions them into
   contiguous chunks of 12 images (`BATCH_SIZE = 12`).

3. Multimodal Prompt Synthesis (`VISION_PROMPT.jinja`):
   Each activity image in a batch is converted into an RFC 2397 compliant base64 data URL
   (`data:image/png;base64,...`) via `imagePath2imageURL`. The prompt assigns an explicit
   zero-indexed identifier (`Image with ID=0`, `Image with ID=1`, etc.) to each image part.
   The underlying Jinja2 template instructs the model on institutional timetable semantics:
     - Disambiguating OCR artifacts (e.g. uppercase 'I' vs lowercase 'l').
     - Activity classification (`Curs`, `Lab`, `Seminar`, `Conferinta`).
     - Academic author format conventions (`<last name> <first initial>`).
     - Venue typology extraction (`Amf`, `Lab`, `Sala`, or `ONLINE`).
     - Recurrence parities (`SP` -> even, `SI` -> odd, week ranges -> range).
     - Student subgroup identification (`SG`, `Gr_X`).

4. Constrained Decoding via Structured Output:
   Using `ChatOpenRouter.with_structured_output(VisionBatchResponse, method="json_schema", include_raw=True)`,
   the model is constrained at the decoding stage to output strictly compliant JSON matching
   the `VisionBatchResponse` schema. This eliminates schema violations and JSON syntax errors.

5. Resilient Rate-Limiting & Exponential Backoff:
   OpenRouter vision endpoints (especially free or tiered previews) frequently throttle requests
   with `HTTP 429 TooManyRequestsResponseError` or transient provider overload errors.
   Worker calls are wrapped in `@backoff.on_exception` using exponential backoff with jitter
   and up to 5 retries.

6. Output Validation & Strict Mapping (`process_images_with_ai`):
   The model returns activities tagged with id corresponding to the prompt image index.
   The pipeline verifies that all expected IDs (0 to len(paths)-1) form a valid, unique
   1-to-1 mapping. If invalid, the full model response is logged to `debug.log` and a detailed
   exception is raised.

7. Manifest Synthesis & Output Serialization:
   The extracted fields (`name`, `type`, `authors`, `location`, `periodicity`, `subgroup`,
   `observations`) are combined with each activity's file `path` to form `ProcessedActivity`
   records. These records are grouped by their parent timetable (`timetable_path`) and
   written to `<OUTPUT_DIR>/data.json`.

8. Asynchronous Concurrency Management:
   Batches are dispatched concurrently using `aiometer.run_all` with bounded concurrency
   (`MAX_CONCURRENT`), balancing maximum throughput against provider rate limits.
"""

import asyncio
import functools
import itertools
import json
import logging
import os
from pathlib import Path
import pprint
import re
from typing import Any, List, Literal, Optional, Union

import aiometer
import backoff
import nest_asyncio
from openrouter import errors
from langchain_openrouter import ChatOpenRouter
from IPython import embed
from langchain.messages import HumanMessage
from pydantic import BaseModel, Field, ValidationError

import utils
from utils import imagePath2imageURL, loadEnv, loadPrompt

nest_asyncio.apply()

logger = utils.create_logger()

# ---------------------------------------------------------------------------
# Global Configurations
# ---------------------------------------------------------------------------
PIPELINE_DATA_DIR = Path(os.getenv("PIPELINE_DATA_DIR", "output"))
OUTPUT_DIR = PIPELINE_DATA_DIR / "ai-processed-activities"
VISION_MODEL = os.getenv("VISION_MODEL", "dots-studio/dots-3-note-preview:free")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "12"))
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "30"))


# ---------------------------------------------------------------------------
# Data Models & Schemas (Synchronized with VISION_PROMPT.jinja)
# ---------------------------------------------------------------------------
class Room(BaseModel):
    """
    Physical room or laboratory location in the university.
    """
    id: int = Field(description="Numerical room identifier (e.g. 415, 503).")
    type: Literal["Amf", "Lab", "Sala"] = Field(
        description="Room typology: 'Amf' (Amphitheatre), 'Lab' (Laboratory), or 'Sala' (Classroom)."
    )


Location = Union[str, Room]


class Time(BaseModel):
    """
    Representation of weekday and time.
    """
    weekday: Literal["Luni", "Marti", "Miercuri", "Joi", "Vineri"]
    hour: int
    minute: int


class Activity(BaseModel):
    """
    Semantic information extracted from an individual timetable activity crop using AI.
    This is passed to the AI model.
    """
    id: int = Field(
        description="Sequential index identifier of the activity within the batch prompt (0, 1, 2, ...).",
    )
    name: str = Field(
        description="Name or title of the subject/activity (with extraneous type info removed).",
    )
    authors: list[str] = Field(
        description="List of professors, lecturers, or instructors teaching the activity.",
    )
    type: Optional[Literal["Curs", "Lab", "Seminar", "Conferinta"]] = Field(
        default=None,
        description="Didactic classification of the activity.",
    )
    location: Optional[Location] = Field(
        default=None,
        description="Classroom, laboratory, amphitheatre, or online platform designation.",
    )
    periodicity: Optional[Literal["even", "odd", "range"]] = Field(
        default=None,
        description="Recurrence frequency: 'even' (SP), 'odd' (SI), or 'range' ([sapt X-Y]).",
    )
    subgroup: Optional[int] = Field(
        default=None,
        description="Target student subgroup number if the activity is subgroup-specific.",
    )

# In this pipeline, each activity cell parsed by the vision model is referred to as VisionResponse
VisionResponse = Activity


def create_batch_schema(batch_size: int) -> type[BaseModel]:
    """
    Dynamically creates a VisionBatchResponse schema locking min_length and max_length
    to the exact batch size. This constrains the decoding grammar (e.g. Outlines, XGrammar)
    so it physically cannot exit the array early until all N activities are generated.
    """
    class VisionBatchResponse(BaseModel):
        parsed_activities: list[VisionResponse] = Field(
            min_length=batch_size,
            max_length=batch_size,
            description="A list of entries in the timetable representing conferences, labs, etc.",
        )
    return VisionBatchResponse


# Default fallback schema for BATCH_SIZE
VisionBatchResponse = create_batch_schema(BATCH_SIZE)


class ProcessedActivity(BaseModel):
    """
    Final representation of an activity including its image path and all extracted semantic attributes.
    """
    path: str = Field(description="Path to the cropped activity image file.")
    id: Optional[int] = Field(
        default=None,
        description="Batch-local prompt index identifier.",
    )
    name: str = Field(description="Name or title of the subject/activity.")
    type: Optional[Literal["Curs", "Lab", "Seminar", "Conferinta"]] = Field(
        default=None, description="Didactic classification of the activity."
    )
    authors: list[str] = Field(
        default_factory=list,
        description="List of professors, lecturers, or instructors teaching the activity.",
    )
    location: Optional[Location] = Field(
        default=None,
        description="Classroom, laboratory, amphitheatre, or online platform designation.",
    )
    periodicity: Optional[Literal["even", "odd", "range"]] = Field(
        default=None,
        description="Recurrence frequency: 'even' (SP), 'odd' (SI), or 'range'.",
    )
    subgroup: Optional[int] = Field(
        default=None,
        description="Target student subgroup number if applicable.",
    )
    observations: Optional[str] = Field(
        default=None,
        description="Edge cases, ambiguities, or additional notes recorded during parsing.",
    )


class TimetableActivities(BaseModel):
    """
    Output record representing a timetable page and its associated list of parsed activities.
    """
    timetable_path: str = Field(description="Path to the original timetable image file.")
    activities: list[ProcessedActivity] = Field(
        default_factory=list,
        description="List of AI-parsed activities belonging to this timetable.",
    )


# ---------------------------------------------------------------------------
# Multimodal Vision AI Helper Methods
# ---------------------------------------------------------------------------
async def _process_single_batch(paths: list[Path]) -> list[VisionResponse]:
    """
    Sends a single batch of up to `BATCH_SIZE` activity images to the vision LLM.

    Encodes each image as a base64 data URL, constructs a multimodal message according
    to `VISION_PROMPT.jinja`, invokes the model via OpenRouter with structured output
    and exponential backoff on rate limits, and validates the parsed results.

    Args:
        paths: List of activity image paths to process in this single API call.

    Returns:
        List of `VisionResponse` objects corresponding 1-to-1 with `paths`.

    Raises:
        ValueError: If the vision model fails to return a valid 1-to-1 mapping of activities.
    """
    if not paths:
        return []

    activity_identifiers = [p.name for p in paths]
    logger.info(f"Parsing activities batch: {activity_identifiers} ({len(paths)} items)")

    # Construct the multimodal message parts
    content_parts: list[dict[str, Any]] = [
        {"type": "text", "text": loadPrompt("VISION_PROMPT.jinja")},
        {"type": "text", "text": "\n\n\n\n===\nHere are the images you need to parse:\n"},
    ]

    for index, p in enumerate(paths):
        if not p.is_file():
            raise FileNotFoundError(f"Activity image file does not exist: {p}")
        url = imagePath2imageURL(str(p))
        content_parts.extend([
            {"type": "text", "text": f"Image with ID={index}\n"},
            {"type": "image", "url": url},
            {"type": "text", "text": "\n"},
        ])

    messages = [HumanMessage(content=content_parts)]

    # Configure client with structured JSON schema output constrained to exact batch size
    batch_schema = create_batch_schema(len(paths))
    model = ChatOpenRouter(
        model=VISION_MODEL,
        max_retries=3,
        reasoning={"summary": "auto"},
    )

    logger.debug(
        f"Invoking vision model {VISION_MODEL} with {len(content_parts)} message parts for {activity_identifiers}..."
    )

    # Invoke model with exponential backoff on transient errors and rate limits (429)
    @backoff.on_exception(
        backoff.expo,
        errors.TooManyRequestsResponseError,
        max_tries=20,
        logger=logger,
    )
    async def _invoke():
        return await model.ainvoke(messages)

    resp = await _invoke()
    match = re.search(r"<FinalResponse>(.*?)</FinalResponse>", resp.content, re.DOTALL)
    if not match or not match.group(1).strip():
        logger.error(
            f"Missing or empty <FinalResponse> XML tags in model response for batch {activity_identifiers}.\n"
            f"Raw model response content:\n{resp.content}"
        )
        raise ValueError(
            f"Vision AI response for batch {activity_identifiers} is missing or empty within <FinalResponse>...</FinalResponse> tags."
        )

    json_payload = match.group(1).strip()

    try:
        # Validate parsed AI output
        parsed_batch = batch_schema.model_validate_json(json_payload)
    except ValidationError as e:
        logger.error(
            f"Failed to validate Vision AI JSON response against schema for batch {activity_identifiers}.\n"
            f"Validation error:\n{e}\n"
            f"Raw model response content:\n{resp.content}"
        )
        raise ValueError(
            f"Vision AI response for batch {activity_identifiers} failed schema validation: {e}"
        ) from e
    
    # Verify clear 1:1 mapping
    parsed_activities = getattr(parsed_batch, "parsed_activities", []) if parsed_batch else []

    expected_ids = set(range(len(paths)))
    id_to_activity = {act.id: act for act in parsed_activities if act.id is not None}

    if len(id_to_activity) != len(paths) or set(id_to_activity.keys()) != expected_ids:
        logger.error(
            f"Invalid AI response for batch {activity_identifiers}. Full response:\n{pprint.pformat(resp, indent=2)}"
        )
        raise ValueError(
            f"Vision AI failed to provide a valid activity mapping for batch {activity_identifiers}. "
            f"Expected {len(paths)} activities with IDs 0 to {len(paths) - 1}, "
            f"but received IDs {[act.id for act in parsed_activities]}. "
            f"Please inspect debug.log to view the full model response and reasoning."
        )

    logger.info(f"Successfully parsed batch {activity_identifiers}")

    return [id_to_activity[i] for i in range(len(paths))]



async def process_images_with_ai(activity_paths: list[Path]) -> list[VisionResponse]:
    """
    Parses a sequence of timetable activity images using the multimodal vision LLM.

    If the number of activity paths exceeds `BATCH_SIZE` (default 12), the list is
    subdivided into contiguous chunks to respect vision context window limits.

    Args:
        activity_paths: List of file paths to cropped activity cell images.

    Returns:
        List of `VisionResponse` objects corresponding 1-to-1 and in the same order
        as the input `activity_paths`.
    """
    paths = [Path(p) for p in activity_paths]
    if not paths:
        return []

    # If within batch size, process directly
    if len(paths) <= BATCH_SIZE:
        return await _process_single_batch(paths)

    # Sub-chunk if called directly with a larger sequence
    chunks = [paths[i:i + BATCH_SIZE] for i in range(0, len(paths), BATCH_SIZE)]
    all_results: list[VisionResponse] = []
    for chunk in chunks:
        batch_res = await _process_single_batch(chunk)
        all_results.extend(batch_res)
    return all_results


# ---------------------------------------------------------------------------
# Main Pipeline Routine
# ---------------------------------------------------------------------------
async def main():
    """
    Main orchestration routine for Step 4 (AI Processing):
      1. Loads environment variables (OPENROUTER_API_KEY, PIPELINE_DATA_DIR, VISION_MODEL).
      2. Reads `<PIPELINE_DATA_DIR>/preprocessed-activities/data.json` produced by Step 3.
      3. Builds associative mappings between timetable pages and their activity image paths.
      4. Aggregates all activity image paths and partitions them into batches of `BATCH_SIZE` (12).
      5. Concurrently executes `process_images_with_ai` across batches using `aiometer.run_all`.
      6. Maps parsed semantic metadata back to each activity and groups them by originating timetable.
      7. Writes the final structured output to `<OUTPUT_DIR>/data.json`.
    """
    logger.info("Initializing Multimodal Vision AI Activity Extraction Pipeline...")
    loadEnv()

    preprocessed_file = PIPELINE_DATA_DIR / "preprocessed-activities" / "data.json"
    if not preprocessed_file.is_file():
        raise FileNotFoundError(
            f"Preprocessed activities file '{preprocessed_file}' does not exist. "
            f"Please run '30_preprocessed_activities.py' first to extract activity cells."
        )

    preprocessed_data: list[dict[str, Any]] = json.loads(
        preprocessed_file.read_text(encoding="utf-8")
    )
    logger.info(
        f"Loaded {len(preprocessed_data)} timetable records from {preprocessed_file}"
    )

    # 1. Map each activity path to its parent timetable path
    activity_to_timetable: dict[str, str] = {}
    all_activity_paths: list[Path] = []

    for item in preprocessed_data:
        tt_path = item.get("timetable_path", "")
        for act in item.get("preprocessed_activities", []):
            act_path_str = act.get("path", "")
            if act_path_str:
                activity_to_timetable[act_path_str] = tt_path
                all_activity_paths.append(Path(act_path_str))

    logger.info(
        f"Found {len(all_activity_paths)} total activities across {len(preprocessed_data)} timetables."
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summary_output_file = OUTPUT_DIR / "data.json"

    if not all_activity_paths:
        logger.warning("No activities found in preprocessed data to process.")
        summary_output_file.write_text("[]", encoding="utf-8")
        return

    # 2. Partition all activity paths into chunks of up to BATCH_SIZE (12)
    chunks = [
        all_activity_paths[i:i + BATCH_SIZE]
        for i in range(0, len(all_activity_paths), BATCH_SIZE)
    ]
    logger.info(
        f"Partitioned {len(all_activity_paths)} activities into {len(chunks)} chunks "
        f"of up to {BATCH_SIZE} images (max_concurrent={MAX_CONCURRENT})."
    )

    # 3. Dispatch parallel batch extraction jobs via aiometer
    jobs = [functools.partial(process_images_with_ai, chunk) for chunk in chunks]
    chunk_results: list[list[VisionResponse]] = await aiometer.run_all(
        jobs, max_at_once=MAX_CONCURRENT
    )

    # 4. Flatten parsed activities and index them by image path
    parsed_activities_flat: list[VisionResponse] = list(
        itertools.chain.from_iterable(chunk_results)
    )

    if len(parsed_activities_flat) != len(all_activity_paths):
        raise RuntimeError(
            f"Activity count mismatch: expected {len(all_activity_paths)} total activities, "
            f"got {len(parsed_activities_flat)} from AI batches."
        )

    path_to_parsed: dict[str, VisionResponse] = {}
    for p, parsed in zip(all_activity_paths, parsed_activities_flat):
        path_to_parsed[str(p)] = parsed

    # 5. Build final output list grouped by parent timetable
    output_timetables: list[dict[str, Any]] = []

    for item in preprocessed_data:
        tt_path = item.get("timetable_path", "")
        tt_activities: list[dict[str, Any]] = []

        for act in item.get("preprocessed_activities", []):
            act_path_str = act.get("path", "")
            parsed = path_to_parsed.get(act_path_str)
            if parsed is None:
                raise RuntimeError(
                    f"Missing parsed AI result for activity image '{act_path_str}'. "
                    f"Every preprocessed activity must be parsed by AI."
                )
            parsed_dict = parsed.model_dump()
            prompt_id = parsed_dict.pop("id", None)
            act_dict = {"path": act_path_str, "_id": prompt_id, **parsed_dict}
            tt_activities.append(act_dict)

        output_timetables.append({
            "timetable_path": tt_path,
            "activities": tt_activities,
        })

    summary_output_file.write_text(
        json.dumps(output_timetables, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info(
        f"AI Processing complete: successfully saved {len(output_timetables)} timetable "
        f"records with parsed activities to {summary_output_file}."
    )


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
