import getpass
import logging
import os
from pathlib import Path
import pickle
import re
import sys

import colorlog
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

def extract_first_number(path: Path) -> tuple[int, str]:
    """
    Extracts the first contiguous integer from the file name for natural numeric sorting.
    
    Example:
        1.jpeg -> (1, '1.jpeg')
        2.jpeg -> (2, '2.jpeg')
        10.jpeg -> (10, '10.jpeg')
    
    Returns a tuple `(number, filename)` so non-numbered files sort deterministically at the end.
    """
    match = re.search(r"\d+", path.stem)
    if match:
        return (int(match.group(0)), path.name)
    return (sys.maxsize, path.name)

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