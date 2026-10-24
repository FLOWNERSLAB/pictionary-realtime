"""
C29 · The whole current catalogue on klein realtime, the way the show will run it:
every style × cat, house, rocket × (55 with the guess, 55 without, 70 with the guess).
The guess comes from the lab's /api/guess (Claude Haiku), once per sketch.

    python scripts/lab/exp_catalogue.py <sketch dir> <out dir> [--lab http://localhost:5179] [--styles a,b]

Writes <out dir>/<style>-<sketch>-<strength>-<on|off>.jpg and <out dir>/catalogue.json.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from exp_round24 import guess, subject_from_guess  # noqa: E402
from falrt import Client, stats, to_data_url  # noqa: E402
from promptkit import STYLES, STYLES_FILE, build_prompt  # noqa: E402

SK = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SEED = 35
STEPS = 3
SKETCHES = ("cat", "house", "rocket")
CATALOGUE = json.loads(STYLES_FILE.read_text(encoding="utf-8"))
STYLE_IDS = sys.argv[sys.argv.index("--styles") + 1].split(",") if "--styles" in sys.argv else [s["id"] for s in CATALOGUE["styles"]]
WORDS = json.loads((SK / "sketches.json").read_text(encoding="utf-8"))


def main() -> None:
    client = Client(log=lambda line: print(line, flush=True))
    t_start = time.time()
    images = {name: to_data_url(SK / f"{name}.png") for name in SKETCHES}
    guesses = {name: guess(SK / f"{name}.png") for name in SKETCHES}
    subjects = {name: subject_from_guess(g) for name, g in guesses.items()}
    for name in SKETCHES:
        print(f"   {name}: «{guesses[name].get('word')}» {guesses[name].get('confidence')} % → {subjects[name]}", flush=True)

    client.frame(build_prompt("photo", "house", 0.5), images["house"], steps=STEPS, seed=SEED)  # warm

    def frame(tag: str, style_id: str, subject: str | None, strength: float, sketch: str) -> dict:
        text = build_prompt(style_id, subject, strength)
        r = client.frame(text, images[sketch], steps=STEPS, seed=SEED)
        row = {"tag": tag, "ms": round(r["ms"]), "cold": r["cold"], "error": r["error"], "prompt": text, "file": None}
        if r["jpeg"]:
            (OUT / f"{tag}.jpg").write_bytes(r["jpeg"])
            row["file"] = f"{tag}.jpg"
        print(f"{tag:36} {row['ms']:5} ms  {r['error'] or ''}", flush=True)
        return row

    styles = []
    for style_id in STYLE_IDS:
        st = STYLES[style_id]
        rows = []
        for sketch in SKETCHES:
            cells = [
                {"label": "55 · Anticipate", **frame(f"{style_id}-{sketch}-55-on", style_id, subjects[sketch], 0.55, sketch)},
                {"label": "55 · no Anticipate", **frame(f"{style_id}-{sketch}-55-off", style_id, None, 0.55, sketch)},
                {"label": "70 · Anticipate", **frame(f"{style_id}-{sketch}-70-on", style_id, subjects[sketch], 0.7, sketch)},
            ]
            rows.append({"sketch": sketch, "cells": cells})
        warm = [c["ms"] for r in rows for c in r["cells"] if not c["cold"] and c["file"]]
        styles.append({"id": style_id, "group": st["group"], "label": st["label"], "look": st["look"], "light": st["light"], "palette": st["palette"], "backdrop": st["backdrop"], "p50": stats(warm).get("p50"), "rows": rows})
        (OUT / "catalogue.json").write_text(json.dumps({"groups": CATALOGUE["groups"], "styles": styles, "guesses": guesses, "subjects": subjects, "words": {k: v["word"] for k, v in WORDS.items()}}, ensure_ascii=False, indent=1), encoding="utf-8")

    client.close()
    warm = [c["ms"] for s in styles for r in s["rows"] for c in r["cells"] if not c["cold"] and c["file"]]
    print("\nwarm latency:", {k: round(v) for k, v in stats(warm).items()}, f"· {len(warm)} frames in {round(time.time() - t_start)} s · sockets {client.sockets_opened}")


if __name__ == "__main__":
    main()
