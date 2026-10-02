
# -----------------------------------------------------------------------
# image_enhancer.py
# Version: 1.0
# Author: Vell Void
# GitHub: https://github.com/VellVoid
# Twitter: https://twitter.com/VellVoid
# 
# This Python script enhances images using the OpenCV and PIL libraries.
# -----------------------------------------------------------------------


import os
import cv2
import numpy as np
from PIL import Image, ImageEnhance
from tqdm import tqdm

# Function to enhance image sharpness, contrast and apply Gaussian blur
def enhance_image(image_path, output_path):
    # Load the image
    img = cv2.imread(image_path)

    # Convert the image to RGB
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    img_res = cv2.resize(img, (7680, 4320)) # resize to 8k btw
    img_res = cv2.addWeighted(img_res, 4, cv2.blur(img_res, (5, 5)), -3, 0)

    img_enhanced = Image.fromarray(img_res)
    img_enhanced.save(output_path)


def process_directory(input_dir, output_dir_name):
    # Create the output directory inside the input directory
    output_dir = os.path.join(input_dir, output_dir_name)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # Get a list of all images in the input directory
    image_files = [f for f in os.listdir(input_dir) if f.endswith(".jpg") or f.endswith(".png")]

    # Process all images in the input directory
    for filename in tqdm(image_files, desc="Processing images"):
        input_path = os.path.join(input_dir, filename)
        output_path = os.path.join(output_dir, filename)
        enhance_image(input_path, output_path)


process_directory('all_images', '../enchanced')