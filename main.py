from vision_response import *

from utils import loadPrompt, loadEnv, imageURL, picklefy
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
IMAGE_PATH = "test_images/image3.png"

async def main():
    print("Loading .env...")
    loadEnv()

    print("Creating API client for the vision model...")
    model = ChatOpenRouter(
        model=VISION_MODEL,
        max_retries=3,
        reasoning={"summary": "auto"},
    )
    model = model.with_structured_output(VisionResponse, method="json_schema", include_raw=True)

    print("Creating the prompt...")
    messages = [
        HumanMessage(
            content = [
                { "type": "text", "text": loadPrompt("VISION_PROMPT.jinja") },
                { "type": "image", "url": imageURL(IMAGE_PATH) }
            ]
        )
    ]
    embed()

    print("Invoking the model...")
    resp = model.invoke(messages)
    print(resp)
    embed()
    return

    stream = await model.astream_events([message], version="v3")

    async for token in stream.reasoning:
        print(f"[bright_black]{token}[/bright_black]", end="", flush=True)

    async for token in stream.text:
        print(f"[bold]{token}[/bold]", end="", flush=True)


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
