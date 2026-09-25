import { deflateSync } from 'node:zlib';

const SIZE = 512;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;

  return c >>> 0;
});

const crc32 = (buffer) => {
  let c = 0xffffffff;

  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);

  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);

  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);

  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
};

/** A guest-grade doodle: house, door, window, sun. Grayscale PNG, no dependencies. */
export const sketchPng = (size = SIZE) => {
  const pixels = Buffer.alloc(size * size, 255);
  const scale = size / 512;

  const dot = (x, y) => {
    for (let dy = -2; dy <= 2; dy += 1)
      for (let dx = -2; dx <= 2; dx += 1) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;

        if (px >= 0 && px < size && py >= 0 && py < size) pixels[py * size + px] = 0;
      }
  };

  const line = (x1, y1, x2, y2) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) * 2;

    for (let i = 0; i <= steps; i += 1) dot(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
  };

  const s = (value) => value * scale;

  line(s(110), s(240), s(400), s(240));
  line(s(400), s(240), s(400), s(430));
  line(s(400), s(430), s(110), s(430));
  line(s(110), s(430), s(110), s(240));
  line(s(110), s(240), s(255), s(130));
  line(s(255), s(130), s(400), s(240));
  line(s(210), s(340), s(210), s(430));
  line(s(210), s(340), s(270), s(340));
  line(s(270), s(340), s(270), s(430));
  line(s(310), s(290), s(360), s(290));
  line(s(360), s(290), s(360), s(330));
  line(s(360), s(330), s(310), s(330));
  line(s(310), s(330), s(310), s(290));

  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4;

    line(s(440) + Math.cos(angle) * s(22), s(90) + Math.sin(angle) * s(22), s(440) + Math.cos(angle) * s(40), s(90) + Math.sin(angle) * s(40));
  }

  const raw = Buffer.alloc((size + 1) * size);

  for (let y = 0; y < size; y += 1) {
    raw[y * (size + 1)] = 0;
    pixels.copy(raw, y * (size + 1) + 1, y * size, (y + 1) * size);
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

export const sketchDataUrl = (size = SIZE) => `data:image/png;base64,${sketchPng(size).toString('base64')}`;
