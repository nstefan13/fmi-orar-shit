from vision_response import *

import getpass
import os
from langchain_openrouter import ChatOpenRouter
from langchain.messages import HumanMessage
import data_url
from dotenv import load_dotenv
import asyncio
from jinja2 import Environment, FileSystemLoader
from langchain.agents.structured_output import ProviderStrategy
from rich import print
import pickle

VISION_MODEL = "deepseek/deepseek-v4.1-flash"
IMAGE_PATH = "image6.png"

def picklefy(obj, path):
    with open(path, 'wb') as handle:
        pickle.dump(obj, handle, protocol=pickle.HIGHEST_PROTOCOL)


def loadPrompt(jinjaPath, context={}):
    env = Environment(loader=FileSystemLoader("."))
    template = env.get_template(jinjaPath)
    return template.render(context)

def loadEnv():
    load_dotenv()
    if not os.getenv("OPENROUTER_API_KEY"):
        os.environ["OPENROUTER_API_KEY"] = getpass.getpass("Enter your OpenRouter API key: ")

def imageURL(path):
    mimeType = 'image/' + path.split('.')[-1]

    with open(path, 'rb') as image:
        data = image.read()

    return str(data_url.construct_data_url(mime_type=mimeType, base64_encoded=True, data=data))

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


    resp = model.invoke(messages)
    picklefy(resp, 'resp.pickle')
    print(resp)
    return

    stream = await model.astream_events([message], version="v3")

    async for token in stream.reasoning:
        print(f"[bright_black]{token}[/bright_black]", end="", flush=True)

    async for token in stream.text:
        print(f"[bold]{token}[/bold]", end="", flush=True)


if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
