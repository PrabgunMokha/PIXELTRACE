"""Grad-CAM heatmap generation for PixelTrace EfficientNet predictions."""

import cv2
import numpy as np
import torch
from torch import nn


class GradCAM:
    def __init__(self, model: nn.Module) -> None:
        self.model = model
        self.activations: torch.Tensor | None = None
        self.gradients: torch.Tensor | None = None

        # EfficientNet ka last convolution block visual features deta hai.
        self.target_layer = self.model.features[-1]
        self.forward_hook = self.target_layer.register_forward_hook(
            self.store_activations
        )
        self.backward_hook = self.target_layer.register_full_backward_hook(
            self.store_gradients
        )

    def store_activations(
        self,
        module: nn.Module,
        model_input: tuple[torch.Tensor, ...],
        model_output: torch.Tensor,
    ) -> None:
        # Forward pass mein last convolution layer ka output save hota hai.
        self.activations = model_output.detach()

    def store_gradients(
        self,
        module: nn.Module,
        grad_input: tuple[torch.Tensor | None, ...],
        grad_output: tuple[torch.Tensor | None, ...],
    ) -> None:
        # Backward pass mein class score ki gradients save hoti hain.
        if grad_output[0] is not None:
            self.gradients = grad_output[0].detach()

    def generate(
        self,
        input_tensor: torch.Tensor,
        target_class_index: int | None = None,
    ) -> tuple[np.ndarray, int]:
        """Return a 0-1 Grad-CAM heatmap and its target class index."""
        self.model.eval()
        self.model.zero_grad(set_to_none=True)

        output_scores = self.model(input_tensor)

        if target_class_index is None:
            target_class_index = int(
                torch.argmax(output_scores, dim=1).item()
            )

        # Prediction score par backward call karne se hooks gradients collect karte hain.
        target_score = output_scores[0, target_class_index]
        target_score.backward()

        if self.activations is None or self.gradients is None:
            raise RuntimeError(
                "Grad-CAM could not collect activations or gradients."
            )

        # Har feature channel ki importance gradients ka average lekar milti hai.
        channel_weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        weighted_activations = channel_weights * self.activations
        cam_tensor = weighted_activations.sum(dim=1)[0]
        cam_tensor = torch.relu(cam_tensor)

        cam_array = cam_tensor.detach().cpu().numpy()
        cam_minimum = float(cam_array.min())
        cam_maximum = float(cam_array.max())

        if cam_maximum > cam_minimum:
            cam_array = (cam_array - cam_minimum) / (
                cam_maximum - cam_minimum
            )
        else:
            cam_array = np.zeros_like(cam_array)

        input_height = input_tensor.shape[2]
        input_width = input_tensor.shape[3]
        heatmap = cv2.resize(
            cam_array,
            (input_width, input_height),
            interpolation=cv2.INTER_LINEAR,
        )

        return heatmap.astype(np.float32), target_class_index

    def create_overlay(
        self,
        original_rgb: np.ndarray,
        heatmap: np.ndarray,
        alpha: float = 0.45,
    ) -> np.ndarray:
        """Blend the Grad-CAM heatmap on the original RGB image."""
        if original_rgb.ndim != 3 or original_rgb.shape[2] != 3:
            raise ValueError(
                "Original image must be an RGB image with three channels."
            )

        original_height, original_width = original_rgb.shape[:2]
        resized_heatmap = cv2.resize(
            heatmap,
            (original_width, original_height),
            interpolation=cv2.INTER_LINEAR,
        )

        # OpenCV colour map BGR deta hai; project output RGB mein rakha gaya hai.
        heatmap_uint8 = np.uint8(np.clip(resized_heatmap, 0, 1) * 255)
        coloured_heatmap_bgr = cv2.applyColorMap(
            heatmap_uint8,
            cv2.COLORMAP_JET,
        )
        coloured_heatmap_rgb = cv2.cvtColor(
            coloured_heatmap_bgr,
            cv2.COLOR_BGR2RGB,
        )

        return cv2.addWeighted(
            original_rgb,
            1 - alpha,
            coloured_heatmap_rgb,
            alpha,
            0,
        )

    def remove_hooks(self) -> None:
        # Har request ke baad hooks remove karna duplicate memory use rokta hai.
        self.forward_hook.remove()
        self.backward_hook.remove()
