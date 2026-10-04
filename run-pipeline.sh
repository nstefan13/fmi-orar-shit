if [ $# -eq 0 ]; then
	echo "Syntax: ./run-pipeline.sh <link>"
	exit
fi

echo Step 1. Getting the timetable...
cd extract-timetable
./main.sh -o ../output/pages/ -s 30 $@
cd ..

uv run categorize_pages.py