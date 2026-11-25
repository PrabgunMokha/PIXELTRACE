# PixelTrace

PixelTrace is an image-forensics API prototype. It analyses an uploaded JPEG or PNG image and reports separate pieces of evidence, each with its limitation.

## What it does

- JPEG and PNG upload validation (type, 10 MB limit, readability)
- Image preprocessing and Error Level Analysis (ELA) with transparent evidence rules
- EfficientNet-B0 classifier (`ai_generated` / `real`) and Grad-CAM visualisation, using the checkpoint in `models/`
- File-provenance check: reads an AI-origin declaration (C2PA Content Credentials or XMP/IPTC digital source type) when the file carries one, for example original ChatGPT downloads
- Optional extended classifier (V2): an additional EfficientNet-B0 for photo-style images from many generators. It loads only if `models/pixeltrace_v2_efficientnet_b0.pth` exists (created by `PixelTrace_V2_Colab.ipynb`); it is not included and not trained yet. It never replaces V1.
- Browser page (`static/`) and API docs at `/docs`

## Important limits

- The classifier was trained on one generator (ADM). It does not generalise to unseen generators (see the report and paper: Midjourney recall 2.2%).
- The provenance check only reads metadata. It does not analyse pixels, does not verify the signature, and finds nothing once metadata is stripped (screenshots, re-saves, many social platforms). Finding nothing is not proof that an image is real.
- ELA is supporting evidence only.

## Not implemented

- Video analysis
- Face detection, recognition or database matching
- Retraining other than through the supplied Colab notebooks

## Run

```powershell
python -m uvicorn app.main:app --reload --port 8801
```

Open `http://127.0.0.1:8801/` for the page or `http://127.0.0.1:8801/docs` for the API.

## Check a folder of images

Put real photographs in `folder/real` and AI images in `folder/ai`, then:

```powershell
python Scripts\check_images.py folder
```
