"""
How much of the drawing survives in a render, in numbers, so AI Strength can be tuned
on measurements instead of eyeballing.

- adherence: share of the sketch's ink that has an edge of the render within ~5 px.
  1 = every drawn line is still there, 0 = the render ignored the drawing.
- novelty: share of the render's edges that lie more than 12 px from any drawn line:
  structure the model added (windows, texture, scenery).
- change: mean absolute pixel difference with another render (frame to frame drift).
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

SIDE = 352


def _gray(image: bytes | str | Path | Image.Image) -> np.ndarray:
    img = image if isinstance(image, Image.Image) else Image.open(io.BytesIO(image) if isinstance(image, bytes) else image)
    return np.asarray(img.convert("L").resize((SIDE, SIDE), Image.BILINEAR), dtype=np.float32) / 255.0


def ink_mask(sketch) -> np.ndarray:
    return _gray(sketch) < 0.5


def edge_mask(render, threshold: float = 0.18) -> np.ndarray:
    g = ndimage.gaussian_filter(_gray(render), 1.0)
    sx = ndimage.sobel(g, axis=1)
    sy = ndimage.sobel(g, axis=0)
    mag = np.hypot(sx, sy)
    mag /= max(mag.max(), 1e-6)
    return mag > threshold


def adherence(sketch, render, reach_px: int = 5) -> float:
    ink = ink_mask(sketch)
    if not ink.any():
        return 0.0
    edges = edge_mask(render)
    near = ndimage.binary_dilation(edges, iterations=reach_px)
    return float((ink & near).sum() / ink.sum())


def novelty(sketch, render, far_px: int = 12) -> float:
    ink = ink_mask(sketch)
    edges = edge_mask(render)
    if not edges.any():
        return 0.0
    dist = ndimage.distance_transform_edt(~ink)
    return float((edges & (dist > far_px)).sum() / edges.sum())


def change(a, b) -> float:
    return float(np.abs(_gray(a) - _gray(b)).mean())


def measure(sketch, render) -> dict:
    return {"adherence": round(adherence(sketch, render), 3), "novelty": round(novelty(sketch, render), 3)}


# ── contact sheets for review ──────────────────────────────────────────────────

_FONT = None


def font(size: int = 14):
    global _FONT
    if _FONT is None:
        for candidate in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"):
            try:
                _FONT = ImageFont.truetype(candidate, size)
                break
            except OSError:
                continue
        else:
            _FONT = ImageFont.load_default()
    return _FONT


def sheet(rows: list[list[tuple[str, bytes | str | Path | None]]], tile: int = 224, out: Path | None = None) -> Image.Image:
    """rows: [[(caption, image), …], …]. Missing images come out as a grey tile."""
    cols = max(len(r) for r in rows)
    cap = 34
    img = Image.new("RGB", (cols * tile, len(rows) * (tile + cap)), "white")
    draw = ImageDraw.Draw(img)
    for y, row in enumerate(rows):
        for x, (caption, image) in enumerate(row):
            px, py = x * tile, y * (tile + cap)
            if image is not None:
                try:
                    t = Image.open(io.BytesIO(image) if isinstance(image, bytes) else image).convert("RGB").resize((tile, tile))
                    img.paste(t, (px, py))
                except Exception:
                    draw.rectangle([px, py, px + tile, py + tile], fill=(230, 230, 230))
            else:
                draw.rectangle([px, py, px + tile, py + tile], fill=(230, 230, 230))
            draw.text((px + 4, py + tile + 3), caption[:40], fill=(20, 20, 20), font=font(13))
    if out:
        img.save(out, quality=82)
    return img
