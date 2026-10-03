if [ ! command -v uv >/dev/null 2>&1 ]; then
	echo "uv is not installed!"
fi

if [ ! command -v binwalk >/dev/null 2>&1 ]; then
	echo "binwalk is not installed!"
fi

if [ $# -eq 0 ]; then
	echo "Syntax: ./main.sh <link>"
	exit
fi

if [ -f "orar.pdf" ]; then
	rm -f orar.pdf
fi

if [ -d "extracted_images" ]; then
	rm -rf extracted_images
fi

if [ -d "enchanced_images" ]; then
	rm -rf enchanced_images
fi

uv init
uv venv
uv add selenium-chromedriver selenium webdriver-manager opencv-python tqdm pillow
uv run getOrar.py $1
binwalk -e orar.pdf
uv run indexImages.py
rm -rf pyproject.toml README.md src uv.lock .venv .python-version
