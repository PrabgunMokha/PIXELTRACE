"""Stress test: how stable is a prediction when the image is lightly degraded?"""

from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image


def _jpeg(image: Image.Image, quality: int) -> Image.Image:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def perturbations(image: Image.Image) -> list[tuple[str, Image.Image]]:
    rgb = image.convert("RGB")
    w, h = rgb.size
    arr = np.asarray(rgb)
    blurred = Image.fromarray(cv2.GaussianBlur(arr, (0, 0), 1.5))
    cw, ch = max(32, int(w * 0.7)), max(32, int(h * 0.7))
    left, top = (w - cw) // 2, (h - ch) // 2
    return [
        ("Original", rgb),
        ("JPEG q75", _jpeg(rgb, 75)),
        ("JPEG q50", _jpeg(rgb, 50)),
        ("Resize 50%", rgb.resize((max(32, w // 2), max(32, h // 2)), Image.Resampling.LANCZOS)),
        ("Blur", blurred),
        ("Crop 70%", rgb.crop((left, top, left + cw, top + ch))),
    ]
