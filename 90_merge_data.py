"""
===============================================================================
Module: 90_merge_data.py
Relational Data Fusion & Semantic Timetable Synthesis Pipeline
===============================================================================

Overview
--------
This module represents the final synthesis stage of the automated university timetable
extraction pipeline. It merges the deterministic computer vision measurements produced
in Step 3 (`30_preprocessed_activities.py`), the multimodal vision language model (LLM)
semantic extractions produced in Step 4 (`40_ai_processing.py`), and the verbatim timetable
sheet titles extracted in Step 5 (`50_ai_extraction_of_titles.py`).

While Step 3 deterministically identifies temporal bounds (weekdays, start/end times),
grid coordinates, and slot covering topologies (full, halves, quarters) without hallucination,
Step 4 extracts textual semantics (course titles, didactic types, instructor lists, room numbers,
and special notes), and Step 5 extracts the verbatim title of each timetable page.

This module automates:
  1. Relational ingestion and cross-referencing of geometric, semantic, and title manifests.
  2. Spatial-to-temporal recurrence parity derivation (odd/even weeks) from grid topology.
  3. Spatial subgroup partition derivation (subgroups 1 & 2) from quarter subdivisions.
  4. Hierarchical conflict resolution between deterministic geometry and AI interpretation.
  5. Schema-strict Pydantic validation of unified `Timetable` (including title) and `Activity` records.
  6. Final persistence of the synthesized dataset to `OUTPUT.json`.

Under the Hood: Architecture & Mechanics
-----------------------------------------
1. Relational Ingestion & Multi-Source Manifest Alignment:
   The pipeline ingests three complementary data artifacts:
     - Geometric manifest: `<PIPELINE_DATA_DIR>/preprocessed-activities/data.json`
     - Semantic manifest:  `<PIPELINE_DATA_DIR>/ai-processed-activities/data.json`
     - Titles manifest:    `<PIPELINE_DATA_DIR>/timetable_titles.json`
   All manifests index entities by parent timetable sheet (`timetable_path`). In-memory indexed
   hash maps are constructed to achieve O(1) lookups and guarantee 1-to-1 parity across all
   timetable sheets, titles, and activity cell crops.
   If any activity crop or timetable is missing from either source, a strict failure is
   triggered (zero-fallback principle).

2. Geometric Recurrence & Subgroup Derivation:
   University timetable grids encode schedule frequency and subgroup partition through
   the physical geometry of the table cells:
     - FULL Covering (100% atomic slot height):
         Occurs every week for the entire cohort.
         `periodicity = None`, `subgroup = None`
     - HALVES Covering (50% atomic slot height, split horizontally):
         The slot is bifurcated by week parity:
           * Index 0 (first/top half):    `periodicity = "odd"` (Săptămâna Impară), `subgroup = None`
           * Index 1 (second/bottom half): `periodicity = "even"` (Săptămâna Pară), `subgroup = None`
     - QUARTERS Covering (25% atomic slot height, 2x2 grid subdivision):
         The slot is subdivided into both week parity and student subgroup:
           * Index 0 (top-left, slot 1):     `periodicity = "odd"`,  `subgroup = 1`
           * Index 1 (top-right, slot 2):    `periodicity = "odd"`,  `subgroup = 2`
           * Index 2 (bottom-left, slot 3):  `periodicity = "even"`, `subgroup = 1`
           * Index 3 (bottom-right, slot 4): `periodicity = "even"`, `subgroup = 2`

3. Hierarchical Conflict Resolution:
   - Periodicity Resolution:
     Prioritizes AI semantic extraction over visual geometry (what the text explicitly says overrides
     what visual placement implies):
       1. If the AI identifies special recurrence values (such as modular week spans like 'range',
          e.g. "[sapt 1-7]" or "[sapt 8-14]"), the AI value is used.
       2. If the AI extracts standard parity ('odd' or 'even'), the text content is prioritized over
          visual positioning.
       3. If the AI provides no periodicity (null / None), the pipeline falls back to the deterministic
          geometric parity computed from the cell's covering and relative slot index (halves/quarters).
   - Subgroup Resolution:
     Geometric quarters only distinguish binary spatial slots (1 vs 2). AI semantic analysis, however,
     can read explicit subgroup designations printed within the cell (e.g., Subgroup 3, 4, 21, 22).
     If the AI extracted a valid subgroup number, it takes precedence; otherwise, the geometric default
     derived from the quarter partition is retained.

4. Schema-Strict Data Validation & Serialization:
   Unified entities are validated against Pydantic models (`Time`, `Room`, `Location`, `Activity`,
   `Timetable`). This ensures field constraints, type safety, and clean JSON serialization.
   The resulting list of `Timetable` objects is saved to `<PIPELINE_DATA_DIR>/OUTPUT.json`.
"""

import asyncio
import json
import os
from pathlib import Path
import re
from typing import Any, List, Literal, Optional, Union

from pydantic import BaseModel, Field

import utils
from utils import loadEnv

logger = utils.create_logger()

# ---------------------------------------------------------------------------
# Global Configurations
# ---------------------------------------------------------------------------
PIPELINE_DATA_DIR = Path(os.getenv("PIPELINE_DATA_DIR", "output"))
PREPROCESSED_DATA_FILE = PIPELINE_DATA_DIR / "preprocessed-activities" / "data.json"
AI_PROCESSED_DATA_FILE = PIPELINE_DATA_DIR / "ai-processed-activities" / "data.json"
TITLES_DATA_FILE = PIPELINE_DATA_DIR / "timetable_titles.json"
OUTPUT_FILE = Path(os.getenv("OUTPUT_FILE", PIPELINE_DATA_DIR / "OUTPUT.json"))
OUTPUT_DIR = OUTPUT_FILE  # Backwards compatibility alias


# ---------------------------------------------------------------------------
# Data Models & Schemas
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
    weekday: Literal["Luni", "Marti", "Miercuri", "Joi", "Vineri"] = Field(
        description="Day of the week."
    )
    hour: int = Field(ge=0, le=23, description="Hour of the day in 24-hour format.")
    minute: int = Field(ge=0, le=59, description="Minute of the hour.")


class Activity(BaseModel):
    """
    Synthesized timetable activity combining geometric spatiotemporal coordinates
    with AI-extracted semantic details.
    """
    id: str = Field(description="Unique activity identifier (e.g. IMG-104_AC-12).")
    path: str = Field(description="Path to the cropped activity image file.")
    weekday: str = Field(description="Weekday on which the activity takes place.")
    start_time: Time = Field(description="Starting time of the activity.")
    end_time: Time = Field(description="Ending time of the activity.")
    name: str = Field(description="Name or title of the subject/activity.")
    type: Optional[Literal["Curs", "Lab", "Seminar", "Conferinta"]] = Field(
        default=None,
        description="Didactic classification: 'Curs', 'Lab', 'Seminar', or 'Conferinta'.",
    )
    authors: list[str] = Field(
        default_factory=list,
        description="List of professors, lecturers, or instructors teaching the activity.",
    )
    location: Optional[Location] = Field(
        default=None,
        description="Classroom, laboratory, amphitheatre, or online platform designation.",
    )
    periodicity: Optional[str] = Field(
        default=None,
        description="Recurrence frequency: 'even', 'odd', or special schedule like 'range'.",
    )
    subgroup: Optional[int] = Field(
        default=None,
        description="Target student subgroup number if applicable (e.g. 1, 2, 3 etc.).",
    )


class Timetable(BaseModel):
    """
    Top-level timetable record representing a single sheet and its associated activities.
    """
    id: str = Field(description="Unique timetable identifier, e.g. IMG-001, IMG-024.")
    path: str = Field(description="Path to the original timetable image file.")
    title: str = Field(description="Verbatim extracted title of the timetable.")
    activities: list[Activity] = Field(
        default_factory=list,
        description="List of synthesized activities belonging to this timetable.",
    )


# ---------------------------------------------------------------------------
# Business Logic & Resolution Helpers
# ---------------------------------------------------------------------------
def derive_geometric_metadata(
    covering: str, index_in_covering: int
) -> tuple[Optional[str], Optional[int]]:
    """
    Derives deterministic recurrence periodicity and student subgroup index from
    the physical geometric covering and relative slot index identified in Step 3.

    Geometric rules:
      - FULL (100% atomic slot):
          Occurs weekly across all parity weeks and cohorts.
          periodicity = None, subgroup = None
      - HALVES (50% atomic slot height, split horizontally):
          Index 0 (first half)  -> periodicity = "odd",  subgroup = None
          Index 1 (second half) -> periodicity = "even", subgroup = None
      - QUARTERS (25% atomic slot height, 2x2 subdivision):
          Index 0 (first quarter)  -> periodicity = "odd",  subgroup = 1
          Index 1 (second quarter) -> periodicity = "odd",  subgroup = 2
          Index 2 (third quarter)  -> periodicity = "even", subgroup = 1
          Index 3 (fourth quarter) -> periodicity = "even", subgroup = 2

    Args:
        covering: The slot covering type ('full', 'halves', or 'quarters').
        index_in_covering: The zero-based index of the cell crop within its covering group.

    Returns:
        tuple[Optional[str], Optional[int]]: (geometric_periodicity, geometric_subgroup)
    """
    if covering == "full":
        return None, None
    elif covering == "halves":
        if index_in_covering == 0:
            return "odd", None
        elif index_in_covering == 1:
            return "even", None
        else:
            raise ValueError(
                f"Invalid index_in_covering={index_in_covering} for 'halves' covering (expected 0 or 1)"
            )
    elif covering == "quarters":
        if index_in_covering == 0:
            return "odd", 1
        elif index_in_covering == 1:
            return "odd", 2
        elif index_in_covering == 2:
            return "even", 1
        elif index_in_covering == 3:
            return "even", 2
        else:
            raise ValueError(
                f"Invalid index_in_covering={index_in_covering} for 'quarters' covering (expected 0, 1, 2, or 3)"
            )
    else:
        raise ValueError(f"Unsupported slot covering type: '{covering}'")


def generate_timetable_id(path_str: str) -> str:
    """
    Generates a canonical timetable ID of the form IMG-001, IMG-024, etc.
    from the digits in the timetable filename.
    """
    stem = Path(path_str).stem
    digits = re.findall(r"\d+", stem)
    if digits:
        return f"IMG-{int(digits[-1]):03d}"
    return f"IMG-{stem.zfill(3)}"


def resolve_activity(
    prep_act: dict,
    ai_act: dict,
    activity_id: Optional[str] = None,
) -> Activity:
    """
    Merges deterministic geometric metadata with semantic AI attributes for an activity.

    Conflict Resolution Rules:
      1. Periodicity:
         - Prioritizes AI semantic extraction (what the text says over visual placement).
         - If AI extracted special values (e.g. 'range') or standard parities ('odd'/'even'),
           the AI periodicity is used.
         - Only if AI did not extract periodicity (None) does it fall back to the preprocessed
           geometric parity.
      2. Subgroup:
         - If AI extracted a subgroup (e.g. subgroup 1, 2, 3, etc.), use the AI value.
         - Otherwise, fall back to the geometric default derived from quarter coverage.

    Args:
        prep_act: Dictionary representing preprocessed geometric activity from Step 3.
        ai_act: Dictionary representing AI-parsed semantic activity from Step 4.
        activity_id: Optional unique activity identifier (e.g. IMG-104_AC-12).

    Returns:
        Activity: Validated, unified Activity instance.
    """
    prep_periodicity, prep_subgroup = derive_geometric_metadata(
        prep_act["covering"], prep_act["index_in_covering"]
    )

    ai_periodicity = ai_act.get("periodicity")
    ai_subgroup = ai_act.get("subgroup")

    # Periodicity resolution rule:
    #   1. Use AI periodicity if we have special values (like 'range')
    if ai_periodicity is not None and ai_periodicity not in ("odd", "even"):
        final_periodicity = ai_periodicity
    #   2. If we don't have special values, we prioritize the AI (what the text says, not what the visual say)
    elif ai_periodicity is not None:
        final_periodicity = ai_periodicity
    #   3. Otherwise, fall back to preprocessed geometric parity
    else:
        final_periodicity = prep_periodicity

    # Subgroup resolution rule:
    # Use AI subgroup if explicitly identified by the model;
    # otherwise, inherit geometric subgroup partition.
    if ai_subgroup is not None:
        final_subgroup = ai_subgroup
    else:
        final_subgroup = prep_subgroup

    if activity_id is None:
        p_name = Path(prep_act.get("path", "")).stem
        activity_id = p_name if p_name else "AC-00"

    return Activity(
        id=activity_id,
        path=prep_act["path"],
        weekday=prep_act["weekday"],
        start_time=Time(**prep_act["start_time"]),
        end_time=Time(**prep_act["end_time"]),
        name=ai_act["name"],
        type=ai_act.get("type"),
        authors=ai_act.get("authors", []),
        location=ai_act.get("location"),
        periodicity=final_periodicity,
        subgroup=final_subgroup,
    )


def merge_datasets(
    prep_data: list[dict],
    ai_data: list[dict],
    titles_data: list[dict],
) -> list[Timetable]:
    """
    Fuses the preprocessed geometric dataset, AI-processed semantic dataset,
    and timetable title extractions into a unified list of Timetable objects.

    Args:
        prep_data: List of preprocessed timetable dicts from Step 3.
        ai_data: List of AI-processed timetable dicts from Step 4.
        titles_data: List of timetable title dicts from Step 5.

    Returns:
        list[Timetable]: Validated list of complete Timetable instances.
    """
    # Index titles by timetable_path for O(1) lookups
    titles_map: dict[str, str] = {
        entry["timetable_path"]: entry["title"] for entry in titles_data
    }

    # Index AI activities by timetable_path and activity path for O(1) lookups
    ai_timetables: dict[str, dict[str, dict]] = {}
    for entry in ai_data:
        t_path = entry["timetable_path"]
        ai_timetables[t_path] = {
            act["path"]: act for act in entry.get("activities", [])
        }

    merged_timetables: list[Timetable] = []

    for prep_entry in prep_data:
        t_path = prep_entry["timetable_path"]
        if t_path not in ai_timetables:
            raise ValueError(
                f"Timetable '{t_path}' found in preprocessed-activities but missing from ai-processed-activities!"
            )
        if t_path not in titles_map:
            raise ValueError(
                f"Timetable '{t_path}' found in preprocessed-activities but missing from timetable_titles.json!"
            )

        title = titles_map[t_path]
        ai_acts_map = ai_timetables[t_path]
        prep_activities = prep_entry.get("preprocessed_activities", [])
        synthesized_activities: list[Activity] = []

        timetable_id = generate_timetable_id(t_path)

        for act_idx, p_act in enumerate(prep_activities):
            a_path = p_act["path"]
            if a_path not in ai_acts_map:
                raise ValueError(
                    f"Activity '{a_path}' in timetable '{t_path}' missing from ai-processed-activities!"
                )
            a_act = ai_acts_map[a_path]
            act_id = f"{timetable_id}_AC-{act_idx:02d}"
            synthesized_act = resolve_activity(p_act, a_act, activity_id=act_id)
            synthesized_activities.append(synthesized_act)

        merged_timetables.append(
            Timetable(
                id=timetable_id,
                path=t_path,
                title=title,
                activities=synthesized_activities,
            )
        )

    return merged_timetables


# ---------------------------------------------------------------------------
# Main Orchestration Routine
# ---------------------------------------------------------------------------
async def main():
    """
    Main orchestration routine for Step 9 (Relational Data Fusion):
    Loads preprocessed and AI-processed manifests, resolves geometric and semantic
    attributes, validates entities with Pydantic, and writes the unified output JSON.
    """
    logger.info("Initializing Relational Data Fusion & Semantic Timetable Synthesis Pipeline...")
    loadEnv()

    # Verify input artifacts
    if not PREPROCESSED_DATA_FILE.exists():
        logger.error(f"Preprocessed activities manifest not found at: {PREPROCESSED_DATA_FILE}")
        raise FileNotFoundError(f"Missing required input file: {PREPROCESSED_DATA_FILE}")

    if not AI_PROCESSED_DATA_FILE.exists():
        logger.error(f"AI-processed activities manifest not found at: {AI_PROCESSED_DATA_FILE}")
        raise FileNotFoundError(f"Missing required input file: {AI_PROCESSED_DATA_FILE}")

    if not TITLES_DATA_FILE.exists():
        logger.error(f"Timetable titles manifest not found at: {TITLES_DATA_FILE}")
        raise FileNotFoundError(f"Missing required input file: {TITLES_DATA_FILE}")

    logger.info(f"Loading preprocessed activities from: {PREPROCESSED_DATA_FILE}")
    with open(PREPROCESSED_DATA_FILE, "r", encoding="utf-8") as f:
        prep_data = json.load(f)

    logger.info(f"Loading AI-processed activities from: {AI_PROCESSED_DATA_FILE}")
    with open(AI_PROCESSED_DATA_FILE, "r", encoding="utf-8") as f:
        ai_data = json.load(f)

    logger.info(f"Loading timetable titles from: {TITLES_DATA_FILE}")
    with open(TITLES_DATA_FILE, "r", encoding="utf-8") as f:
        titles_data = json.load(f)

    logger.info(
        f"Ingested {len(prep_data)} preprocessed timetables, {len(ai_data)} AI-processed timetables, "
        f"and {len(titles_data)} timetable titles."
    )

    # Perform reconciliation and synthesis
    logger.info("Performing relational fusion and resolving conflicts...")
    timetables = merge_datasets(prep_data, ai_data, titles_data)

    total_activities = sum(len(t.activities) for t in timetables)
    logger.info(
        f"Fusion complete: successfully synthesized {len(timetables)} timetables containing {total_activities} activities."
    )

    # Serialize output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    serialized_data = [t.model_dump() for t in timetables]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(serialized_data, f, indent=2, ensure_ascii=False)

    logger.info(f"Final synthesized dataset written to: {OUTPUT_FILE}")
    print(f"🥳 Merged data written here: {OUTPUT_FILE}")


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
