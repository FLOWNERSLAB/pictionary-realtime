"""
Minimal client for fal's realtime socket (`fal-ai/flux-2/klein/realtime`) in Python,
for the experiments in this folder. The socket speaks msgpack, so a tiny codec lives
here rather than a dependency.

Facts it is built around (measured 24 sep 2026, scripts/probe-socket.mjs):
- fal closes every socket ~30 s after its runner is ready, busy or not (code 1000);
- a fresh socket may land on a cold runner (first frame 2-13 s);
- one frame in flight at a time is the honest way to measure latency.

So `Client.frame()` reopens the socket whenever it died, and `rotate_every` reopens it
proactively after N frames to avoid losing one mid-flight.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import struct
import time
from pathlib import Path
from typing import Any

from websockets.sync.client import connect

APP = "fal-ai/flux-2/klein/realtime"
TOKEN_URL = "https://rest.alpha.fal.ai/tokens/"


# ── msgpack, just enough ────────────────────────────────────────────────────────


def pack(value: Any) -> bytes:
    out = bytearray()

    def put(v: Any) -> None:
        nonlocal out
        if v is None:
            out.append(0xC0)
        elif v is True:
            out.append(0xC3)
        elif v is False:
            out.append(0xC2)
        elif isinstance(v, int):
            if 0 <= v < 128:
                out.append(v)
            elif -32 <= v < 0:
                out.append(v & 0xFF)
            elif 0 <= v <= 0xFFFFFFFF:
                out.append(0xCE)
                out += struct.pack(">I", v)
            else:
                out.append(0xD3)
                out += struct.pack(">q", v)
        elif isinstance(v, float):
            out.append(0xCB)
            out += struct.pack(">d", v)
        elif isinstance(v, str):
            b = v.encode("utf-8")
            n = len(b)
            if n < 32:
                out.append(0xA0 | n)
            elif n < 256:
                out += bytes([0xD9, n])
            elif n < 65536:
                out.append(0xDA)
                out += struct.pack(">H", n)
            else:
                out.append(0xDB)
                out += struct.pack(">I", n)
            out += b
        elif isinstance(v, (bytes, bytearray)):
            n = len(v)
            if n < 256:
                out += bytes([0xC4, n])
            elif n < 65536:
                out.append(0xC5)
                out += struct.pack(">H", n)
            else:
                out.append(0xC6)
                out += struct.pack(">I", n)
            out += v
        elif isinstance(v, (list, tuple)):
            n = len(v)
            if n < 16:
                out.append(0x90 | n)
            else:
                out.append(0xDC)
                out += struct.pack(">H", n)
            for item in v:
                put(item)
        elif isinstance(v, dict):
            n = len(v)
            if n < 16:
                out.append(0x80 | n)
            else:
                out.append(0xDE)
                out += struct.pack(">H", n)
            for k, item in v.items():
                put(k)
                put(item)
        else:
            raise TypeError(f"cannot pack {type(v)}")

    put(value)
    return bytes(out)


def unpack(data: bytes) -> Any:
    pos = 0

    def take(n: int) -> bytes:
        nonlocal pos
        chunk = data[pos : pos + n]
        pos += n
        return chunk

    def read() -> Any:
        nonlocal pos
        b = data[pos]
        pos += 1
        if b <= 0x7F:
            return b
        if b >= 0xE0:
            return b - 256
        if 0x80 <= b <= 0x8F:
            return {read(): read() for _ in range(b & 0x0F)}
        if 0x90 <= b <= 0x9F:
            return [read() for _ in range(b & 0x0F)]
        if 0xA0 <= b <= 0xBF:
            return take(b & 0x1F).decode("utf-8", "replace")
        if b == 0xC0:
            return None
        if b == 0xC2:
            return False
        if b == 0xC3:
            return True
        if b == 0xC4:
            return take(take(1)[0])
        if b == 0xC5:
            return take(struct.unpack(">H", take(2))[0])
        if b == 0xC6:
            return take(struct.unpack(">I", take(4))[0])
        if b == 0xCA:
            return struct.unpack(">f", take(4))[0]
        if b == 0xCB:
            return struct.unpack(">d", take(8))[0]
        if b == 0xCC:
            return take(1)[0]
        if b == 0xCD:
            return struct.unpack(">H", take(2))[0]
        if b == 0xCE:
            return struct.unpack(">I", take(4))[0]
        if b == 0xCF:
            return struct.unpack(">Q", take(8))[0]
        if b == 0xD0:
            return struct.unpack(">b", take(1))[0]
        if b == 0xD1:
            return struct.unpack(">h", take(2))[0]
        if b == 0xD2:
            return struct.unpack(">i", take(4))[0]
        if b == 0xD3:
            return struct.unpack(">q", take(8))[0]
        if b == 0xD9:
            return take(take(1)[0]).decode("utf-8", "replace")
        if b == 0xDA:
            return take(struct.unpack(">H", take(2))[0]).decode("utf-8", "replace")
        if b == 0xDB:
            return take(struct.unpack(">I", take(4))[0]).decode("utf-8", "replace")
        if b == 0xDC:
            return [read() for _ in range(struct.unpack(">H", take(2))[0])]
        if b == 0xDD:
            return [read() for _ in range(struct.unpack(">I", take(4))[0])]
        if b == 0xDE:
            return {read(): read() for _ in range(struct.unpack(">H", take(2))[0])}
        if b == 0xDF:
            return {read(): read() for _ in range(struct.unpack(">I", take(4))[0])}
        raise ValueError(f"msgpack byte {b:#x} not handled")

    return read()


# ── fal ─────────────────────────────────────────────────────────────────────────


def fal_key() -> str:
    key = os.environ.get("FAL_KEY")
    if not key:
        env = Path(__file__).resolve().parents[2] / ".env"
        m = re.search(r"^FAL_KEY=(.+)$", env.read_text(encoding="utf-8"), re.M)
        key = m.group(1).strip() if m else ""
    if not key:
        raise SystemExit("FAL_KEY missing (.env or environment)")
    return key


def mint_token(key: str, seconds: int = 600) -> str:
    import urllib.request

    req = urllib.request.Request(
        TOKEN_URL,
        data=json.dumps({"allowed_apps": ["flux-2"], "token_expiration": seconds}).encode(),
        headers={"authorization": f"Key {key}", "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode().strip().strip('"')


def to_data_url(image: bytes | str | Path, quality: int = 50) -> str:
    """JPEG data URI at 704 px, which is what fal recommends for the realtime socket."""
    from PIL import Image

    if isinstance(image, str) and image.startswith("data:"):
        return image
    img = Image.open(io.BytesIO(image) if isinstance(image, bytes) else image).convert("RGB")
    if img.size != (704, 704):
        img = img.resize((704, 704), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


class Client:
    def __init__(self, key: str | None = None, rotate_every: int = 18, log=print):
        self.key = key or fal_key()
        self.token = mint_token(self.key)
        self.token_at = time.time()
        self.rotate_every = rotate_every
        self.log = log
        self.ws = None
        self.sent_on_socket = 0
        self.sockets_opened = 0
        self.last_open_ms = 0.0

    def _open(self) -> None:
        self.close()
        if time.time() - self.token_at > 500:
            self.token = mint_token(self.key)
            self.token_at = time.time()
        t0 = time.perf_counter()
        self.ws = connect(f"wss://fal.run/{APP}?fal_jwt_token={self.token}&max_buffering=2", max_size=None, open_timeout=20)
        self.last_open_ms = (time.perf_counter() - t0) * 1000
        self.sent_on_socket = 0
        self.sockets_opened += 1

    def close(self) -> None:
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None

    def frame(self, prompt: str, image: str, *, steps: int = 3, seed: int = 35, feedback: float = 1.0, mu: float = 2.3, hd: bool = False, timeout: float = 25) -> dict:
        """One frame, one answer. Returns {ms, jpeg (bytes|None), error, cold (bool), keys}."""
        payload = {
            "prompt": prompt,
            "image_url": image,
            "image_size": "square_hd" if hd else "square",
            "num_inference_steps": int(steps),
            "output_feedback_strength": float(feedback),
            "schedule_mu": float(mu),
            "enable_interpolation": False,
            "seed": int(seed),
        }
        for attempt in range(3):
            fresh = False
            if self.ws is None or self.sent_on_socket >= self.rotate_every:
                self._open()
                fresh = True
            t0 = time.perf_counter()
            try:
                self.ws.send(pack(payload))
                self.sent_on_socket += 1
                while True:
                    raw = self.ws.recv(timeout=timeout)
                    msg = json.loads(raw) if isinstance(raw, str) else unpack(raw)
                    if isinstance(msg, dict) and msg.get("images"):
                        ms = (time.perf_counter() - t0) * 1000
                        content = msg["images"][0].get("content")
                        if isinstance(content, str):
                            content = base64.b64decode(content)
                        return {"ms": ms, "jpeg": content, "error": None, "cold": fresh, "keys": [k for k in msg if k != "images"], "attempt": attempt}
                    if isinstance(msg, dict) and msg.get("type") == "x-fal-error" and msg.get("error") != "TIMEOUT":
                        return {"ms": (time.perf_counter() - t0) * 1000, "jpeg": None, "error": f"{msg.get('error')}: {msg.get('reason')}", "cold": fresh, "keys": [], "attempt": attempt}
                    if isinstance(msg, dict) and msg.get("status") == "error":
                        return {"ms": (time.perf_counter() - t0) * 1000, "jpeg": None, "error": str(msg), "cold": fresh, "keys": [], "attempt": attempt}
            except Exception as fault:  # socket died under the frame: reopen and resend once
                self.log(f"   socket: {type(fault).__name__}: {fault} (reintento {attempt + 1})")
                self.close()
        return {"ms": 0, "jpeg": None, "error": "sin respuesta tras 3 intentos", "cold": True, "keys": [], "attempt": 3}


def stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    s = sorted(values)
    return {
        "n": len(s),
        "mean": sum(s) / len(s),
        "p50": s[len(s) // 2],
        "p90": s[min(len(s) - 1, int(len(s) * 0.9))],
        "min": s[0],
        "max": s[-1],
    }
