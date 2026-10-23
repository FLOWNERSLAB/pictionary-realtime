"""
E2 · The style catalogue on klein realtime: every style × a few sketches × AI Strength,
with and without the hint word. Each render is measured (latency, adherence, novelty)
and saved for the report.

    python scripts/lab/exp_styles.py <lab dir> [--sketches house,cat,rocket,pizza] [--strengths 0.25,0.55,0.85] [--styles a,b]
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from falrt import Client, stats, to_data_url  # noqa: E402
from metrics import measure, sheet  # noqa: E402
from promptkit import STYLES, build_prompt  # noqa: E402

LAB = Path(sys.argv[1])
SK = LAB / "sketches"
OUT = LAB / "e2-styles"
OUT.mkdir(parents=True, exist_ok=True)


def arg(name: str, default: str) -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


SKETCHES = arg("--sketches", "house,cat,rocket,pizza").split(",")
STRENGTHS = [float(v) for v in arg("--strengths", "0.25,0.55,0.85").split(",")]
STYLE_IDS = arg("--styles", ",".join(STYLES)).split(",")
WORDS = json.loads((SK / "sketches.json").read_text(encoding="utf-8"))
SEED = 35
STEPS = 3


def main() -> None:
    client = Client(log=lambda line: print(line, flush=True))
    results: list[dict] = []
    t_start = time.time()
    images = {name: to_data_url(SK / f"{name}.png") for name in SKETCHES}

    client.frame(build_prompt("photo", "house", 0.5), images[SKETCHES[0]], steps=STEPS, seed=SEED)  # warm

    def run(style_id: str, sketch: str, strength: float, hint: str | None) -> None:
        text = build_prompt(style_id, hint, strength)
        r = client.frame(text, images[sketch], steps=STEPS, seed=SEED)
        tag = f"{style_id}-{sketch}-{int(strength * 100)}{'' if hint else '-noword'}"
        row = {"style": style_id, "sketch": sketch, "strength": strength, "hint": hint, "ms": round(r["ms"]), "cold": r["cold"], "error": r["error"], "file": None, "prompt": text}
        if r["jpeg"]:
            (OUT / f"{tag}.jpg").write_bytes(r["jpeg"])
            row["file"] = f"{tag}.jpg"
            row.update(measure(SK / f"{sketch}.png", r["jpeg"]))
        results.append(row)
        print(f"{tag:34} {row['ms']:5} ms  adh {row.get('adherence', '-')}  nov {row.get('novelty', '-')}  {r['error'] or ''}", flush=True)

    for style_id in STYLE_IDS:
        for sketch in SKETCHES:
            for strength in STRENGTHS:
                run(style_id, sketch, strength, WORDS[sketch]["word"])
            run(style_id, sketch, 0.55, None)
        (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")

    client.close()
    warm = [r["ms"] for r in results if not r["cold"] and r["file"]]
    print("\nlatencia en caliente:", {k: round(v) for k, v in stats(warm).items()}, f"· {len(results)} frames en {round(time.time() - t_start)} s · sockets {client.sockets_opened}")

    for style_id in STYLE_IDS:
        rows = []
        for sketch in SKETCHES:
            row = [(f"{sketch}", SK / f"{sketch}.png")]
            for r in results:
                if r["style"] == style_id and r["sketch"] == sketch:
                    row.append((f"{'s' + str(int(r['strength'] * 100)) if r['hint'] else 'no word'} {r['ms']}ms a{r.get('adherence', '-')}", (OUT / r["file"]) if r["file"] else None))
            rows.append(row)
        sheet(rows, tile=200, out=OUT / f"sheet-{style_id}.jpg")


if __name__ == "__main__":
    main()
