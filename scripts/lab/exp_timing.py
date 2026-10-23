"""
E3 · Time. What the loop feels like on klein realtime, recorded frame by frame:

  steady   30 frames, same sketch, at 2 and 3 steps (and square_hd): p50/p90 per frame
  switch   a different style every frame: does a prompt change cost anything?
  cold     fresh sockets: first-frame time distribution
  drawing  a sketch appearing stroke by stroke (10 stages) on a "drawing clock": a new
           stage becomes available every STAGE_MS, the loop sends the newest stage as
           soon as the previous frame lands (one in flight, like the app). Each frame
           records the stage it showed and how stale it already was: the real-time
           recording for the report.

    python scripts/lab/exp_timing.py <lab dir> [--stage-ms 700]
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
OUT = LAB / "e3-timing"
OUT.mkdir(parents=True, exist_ok=True)
STAGE_MS = int(sys.argv[sys.argv.index("--stage-ms") + 1]) if "--stage-ms" in sys.argv else 700
WORDS = json.loads((SK / "sketches.json").read_text(encoding="utf-8"))
SEED = 35
STAGES = 10


def main() -> None:
    log = lambda line: print(line, flush=True)  # noqa: E731
    client = Client(log=log, rotate_every=20)
    report: dict = {"stage_ms": STAGE_MS}
    house = to_data_url(SK / "house.png")
    photo = build_prompt("photo", "house", 0.55)

    # ── cold: first frame on fresh sockets
    cold = []
    for k in range(3):
        client.close()
        client.ws = None
        r = client.frame(photo, house, steps=3, seed=SEED)
        cold.append({"ms": round(r["ms"]), "open_ms": round(client.last_open_ms), "error": r["error"]})
        log(f"cold #{k + 1}: {round(r['ms'])} ms (handshake {round(client.last_open_ms)} ms)")
    report["cold"] = cold

    # ── steady: 30 frames at 2 and 3 steps, 12 at square_hd
    steady = {}
    for label, steps, hd in (("3 pasos", 3, False), ("2 pasos", 2, False), ("1 paso", 1, False), ("3 pasos · 1024 px", 3, True)):
        samples = []
        for _ in range(30 if not hd else 12):
            r = client.frame(photo, house, steps=steps, seed=SEED, hd=hd)
            if r["jpeg"] and not r["cold"]:
                samples.append(r["ms"])
        steady[label] = {k: round(v) for k, v in stats(samples).items()}
        log(f"steady {label}: {steady[label]}")
    report["steady"] = steady

    # ── switch: a new style on every frame
    switch = []
    style_ids = list(STYLES)
    for k in range(24):
        style_id = style_ids[k % len(style_ids)]
        r = client.frame(build_prompt(style_id, "house", 0.55), house, steps=3, seed=SEED)
        if r["jpeg"]:
            (OUT / f"switch-{k:02d}-{style_id}.jpg").write_bytes(r["jpeg"])
        switch.append({"k": k, "style": style_id, "ms": round(r["ms"]), "cold": r["cold"], "file": f"switch-{k:02d}-{style_id}.jpg" if r["jpeg"] else None})
    report["switch"] = {"frames": switch, "stats": {k: round(v) for k, v in stats([s["ms"] for s in switch if not s["cold"]]).items()}}
    log(f"switch: {report['switch']['stats']}")

    # ── drawing: stages on a clock, newest stage wins, one frame in flight
    drawing = {}
    for sketch in ("cat", "rocket", "bicycle"):
        for style_id, strength in (("photo", 0.55), ("clay", 0.55)):
            word = WORDS[sketch]["word"]
            text = build_prompt(style_id, word, strength)
            stages = [to_data_url(SK / f"{sketch}-s{k:02d}.png") for k in range(1, STAGES + 1)]
            client.frame(text, stages[0], steps=3, seed=SEED)  # warm with the first stroke
            frames = []
            t0 = time.perf_counter()
            last_stage = 0
            while True:
                now = (time.perf_counter() - t0) * 1000
                available = min(STAGES, int(now // STAGE_MS) + 1)
                if available == last_stage:
                    if last_stage == STAGES:
                        break
                    time.sleep(0.01)
                    continue
                stage = available
                stage_at = (stage - 1) * STAGE_MS
                sent_at = (time.perf_counter() - t0) * 1000
                r = client.frame(text, stages[stage - 1], steps=3, seed=SEED)
                shown_at = (time.perf_counter() - t0) * 1000
                name = f"draw-{sketch}-{style_id}-{len(frames):02d}-s{stage:02d}.jpg"
                if r["jpeg"]:
                    (OUT / name).write_bytes(r["jpeg"])
                frames.append({"stage": stage, "stage_at": round(stage_at), "sent_at": round(sent_at), "shown_at": round(shown_at), "ms": round(r["ms"]), "lag_ms": round(shown_at - stage_at), "file": name if r["jpeg"] else None, "cold": r["cold"]})
                last_stage = stage
            key = f"{sketch}-{style_id}"
            drawing[key] = {"sketch": sketch, "style": style_id, "word": word, "strength": strength, "prompt": text, "frames": frames, "stats": {k: round(v) for k, v in stats([f["ms"] for f in frames]).items()}, "lag": {k: round(v) for k, v in stats([f["lag_ms"] for f in frames]).items()}}
            log(f"drawing {key}: {len(frames)} frames for {STAGES} stages · frame {drawing[key]['stats']} · lag {drawing[key]['lag']}")
            rows = [[(f"stage {f['stage']} @{f['stage_at']}ms", SK / f"{sketch}-s{f['stage']:02d}.png") for f in frames], [(f"shown @{f['shown_at']}ms ({f['ms']}ms)", (OUT / f["file"]) if f["file"] else None) for f in frames]]
            sheet(rows, tile=160, out=OUT / f"sheet-draw-{key}.jpg")
    report["drawing"] = drawing

    client.close()
    (OUT / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    log("done")


if __name__ == "__main__":
    main()
