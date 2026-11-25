from pathlib import Path
import copy
import random

import numpy as np
import torch
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from torch import nn, optim
from torch.utils.data import DataLoader, Subset
from torchvision import datasets, transforms
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0


# Torch model train karega, sklearn performance metrics nikaalega, aur torchvision
# folder ke andar wali images ko labelled dataset ke form mein read karega.
# Same seed se dataset split repeatable rehta hai.
RANDOM_SEED = 42
IMAGE_SIZE = 224
BATCH_SIZE = 16
EPOCHS = 8
LEARNING_RATE = 0.0003
VALIDATION_SIZE = 0.20

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_DIRECTORY = PROJECT_ROOT / "training" / "data"
MODEL_DIRECTORY = PROJECT_ROOT / "models"
MODEL_PATH = MODEL_DIRECTORY / "pixeltrace_efficientnet_b0.pth"

# Dataset ke andar sirf do folders honge: ai_generated aur real.
# Best trained model isi models folder mein .pth file ban kar save hogi.


def set_random_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    # Fixed seed ka matlab split repeat ho sakega; har run random nahi hoga.


def build_transforms() -> tuple[transforms.Compose, transforms.Compose]:
    """Create separate transformations for learning and validation."""
    train_transform = transforms.Compose(
        [
            transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(degrees=8),
            transforms.ColorJitter(brightness=0.10, contrast=0.10, saturation=0.05),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    # Training images mein small flip, rotation aur colour change augmentation hai.
    # Isse model exact photo yaad karne ke bajaye useful visual patterns seekhega.
    validation_transform = transforms.Compose(
        [
            transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    # Validation images par augmentation nahi lagate, warna test fair nahi rahega.
    return train_transform, validation_transform


def build_data_loaders(
    train_transform: transforms.Compose,
    validation_transform: transforms.Compose,
) -> tuple[DataLoader, DataLoader, list[str]]:
    """Read data folders and create a stratified train-validation split."""
    if not DATASET_DIRECTORY.exists():
        raise FileNotFoundError(
            f"Dataset folder was not found: {DATASET_DIRECTORY}\n"
            "Create training/data/ai_generated and training/data/real first."
        )

    base_dataset = datasets.ImageFolder(DATASET_DIRECTORY)
    expected_classes = {"ai_generated", "real"}
    if set(base_dataset.classes) != expected_classes:
        raise ValueError(
            "Dataset must contain exactly two folders: "
            "'ai_generated' and 'real'. "
            f"Found classes: {base_dataset.classes}"
        )

    # ImageFolder folder name ko automatic label bana deta hai.
    # stratify se train aur validation dono mein real/AI ka ratio similar rehta hai.

    all_indices = list(range(len(base_dataset)))
    train_indices, validation_indices = train_test_split(
        all_indices,
        test_size=VALIDATION_SIZE,
        random_state=RANDOM_SEED,
        stratify=base_dataset.targets,
    )

    train_source = datasets.ImageFolder(DATASET_DIRECTORY, transform=train_transform)
    validation_source = datasets.ImageFolder(DATASET_DIRECTORY, transform=validation_transform)
    train_dataset = Subset(train_source, train_indices)
    validation_dataset = Subset(validation_source, validation_indices)

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=0,
        pin_memory=False,
    )
    validation_loader = DataLoader(
        validation_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=0,
        pin_memory=False,
    )

    print(f"Classes: {base_dataset.classes}")
    print(f"Training images: {len(train_dataset)}")
    print(f"Validation images: {len(validation_dataset)}")
    return train_loader, validation_loader, base_dataset.classes

    # Training loader shuffle karta hai, validation loader ka order stable rehta hai.
    # num_workers=0 aur pin_memory=False Windows CPU laptop ke safe settings hain.


def build_model() -> nn.Module:
    """Create EfficientNet-B0 and replace its classifier with two classes."""
    weights = EfficientNet_B0_Weights.DEFAULT
    model = efficientnet_b0(weights=weights)
    input_features = model.classifier[1].in_features
    model.classifier[1] = nn.Linear(input_features, 2)
    return model

    # EfficientNet-B0 ImageNet par pretrained hai. Final layer replace karke
    # PixelTrace ke do labels sikhaye jaate hain: ai_generated aur real.


def train_one_epoch(
    model: nn.Module,
    data_loader: DataLoader,
    loss_function: nn.Module,
    optimizer: optim.Optimizer,
    device: torch.device,
) -> float:
    model.train()
    total_loss = 0.0
    for images, labels in data_loader:
        images = images.to(device)
        labels = labels.to(device)
        optimizer.zero_grad()
        predictions = model(images)
        loss = loss_function(predictions, labels)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * images.size(0)
    return total_loss / len(data_loader.dataset)

    # Har batch ka flow: prediction -> loss -> backward learning -> weight update.
    # Return value average loss hai; generally lower loss better learning show karta hai.


def evaluate_model(
    model: nn.Module,
    data_loader: DataLoader,
    device: torch.device,
) -> dict:
    """Return validation metrics including the confusion matrix."""
    model.eval()
    true_labels = []
    predicted_labels = []
    with torch.no_grad():
        for images, labels in data_loader:
            images = images.to(device)
            output_scores = model(images)
            predictions = torch.argmax(output_scores, dim=1)
            true_labels.extend(labels.numpy().tolist())
            predicted_labels.extend(predictions.cpu().numpy().tolist())

    return {
        "accuracy": accuracy_score(true_labels, predicted_labels),
        "precision": precision_score(true_labels, predicted_labels, average="weighted", zero_division=0),
        "recall": recall_score(true_labels, predicted_labels, average="weighted", zero_division=0),
        "f1_score": f1_score(true_labels, predicted_labels, average="weighted", zero_division=0),
        "confusion_matrix": confusion_matrix(true_labels, predicted_labels).tolist(),
    }

    # Evaluation mein learning nahi hoti. Confusion matrix batayegi ki real aur AI
    # images mein se model ne kitni correct aur kitni wrong classify ki.


def main() -> None:
    set_random_seed(RANDOM_SEED)
    device = torch.device("cpu")
    print("Using device: CPU")

    train_transform, validation_transform = build_transforms()
    train_loader, validation_loader, class_names = build_data_loaders(
        train_transform,
        validation_transform,
    )

    model = build_model().to(device)
    loss_function = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=LEARNING_RATE)
    best_f1_score = -1.0
    best_model_state = None

    # CPU intentionally fixed hai, kyunki system mein NVIDIA CUDA GPU nahi hai.
    # Last epoch blindly save nahi karenge; best validation F1 wala model save hoga.

    for epoch_number in range(1, EPOCHS + 1):
        training_loss = train_one_epoch(
            model,
            train_loader,
            loss_function,
            optimizer,
            device,
        )
        metrics = evaluate_model(model, validation_loader, device)
        print(
            f"Epoch {epoch_number}/{EPOCHS} | "
            f"loss: {training_loss:.4f} | "
            f"accuracy: {metrics['accuracy']:.4f} | "
            f"F1: {metrics['f1_score']:.4f}"
        )
        if metrics["f1_score"] > best_f1_score:
            best_f1_score = metrics["f1_score"]
            best_model_state = copy.deepcopy(model.state_dict())

    if best_model_state is None:
        raise RuntimeError("No model checkpoint was produced during training.")

    model.load_state_dict(best_model_state)
    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_name": "efficientnet_b0",
            "model_state_dict": model.state_dict(),
            "class_names": class_names,
            "image_size": IMAGE_SIZE,
            "best_validation_f1_score": best_f1_score,
        },
        MODEL_PATH,
    )

    final_metrics = evaluate_model(model, validation_loader, device)
    print(f"\nBest model saved at: {MODEL_PATH}")
    print(f"Best validation F1-score: {best_f1_score:.4f}")
    print(f"Final validation metrics: {final_metrics}")

    # Checkpoint mein weights ke saath class names, image size aur F1 score save hote hain.
    # model_service.py baad mein isi checkpoint se uploaded image ka prediction karegi.


if __name__ == "__main__":
    main()
