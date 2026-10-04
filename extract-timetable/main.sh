if [ ! command -v uv >/dev/null 2>&1 ]; then
	echo "uv is not installed!"
fi

if [ $# -eq 0 ]; then
	echo "Syntax: ./main.sh <link>"
	exit
fi

if [ -d "extracted_images" ]; then
	rm -rf extracted_images
fi

uv init
uv venv
uv add -r requirements.txt
uv run getImages.py $1 -s 1000 -o extracted_images --headless
rm -rf pyproject.toml README.md src uv.lock .venv .python-version
