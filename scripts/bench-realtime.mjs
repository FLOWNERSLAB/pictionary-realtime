import fs from 'node:fs';

import { fal } from '@fal-ai/client';

import { sketchPng } from './sketch.mjs';

const key = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/FAL_KEY=(.+)/)?.[1].trim();

if (!key) throw new Error('FAL_KEY missing in .env');

fal.config({ credentials: key, suppressLocalCredentialsWarning: true });

const APP = 'fal-ai/flux-2/klein/realtime';
const FRAMES = Number(process.env.FRAMES ?? 8);
const STYLE = 'a glossy 3D toy figurine, soft studio lighting, rounded plastic shapes';

const log = line => fs.writeSync(1, `${line}\n`);

/** Width × height from raw PNG or JPEG bytes, to know what 'square' really returns. */
const outputSize = content => {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content ?? []);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes[0] === 0x89) return `${view.getUint32(16)}×${view.getUint32(20)} png`;

  for (let i = 2; i < bytes.length - 9; ) {
    const marker = bytes[i + 1];

    if (marker >= 0xc0 && marker <= 0xc2) return `${view.getUint16(i + 7)}×${view.getUint16(i + 5)} jpeg`;

    i += 2 + view.getUint16(i + 2);
  }

  return `? (${bytes.length} bytes)`;
};

/**
 * Steady-state latency with exactly one frame in flight: send, wait for the
 * answer, send the next. That is the best case the drawing loop can ever feel.
 * Goes through the official client because the socket speaks msgpack — a plain
 * JSON frame comes back as `INTERNAL_ERROR: 'bytes'`.
 */
const run = async ({ steps, size, inputSize }) => {
  const image = `data:image/png;base64,${sketchPng(inputSize).toString('base64')}`;
  const latencies = [];

  let sentAt = 0;
  let finish = () => {};
  const done = new Promise(resolve => {
    finish = resolve;
  });

  const connection = fal.realtime.connect(APP, {
    connectionKey: `bench-${steps}-${size}-${inputSize}`,
    throttleInterval: 0,
    maxBuffering: 1,
    onError: error => {
      log(`   error: ${error.message}`);
      finish();
    },
    onResult: result => {
      latencies.push(Date.now() - sentAt);

      if (latencies.length === 1) log(`   salida ${outputSize(result?.images?.[0]?.content)}`);

      if (latencies.length >= FRAMES) return finish();

      send();
    },
  });

  function send() {
    sentAt = Date.now();
    connection.send({
      prompt: `Turn this into "${STYLE}"`,
      image_url: image,
      image_size: size,
      num_inference_steps: steps,
      output_feedback_strength: 1,
      seed: 35,
    });
  }

  send();
  setTimeout(finish, 120000);
  await done;
  connection.close();

  return latencies;
};

const stats = values => {
  if (!values.length) return 'sin datos';

  const sorted = [...values].sort((a, b) => a - b);
  const average = Math.round(values.reduce((total, value) => total + value, 0) / values.length);

  return `media ${average} ms · p50 ${sorted[Math.floor(sorted.length / 2)]} ms · min ${sorted[0]} ms · max ${sorted.at(-1)} ms`;
};

const CASE_SETS = {
  default: [
    { label: '3 pasos · salida 768 · entrada 704', steps: 3, size: 'square', inputSize: 704 },
    { label: '2 pasos · salida 768 · entrada 704', steps: 2, size: 'square', inputSize: 704 },
    { label: '1 paso · salida 768 · entrada 512', steps: 1, size: 'square', inputSize: 512 },
    { label: '3 pasos · salida 1024 · entrada 704', steps: 3, size: 'square_hd', inputSize: 704 },
  ],
  // klein realtime only takes 'square' or 'square_hd' as output, so 512 is on the input side only.
  512: [
    { label: '2 pasos · entrada 704 (referencia)', steps: 2, size: 'square', inputSize: 704 },
    { label: '3 pasos · entrada 512', steps: 3, size: 'square', inputSize: 512 },
    { label: '2 pasos · entrada 512', steps: 2, size: 'square', inputSize: 512 },
    { label: '1 paso · entrada 512', steps: 1, size: 'square', inputSize: 512 },
    { label: '2 pasos · entrada 384', steps: 2, size: 'square', inputSize: 384 },
  ],
};

const CASES = CASE_SETS[process.env.CASES ?? 'default'];

for (const testCase of CASES) {
  const latencies = await run(testCase);
  const [first, ...rest] = latencies;

  log(`${testCase.label}\n   1ª ${first ?? '-'} ms · resto: ${stats(rest)}`);
}

process.exit(0);
