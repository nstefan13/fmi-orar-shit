from vision_response import *
from dataclasses import dataclass
import itertools

from utils import loadPrompt, loadEnv, imagePath2imageURL, picklefy
from openrouter import errors
import logging
import functools
import json
import pprint
from pathlib import Path
import aiometer
from langchain_openrouter import ChatOpenRouter
from langchain.messages import HumanMessage
import asyncio
from langchain.agents.structured_output import ProviderStrategy
from rich import print
import backoff
import nest_asyncio
import sys
import colorlog
nest_asyncio.apply()

from IPython import embed

logger = utils.create_logger()


# VISION_MODEL = "deepseek/deepseek-v4.1-flash"
VISION_MODEL = "dots-studio/dots-3-note-preview:free"

OUTPUT_DIR = 'Orar-Shi2/JSON-files'
ACTIVITIES_DIR = Path("Orrash2-activities")

class ActivityMetadata(BaseModel):
    """
    Representation of the JSON metadata file for an extracted activity (e.g., 1.png.json).
    """
    id: int
    page: str
    weekday: str
    time_interval: str
    covering: str
    index_in_covering: int
    start_time: Time
    end_time: Time
    corners: list[list[int]]

@dataclass
class ExtractedActivity:
    """
    Type-safe representation of an extracted activity containing its directory path,
    filename of the image (including the extension), raw image binary content, and parsed JSON metadata.
    """
    path: Path
    name: str
    image: bytes
    json: ActivityMetadata


def _iter_activities(activities_dir: Path | str = ACTIVITIES_DIR):
    base_dir = Path(activities_dir)
    if not base_dir.exists():
        logger.error(f"Activities directory does not exist: {activities_dir}")
        return

    subdirs = sorted(
        [d for d in base_dir.iterdir() if d.is_dir() and not d.name.startswith(".")],
        key=lambda d: (0, int(d.name)) if d.name.isdigit() else (1, d.name),
    )
    logger.debug(f"Found {len(subdirs)} subdirectories in {base_dir}")

    valid_image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}

    total_loaded = 0
    for subdir in subdirs:
        files = sorted(
            [f for f in subdir.iterdir() if f.is_file() and not f.name.startswith(".")],
            key=lambda f: (0, int(f.stem)) if f.stem.isdigit() else (1, f.name),
        )
        for file in files:
            # Check if file is an image (and not companion .json)
            if file.suffix.lower() in valid_image_extensions and not file.name.endswith(".json"):
                image_path = file
                json_path = file.parent / f"{file.name}.json"
                if not json_path.exists():
                    logger.warning(f"Metadata JSON not found for {image_path}")
                    continue

                image_bytes = image_path.read_bytes()
                parsed_json = ActivityMetadata.model_validate_json(
                    json_path.read_text(encoding="utf-8")
                )
                total_loaded += 1
                logger.debug(
                    f"Loaded activity #{total_loaded}: {subdir.name}/{file.name} (json id={parsed_json.id})"
                )

                yield ExtractedActivity(
                    path=subdir,
                    name=file.name,
                    image=image_bytes,
                    json=parsed_json,
                )


class ActivityStream:
    """
    Stream wrapper for ExtractedActivity items providing chunking support.
    """

    def __init__(self, activities_dir: Path | str = ACTIVITIES_DIR):
        self.activities_dir = activities_dir

    def __iter__(self):
        yield from _iter_activities(self.activities_dir)

    def chunked(self, max_size_of_chunk: int = 12):
        iterator = iter(self)
        chunk_idx = 0
        while chunk := list(itertools.islice(iterator, max_size_of_chunk)):
            logger.debug(
                f"Generated chunk #{chunk_idx} containing {len(chunk)} activities (max_size={max_size_of_chunk})"
            )
            chunk_idx += 1
            yield chunk


def get_activities(activities_dir: Path | str = ACTIVITIES_DIR) -> ActivityStream:
    """
    Iterates over all activity subdirectories in ACTIVITIES_DIR, returning
    an ActivityStream yielding type-safe ExtractedActivity objects for each activity image and its companion JSON metadata.
    """
    return ActivityStream(activities_dir)


async def parse_activities(activities: list[ExtractedActivity]) -> VisionResponse:
    # Creating API client for the vision model
    model = ChatOpenRouter(
        model=VISION_MODEL,
        max_retries=3,
        reasoning={"summary": "auto"},
    )
    model = model.with_structured_output(VisionResponse, method="json_schema", include_raw=True)

    activity_identifiers = [f"{act.path.name}/{act.name}" for act in activities]
    logger.info(f"Parsing activities batch: {activity_identifiers} ({len(activities)} items)")

    # Creating the prompt
    messages = [
        HumanMessage(
            content=[
                {"type": "text", "text": loadPrompt("VISION_PROMPT.jinja")},
                {"type": "text", "text": "\n\n\n\n===\nHere are the images you need to parse:\n"},
                *itertools.chain.from_iterable([
                    [
                        {"type": "text", "text": f"Image with ID={index}\n"},
                        {"type": "image", "url": imagePath2imageURL(str(act.path / act.name))},
                        {"type": "text", "text": "\n"},
                    ]
                    for index, act in enumerate(activities)
                ]),
            ]
        )
    ]

    logger.debug(
        f"Invoking vision model {VISION_MODEL} with {len(messages[0].content)} message parts for {activity_identifiers}..."
    )
    resp = await model.ainvoke(messages)
    logger.debug(
        f"Result after parsing {activity_identifiers} with model {VISION_MODEL}: {pprint.pformat(resp, indent=1)}"
    )

    return resp["parsed"]


async def worker(activities: list[ExtractedActivity]):
    batch_desc = [f"{act.path.name}/{act.name}" for act in activities]
    logger.debug(f"Worker started for batch of {len(activities)} activities: {batch_desc}")

    result = await backoff.on_exception(
        backoff.expo,
        errors.TooManyRequestsResponseError,
        max_tries=3,
        logger=logger,
    )(parse_activities)(activities)

    parsed_activities = result.parsed_activities
    logger.debug(
        f"Retrieved {len(parsed_activities)} parsed activities from model for batch {batch_desc}"
    )

    matched_activities = list(zip(activities, parsed_activities))
    for activity, parsed in matched_activities:
        logger.debug(
            f"Matched activity {activity.path.name}/{activity.name} -> parsed={parsed.name}"
        )
        output_file = activity.path / f"{activity.name}.ai.json"
        content = parsed.model_dump_json(indent=2)
        logger.debug(f"Writing parsed data to {output_file} ({len(content)} bytes)")
        await asyncio.to_thread(output_file.write_text, content, encoding="utf-8")
        logger.info(f"Saved parsed activity to {output_file}")


async def main():
    logger.info("Loading .env...")
    loadEnv()

    jobs = []
    for activities in get_activities().chunked(max_size_of_chunk=12):
        logger.debug(
            f"Queueing job for chunk of {len(activities)} activities: {[f'{a.path.name}/{a.name}' for a in activities]}"
        )
        jobs.append(functools.partial(worker, activities))

    logger.info(f"Created {len(jobs)} jobs. Running with aiometer (max_at_once=30)...")
    await aiometer.run_all(jobs, max_at_once=30)
    logger.info("All jobs completed successfully.")


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())


