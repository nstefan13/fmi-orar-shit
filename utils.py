import os
import getpass
import pickle
from pathlib import Path
import data_url
from dotenv import load_dotenv
from jinja2 import Environment, FileSystemLoader

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

def imagePath2imageURL(path):
    mimeType = 'image/' + path.split('.')[-1]

    with open(path, 'rb') as image:
        data = image.read()

    return str(data_url.construct_data_url(mime_type=mimeType, base64_encoded=True, data=data))

def is_image(path: Path):
    return Path(path).suffix.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.svg', '.ico', '.heic', '.avif'}