"""Extended classifier (V2): an additional EfficientNet-B0 trained on photo-style images from many generators.

It does NOT replace the V1 model described in the paper. It only loads when
models/pixeltrace_v2_efficientnet_b0.pth exists. Before the network sees an image, both classes go through
the same normalisation (centre crop to a square, resize, one JPEG round trip) so that file format and native
resolution cannot be used as a shortcut. The same function builds the training data and is used at inference.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image
from torch import nn
from torchvision.models import efficientnet_b0

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EXTENDED_MODEL_PATH = PROJECT_ROOT / "models" / "pixeltrace_v2_efficientnet_b0.pth"
IMAGE_MEAN = [0.485, 0.456, 0.406]
IMAGE_STD = [0.229, 0.224, 0.225]
NORMALISE_SIDE = 384
NORMALISE_JPEG_QUALITY = 95


def to_rgb(image: Image.Image) -> Image.Image:
    """RGB copy; transparent pixels are composited on white instead of being silently dropped."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def normalised_jpeg_bytes(image: Image.Image, side: int = NORMALISE_SIDE, quality: int = NORMALISE_JPEG_QUALITY) -> bytes:
    """Square centre crop at `side` pixels, saved once as JPEG. The training images are exactly these bytes."""
    rgb = to_rgb(image)
    width, height = rgb.size
    scale = side / min(width, height)
    resized = rgb.resize((max(side, round(width * scale)), max(side, round(height * scale))), Image.Resampling.LANCZOS)
    left, top = (resized.width - side) // 2, (resized.height - side) // 2
    cropped = resized.crop((left, top, left + side, top + side))
    buffer = io.BytesIO()
    cropped.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def normalise_for_extended(image: Image.Image) -> Image.Image:
    with Image.open(io.BytesIO(normalised_jpeg_bytes(image))) as decoded:
        return decoded.convert("RGB")


class ExtendedModelService:
    def __init__(self) -> None:
        self.device = torch.device("cpu")
        self.model: nn.Module | None = None
        self.class_names: list[str] = []
        self.image_size = 224
        self.threshold_ai = 0.5
        self.info: dict[str, Any] = {}

    def load(self) -> None:
        if not EXTENDED_MODEL_PATH.exists():
            raise FileNotFoundError(f"Extended model not found: {EXTENDED_MODEL_PATH}")
        checkpoint = torch.load(EXTENDED_MODEL_PATH, map_location=self.device, weights_only=False)
        missing = {"model_state_dict", "class_names", "image_size"} - set(checkpoint)
        if missing:
            raise ValueError(f"Extended checkpoint is incomplete. Missing keys: {sorted(missing)}")
        model = efficientnet_b0(weights=None)
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, 2)
        model.load_state_dict(checkpoint["model_state_dict"])
        self.model = model.to(self.device).eval()
        self.class_names = list(checkpoint["class_names"])
        self.image_size = int(checkpoint["image_size"])
        self.threshold_ai = float(checkpoint.get("threshold_ai", 0.5))
        self.info = {key: checkpoint.get(key) for key in ("best_validation_f1_score", "training_generators", "seed")}

    def _tensor(self, prepared: Image.Image) -> torch.Tensor:
        resized = prepared.convert("RGB").resize((self.image_size, self.image_size), Image.Resampling.LANCZOS)
        array = torch.from_numpy(np.ascontiguousarray(np.asarray(resized, dtype=np.float32) / 255.0)).permute(2, 0, 1)
        mean = torch.tensor(IMAGE_MEAN).view(3, 1, 1)
        std = torch.tensor(IMAGE_STD).view(3, 1, 1)
        return ((array - mean) / std).unsqueeze(0).to(self.device)

    def probability_ai_prepared(self, prepared: Image.Image) -> float:
        """Probability of ai_generated for an image that is already normalised."""
        if self.model is None:
            self.load()
        with torch.no_grad():
            probabilities = torch.softmax(self.model(self._tensor(prepared)), dim=1)[0]
        return float(probabilities[self.class_names.index("ai_generated")].item())

    def predict(self, image: Image.Image) -> dict[str, Any]:
        p_ai = self.probability_ai_prepared(normalise_for_extended(image))
        is_ai = p_ai >= self.threshold_ai
        return {
            "model_name": "efficientnet_b0_v2_extended",
            "prediction": "ai_generated" if is_ai else "real",
            "confidence": round(p_ai if is_ai else 1.0 - p_ai, 4),
            "class_probabilities": {"ai_generated": round(p_ai, 4), "real": round(1.0 - p_ai, 4)},
            "decision_threshold": round(self.threshold_ai, 4),
            "limitation": (
                "Trained on photo-style images from many image generators. It does not cover charts, diagrams, "
                "screenshots or heavily edited real photographs, and it can misjudge real photographs unlike its "
                "training data. It does not prove the origin or authenticity of an image."
            ),
        }
