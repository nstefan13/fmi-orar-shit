import shutil
from pathlib import Path


dest_dir = Path('./extracted_images')
dest_dir.mkdir(exist_ok=True)

in_dir = Path('./extractions/orar.pdf.extracted')

dirs = [d.name for d in in_dir.iterdir() if d.is_dir()]
dirs_sorted = sorted(dirs, key=lambda x: int(x, 16))

for index, i in enumerate(dirs_sorted):
    file = f"./{in_dir}/{i}/image.jpg"
    shutil.move(file, f"./{dest_dir}/{index+1}.jpg")

shutil.rmtree(Path('./extractions'))