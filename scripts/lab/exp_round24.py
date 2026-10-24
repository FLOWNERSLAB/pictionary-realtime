"""
R24 · The 24 oct 2026 round for the lab report: anticipation on and off while a sketch
grows, the AI Strength ladder with the guess in the prompt, and three of the new styles.

    python scripts/lab/exp_round24.py <sketch dir> <out dir> [--lab http://localhost:5179]

Needs the lab dev server (its /api/guess route asks Claude Haiku) and FAL_KEY. Writes
<out dir>/<tag>.jpg and <out dir>/r24.json for the report page.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from falrt import Client, to_data_url  # noqa: E402
from promptkit import STYLES, build_prompt  # noqa: E402

SK = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
LAB = sys.argv[sys.argv.index("--lab") + 1] if "--lab" in sys.argv else "http://localhost:5179"
SEED = 35
STEPS = 3
CONFIDENT = 55  # mirrors GUESS_CONFIDENT in src/lib/guess.ts

# Ladder rungs as the app's slider: (strength, label, blurred sketch suffix or None)
RUNGS = [(0.06, "Calco", None), (0.18, "Coloreado", None), (0.31, "Recorte", None), (0.44, "Fiel", None), (0.55, "Acabado", None), (0.69, "Limpio", None), (0.82, "Libre", "blur06"), (0.95, "Prompt", "blur12")]

WORDS = json.loads((SK / "sketches.json").read_text(encoding="utf-8"))


def guess(png: Path) -> dict:
    """The same call the app makes: a 448 px JPEG to /api/guess."""
    im = Image.open(png).convert("RGB").resize((448, 448))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=60)
    url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    req = urllib.request.Request(f"{LAB}/api/guess", data=json.dumps({"image": url}).encode(), headers={"content-type": "application/json"})
    t0 = time.time()
    body = json.loads(urllib.request.urlopen(req, timeout=40).read())
    body["round_trip_ms"] = round((time.time() - t0) * 1000)
    return body


def subject_from_guess(g: dict) -> str | None:
    """Mirrors subjectFromGuess in src/lib/guess.ts."""
    word, kind, conf = g.get("word", ""), g.get("kind", "unknown"), g.get("confidence", 0)
    if word and conf >= CONFIDENT:
        return word if word.split()[0] in ("a", "an", "the") else ("an " if word[0] in "aeiou" else "a ") + word
    if kind not in ("unknown", "object"):
        return f"some kind of {kind}"
    return None


def main() -> None:
    client = Client(log=lambda line: print(line, flush=True))
    data: dict = {"stages": [], "ladder": [], "styles": [], "guesses": []}

    def frame(tag: str, style_id: str, subject: str | None, strength: float, image: Path) -> dict:
        text = build_prompt(style_id, subject, strength)
        r = client.frame(text, to_data_url(image), steps=STEPS, seed=SEED)
        row = {"tag": tag, "style": style_id, "subject": subject, "strength": strength, "ms": round(r["ms"]), "cold": r["cold"], "error": r["error"], "prompt": text, "file": None}
        if r["jpeg"]:
            (OUT / f"{tag}.jpg").write_bytes(r["jpeg"])
            row["file"] = f"{tag}.jpg"
        print(f"{tag:40} {row['ms']:5} ms  {r['error'] or ''}", flush=True)
        return row

    client.frame(build_prompt("photo", "house", 0.5), to_data_url(SK / "house.png"), steps=STEPS, seed=SEED)  # warm

    # A · anticipation on and off while the sketch grows (Claymation, Acabado 55)
    for sketch in ("cat", "rocket"):
        stages = sorted(SK.glob(f"{sketch}-s[0-9][0-9].png"))
        rows = []
        for stage in stages:
            g = guess(stage)
            data["guesses"].append({"sketch": sketch, "stage": stage.stem, **g})
            subject = subject_from_guess(g)
            print(f"   {stage.stem}: «{g.get('word')}» {g.get('kind')} {g.get('confidence')} % · {g.get('ms')} ms → {subject}", flush=True)
            off = frame(f"stage-{stage.stem}-off", "clay", None, 0.55, stage)
            on = frame(f"stage-{stage.stem}-on", "clay", subject, 0.55, stage)
            rows.append({"stage": stage.stem, "stage_src": stage.name, "guess": g, "subject": subject, "off": off, "on": on})
        data["stages"].append({"sketch": sketch, "rows": rows})

    # B · the ladder with the guess in the prompt (what Anticipar does), Claymation and Isométrico
    for style_id in ("clay", "isometric"):
        g = next(x for x in data["guesses"] if x["sketch"] == "cat" and x["stage"].endswith(sorted(SK.glob("cat-s[0-9][0-9].png"))[-1].stem[-3:]))
        subject = subject_from_guess(g)
        cells = []
        for strength, label, blur in RUNGS:
            image = SK / (f"cat-{blur}.png" if blur else "cat.png")
            cells.append({"label": label, **frame(f"ladder-{style_id}-{int(strength * 100)}", style_id, subject, strength, image)})
        data["ladder"].append({"style": style_id, "sketch": "cat", "subject": subject, "cells": cells})

    # C · three of the new styles: cat, rocket, house · 55 with the guess, 55 without, 70 with the guess
    for style_id in ("isometric", "product", "clay"):
        rows = []
        for sketch in ("cat", "rocket", "house"):
            g = guess(SK / f"{sketch}.png")
            data["guesses"].append({"sketch": sketch, "stage": sketch, **g})
            subject = subject_from_guess(g)
            cells = [
                {"label": "55 · anticipar", **frame(f"style-{style_id}-{sketch}-55-on", style_id, subject, 0.55, SK / f"{sketch}.png")},
                {"label": "55 · sin anticipar", **frame(f"style-{style_id}-{sketch}-55-off", style_id, None, 0.55, SK / f"{sketch}.png")},
                {"label": "70 · anticipar", **frame(f"style-{style_id}-{sketch}-70-on", style_id, subject, 0.7, SK / f"{sketch}.png")},
            ]
            rows.append({"sketch": sketch, "guess": g, "subject": subject, "cells": cells})
        st = STYLES[style_id]
        data["styles"].append({"id": style_id, "label": st["label"], "look": st["look"], "light": st["light"], "palette": st["palette"], "backdrop": st["backdrop"], "rows": rows})

    client.close()
    data["words"] = {k: v["word"] for k, v in WORDS.items()}
    (OUT / "r24.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    frames = [r for part in (data["stages"], data["ladder"], data["styles"]) for r in part]
    print(f"listo · {len(list(OUT.glob('*.jpg')))} frames · sockets {client.sockets_opened} · {len(frames)} bloques")


if __name__ == "__main__":
    main()
