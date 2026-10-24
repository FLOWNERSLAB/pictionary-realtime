"""
The prompt klein realtime gets, built from three independent parts, so a style never
smuggles in a subject and AI Strength only changes how closely the lines are followed:

    [fidelity sentence · from strength + hint]  [style look]  [light + palette]  [backdrop]

Mirrors src/lib/prompt.ts in the app: keep both in step.
"""

from __future__ import annotations

import json
from pathlib import Path

# One catalogue for the app and the harness: src/data/styles.json (rules at its top).
STYLES_FILE = Path(__file__).resolve().parents[2] / "src" / "data" / "styles.json"
STYLES = {s["id"]: s for s in json.loads(STYLES_FILE.read_text(encoding="utf-8"))["styles"]}

# From "trace the lines" to "the sketch is only a hint". `{S}` is the subject phrase.
LADDER = [
    # (upto, text, soft style)
    (0.12, "This is a line drawing of {S}. Keep it a line drawing: the exact same lines, outline, proportions and position on the same white sheet, nothing added.", True),
    (0.25, "Render this drawing of {S} exactly as drawn: every line where it is, same proportions and position, flat and simple, with only light shading and colour.", True),
    (0.38, "Render this drawing of {S} exactly as drawn: every line where it is, same proportions and position, flat and simple, with only light shading and colour.", False),
    (0.5, "Treat the ink as the only subject: keep exactly the drawn shapes, where they are, and texture them as if they were made of the materials of {S}. Add no other shapes.", False),
    (0.62, "Treat the ink as the only subject: keep exactly the drawn shapes, where they are, and texture them as if they were made of the materials of {S}, with the surface detail {S} would have. Add no other shapes.", False),
    (0.75, "Turn this sketch into {S}. Use the drawing as the layout and clean up the shape so it clearly reads as {S}.", False),
    (0.88, "Create {S}, using this sketch only as a rough guide for placement and pose. Redesign the shape freely, with full detail.", False),
    (1.01, "Create {S}. Ignore the exact lines of the sketch; only keep it roughly in the same place in the frame.", False),
]


def rung(strength: float) -> tuple[str, bool]:
    for upto, text, soft in LADDER:
        if strength < upto:
            return text, soft
    return LADDER[-1][1], LADDER[-1][2]


def subject_phrase(hint: str | None) -> str:
    hint = (hint or "").strip()
    if not hint:
        return "what it depicts"
    return hint if hint.split()[0].lower() in ("a", "an", "the", "some") else f"a {hint}"


def build_prompt(style_id: str, hint: str | None, strength: float, backdrop: bool = True) -> str:
    style = STYLES[style_id]
    text, soft = rung(strength)
    parts = [text.format(S=subject_phrase(hint))]
    if soft:
        parts.append(f"Hint at the look only through colour and light: {style['palette']}, {style['light']}.")
    else:
        parts.append(f"{style['look']}. {style['light'][0].upper()}{style['light'][1:]}, {style['palette']}.")
        if backdrop:
            parts.append(f"{style['backdrop'][0].upper()}{style['backdrop'][1:]} behind it, nothing else in the frame.")
    return " ".join(parts)
