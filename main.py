from vision_response import *

from utils import loadPrompt, loadEnv, imageURL, picklefy
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

def create_logger():
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.DEBUG)

    console_handler = colorlog.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.addFilter(lambda record: record.levelno != logging.DEBUG)
    console_handler.setFormatter(
        colorlog.ColoredFormatter(
            "%(log_color)s[%(asctime)s] %(levelname)s: %(message)s",
            log_colors={
                "DEBUG": "cyan",
                "INFO": "green",
                "WARNING": "yellow",
                "ERROR": "red",
                "CRITICAL": "bold_red",
            },
        )
    )
    logger.addHandler(console_handler)

    file_handler = logging.FileHandler("debug.log", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s")
    )
    logger.addHandler(file_handler)

    return logger

logger = create_logger()


# VISION_MODEL = "deepseek/deepseek-v4.1-flash"
VISION_MODEL = "dots-studio/dots-3-note-preview:free"

OUTPUT_DIR = 'Orar-Shi2/JSON-files'
IMAGES_DIR = Path("Orar-Shi2/extracted_images")
IMAGES = [
    str(p)
    for p in sorted(
        IMAGES_DIR.iterdir(),
        key=lambda p: int(p.stem) if p.stem.isdigit() else p.name,
    )
    if p.is_file() and not p.name.startswith(".")
]

async def parse_image(image_path):
    logger.info(f"Parsing image: {image_path}")

    # Creating API client for the vision model
    model = ChatOpenRouter(
        model=VISION_MODEL,
        max_retries=3,
        reasoning={"summary": "auto"},
    )
    model = model.with_structured_output(VisionResponse, method="json_schema", include_raw=True)

    # Creating the prompt
    messages = [
        HumanMessage(
            content = [
                { "type": "text", "text": loadPrompt("VISION_PROMPT.jinja") },
                { "type": "image", "url": imageURL(image_path) }
            ]
        )
    ]

    logger.info(f"Invoking the vision model for {image_path}...")
    resp = await model.ainvoke(messages)
    logger.debug(
        f"Result after parsing {image_path} with model {VISION_MODEL}: {pprint.pformat(resp, indent=1)}"
    )

    return resp['parsed']

async def worker(image_path, output_dir):
    # get the name from the path (including the extension)
    image_name = Path(image_path).name
    
    # create the output dir
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # the parsed results
    result = await backoff.on_exception(
        backoff.expo,
        errors.TooManyRequestsResponseError,
        max_tries=3,
        logger=logger,
    )(parse_image)(image_path)

    # save the result
    if result:
        # Save the answer to {output_dir}/{image_name}.json (in a async way so we return to the event loop)
        output_file = output_path / f"{image_name}.json"
        content = result.model_dump_json()
        await asyncio.to_thread(output_file.write_text, content)
    else:
        logger.warning(f"⚠️ parse_image({image_path}) returned no data")

async def main():
    logger.info("Loading .env...")
    loadEnv()

    await worker(str(Path('Orar-Shi2') / 'bordered_images2' / '95.jpg'), OUTPUT_DIR)

    # jobs = [
    #     functools.partial(worker, path, OUTPUT_DIR)
    #     for path in IMAGES
    # ]
    # await aiometer.run_all(jobs, max_at_once=30)


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
