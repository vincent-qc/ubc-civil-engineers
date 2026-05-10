#!/usr/bin/env python3
"""Click-to-label desktop icon coordinates from PNG screenshots.

By default this recursively loads PNGs from ~/SCREENSHOTS and appends labels to
dataset.csv in the current directory.

Examples:
    python3 script.py
    python3 script.py --labels Finder,Chrome,Terminal,Trash
    python3 script.py --screenshots ~/SCREENSHOTS --csv data/icon_labels.csv --labels-file labels.txt
"""

from __future__ import annotations

import argparse
import csv
import math
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import messagebox, ttk


DEFAULT_LABELS = [
    "finder",
    "chrome",
    "arc",
    "terminal",
    "discord",
    "imessage",
    "vscode",
    "notion",
    "spotify",
    "chatgpt",
    "email",
    "close button",
    "minimize button",
    "fullscreen button",
]

CSV_COLUMNS = ["image_path", "label", "x", "y"]


@dataclass(frozen=True)
class Annotation:
    image_path: str
    label: str
    x: int
    y: int


class IconLabeler:
    def __init__(self, args: argparse.Namespace) -> None:
        self.screenshot_dir = args.screenshots.expanduser().resolve()
        self.csv_path = args.csv.expanduser().resolve()
        self.labels = load_labels(args)
        self.images = sorted(self.screenshot_dir.rglob("*.png"))
        self.index = 0
        self.annotations = read_annotations(self.csv_path)
        self.current_photo: tk.PhotoImage | None = None
        self.current_subsample = 1
        self.current_image_path: Path | None = None
        self.current_image_width = 1
        self.current_image_height = 1

        if not self.images:
            raise SystemExit(f"No PNG files found under {self.screenshot_dir}")

        self.root = tk.Tk()
        self.root.title("Screenshot Icon Labeler")
        self.root.geometry("1200x820")
        self.root.minsize(760, 520)

        self.label_var = tk.StringVar(value=self.labels[0])
        self.status_var = tk.StringVar()
        self.coord_var = tk.StringVar()

        self._build_ui()
        self._bind_shortcuts()
        self._load_current_image()

    def run(self) -> None:
        self.root.mainloop()

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        toolbar = ttk.Frame(self.root, padding=(10, 8))
        toolbar.grid(row=0, column=0, sticky="ew")
        toolbar.columnconfigure(8, weight=1)

        ttk.Label(toolbar, text="Label").grid(row=0, column=0, padx=(0, 6))
        label_box = ttk.Combobox(toolbar, textvariable=self.label_var, values=self.labels, state="readonly", width=22)
        label_box.grid(row=0, column=1, padx=(0, 12))

        ttk.Button(toolbar, text="Prev", command=self.previous_image).grid(row=0, column=2, padx=3)
        ttk.Button(toolbar, text="Next", command=self.next_image).grid(row=0, column=3, padx=3)
        ttk.Button(toolbar, text="Undo", command=self.undo_last).grid(row=0, column=4, padx=3)
        ttk.Button(toolbar, text="Open CSV", command=self.show_csv_path).grid(row=0, column=5, padx=3)

        ttk.Label(toolbar, textvariable=self.coord_var).grid(row=0, column=6, padx=(16, 0))
        ttk.Label(toolbar, textvariable=self.status_var, anchor="e").grid(row=0, column=8, sticky="e")

        body = ttk.Frame(self.root)
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)

        self.canvas = tk.Canvas(body, background="#1f2328", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        self.canvas.bind("<Button-1>", self.on_click)
        self.canvas.bind("<Motion>", self.on_motion)

        xscroll = ttk.Scrollbar(body, orient="horizontal", command=self.canvas.xview)
        xscroll.grid(row=1, column=0, sticky="ew")
        yscroll = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        yscroll.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(xscrollcommand=xscroll.set, yscrollcommand=yscroll.set)

    def _bind_shortcuts(self) -> None:
        self.root.bind("n", lambda _event: self.next_image())
        self.root.bind("<Right>", lambda _event: self.next_image())
        self.root.bind("p", lambda _event: self.previous_image())
        self.root.bind("<Left>", lambda _event: self.previous_image())
        self.root.bind("u", lambda _event: self.undo_last())
        self.root.bind("<BackSpace>", lambda _event: self.undo_last())
        for number in range(1, min(10, len(self.labels) + 1)):
            self.root.bind(str(number), lambda _event, i=number - 1: self.label_var.set(self.labels[i]))

    def _load_current_image(self) -> None:
        image_path = self.images[self.index]
        photo = tk.PhotoImage(file=str(image_path))
        self.current_image_path = image_path
        self.current_image_width = photo.width()
        self.current_image_height = photo.height()
        self.current_subsample = self._best_subsample(photo.width(), photo.height())
        if self.current_subsample > 1:
            photo = photo.subsample(self.current_subsample, self.current_subsample)
        self.current_photo = photo

        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self.current_photo, tags=("screenshot",))
        self.canvas.configure(scrollregion=(0, 0, photo.width(), photo.height()))
        self._draw_existing_annotations()
        self._update_status()

    def _best_subsample(self, width: int, height: int) -> int:
        max_width = max(self.root.winfo_width() - 80, 900)
        max_height = max(self.root.winfo_height() - 130, 620)
        scale = max(width / max_width, height / max_height, 1)
        return max(1, math.ceil(scale))

    def _draw_existing_annotations(self) -> None:
        if not self.current_image_path:
            return
        image_key = image_key_for_csv(self.current_image_path)
        for annotation in self.annotations:
            if annotation.image_path == image_key:
                self._draw_marker(annotation.x, annotation.y, annotation.label, fill="#36d399")

    def _draw_marker(self, x: int, y: int, label: str, fill: str) -> None:
        display_x = x / self.current_subsample
        display_y = y / self.current_subsample
        radius = 6
        self.canvas.create_line(display_x - radius, display_y, display_x + radius, display_y, fill=fill, width=2)
        self.canvas.create_line(display_x, display_y - radius, display_x, display_y + radius, fill=fill, width=2)
        self.canvas.create_oval(
            display_x - radius,
            display_y - radius,
            display_x + radius,
            display_y + radius,
            outline=fill,
            width=2,
        )
        self.canvas.create_text(display_x + 10, display_y - 10, text=label, anchor="sw", fill=fill)

    def on_click(self, event: tk.Event) -> None:
        if not self.current_image_path:
            return
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        x = round(canvas_x * self.current_subsample)
        y = round(canvas_y * self.current_subsample)
        if not 0 <= x <= self.current_image_width or not 0 <= y <= self.current_image_height:
            return

        annotation = Annotation(
            image_path=image_key_for_csv(self.current_image_path),
            label=self.label_var.get(),
            x=x,
            y=y,
        )
        append_annotation(self.csv_path, annotation)
        self.annotations.append(annotation)
        self._draw_marker(annotation.x, annotation.y, annotation.label, fill="#ffcc66")
        self._update_status()

    def on_motion(self, event: tk.Event) -> None:
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        x = round(canvas_x * self.current_subsample)
        y = round(canvas_y * self.current_subsample)
        self.coord_var.set(f"x={x} y={y}")

    def next_image(self) -> None:
        self.index = min(self.index + 1, len(self.images) - 1)
        self._load_current_image()

    def previous_image(self) -> None:
        self.index = max(self.index - 1, 0)
        self._load_current_image()

    def undo_last(self) -> None:
        if not self.annotations:
            return
        removed = self.annotations.pop()
        write_annotations(self.csv_path, self.annotations)
        if self.current_image_path and removed.image_path == image_key_for_csv(self.current_image_path):
            self._load_current_image()
        else:
            self._update_status()

    def show_csv_path(self) -> None:
        messagebox.showinfo("Dataset CSV", str(self.csv_path))

    def _update_status(self) -> None:
        image_name = self.current_image_path.name if self.current_image_path else ""
        image_key = image_key_for_csv(self.current_image_path) if self.current_image_path else ""
        image_count = sum(1 for annotation in self.annotations if annotation.image_path == image_key)
        self.status_var.set(
            f"{self.index + 1}/{len(self.images)}  {image_name}  "
            f"{self.current_image_width}x{self.current_image_height}  "
            f"labels on image: {image_count}  total: {len(self.annotations)}"
        )


def image_key_for_csv(path: Path) -> str:
    return str(path.expanduser().resolve())


def load_labels(args: argparse.Namespace) -> list[str]:
    if args.labels_file:
        labels = [
            line.strip()
            for line in args.labels_file.expanduser().read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    elif args.labels:
        labels = [label.strip() for label in args.labels.split(",") if label.strip()]
    else:
        labels = DEFAULT_LABELS
    if not labels:
        raise SystemExit("Provide at least one label.")
    return labels


def read_annotations(csv_path: Path) -> list[Annotation]:
    if not csv_path.exists():
        return []
    with csv_path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [
            Annotation(
                image_path=row["image_path"],
                label=row["label"],
                x=int(round(float(row["x"]))),
                y=int(round(float(row["y"]))),
            )
            for row in reader
            if row.get("image_path") and row.get("label") and row.get("x") and row.get("y")
        ]


def append_annotation(csv_path: Path, annotation: Annotation) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    exists = csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow(
            {
                "image_path": annotation.image_path,
                "label": annotation.label,
                "x": annotation.x,
                "y": annotation.y,
            }
        )


def write_annotations(csv_path: Path, annotations: list[Annotation]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for annotation in annotations:
            writer.writerow(
                {
                    "image_path": annotation.image_path,
                    "label": annotation.label,
                    "x": annotation.x,
                    "y": annotation.y,
                }
            )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Click-label icon locations in desktop screenshots.")
    parser.add_argument("--screenshots", type=Path, default=Path("~/SCREENSHOTS"))
    parser.add_argument("--csv", type=Path, default=Path("dataset.csv"))
    parser.add_argument("--labels", help="Comma-separated label set.")
    parser.add_argument("--labels-file", type=Path, help="One label per line.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    IconLabeler(args).run()


if __name__ == "__main__":
    main()
