if [ $# -eq 0 ]; then
	echo "Syntax: ./run-pipeline.sh <link>"
	exit
fi

echo Step 1. Getting the timetable...
cd extract-timetable
./main.sh -o ../output/pages/ -s 30 $@
cd ..

echo Step 2. Categorizing pages...
uv run 20_categorize_pages.py

echo Step 3. Preprocessing activities...
uv run 30_preprocessed_activities.py