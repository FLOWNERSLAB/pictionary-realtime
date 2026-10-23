"""
Builds the HTML report of a lab run: every render of E1/E1b/E2/E3 as an embedded
thumbnail, with its latency and the prompt behind it.

    python scripts/lab/build_report.py <lab dir> <out.html>
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

LAB = Path(sys.argv[1])
OUT = Path(sys.argv[2])
STYLES = json.loads((Path(__file__).parent / "styles.json").read_text(encoding="utf-8"))["styles"]
SKETCH_WORDS = json.loads((LAB / "sketches" / "sketches.json").read_text(encoding="utf-8"))

THUMB = 150


def thumb(path: Path | None, size: int = THUMB, quality: int = 56) -> str:
    if path is None or not path.exists():
        return ""
    img = Image.open(path).convert("RGB")
    img.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def load(name: str):
    p = LAB / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


e1 = load("e1-strength/results.json") or []
e1b = load("e1b-ladder/results.json") or []
e2 = load("e2-styles/results.json") or []
e3 = load("e3-timing/report.json") or {}

RUNGS = ["Calco", "Coloreado", "Recorte", "Fiel", "Acabado", "Limpio", "Libre", "Prompt"]
# E1b rung → report rung (r0 soft, r1 soft, r1 full, r2 … r6)
E1B_MAP = [("0", True), ("1", True), ("1", False), ("2", False), ("3", False), ("4", False), ("5", False), ("6", False)]


def e1b_tile(style: str, sketch: str, rung_idx: int):
    rung, soft = E1B_MAP[rung_idx]
    for r in e1b:
        if r["style"] == style and r["sketch"] == sketch and str(r["rung"]) == rung and r["soft"] == soft and r["file"]:
            return r
    return None


def img(src: str, alt: str, cls: str = "") -> str:
    return f'<img class="{cls}" src="{src}" alt="{alt}" loading="lazy" width="{THUMB}" height="{THUMB}">' if src else '<div class="miss"></div>'


# ── data for the page ──────────────────────────────────────────────────────────
sketch_thumbs = {name: thumb(LAB / "sketches" / f"{name}.png", 160) for name in SKETCH_WORDS}

ladder_data = {}
for style in ("photo", "watercolor"):
    rows = []
    for sketch in ("house", "cat", "rocket", "pizza", "bicycle"):
        cells = []
        for i in range(8):
            r = e1b_tile(style, sketch, i)
            cells.append({"src": thumb(LAB / "e1b-ladder" / r["file"]) if r else "", "ms": r["ms"] if r else None, "adh": r.get("adherence") if r else None, "prompt": r["prompt"] if r else ""})
        rows.append({"sketch": sketch, "cells": cells})
    ladder_data[style] = rows

mech = {}
for family, tags, note in (
    ("Desenfoque del boceto", ["A-L50", "B-blur06", "B-blur12", "B-blur20", "B-low"], "A igual prompt, un boceto más borroso suelta la forma: más ventanas, otro gato. Por eso el tramo alto del slider desenfoca la entrada."),
    ("Pasos", ["D-s1", "D-s2", "A-L50", "D-s4", "D-s6"], "1, 2, 3, 4 y 6 pasos. Con 1-2 sale más plano; con 6 añade chimenea y árboles y cuesta 1 s."),
    ("schedule_mu", ["C-mu0.3", "C-mu1.0", "C-mu1.7", "A-L50"], "0,3 · 1,0 · 1,7 · 2,3: apenas cambia la imagen."),
    ("Memoria (output_feedback_strength)", ["F-fb0.7-0", "F-fb0.7-3", "F-fb0.5-0", "F-fb0.5-3"], "Feedback 0,7 en el frame 1 y 4; 0,5 en el frame 1 y 4. A 0,5 el cuarto frame ya está manchado: el tope de «Memoria» en el lab es 0,3."),
):
    rows = []
    for sketch in ("house", "cat"):
        cells = []
        for tag in tags:
            r = next((x for x in e1 if x["sketch"] == sketch and x["tag"] == tag and x["file"]), None)
            cells.append({"src": thumb(LAB / "e1-strength" / r["file"]) if r else "", "ms": r["ms"] if r else None, "tag": tag})
        rows.append({"sketch": sketch, "cells": cells})
    mech[family] = {"rows": rows, "note": note}

styles_data = []
for style in STYLES:
    rows = []
    for sketch in ("house", "cat", "rocket", "pizza"):
        cells = []
        for strength in (0.25, 0.55, 0.85):
            r = next((x for x in e2 if x["style"] == style["id"] and x["sketch"] == sketch and x["hint"] and abs(x["strength"] - strength) < 1e-6), None)
            cells.append({"src": thumb(LAB / "e2-styles" / r["file"]) if r and r["file"] else "", "ms": r["ms"] if r else None, "label": f"{int(strength * 100)}", "prompt": r["prompt"] if r else ""})
        r = next((x for x in e2 if x["style"] == style["id"] and x["sketch"] == sketch and not x["hint"]), None)
        cells.append({"src": thumb(LAB / "e2-styles" / r["file"]) if r and r["file"] else "", "ms": r["ms"] if r else None, "label": "sin pista", "prompt": r["prompt"] if r else ""})
        rows.append({"sketch": sketch, "cells": cells})
    lat = sorted(x["ms"] for x in e2 if x["style"] == style["id"] and x["file"] and not x["cold"] and x["ms"] < 3000)
    styles_data.append({**style, "rows": rows, "p50": lat[len(lat) // 2] if lat else None})

drawing = []
for key, run in (e3.get("drawing") or {}).items():
    frames = []
    for f in run["frames"]:
        frames.append({**f, "src": thumb(LAB / "e3-timing" / f["file"], 150) if f["file"] else "", "stage_src": thumb(LAB / "sketches" / f"{run['sketch']}-s{f['stage']:02d}.png", 150)})
    drawing.append({**run, "frames": frames})

switch = []
for f in (e3.get("switch") or {}).get("frames", []):
    switch.append({**f, "src": thumb(LAB / "e3-timing" / f["file"], 120) if f["file"] else ""})

warm_e2 = sorted(x["ms"] for x in e2 if x["file"] and not x["cold"])
outliers = [x for x in e2 if x["file"] and x["ms"] > 3000]
e1_warm = sorted(x["ms"] for x in e1 if x["file"] and not x["cold"] and x["ms"] < 3000)

summary = {
    "frames": len(e1) + len(e1b) + len(e2) + sum(len(r["frames"]) for r in drawing) + len(switch) + sum(v["n"] for v in (e3.get("steady") or {}).values()),
    "e2_p50": warm_e2[len(warm_e2) // 2] if warm_e2 else None,
    "e2_p90": warm_e2[int(len(warm_e2) * 0.9)] if warm_e2 else None,
    "outliers": len(outliers),
    "e2_n": len(e2),
    "steady": e3.get("steady") or {},
    "cold": e3.get("cold") or [],
    "switch": (e3.get("switch") or {}).get("stats"),
    "stage_ms": e3.get("stage_ms"),
}

# ── StreamDiffusion (captured from the lab by sd-harness.js)
SD = LAB / "sd"
sd_matrix = []
for style in STYLES:
    rows = []
    for sketch in ("house", "cat"):
        cells = []
        for strength, label in ((32, "Recorte 32"), (56, "Acabado 56"), (82, "Libre 82")):
            f = SD / "matrix" / f"{sketch}-{style['id']}-{strength}.jpg"
            cells.append({"src": thumb(f) if f.exists() else "", "label": label})
        rows.append({"sketch": sketch, "cells": cells})
    sd_matrix.append({"id": style["id"], "label": style["label"], "group": style["group"], "tags": style.get("tags", ""), "rows": rows})

sd_sweeps = []
for tag, sketch, style_id, style_label in (("sweep-house", "house", "photo", "Natural"), ("sweep-cat", "cat", "photo", "Natural"), ("sweep-cat", "cat", "clay", "Arcilla")):
    cells = []
    for strength in (6, 19, 32, 44, 56, 69, 82, 95):
        f = SD / "matrix" / f"{tag}-{style_id}-{strength}.jpg"
        cells.append({"src": thumb(f) if f.exists() else "", "label": str(strength)})
    if any(c["src"] for c in cells):
        sd_sweeps.append({"sketch": sketch, "style": style_label, "cells": cells})

# Read off the lab's header and tape on 23 oct 2026 after a 14-round probe (key L), SDXL-Turbo, Scribble TD.
sd_stats = {"measured": {"header": "En vivo· 349 ms· 21,1 fps", "tape": ["21,1", "416 ms", "3,5 s", "12/14", "2", "s/d"]}}
sd_records = {}
for folder in (SD / "record").glob("*-v5"):
    log = json.loads((folder / "log.json").read_text(encoding="utf-8"))
    sd_records[folder.name] = {"frames": len(log["frames"]), "seconds": log["seconds"], "stats": log.get("stats")}

VIDEOS = [
    ("videos/01-cat-foto-natural.mp4", "gato · Foto natural", "Escalera v1 (sin anclar): con la pista la foto está completa desde el primer trazo."),
    ("videos/02-rocket-arcilla.mp4", "cohete · Arcilla", "Un estilo de materia sigue el trazo mejor que uno de foto."),
    ("videos/03-bicycle-cine.mp4", "bici · Cine", "Escena atmosférica: el fondo del estilo aparece aunque no esté dibujado."),
    ("videos/04-pizza-acuarela.mp4", "pizza · Acuarela", "Los estilos de arte casi no completan: pintan lo que hay."),
    ("videos/05-house-noche.mp4", "casa · Noche", "Con un socket que cae en runner frío: el frame en vuelo pasa a ámbar y la imagen se congela unos segundos."),
    ("videos/06-fish-sin-pista.mp4", "pez · sin pista → pista", "Sin pista el dibujo se vuelve objeto físico; la palabra llega después y lo reinterpreta."),
    ("videos/07-house-natural-anclado.mp4", "casa · Natural · escalera anclada", "Acabado 55 con la pista como material: la casa crece con los trazos, como en Krea."),
    ("videos/08-cat-natural-anclado.mp4", "gato · Natural · escalera anclada", "Un círculo es un aro; el gato aparece cuando está el cuerpo."),
    ("videos/david-01-prueba-real-flux.mp4", "Prueba real de David · Flux realtime", "Grabación de pantalla de una sesión libre (4 min, con audio): un garabato sin pista se vuelve escultura de hormigón, luego objeto rojo; cambios de estilo y de strength sobre la marcha y la tira de historial para comparar."),
]
SD_VIDEOS = [
    ("videos/sd-01-cat-natural.mp4", "gato · Natural · 56", "Vídeo continuo a ~20 fps: el render cambia mientras la mano se mueve, sin esperar frames."),
    ("videos/sd-02-rocket-neon.mp4", "cohete · Neón · 56", "El trazo blanco sobre negro es el mapa de líneas: el neón lo sigue literalmente."),
    ("videos/sd-03-house-arcilla.mp4", "casa · Arcilla · 82", "A AI Strength alto SDXL-Turbo ya construye el objeto desde la pista."),
    ("videos/david-02-prueba-real-streamdiffusion.mp4", "Prueba real de David · StreamDiffusion", "Grabación de pantalla (2 min, con audio): garabato orgánico sin pista que el stream convierte en escultura de arcilla y cerámica a 20 fps mientras se dibuja; al final, cristal."),
]

payload = {
    "sd": {"matrix": sd_matrix, "sweeps": sd_sweeps, "stats": sd_stats, "records": sd_records},
    "videos": VIDEOS,
    "sd_videos": SD_VIDEOS,
    "sketches": sketch_thumbs,
    "words": {k: v["word"] for k, v in SKETCH_WORDS.items()},
    "rungs": RUNGS,
    "ladder": ladder_data,
    "mech": mech,
    "styles": styles_data,
    "drawing": drawing,
    "switch": switch,
    "summary": summary,
}

template = (Path(__file__).parent / "report_template.html").read_text(encoding="utf-8")
html = template.replace("/*__DATA__*/", json.dumps(payload, ensure_ascii=False))
OUT.write_text(html, encoding="utf-8")
print(f"{OUT} · {OUT.stat().st_size / 1e6:.1f} MB · {summary['frames']} frames")
