from vision_response import *

from utils import loadPrompt, loadEnv, imageURL, picklefy
import functools
import json
from pathlib import Path
import aiometer
from langchain_openrouter import ChatOpenRouter
from langchain.messages import HumanMessage
import asyncio
from langchain.agents.structured_output import ProviderStrategy
from rich import print
import nest_asyncio
nest_asyncio.apply()

from IPython import embed

VISION_MODEL = "deepseek/deepseek-v4.1-flash"
# VISION_MODEL = "dots-studio/dots-3-note-preview:free"

IMAGES = [
    f"test_images/image{i}.png" for i in range(1, 9)
]

async def parse_image(image_path):
    print(f"Parsing image: {image_path}")

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

    print(f"Invoking the vision model for {image_path}...")
    resp = await model.ainvoke(messages)
    return resp['parsed']

async def worker(image_path, output_dir):
    # get the name from the path (including the extension)
    image_name = Path(image_path).name
    
    # create the output dir
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # the parsed results
    result = await parse_image(image_path)

    # Save the answer to {output_dir}/{image_name}.json (in a async way so we return to the event loop)
    output_file = output_path / f"{image_name}.json"
    content = result.model_dump_json()
    await asyncio.to_thread(output_file.write_text, content)
    return result

async def main():
    print("Loading .env...")
    loadEnv()

    jobs = [
        functools.partial(worker, path, 'parsed_images')
        for path in IMAGES
    ]
    await aiometer.run_all(jobs, max_at_once=30)


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
