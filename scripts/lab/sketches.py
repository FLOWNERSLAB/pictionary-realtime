"""
Guest-grade doodles for the klein realtime experiments, drawn with PIL so Node, Python
and the browser all see the same strokes. Coordinates are canvas fractions (0-1), one
list of points per stroke, in the order a person would draw them.

    python scripts/lab/sketches.py <out dir> [--size 704] [--stages 10]

Writes <name>.png (full sketch), <name>-sNN.png (progressive stages, as if someone were
drawing), <name>-blurNN.png (soft references) and sketches.json (the strokes).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

Point = tuple[float, float]


def seg(a: Point, b: Point, n: int = 24) -> list[Point]:
    return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]


def poly(*pts: Point) -> list[Point]:
    out: list[Point] = []
    for i in range(len(pts) - 1):
        out += seg(pts[i], pts[i + 1])[1 if i else 0 :]
    return out


def arc(cx: float, cy: float, rx: float, ry: float, a0: float, a1: float, n: int = 48) -> list[Point]:
    return [(cx + math.cos(a0 + (a1 - a0) * i / n) * rx, cy + math.sin(a0 + (a1 - a0) * i / n) * ry) for i in range(n + 1)]


def circle(cx: float, cy: float, r: float) -> list[Point]:
    return arc(cx, cy, r, r, -math.pi / 2, math.pi * 1.5)


TAU = math.pi * 2

SKETCHES: dict[str, dict] = {
    "house": {
        "word": "house",
        "strokes": [
            poly((0.22, 0.47), (0.78, 0.47), (0.78, 0.84), (0.22, 0.84), (0.22, 0.47)),
            poly((0.18, 0.49), (0.5, 0.24), (0.82, 0.49)),
            poly((0.44, 0.84), (0.44, 0.66), (0.56, 0.66), (0.56, 0.84)),
            poly((0.28, 0.55), (0.38, 0.55), (0.38, 0.64), (0.28, 0.64), (0.28, 0.55)),
            circle(0.82, 0.16, 0.07),
        ],
    },
    "cat": {
        "word": "cat",
        "strokes": [
            circle(0.5, 0.36, 0.16),
            poly((0.38, 0.25), (0.36, 0.1), (0.47, 0.21)),
            poly((0.62, 0.25), (0.64, 0.1), (0.53, 0.21)),
            arc(0.5, 0.66, 0.2, 0.22, math.pi, TAU),
            poly((0.3, 0.66), (0.3, 0.86), (0.7, 0.86), (0.7, 0.66)),
            arc(0.76, 0.78, 0.12, 0.2, math.pi / 2, -math.pi / 2),
            circle(0.44, 0.34, 0.02),
            circle(0.56, 0.34, 0.02),
            poly((0.48, 0.41), (0.52, 0.41), (0.5, 0.44), (0.48, 0.41)),
            poly((0.32, 0.4), (0.44, 0.42)),
            poly((0.32, 0.46), (0.44, 0.44)),
            poly((0.68, 0.4), (0.56, 0.42)),
            poly((0.68, 0.46), (0.56, 0.44)),
        ],
    },
    "rocket": {
        "word": "rocket",
        "strokes": [
            poly((0.4, 0.35), (0.4, 0.7), (0.6, 0.7), (0.6, 0.35)),
            arc(0.5, 0.35, 0.1, 0.22, math.pi, TAU),
            poly((0.4, 0.55), (0.28, 0.78), (0.4, 0.7)),
            poly((0.6, 0.55), (0.72, 0.78), (0.6, 0.7)),
            circle(0.5, 0.42, 0.05),
            poly((0.43, 0.7), (0.46, 0.84), (0.5, 0.74), (0.54, 0.86), (0.57, 0.7)),
        ],
    },
    "bicycle": {
        "word": "bicycle",
        "strokes": [
            circle(0.27, 0.66, 0.15),
            circle(0.73, 0.66, 0.15),
            poly((0.27, 0.66), (0.44, 0.4), (0.62, 0.4), (0.73, 0.66)),
            poly((0.44, 0.4), (0.5, 0.66), (0.27, 0.66)),
            poly((0.5, 0.66), (0.62, 0.4)),
            poly((0.62, 0.4), (0.66, 0.3), (0.72, 0.3)),
            poly((0.44, 0.4), (0.42, 0.32), (0.36, 0.32)),
        ],
    },
    "pizza": {
        "word": "pizza slice",
        "strokes": [
            poly((0.5, 0.86), (0.22, 0.3), (0.78, 0.3), (0.5, 0.86)),
            arc(0.5, 0.42, 0.3, 0.14, math.pi + 0.3, TAU - 0.3),
            circle(0.44, 0.44, 0.04),
            circle(0.57, 0.5, 0.04),
            circle(0.48, 0.6, 0.035),
        ],
    },
    "fish": {
        "word": "fish",
        "strokes": [
            arc(0.46, 0.5, 0.26, 0.15, 0, TAU),
            poly((0.7, 0.5), (0.84, 0.34), (0.84, 0.66), (0.7, 0.5)),
            circle(0.3, 0.46, 0.025),
            poly((0.44, 0.36), (0.5, 0.26), (0.58, 0.38)),
            poly((0.22, 0.52), (0.26, 0.56)),
        ],
    },
}


def _resample(points: list[Point], n: int) -> list[Point]:
    if len(points) <= n:
        return points
    return [points[int(i * (len(points) - 1) / (n - 1))] for i in range(n)]


def render(strokes: list[list[Point]], size: int, width: int = 9, until: float | None = None) -> Image.Image:
    """`until` ∈ (0, 1]: the share of all points drawn so far, as a person draws stroke by stroke."""
    img = Image.new("L", (size, size), 255)
    draw = ImageDraw.Draw(img)
    total = sum(len(s) for s in strokes)
    budget = total if until is None else max(1, int(total * until))
    for stroke in strokes:
        take = min(len(stroke), budget)
        budget -= take
        if take < 2:
            if take == 1:
                x, y = stroke[0]
                draw.ellipse([x * size - width / 2, y * size - width / 2, x * size + width / 2, y * size + width / 2], fill=0)
            break
        pts = [(x * size, y * size) for x, y in stroke[:take]]
        draw.line(pts, fill=0, width=width, joint="curve")
        for x, y in (pts[0], pts[-1]):
            draw.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=0)
        if budget <= 0:
            break
    return img


def main() -> None:
    out = Path(sys.argv[1])
    size = int(sys.argv[sys.argv.index("--size") + 1]) if "--size" in sys.argv else 704
    stages = int(sys.argv[sys.argv.index("--stages") + 1]) if "--stages" in sys.argv else 10
    out.mkdir(parents=True, exist_ok=True)

    for name, sketch in SKETCHES.items():
        strokes = sketch["strokes"]
        full = render(strokes, size)
        full.save(out / f"{name}.png")
        for k in range(1, stages + 1):
            render(strokes, size, until=k / stages).save(out / f"{name}-s{k:02d}.png")
        for blur in (6, 12, 20):
            full.filter(ImageFilter.GaussianBlur(blur)).save(out / f"{name}-blur{blur:02d}.png")
        # A soft, low-detail reference: the sketch seen at 128 px and blown back up.
        full.resize((128, 128), Image.BILINEAR).resize((size, size), Image.BILINEAR).save(out / f"{name}-low.png")

    (out / "sketches.json").write_text(
        json.dumps({name: {"word": s["word"], "strokes": [_resample(st, 40) for st in s["strokes"]]} for name, s in SKETCHES.items()}),
        encoding="utf-8",
    )
    print(f"{len(SKETCHES)} sketches → {out}")


if __name__ == "__main__":
    main()
