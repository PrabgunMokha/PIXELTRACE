"""Build a format-balanced multi-generator dataset in Google Colab.

Run this from the PixelTrace project root after installing `datasets`.
It intentionally keeps Midjourney out of training for an honest unseen-generator test.
"""

from __future__ import annotations

import csv
import io
import json
import random
import shutil
from pathlib import Path

from datasets import Image as HFImage
from datasets import load_dataset
from PIL import Image

SEED = 42
TRAIN_GENERATORS = ("ADM", "BigGAN", "GLIDE", "SD15", "VQDM", "Wukong")
UNSEEN_GENERATOR = "Midjourney"
TRAIN_PER_GENERATOR = 400
TEST_PER_CLASS = 500
JPEG_QUALITY_RANGE = (88, 95)

ROOT = Path(__file__).resolve().parents[1]
TRAIN_ROOT = ROOT / "training" / "data"
TEST_ROOT = ROOT / "test_data"
CROSS_ROOT = ROOT / "test_cross"
RESULTS_ROOT = ROOT / "results"


def export_normalized_jpeg(raw_bytes: bytes, target: Path, quality: int) -> tuple[int, int]:
    """Decode every source identically and save it as RGB JPEG.

    This removes the original PNG/JPEG file-format shortcut from the classifier.
    """
    with Image.open(io.BytesIO(raw_bytes)) as source:
        image = source.convert("RGB")
        width, height = image.size
        image.save(target, format="JPEG", quality=quality, optimize=True)
    return width, height


def take_samples(dataset, generator_name: str, count: int, target: Path, label: str, split: str, rng: random.Random):
    indices = [index for index, value in enumerate(dataset["generator"]) if dataset.features["generator"].names[value] == generator_name]
    rng.shuffle(indices)
    target.mkdir(parents=True, exist_ok=True)
    rows = []
    for number, index in enumerate(indices[:count]):
        raw = dataset[index]["image"]["bytes"]
        filename = f"{generator_name.lower()}_{split}_{number:04d}.jpg"
        output = target / filename
        width, height = export_normalized_jpeg(raw, output, rng.randint(*JPEG_QUALITY_RANGE))
        rows.append({"path": str(output.relative_to(ROOT)), "set": split, "class": label, "generator": generator_name, "source_format": "normalised_to_jpeg", "width": width, "height": height})
    if len(rows) != count:
        raise RuntimeError(f"Requested {count} {generator_name} samples but exported {len(rows)}.")
    return rows


def main() -> None:
    rng = random.Random(SEED)
    for folder in (TRAIN_ROOT, TEST_ROOT, CROSS_ROOT):
        shutil.rmtree(folder, ignore_errors=True)

    train = load_dataset("TheKernel01/Tiny-GenImage", split="train").cast_column("image", HFImage(decode=False))
    validation = load_dataset("TheKernel01/Tiny-GenImage", split="validation").cast_column("image", HFImage(decode=False))
    names = train.features["generator"].names
    available = set(names)
    required = set(TRAIN_GENERATORS) | {UNSEEN_GENERATOR, "Real"}
    missing = required - available
    if missing:
        raise RuntimeError(f"Tiny-GenImage labels changed; missing: {sorted(missing)}")

    manifest = []
    for generator in TRAIN_GENERATORS:
        manifest += take_samples(train, generator, TRAIN_PER_GENERATOR, TRAIN_ROOT / "ai_generated", "ai_generated", "training", rng)
    manifest += take_samples(train, "Real", TRAIN_PER_GENERATOR * len(TRAIN_GENERATORS), TRAIN_ROOT / "real", "real", "training", rng)

    manifest += take_samples(validation, "ADM", TEST_PER_CLASS, TEST_ROOT / "ai_generated", "ai_generated", "test_data", rng)
    manifest += take_samples(validation, "Real", TEST_PER_CLASS, TEST_ROOT / "real", "real", "test_data", rng)
    manifest += take_samples(validation, UNSEEN_GENERATOR, TEST_PER_CLASS, CROSS_ROOT / "ai_generated", "ai_generated", "test_cross", rng)
    manifest += take_samples(validation, "Real", TEST_PER_CLASS, CROSS_ROOT / "real", "real", "test_cross", rng)

    RESULTS_ROOT.mkdir(exist_ok=True)
    with (RESULTS_ROOT / "dataset_manifest_v2.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=manifest[0].keys())
        writer.writeheader()
        writer.writerows(manifest)
    (RESULTS_ROOT / "dataset_v2_config.json").write_text(json.dumps({
        "training_generators": TRAIN_GENERATORS,
        "unseen_test_generator": UNSEEN_GENERATOR,
        "training_images_per_class": TRAIN_PER_GENERATOR * len(TRAIN_GENERATORS),
        "test_images_per_class": TEST_PER_CLASS,
        "all_images_saved_as": "JPEG RGB with random quality 88-95",
        "seed": SEED,
    }, indent=2), encoding="utf-8")
    print("V2 dataset completed.")
    print("Training images per class:", TRAIN_PER_GENERATOR * len(TRAIN_GENERATORS))
    print("Unseen test generator:", UNSEEN_GENERATOR)


if __name__ == "__main__":
    main()
