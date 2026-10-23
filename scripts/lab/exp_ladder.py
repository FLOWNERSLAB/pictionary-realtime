"""
E1b · A second wording ladder with a real low end. E1 showed that with a photographic
style the model reinterprets fully even when told to "follow the lines exactly": the
low end of AI Strength must ask for a *drawing* that keeps the lines, and the style
must step back to colour and light there. Seven rungs × two style clauses (full look,
or softened to palette and light) × five sketches × two styles.

    python scripts/lab/exp_ladder.py <lab dir>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from falrt import Client, to_data_url  # noqa: E402
from metrics import change, measure, sheet  # noqa: E402
from promptkit import STYLES, subject_phrase  # noqa: E402

LAB = Path(sys.argv[1])
SK = LAB / "sketches"
OUT = LAB / "e1b-ladder"
OUT.mkdir(parents=True, exist_ok=True)
WORDS = json.loads((SK / "sketches.json").read_text(encoding="utf-8"))
SEED = 35

RUNGS = [
    "This is a line drawing of {S}. Keep it a line drawing: the exact same lines, outline, proportions and position on the same white sheet, nothing added.",
    "Render this drawing of {S} exactly as drawn: every line where it is, same proportions and position, flat and simple, with only light shading and colour.",
    "Turn this sketch into {S}. Keep every drawn line exactly where it is: same outline, proportions and position, and add nothing that is not drawn.",
    "Turn this sketch into {S}. Keep the drawn outline, proportions and position; add only the detail it needs to look finished.",
    "Turn this sketch into {S}. Use the drawing as the layout and clean up the shape so it clearly reads as {S}.",
    "Create {S}, using this sketch only as a rough guide for placement and pose. Redesign the shape freely, with full detail.",
    "Create {S}. Ignore the exact lines of the sketch; only keep it roughly in the same place in the frame.",
]


def style_clause(style: dict, soft: bool) -> str:
    if soft:
        return f"Hint at the look only through colour and light: {style['palette']}, {style['light']}."
    return f"{style['look']}. {style['light'][0].upper()}{style['light'][1:]}, {style['palette']}. {style['backdrop'][0].upper()}{style['backdrop'][1:]} behind it, nothing else in the frame."


def main() -> None:
    client = Client(log=lambda line: print(line, flush=True))
    results = []
    t0 = time.time()
    sketches = ["house", "cat", "rocket", "pizza", "bicycle"]
    images = {s: to_data_url(SK / f"{s}.png") for s in sketches}
    client.frame("Turn this sketch into a house.", images["house"], steps=3, seed=SEED)

    for style_id in ("photo", "watercolor"):
        style = STYLES[style_id]
        for sketch in sketches:
            word = WORDS[sketch]["word"]
            for rung, text in enumerate(RUNGS):
                for soft in ((True, False) if rung < 3 else (False,)):
                    prompt = f"{text.format(S=subject_phrase(word))} {style_clause(style, soft)}"
                    r = client.frame(prompt, images[sketch], steps=3, seed=SEED)
                    tag = f"{style_id}-{sketch}-r{rung}{'-soft' if soft else ''}"
                    row = {"style": style_id, "sketch": sketch, "rung": rung, "soft": soft, "ms": round(r["ms"]), "file": None, "prompt": prompt, "error": r["error"]}
                    if r["jpeg"]:
                        (OUT / f"{tag}.jpg").write_bytes(r["jpeg"])
                        row["file"] = f"{tag}.jpg"
                        row.update(measure(SK / f"{sketch}.png", r["jpeg"]))
                        row["distance"] = round(change(SK / f"{sketch}.png", r["jpeg"]), 3)
                    results.append(row)
                    print(f"{tag:28} {row['ms']:5} ms  adh {row.get('adherence', '-')}  nov {row.get('novelty', '-')}  dist {row.get('distance', '-')} {r['error'] or ''}", flush=True)
            (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")

    client.close()
    print(f"{len(results)} frames en {round(time.time() - t0)} s")
    for style_id in ("photo", "watercolor"):
        rows = []
        for sketch in sketches:
            row = [(sketch, SK / f"{sketch}.png")]
            for r in results:
                if r["style"] == style_id and r["sketch"] == sketch:
                    row.append((f"r{r['rung']}{' soft' if r['soft'] else ''} a{r.get('adherence', '-')} d{r.get('distance', '-')}", (OUT / r["file"]) if r["file"] else None))
            rows.append(row)
        sheet(rows, tile=170, out=OUT / f"sheet-{style_id}.jpg")


if __name__ == "__main__":
    main()
