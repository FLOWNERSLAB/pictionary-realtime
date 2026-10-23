"""
E4 · Real-time takes for video. One take = a sketch drawn stroke by stroke on a clock
(STAGES stages, one every STAGE_MS), then a hold, then an AI Strength sweep, then a
run through a few styles. The loop works like the app: newest state wins, one frame in
flight, every frame saved with the exact time it was sent and shown.

    python scripts/lab/exp_record.py <lab dir> [--takes cat:photo,rocket:clay]

Writes <lab dir>/e4-record/<take>/events.json + frame-NN.jpg + stage-NN.png.
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from falrt import Client, to_data_url  # noqa: E402
from promptkit import STYLES, build_prompt  # noqa: E402
from sketches import SKETCHES, render  # noqa: E402

LAB = Path(sys.argv[1])
OUT = LAB / "e4-record"
STAGES = 48
STAGE_MS = 150
HOLD_MS = 1500
SEED = 35
STEPS = 3
SWEEP = [0.05, 0.2, 0.3, 0.45, 0.55, 0.7, 0.8, 0.95]
TOUR = ["studio", "cinematic", "night", "neon", "clay", "chrome", "watercolor", "cartoon", "riso"]


def arg(name: str, default: str) -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


TAKES = [t.split(":") for t in arg("--takes", "cat:photo,rocket:clay,bicycle:cinematic,pizza:watercolor,house:night,fish:photo:nohint").split(",")]


def main() -> None:
    log = lambda line: print(line, flush=True)  # noqa: E731
    client = Client(log=log, rotate_every=20)

    for take in TAKES:
        sketch, style = take[0], take[1]
        nohint = len(take) > 2 and take[2] == "nohint"
        word = SKETCHES[sketch]["word"]
        folder = OUT / f"{sketch}-{style}{'-nohint' if nohint else ''}"
        folder.mkdir(parents=True, exist_ok=True)
        strokes = SKETCHES[sketch]["strokes"]

        stages = []
        for k in range(1, STAGES + 1):
            img = render(strokes, 704, until=k / STAGES)
            img.save(folder / f"stage-{k:02d}.png")
            buf = io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=50)
            stages.append(to_data_url(buf.getvalue()))
        full = stages[-1]

        # warm the socket on the first stroke so the take starts on a live runner
        client.frame(build_prompt(style, None if nohint else word, 0.55), stages[0], steps=STEPS, seed=SEED)

        events = []
        frames = 0
        t0 = time.perf_counter()
        now = lambda: (time.perf_counter() - t0) * 1000  # noqa: E731

        def shoot(image: str, *, strength: float, style_id: str, hint: str | None, stage: int, phase: str) -> None:
            nonlocal frames
            prompt = build_prompt(style_id, hint, strength)
            sent_at = now()
            r = client.frame(prompt, image, steps=STEPS, seed=SEED)
            shown_at = now()
            name = f"frame-{frames:02d}.jpg"
            if r["jpeg"]:
                (folder / name).write_bytes(r["jpeg"])
            events.append({"type": "frame", "file": name if r["jpeg"] else None, "stage": stage, "phase": phase, "strength": strength, "style": style_id, "style_label": STYLES[style_id]["label"], "hint": hint, "sent_at": round(sent_at), "shown_at": round(shown_at), "ms": round(r["ms"]), "cold": r["cold"], "prompt": prompt, "error": r["error"]})
            frames += 1
            log(f"  {phase:8} stage {stage:2} {style_id:10} s{int(strength * 100):3} {round(r['ms']):5} ms {r['error'] or ''}")

        # ── drawing on a clock
        hint = None if nohint else word
        last_stage = 0
        while True:
            available = min(STAGES, int(now() // STAGE_MS) + 1)
            if available == last_stage:
                if last_stage == STAGES:
                    break
                time.sleep(0.005)
                continue
            last_stage = available
            shoot(stages[available - 1], strength=0.55, style_id=style, hint=hint, stage=available, phase="drawing")
        drawing_end = now()
        events.append({"type": "mark", "at": round(drawing_end), "label": "drawing-end"})

        # a no-hint take: the hint arrives now, so the video shows what the word does
        if nohint:
            time.sleep(HOLD_MS / 1000)
            events.append({"type": "mark", "at": round(now()), "label": "hint"})
            for _ in range(2):
                shoot(full, strength=0.55, style_id=style, hint=word, stage=STAGES, phase="hint")
            hint = word

        # ── strength sweep
        time.sleep(HOLD_MS / 1000)
        events.append({"type": "mark", "at": round(now()), "label": "sweep"})
        for strength in SWEEP:
            shoot(full, strength=strength, style_id=style, hint=hint, stage=STAGES, phase="sweep")

        # ── style tour
        time.sleep(HOLD_MS / 1000)
        events.append({"type": "mark", "at": round(now()), "label": "tour"})
        for style_id in [s for s in TOUR if s != style]:
            shoot(full, strength=0.55, style_id=style_id, hint=hint, stage=STAGES, phase="tour")
        events.append({"type": "mark", "at": round(now()), "label": "end"})

        (folder / "events.json").write_text(json.dumps({"sketch": sketch, "word": word, "style": style, "nohint": nohint, "stages": STAGES, "stage_ms": STAGE_MS, "events": events}, indent=1), encoding="utf-8")
        log(f"{folder.name}: {frames} frames, {round(now() / 1000, 1)} s")

    client.close()


if __name__ == "__main__":
    main()
