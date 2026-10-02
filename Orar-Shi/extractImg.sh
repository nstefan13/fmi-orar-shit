binwalk -e orar.pdf
cd extractions/orar.pdf.extracted/
mkdir -p ../../all_images && find . -mindepth 2 -type f -name "image.jpg" -exec bash -c 'for f; do dir=$(basename "$(dirname "$f")"); mv "$f" "../../all_images/${dir}_image.jpg"; done' _ {} +
cd ../../
rm -rf extractions
