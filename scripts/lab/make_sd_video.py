"""
Composes a real-time video from a StreamDiffusion take captured by sd-harness.js
(`__sd.record`): paper and output frames grabbed from the lab at ~8 fps with their
timestamps. Same layout as make_video.py, so the two engines compare side by side.

    python scripts/lab/make_sd_video.py <take folder> <out.mp4> --title "gato · Natural" --stats "21 fps · 349 ms"
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
TITLE = sys.argv[sys.argv.index("--title") + 1] if "--title" in sys.argv else TAKE.name
STATS = sys.argv[sys.argv.index("--stats") + 1] if "--stats" in sys.argv else ""
FPS = 24

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


def font(size: int, bold: bool = False):
    for name in (("segoeuib.ttf" if bold else "segoeui.ttf"), "arialbd.ttf" if bold else "arial.ttf"):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default()


def mono(size: int):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/consola.ttf", size)
    except OSError:
        return ImageFont.load_default()


F_TITLE, F_LABEL, F_SMALL, F_BIG = font(30, True), font(22), font(18), mono(44)


def main() -> None:
    log = json.loads((TAKE / "log.json").read_text(encoding="utf-8"))
    frames = [f for f in log["frames"] if f["out"] and f["paper"]]
    outs = {f["index"]: Image.open(TAKE / f"out-{f['index']:03d}.jpg").convert("RGB").resize((SQ, SQ), Image.LANCZOS) for f in frames}
    papers = {f["index"]: Image.open(TAKE / f"paper-{f['index']:03d}.png").convert("RGB").resize((SQ, SQ), Image.LANCZOS) for f in frames}
    total_ms = frames[-1]["at"] + 600
    n_frames = int(total_ms / 1000 * FPS)

    cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin

    for i in range(n_frames):
        t = i * 1000 / FPS
        current = [f for f in frames if f["at"] <= t]
        f = current[-1] if current else frames[0]

        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        d.text((LX, 24), TITLE, fill=FG, font=F_TITLE)
        d.text((LX, 62), "StreamDiffusion · SDXL-Turbo en Daydream · WebRTC · tiempo real, sin acelerar · capturado del lab a 8 fps", fill=MUTED, font=F_SMALL)
        img.paste(papers[f["index"]], (LX, TOP))
        img.paste(outs[f["index"]], (RX, TOP))
        d.rectangle([LX, TOP, LX + SQ, TOP + SQ], outline=(60, 60, 58), width=1)
        d.rectangle([RX, TOP, RX + SQ, TOP + SQ], outline=ACCENT, width=2)
        y = TOP + SQ + 14
        d.text((LX, y), "Lo que hay en el papel", fill=MUTED, font=F_SMALL)
        d.text((RX, y), "Lo que ve el público (vídeo continuo)", fill=FG, font=F_LABEL)
        by = H - 92
        d.text((LX, by), f"{t / 1000:6.2f} s", fill=FG, font=F_BIG)
        if STATS:
            d.text((LX + 220, by + 12), STATS, fill=MUTED, font=F_LABEL)
        proc.stdin.write(img.tobytes())

    proc.stdin.close()
    proc.wait()
    print(f"{OUT} · {n_frames / FPS:.1f} s · {len(frames)} capturas")


if __name__ == "__main__":
    main()
