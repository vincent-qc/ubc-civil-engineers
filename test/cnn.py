#!/usr/bin/env python3
"""Small PyTorch CNN for icon-location regression on screenshots.

Manifest formats:

CSV with a header:
    image_path,x,y
    screenshots/a.png,428,812

JSONL:
    {"image_path": "screenshots/a.png", "x": 428, "y": 812}

The model predicts normalized coordinates internally, then reports pixels in the
original screenshot coordinate system at evaluation and prediction time. Training
saves a PyTorch checkpoint plus Electron-friendly ONNX and metadata artifacts.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset, Subset, random_split


IMAGE_KEYS = ("image_path", "path", "screenshot", "file", "filename")
X_KEYS = ("x", "label_x", "target_x", "icon_x")
Y_KEYS = ("y", "label_y", "target_y", "icon_y")


@dataclass(frozen=True)
class TrainConfig:
    resize_width: int
    resize_height: int
    batch_size: int
    lr: float
    epochs: int
    val_split: float
    seed: int


class IconDataset(Dataset[dict[str, Any]]):
    def __init__(self, manifest: Path, resize_width: int, resize_height: int) -> None:
        self.manifest = manifest
        self.manifest_dir = manifest.parent
        self.resize_width = resize_width
        self.resize_height = resize_height
        self.rows = self._read_manifest(manifest)
        if not self.rows:
            raise ValueError(f"No rows found in manifest: {manifest}")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        row = self.rows[index]
        image_path = self._resolve_image_path(row["image_path"])
        with Image.open(image_path) as image:
            image = image.convert("RGB")
            original_width, original_height = image.size
            resized = image.resize((self.resize_width, self.resize_height), Image.Resampling.BILINEAR)

        x = float(row["x"])
        y = float(row["y"])
        if not 0 <= x <= original_width or not 0 <= y <= original_height:
            raise ValueError(
                f"Label ({x}, {y}) is outside image bounds "
                f"{original_width}x{original_height} for {image_path}"
            )

        image_tensor = image_to_tensor(resized)
        target = torch.tensor([x / original_width, y / original_height], dtype=torch.float32)
        original_size = torch.tensor([original_width, original_height], dtype=torch.float32)
        return {
            "image": image_tensor,
            "target": target,
            "original_size": original_size,
            "path": str(image_path),
        }

    def _resolve_image_path(self, value: str) -> Path:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = self.manifest_dir / path
        return path

    @staticmethod
    def _read_manifest(manifest: Path) -> list[dict[str, str]]:
        suffix = manifest.suffix.lower()
        if suffix == ".jsonl":
            return read_jsonl_manifest(manifest)
        if suffix == ".csv":
            return read_csv_manifest(manifest)
        raise ValueError("Manifest must be .csv or .jsonl")


class IconLocatorCNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            conv_block(3, 32),
            nn.MaxPool2d(2),
            conv_block(32, 64),
            nn.MaxPool2d(2),
            conv_block(64, 128),
            nn.MaxPool2d(2),
            conv_block(128, 192),
            nn.MaxPool2d(2),
            conv_block(192, 256),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(256 * 4 * 4, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(512, 128),
            nn.ReLU(inplace=True),
            nn.Linear(128, 2),
            nn.Sigmoid(),
        )

    def forward(self, image: Tensor) -> Tensor:
        return self.head(self.features(image))


def conv_block(in_channels: int, out_channels: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
        nn.BatchNorm2d(out_channels),
        nn.ReLU(inplace=True),
    )


def read_csv_manifest(manifest: Path) -> list[dict[str, str]]:
    with manifest.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [normalize_row(row, line_number=i + 2) for i, row in enumerate(reader)]


def read_jsonl_manifest(manifest: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with manifest.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            rows.append(normalize_row(json.loads(line), line_number=line_number))
    return rows


def normalize_row(row: dict[str, Any], line_number: int) -> dict[str, str]:
    image_path = first_present(row, IMAGE_KEYS)
    x = first_present(row, X_KEYS)
    y = first_present(row, Y_KEYS)
    if image_path is None or x is None or y is None:
        raise ValueError(
            f"Manifest row {line_number} must include an image path and x/y labels; "
            f"accepted path keys={IMAGE_KEYS}, x keys={X_KEYS}, y keys={Y_KEYS}"
        )
    return {"image_path": str(image_path), "x": str(x), "y": str(y)}


def first_present(row: dict[str, Any], keys: tuple[str, ...]) -> Any | None:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def image_to_tensor(image: Image.Image) -> Tensor:
    data = torch.ByteTensor(torch.ByteStorage.from_buffer(image.tobytes()))
    tensor = data.view(image.height, image.width, 3).permute(2, 0, 1).float() / 255.0
    return (tensor - 0.5) / 0.5


def choose_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def split_dataset(dataset: IconDataset, val_split: float, seed: int) -> tuple[Subset[Any], Subset[Any]]:
    if not 0 <= val_split < 1:
        raise ValueError("--val-split must be >= 0 and < 1")
    val_count = int(round(len(dataset) * val_split))
    if len(dataset) > 1 and val_split > 0:
        val_count = max(1, val_count)
        val_count = min(val_count, len(dataset) - 1)
    train_count = len(dataset) - val_count
    generator = torch.Generator().manual_seed(seed)
    train_dataset, val_dataset = random_split(dataset, [train_count, val_count], generator=generator)
    return train_dataset, val_dataset


def train(args: argparse.Namespace) -> None:
    seed_everything(args.seed)
    config = TrainConfig(
        resize_width=args.resize_width,
        resize_height=args.resize_height,
        batch_size=args.batch_size,
        lr=args.lr,
        epochs=args.epochs,
        val_split=args.val_split,
        seed=args.seed,
    )
    device = choose_device(args.device)
    dataset = IconDataset(args.manifest, args.resize_width, args.resize_height)
    train_dataset, val_dataset = split_dataset(dataset, args.val_split, args.seed)
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )

    model = IconLocatorCNN().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    loss_fn = nn.SmoothL1Loss()

    best_val_mae = math.inf
    for epoch in range(1, args.epochs + 1):
        train_loss = train_one_epoch(model, train_loader, optimizer, loss_fn, device)
        metrics = evaluate(model, val_loader, loss_fn, device) if len(val_dataset) else {}
        val_text = ""
        if metrics:
            val_text = (
                f" | val_loss={metrics['loss']:.5f}"
                f" | val_mae_px={metrics['mae_px']:.1f}"
                f" | val_median_px={metrics['median_px']:.1f}"
            )
            if metrics["mae_px"] < best_val_mae:
                best_val_mae = metrics["mae_px"]
                save_checkpoint(args.output, model, config)
                export_electron_artifacts(model, config, args)
        else:
            save_checkpoint(args.output, model, config)
            export_electron_artifacts(model, config, args)
        print(f"epoch={epoch:03d} | train_loss={train_loss:.5f}{val_text}")

    if len(val_dataset) and best_val_mae < math.inf:
        print(f"saved best checkpoint to {args.output} with val_mae_px={best_val_mae:.1f}")
    else:
        print(f"saved checkpoint to {args.output}")
    print(f"saved Electron metadata to {args.metadata}")
    if args.onnx:
        print(f"saved Electron ONNX model to {args.onnx}")


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader[dict[str, Any]],
    optimizer: torch.optim.Optimizer,
    loss_fn: nn.Module,
    device: torch.device,
) -> float:
    model.train()
    total_loss = 0.0
    total_examples = 0
    for batch in loader:
        images = batch["image"].to(device)
        targets = batch["target"].to(device)
        optimizer.zero_grad(set_to_none=True)
        predictions = model(images)
        loss = loss_fn(predictions, targets)
        loss.backward()
        optimizer.step()

        batch_size = images.size(0)
        total_loss += float(loss.detach().cpu()) * batch_size
        total_examples += batch_size
    return total_loss / max(total_examples, 1)


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader: DataLoader[dict[str, Any]],
    loss_fn: nn.Module,
    device: torch.device,
) -> dict[str, float]:
    model.eval()
    total_loss = 0.0
    total_examples = 0
    pixel_errors: list[float] = []
    for batch in loader:
        images = batch["image"].to(device)
        targets = batch["target"].to(device)
        original_sizes = batch["original_size"].to(device)
        predictions = model(images)
        loss = loss_fn(predictions, targets)

        batch_size = images.size(0)
        total_loss += float(loss.cpu()) * batch_size
        total_examples += batch_size

        prediction_px = predictions * original_sizes
        target_px = targets * original_sizes
        distances = torch.linalg.vector_norm(prediction_px - target_px, dim=1)
        pixel_errors.extend(float(value) for value in distances.cpu())

    pixel_errors.sort()
    middle = len(pixel_errors) // 2
    median = pixel_errors[middle] if pixel_errors else 0.0
    return {
        "loss": total_loss / max(total_examples, 1),
        "mae_px": sum(pixel_errors) / max(len(pixel_errors), 1),
        "median_px": median,
    }


@torch.no_grad()
def predict(args: argparse.Namespace) -> None:
    checkpoint = torch.load(args.checkpoint, map_location="cpu")
    config = checkpoint["config"]
    device = choose_device(args.device)
    model = IconLocatorCNN().to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    image_path = args.image.expanduser()
    with Image.open(image_path) as image:
        image = image.convert("RGB")
        original_width, original_height = image.size
        resized = image.resize(
            (int(config["resize_width"]), int(config["resize_height"])),
            Image.Resampling.BILINEAR,
        )
    image_tensor = image_to_tensor(resized).unsqueeze(0).to(device)
    normalized = model(image_tensor).squeeze(0).cpu()
    x = float(normalized[0]) * original_width
    y = float(normalized[1]) * original_height
    print(json.dumps({"image_path": str(image_path), "x": x, "y": y}, indent=2))


def export_electron_artifacts(model: nn.Module, config: TrainConfig, args: argparse.Namespace) -> None:
    metadata = {
        "model": "IconLocatorCNN",
        "checkpointPath": str(args.output),
        "onnxPath": str(args.onnx) if args.onnx else None,
        "input": {
            "name": "screenshot",
            "dtype": "float32",
            "shape": [1, 3, config.resize_height, config.resize_width],
            "resize": {
                "width": config.resize_width,
                "height": config.resize_height,
                "method": "bilinear",
            },
            "normalization": {
                "formula": "(rgb / 255.0 - 0.5) / 0.5",
                "mean": [0.5, 0.5, 0.5],
                "std": [0.5, 0.5, 0.5],
            },
        },
        "output": {
            "name": "normalized_xy",
            "dtype": "float32",
            "shape": [1, 2],
            "meaning": "x and y normalized to [0, 1]; multiply by original screenshot width and height.",
        },
        "electronRuntimeHint": {
            "package": "onnxruntime-node",
            "inputTensorShape": "new ort.Tensor('float32', chwData, [1, 3, height, width])",
        },
    }
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    if not args.onnx:
        return

    args.onnx.parent.mkdir(parents=True, exist_ok=True)
    export_model = IconLocatorCNN()
    export_model.load_state_dict({key: value.detach().cpu() for key, value in model.state_dict().items()})
    export_model.eval()
    dummy_input = torch.zeros(1, 3, config.resize_height, config.resize_width, dtype=torch.float32)
    try:
        torch.onnx.export(
            export_model,
            dummy_input,
            args.onnx,
            input_names=["screenshot"],
            output_names=["normalized_xy"],
            dynamic_axes={"screenshot": {0: "batch"}, "normalized_xy": {0: "batch"}},
            opset_version=17,
        )
    except Exception as error:
        raise RuntimeError(
            "ONNX export failed. Install ONNX export support in the training environment "
            "(usually `pip install onnx`) or pass `--no-onnx` to save only the PyTorch checkpoint."
        ) from error


def save_checkpoint(path: Path, model: nn.Module, config: TrainConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model_state": model.state_dict(), "config": asdict(config)}, path)


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train a small CNN to locate an icon in screenshots.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train")
    train_parser.add_argument("--manifest", type=Path, required=True, help="CSV or JSONL labels file.")
    train_parser.add_argument("--output", type=Path, default=Path("models/icon_locator.pt"))
    train_parser.add_argument("--onnx", type=Path, default=Path("models/icon_locator.onnx"))
    train_parser.add_argument("--no-onnx", action="store_const", const=None, dest="onnx")
    train_parser.add_argument("--metadata", type=Path, default=Path("models/icon_locator.metadata.json"))
    train_parser.add_argument("--resize-width", type=int, default=512)
    train_parser.add_argument("--resize-height", type=int, default=320)
    train_parser.add_argument("--batch-size", type=int, default=16)
    train_parser.add_argument("--epochs", type=int, default=20)
    train_parser.add_argument("--lr", type=float, default=3e-4)
    train_parser.add_argument("--weight-decay", type=float, default=1e-4)
    train_parser.add_argument("--val-split", type=float, default=0.15)
    train_parser.add_argument("--num-workers", type=int, default=0)
    train_parser.add_argument("--seed", type=int, default=7)
    train_parser.add_argument("--device", default="auto", help="auto, cpu, cuda, mps, etc.")
    train_parser.set_defaults(func=train)

    predict_parser = subparsers.add_parser("predict")
    predict_parser.add_argument("--checkpoint", type=Path, required=True)
    predict_parser.add_argument("--image", type=Path, required=True)
    predict_parser.add_argument("--device", default="auto", help="auto, cpu, cuda, mps, etc.")
    predict_parser.set_defaults(func=predict)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
