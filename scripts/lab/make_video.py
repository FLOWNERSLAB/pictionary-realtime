"""
Composes a real-time video from a take recorded by exp_record.py: the paper on the
left shows the stroke that existed at each instant, the light box on the right shows
the frame the public was seeing at that instant, and the bar below shows the clock,
the frame in flight and the latency of the last answer. Nothing is sped up.

    python scripts/lab/make_video.py <take folder> <out.mp4> [--fps 30]
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FFMPEG = r"C:\Users\david\AppData\Local\Programs\Python\Python311\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"

TAKE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
FPS = int(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 30

W, H = 1600, 900
SQ = 640
TOP = 96
GAP = 48
LX = (W - 2 * SQ - GAP) // 2
RX = LX + SQ + GAP
BG = (18, 18, 17)
FG = (236, 235, 230)
MUTED = (150, 146, 138)
ACCENT = (92, 184, 242)
WARN = (227, 162, 64)
PAPER = (255, 255, 255)

RUNGS = [(0.12, "Calco"), (0.25, "Coloreado"), (0.38, "Recorte"), (0.5, "Fiel"), (0.62, "Acabado"), (0.75, "Limpio"), (0.88, "Libre"), (1.01, "Prompt")]


def rung(strength: float) -> str:
    for upto, label in RUNGS:
        if strength < upto:
            return label
    return "Prompt"


def font(size: int, bold: bool = False):
    for name in (("segoeuib.ttf" if bold else "segoeui.ttf"), "arialbd.ttf" if bold else "arial.ttf"):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default()


def mono(size: int):
    for name in ("consola.ttf", "cour.ttf"):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default()


F_TITLE, F_LABEL, F_SMALL, F_MONO, F_BIG = font(30, True), font(22), font(18), mono(22), mono(44)


def main() -> None:
    data = json.loads((TAKE / "events.json").read_text(encoding="utf-8"))
    events = data["events"]
    frames = [e for e in events if e["type"] == "frame"]
    marks = {e["label"]: e["at"] for e in events if e["type"] == "mark"}
    stages = {k: Image.open(TAKE / f"stage-{k:02d}.png").convert("RGB").resize((SQ, SQ), Image.LANCZOS) for k in range(1, data["stages"] + 1)}
    renders = {f["file"]: Image.open(TAKE / f["file"]).convert("RGB").resize((SQ, SQ), Image.LANCZOS) for f in frames if f["file"]}
    total_ms = marks.get("end", frames[-1]["shown_at"]) + 1800
    n_frames = int(total_ms / 1000 * FPS)

    style_label = {f["style"]: f["style_label"] for f in frames}
    title = f"{data['word']} · {style_label[data['style']]}" + (" · sin pista" if data["nohint"] else f" · pista «{data['word']}»")

    cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin

    for i in range(n_frames):
        t = i * 1000 / FPS
        # paper: the stroke that existed at t
        stage = min(data["stages"], int(t // data["stage_ms"]) + 1) if t < marks.get("drawing-end", 1e9) else data["stages"]
        shown = [f for f in frames if f["shown_at"] <= t and f["file"]]
        last = shown[-1] if shown else None
        in_flight = next((f for f in frames if f["sent_at"] <= t < f["shown_at"]), None)

        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        d.text((LX, 24), title, fill=FG, font=F_TITLE)
        d.text((LX, 62), "FLUX.2 klein realtime · fal · 3 pasos · 704 px · tiempo real, sin acelerar", fill=MUTED, font=F_SMALL)

        img.paste(stages[stage], (LX, TOP))
        d.rectangle([LX, TOP, LX + SQ, TOP + SQ], outline=(60, 60, 58), width=1)
        if last:
            img.paste(renders[last["file"]], (RX, TOP))
        else:
            d.rectangle([RX, TOP, RX + SQ, TOP + SQ], fill=(28, 28, 27))
            d.text((RX + 24, TOP + SQ // 2 - 12), "esperando el primer frame…", fill=MUTED, font=F_LABEL)
        d.rectangle([RX, TOP, RX + SQ, TOP + SQ], outline=ACCENT if in_flight else (60, 60, 58), width=2)

        # captions under each square
        y = TOP + SQ + 14
        d.text((LX, y), "Lo que hay en el papel", fill=MUTED, font=F_SMALL)
        if t < marks.get("drawing-end", 1e9):
            d.text((LX + SQ - 150, y), f"trazo {stage}/{data['stages']}", fill=MUTED, font=F_SMALL)
        if last:
            phase = last["phase"]
            what = (
                f"AI Strength {int(last['strength'] * 100)} · {rung(last['strength'])}"
                if phase == "sweep"
                else f"Estilo: {last['style_label']}" if phase == "tour" else ("Llega la pista: «" + str(last["hint"]) + "»" if phase == "hint" else f"{last['style_label']} · AI Strength {int(last['strength'] * 100)}")
            )
            d.text((RX, y), what, fill=FG, font=F_LABEL)
            lag = last["shown_at"] - (min(data["stages"], last["stage"]) - 1) * data["stage_ms"] if phase == "drawing" else None
            right = f"{last['ms']} ms" + (f" · {lag} ms tras el trazo" if lag is not None else "")
            d.text((RX + SQ - d.textlength(right, font=F_SMALL), y + 2), right, fill=MUTED, font=F_SMALL)

        # bottom bar: clock, in-flight meter, phase
        by = H - 92
        d.text((LX, by), f"{t / 1000:6.2f} s", fill=FG, font=F_BIG)
        bar_x, bar_w = LX + 220, W - 2 * LX - 220
        d.rectangle([bar_x, by + 18, bar_x + bar_w, by + 30], fill=(40, 40, 38))
        if in_flight:
            frac = min(1.0, (t - in_flight["sent_at"]) / 1500)
            d.rectangle([bar_x, by + 18, bar_x + int(bar_w * frac), by + 30], fill=ACCENT if frac < 0.8 else WARN)
            d.text((bar_x, by + 40), f"frame en vuelo: {int(t - in_flight['sent_at'])} ms", fill=MUTED, font=F_SMALL)
        else:
            d.text((bar_x, by + 40), "sin frame en vuelo", fill=MUTED, font=F_SMALL)
        phase_label = "Dibujando" if t < marks.get("drawing-end", 1e9) else "Pista" if "hint" in marks and t < marks.get("sweep", 1e9) and t >= marks["hint"] else "Barrido de AI Strength" if "sweep" in marks and marks["sweep"] <= t < marks.get("tour", 1e9) else "Cambio de estilo" if "tour" in marks and t >= marks["tour"] else "Espera"
        d.text((W - LX - d.textlength(phase_label, font=F_LABEL), by + 40), phase_label, fill=ACCENT, font=F_LABEL)

        proc.stdin.write(img.tobytes())

    proc.stdin.close()
    proc.wait()
    print(f"{OUT} · {n_frames / FPS:.1f} s · {len(frames)} frames IA")


if __name__ == "__main__":
    main()
