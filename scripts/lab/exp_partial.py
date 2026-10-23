"""
E5 · Does klein complete the object from the hint, or only dress what is drawn?

Krea's Flux Realtime is img2img: the output is anchored to the canvas pixels, the
prompt only textures the shapes that exist, and an empty canvas gives nothing. With
klein the hint "house" makes a whole house out of one line. This runs partial sketches
(stage k of 10) through four wordings of the hint and measures how much structure
appears away from the drawn lines (novelty: lower = more Krea-like).

    python scripts/lab/exp_partial.py <lab dir>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from falrt import Client, to_data_url  # noqa: E402
from metrics import measure, sheet  # noqa: E402
from promptkit import STYLES  # noqa: E402

LAB = Path(sys.argv[1])
SK = LAB / "sketches"
OUT = LAB / "e5-partial"
OUT.mkdir(parents=True, exist_ok=True)
SEED = 35

STYLE_CLAUSE = lambda s: f"{s['look']}. {s['light'][0].upper()}{s['light'][1:]}, {s['palette']}. {s['backdrop'][0].upper()}{s['backdrop'][1:]} behind it, nothing else in the frame."  # noqa: E731

VARIANTS = {
    "acabado": "Turn this sketch into {S}. Keep the drawn outline, proportions and position; add only the detail it needs to look finished.",
    "solo-lo-dibujado": "Render only what is drawn on this sheet, nothing more. The drawn shapes are parts of {S}: give them the surfaces and materials of {S}, but do not draw any part of {S} that is not on the paper yet. Empty paper stays empty.",
    "textura": "Treat the ink as the only subject: keep exactly the drawn shapes, where they are, and texture them as if they were made of the materials of {S}. Add no other shapes.",
    "sin-pista": "Render only what is drawn on this sheet, nothing more, exactly where it is, as a physical object. Empty paper stays empty.",
}

SKETCHES = [("house", "a house"), ("cat", "a cat"), ("pizza", "a pizza slice")]
STAGES = [2, 4, 6, 8, 10]


def main() -> None:
    client = Client(log=lambda line: print(line, flush=True))
    results = []
    t0 = time.time()
    client.frame("Turn this sketch into a house.", to_data_url(SK / "house.png"), steps=3, seed=SEED)

    for style_id in ("photo", "clay"):
        style = STYLES[style_id]
        for sketch, subject in SKETCHES:
            for stage in STAGES:
                image = to_data_url(SK / f"{sketch}-s{stage:02d}.png")
                for variant, text in VARIANTS.items():
                    prompt = f"{text.format(S=subject)} {STYLE_CLAUSE(style)}"
                    r = client.frame(prompt, image, steps=3, seed=SEED)
                    tag = f"{style_id}-{sketch}-s{stage:02d}-{variant}"
                    row = {"style": style_id, "sketch": sketch, "stage": stage, "variant": variant, "ms": round(r["ms"]), "file": None, "prompt": prompt, "error": r["error"]}
                    if r["jpeg"]:
                        (OUT / f"{tag}.jpg").write_bytes(r["jpeg"])
                        row["file"] = f"{tag}.jpg"
                        row.update(measure(SK / f"{sketch}-s{stage:02d}.png", r["jpeg"]))
                    results.append(row)
                    print(f"{tag:40} {row['ms']:5} ms  adh {row.get('adherence', '-')}  nov {row.get('novelty', '-')} {r['error'] or ''}", flush=True)
            (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")

    client.close()
    print(f"{len(results)} frames en {round(time.time() - t0)} s")

    for style_id in ("photo", "clay"):
        for sketch, _ in SKETCHES:
            rows = []
            for variant in VARIANTS:
                row = [(variant, SK / f"{sketch}.png")]
                for stage in STAGES:
                    r = next((x for x in results if x["style"] == style_id and x["sketch"] == sketch and x["stage"] == stage and x["variant"] == variant), None)
                    row.append((f"s{stage} nov {r.get('novelty', '-') if r else '-'}", (OUT / r["file"]) if r and r["file"] else None))
                rows.append(row)
            stage_row = [("boceto", None)] + [(f"stage {s}", SK / f"{sketch}-s{s:02d}.png") for s in STAGES]
            sheet([stage_row] + rows, tile=170, out=OUT / f"sheet-{style_id}-{sketch}.jpg")


if __name__ == "__main__":
    main()
