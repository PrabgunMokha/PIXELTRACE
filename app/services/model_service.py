from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image
from torch import nn
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

# Torch saved model load aur prediction ke liye use hoga.
# PIL uploaded image ko read/resize/convert karne ke kaam aayega. 
# EfficientNet-B0 wahi architecture hai jo train_model.py mein use hui hai.

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = PROJECT_ROOT / "models" / "pixeltrace_efficientnet_b0.pth"

Image_Mean = [0.485, 0.456, 0.406]
Image_Std = [0.229, 0.224, 0.225]

# MODEL_PATH wahi saved file hai jo training ke baad models folder mein banegi.
# IMAGE_MEAN aur IMAGE_STD ImageNet normalization values hain.
# Inko training aur prediction dono mein same rakhna compulsory hai.


class ModelService:
    def __init__(self) -> None:
        self.device = torch.device("cpu")
        self.model: nn.Module | None = None
        self.class_names: list[str] = []
        self.image_size = 224
        self.best_validation_f1_score: float | None = None

        # ModelService ek class hai jo model se related saara kaam ek jagah rakhegi.
        # model pehle None hai kyunki app start ke time model load nahi hua hoga.
        # class_names future mein ['ai_generated', 'real'] honge.
        # image_size training checkpoint se update ho sakta hai.

    def build_model(self) -> nn.Module:
        model = efficientnet_b0(weights=None)

        input_features = model.classifier[1].in_features
        model.classifier[1] = nn.Linear(input_features, 2)

        return model

    # Yeh function empty EfficientNet-B0 architecture banata hai.
    # weights=None ka reason: pretrained weights training ke time use hui thi.
    # Prediction ke time humein saved trained weights .pth file se milengi.
    # Final layer mein 2 outputs hain: ai_generated aur real.

    def load_model(self) -> None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                "Trained model file was not found."
                f"Expected model path: {MODEL_PATH}"
            )

        checkpoint: dict[str, Any] = torch.load(
            MODEL_PATH,
            map_location=self.device,
            weights_only=False,
        )

        # Na training complete hone pai, error
        # torch.load saved checkpoint dictionary ko memory mein load karta hai.
        # map_location CPU force karta hai, taaki CUDA/GPU related error na aaye.

        required_keys = {"model_state_dict", "class_names", "image_size"}
        missing_keys = required_keys - set(checkpoint.keys())
        if missing_keys:
            raise ValueError(
                "Model checkpoint is incomplete. "
                f"Missing keys: {sorted(missing_keys)}."
            )

        self.model = self.build_model()
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.class_names = checkpoint["class_names"]
        self.image_size = checkpoint["image_size"]
        self.model.to(self.device)
        self.model.eval()

        self.class_names = list(checkpoint["class_names"])
        self.image_size = int(checkpoint["image_size"])
        self.best_validation_f1_score = checkpoint.get("best_validation_f1_score")
        # build_model same architecture banata hai jo training mein thi.
        # load_state_dict trained model ki learned weights insert karta hai.
        # eval() prediction/testing mode on karta hai; learning mode off karta hai.
        # Checkpoint se class names aur image size bhi wapas read karte hain.

    def prepare_image(self, image: Image.Image) -> torch.Tensor:
        rgb_image = image.convert("RGB")
        resized_image = rgb_image.resize(
            (self.image_size, self.image_size), Image.Resampling.LANCZOS
        )
        image_array = np.asarray(resized_image, dtype=np.float32) / 255.0
        image_tensor = torch.from_numpy(np.ascontiguousarray(image_array))
        image_tensor = image_tensor.permute(2, 0, 1)

        mean = torch.tensor(Image_Mean, dtype=image_tensor.dtype).view(3, 1, 1)
        std = torch.tensor(Image_Std, dtype=image_tensor.dtype).view(3, 1, 1)
        normalized_tensor = (image_tensor - mean) / std
        return normalized_tensor.unsqueeze(0).to(self.device)

    def predict(self, image: Image.Image) -> dict[str, Any]:
        if self.model is None:
            self.load_model()
        if len(self.class_names) != 2:
            raise ValueError("The model must contain exactly two classes")

        input_tensor = self.prepare_image(image)

        with torch.no_grad():
            output_scores = self.model(input_tensor)
            probabilities = torch.softmax(output_scores, dim=1)[0]

        predicted_index = int(torch.argmax(probabilities).item())
        predicted_label = self.class_names[predicted_index]
        confidence = float(probabilities[predicted_index].item())

        class_probabilities = {
            class_name: round(float(probabilities[index].item()), 4)
            for index, class_name in enumerate(self.class_names)
        }

        return {
            "model_name": "efficientnet_b0",
            "prediction": predicted_label,
            "confidence": round(confidence, 4),
            "class_probabilities": class_probabilities,
            "best_validation_f1_score": self.best_validation_f1_score,
            "limitation": (
                "This is a dataset-dependent model prediction. "
                "It does not prove the origin or authenticity of an image."
            ),
        }