"""
E1 · What can play the part of "AI Strength" on klein realtime, which has no strength.

Same sketch, same seed, one photographic style, and every knob we can turn:
  A. wording ladder (fidelity instruction, L0 … L100)
  B. softer reference (gaussian blur, low-res resample) at mid wording
  C. schedule_mu at mid wording
  D. steps at mid wording
  E. composite chain: the model's previous output under the ink, alpha 0,35 / 0,65
  F. output_feedback_strength (latent memory) 0,7 / 0,5 over four frames
  G. mid wording with no subject word

    python scripts/lab/exp_strength.py <lab dir>   (expects <lab dir>/sketches from sketches.py)
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from falrt import Client, stats, to_data_url  # noqa: E402
from metrics import measure, sheet  # noqa: E402

LAB = Path(sys.argv[1])
SK = LAB / "sketches"
OUT = LAB / "e1-strength"
OUT.mkdir(parents=True, exist_ok=True)

STYLE = "Photograph it with a real camera: natural daylight, true-to-life materials and textures, 50mm lens, plain uncluttered background."

LADDER = {
    0: "Turn this sketch into {S}. Keep every drawn line exactly where it is: same outline, proportions and position, and add nothing that is not drawn.",
    25: "Turn this sketch into {S}. Keep the drawn outline, proportions and position; add only the detail it needs to look real.",
    50: "Turn this sketch into {S}. Use the drawing as the layout and clean up the shape so it clearly reads as {S}.",
    75: "Create {S}, using this sketch only as a rough guide for placement and pose. Redesign the shape freely, with full detail.",
    100: "Create {S}. Ignore the exact lines of the sketch; only keep it roughly in the same place in the frame.",
}

SKETCHES = [("house", "a house"), ("cat", "a cat"), ("rocket", "a rocket")]
SEED = 35


def prompt(level: int, subject: str) -> str:
    return f"{LADDER[level].format(S=subject)} {STYLE}"


def composite(previous_jpeg: bytes, sketch_png: Path, alpha: float) -> str:
    """Previous render faded towards white by (1-alpha), with the ink multiplied on top."""
    prev = Image.open(io.BytesIO(previous_jpeg)).convert("RGB").resize((704, 704))
    white = Image.new("RGB", (704, 704), "white")
    base = Image.blend(white, prev, alpha)
    ink = Image.open(sketch_png).convert("L").resize((704, 704))
    base = Image.composite(Image.new("RGB", (704, 704), "black"), base, ink.point(lambda v: 255 if v < 128 else 0))
    buf = io.BytesIO()
    base.save(buf, "JPEG", quality=60)
    return to_data_url(buf.getvalue())


def main() -> None:
    client = Client(log=lambda line: print(line, flush=True))
    results: list[dict] = []
    t_start = time.time()

    def run(tag: str, sketch: str, subject: str, image: str, *, level=50, steps=3, mu=2.3, feedback=1.0, prompt_text=None, ref_png=None) -> dict:
        text = prompt_text or prompt(level, subject)
        r = client.frame(text, image, steps=steps, seed=SEED, feedback=feedback, mu=mu)
        name = f"{sketch}-{tag}.jpg"
        row = {"sketch": sketch, "tag": tag, "level": level, "steps": steps, "mu": mu, "feedback": feedback, "ms": round(r["ms"]), "cold": r["cold"], "error": r["error"], "file": None, "prompt": text}
        if r["jpeg"]:
            (OUT / name).write_bytes(r["jpeg"])
            row["file"] = name
            row.update(measure(ref_png or SK / f"{sketch}.png", r["jpeg"]))
        results.append(row)
        print(f"{sketch:7} {tag:14} {row['ms']:5} ms  adh {row.get('adherence', '-')}  nov {row.get('novelty', '-')}  {r['error'] or ''}", flush=True)
        return row

    for sketch, subject in SKETCHES:
        full = to_data_url(SK / f"{sketch}.png")
        # warm the runner so the first measured frame is not a cold start
        client.frame(prompt(50, subject), full, steps=3, seed=SEED)

        for level in (0, 25, 50, 75, 100):
            run(f"A-L{level}", sketch, subject, full, level=level)
        for variant in ("blur06", "blur12", "blur20", "low"):
            run(f"B-{variant}", sketch, subject, to_data_url(SK / f"{sketch}-{variant}.png"))
        for mu in (0.3, 1.0, 1.7):
            run(f"C-mu{mu}", sketch, subject, full, mu=mu)
        for steps in (1, 2, 4, 6):
            run(f"D-s{steps}", sketch, subject, full, steps=steps)
        for alpha in (0.35, 0.65):
            previous = run(f"E-a{alpha}-0", sketch, subject, full, level=75)
            for k in range(1, 4):
                if not previous.get("file"):
                    break
                image = composite((OUT / previous["file"]).read_bytes(), SK / f"{sketch}.png", alpha)
                previous = run(f"E-a{alpha}-{k}", sketch, subject, image, level=75)
        for fb in (0.7, 0.5):
            for k in range(4):
                run(f"F-fb{fb}-{k}", sketch, subject, full, level=75, feedback=fb)
        run("G-noword", sketch, subject, full, prompt_text=f"{LADDER[50].format(S='what it depicts')} {STYLE}")

    client.close()
    (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")

    warm = [r["ms"] for r in results if not r["cold"] and r["file"]]
    print("\nlatencia en caliente:", {k: round(v) for k, v in stats(warm).items()}, f"· {len(results)} frames en {round(time.time() - t_start)} s · sockets {client.sockets_opened}")

    # contact sheets per sketch: one row per family
    for sketch, _ in SKETCHES:
        rows = []
        for family in ("A", "B", "C", "D", "E-a0.35", "E-a0.65", "F-fb0.7", "F-fb0.5", "G"):
            row = [(f"{sketch} (sketch)", SK / f"{sketch}.png")]
            for r in results:
                if r["sketch"] == sketch and r["tag"].startswith(family):
                    row.append((f"{r['tag']} {r['ms']}ms a{r.get('adherence', '-')} n{r.get('novelty', '-')}", (OUT / r["file"]) if r["file"] else None))
            rows.append(row)
        sheet(rows, tile=200, out=OUT / f"sheet-{sketch}.jpg")


if __name__ == "__main__":
    main()
