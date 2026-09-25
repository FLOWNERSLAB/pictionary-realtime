import fs from 'node:fs';

import { sketchDataUrl } from './sketch.mjs';

const key = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/FAL_KEY=(.+)/)?.[1].trim();

if (!key) throw new Error('FAL_KEY missing in .env');

const STYLE = 'a glossy 3D toy figurine, soft studio lighting, rounded plastic shapes, subtle shadow, seamless light grey background';
const RUNS = Number(process.env.RUNS ?? 3);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 240000);

const image512 = sketchDataUrl(512);
const image768 = sketchDataUrl(768);

const CANDIDATES = [
  {
    label: 'LCM SD1.5 i2i (512)',
    endpoint: 'fal-ai/lcm-sd15-i2i',
    input: { prompt: STYLE, image_url: image512, strength: 0.7, num_inference_steps: 4, guidance_scale: 1, sync_mode: true },
  },
  {
    label: 'LCM SDXL i2i (512)',
    endpoint: 'fal-ai/fast-lcm-diffusion/image-to-image',
    input: { prompt: STYLE, image_url: image512, strength: 0.7, num_inference_steps: 4, sync_mode: true },
  },
  {
    label: 'Z-Image Turbo i2i (768)',
    endpoint: 'fal-ai/z-image/turbo/image-to-image',
    input: { prompt: STYLE, image_url: image768, strength: 0.7, num_inference_steps: 4, acceleration: 'high', image_size: 'square', sync_mode: true },
  },
  {
    label: 'Z-Image Turbo + canny (768)',
    endpoint: 'fal-ai/z-image/turbo/controlnet',
    input: { prompt: STYLE, image_url: image768, preprocess: 'canny', control_scale: 0.75, num_inference_steps: 4, acceleration: 'high', image_size: 'square', sync_mode: true },
  },
  {
    label: 'SDXL ControlNet Union (768)',
    endpoint: 'fal-ai/sdxl-controlnet-union/image-to-image',
    input: { prompt: STYLE, image_url: image768, canny_image_url: image768, canny_preprocess: true, controlnet_conditioning_scale: 0.75, num_inference_steps: 6, image_size: 'square', sync_mode: true },
  },
  {
    label: 'FLUX.2 klein 4B edit (1024)',
    endpoint: 'fal-ai/flux-2/klein/4b/edit',
    input: { prompt: STYLE, image_urls: [image768], image_size: 'square_hd', num_inference_steps: 8, sync_mode: true },
  },
  {
    label: 'FLUX.2 turbo edit (512)',
    endpoint: 'fal-ai/flux-2/turbo/edit',
    input: { prompt: STYLE, image_urls: [image512], image_size: 'square', output_format: 'jpeg', sync_mode: true },
  },
  {
    label: 'SDXL Lightning i2i (512, 2 pasos)',
    endpoint: 'fal-ai/fast-lightning-sdxl/image-to-image',
    input: {
      prompt: STYLE,
      image_url: image512,
      strength: 0.8,
      num_inference_steps: 2,
      image_size: 'square',
      safety_checker_version: 'v2',
      format: 'jpeg',
      sync_mode: true,
    },
  },
  {
    label: 'Nano Banana edit',
    endpoint: 'fal-ai/nano-banana/edit',
    input: { prompt: STYLE, image_urls: [image768], aspect_ratio: '1:1', num_images: 1, sync_mode: true },
  },
  {
    label: 'Bria FIBO sketch→color',
    endpoint: 'bria/fibo-edit/sketch_to_colored_image',
    input: { image_url: image768 },
  },
];

/** console.log is block-buffered when stdout is a file, so results are flushed as they land. */
const log = line => fs.writeSync(1, `${line}
`);

const only = process.argv[2];
const pool = only ? CANDIDATES.filter(c => c.endpoint.includes(only) || c.label.toLowerCase().includes(only.toLowerCase())) : CANDIDATES;

/**
 * fal answers a flagged render with a fully black image and HTTP 200, so a run is
 * only "ok" once the pixels say so. Reads the PNG/JPEG header-free way: average
 * the decoded bytes is overkill here, a data URI that decodes to a single dark
 * colour has almost no entropy, so the compressed size gives it away.
 */
const isBlank = async url => {
  if (typeof url !== 'string') return false;

  const base64 = url.startsWith('data:') ? url.slice(url.indexOf(',') + 1) : null;

  if (!base64) return false;

  // A 1024x1024 flat-black PNG compresses to a few KB; any real render is far bigger.
  return Buffer.from(base64, 'base64').length < 20000;
};

const call = async ({ endpoint, input }) => {
  const startedAt = Date.now();

  try {
    const response = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST',
      headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const elapsed = Date.now() - startedAt;
    const text = await response.text();

    if (!response.ok) return { ms: elapsed, ok: false, note: `${response.status} ${text.slice(0, 140).replace(/\s+/g, ' ')}` };

    const body = JSON.parse(text);
    const inference = body.timings?.inference ?? body.timings?.total;
    const nsfw = body.has_nsfw_concepts?.some(Boolean);
    const blank = await isBlank(body.images?.[0]?.url);
    const detail = inference ? `inferencia ${Math.round(inference * 1000)} ms` : '';

    if (blank) return { ms: elapsed, ok: false, note: `frame en negro${nsfw ? ' (marcado NSFW)' : ''}` };

    return { ms: elapsed, ok: true, note: detail };
  } catch (error) {
    return { ms: Date.now() - startedAt, ok: false, note: error.name === 'TimeoutError' ? `sin respuesta en ${TIMEOUT_MS / 1000} s` : error.message };
  }
};

log(`Sketch de ${Math.round(image512.length / 1024)} KB (512) y ${Math.round(image768.length / 1024)} KB (768). ${RUNS} llamadas por modelo.\n`);
log('| Modelo | 1ª llamada | Llamadas en caliente | Estado |');
log('|:--|--:|--:|:--|');

for (const candidate of pool) {
  const results = [];

  for (let run = 0; run < RUNS; run += 1) results.push(await call(candidate));

  const [first, ...warm] = results;
  const okWarm = warm.filter(r => r.ok);
  const warmAverage = okWarm.length ? Math.round(okWarm.reduce((total, r) => total + r.ms, 0) / okWarm.length) : null;
  const failures = results.filter(r => !r.ok);
  const status = failures.length ? `FALLA: ${failures[0].note}` : `ok · ${okWarm[0]?.note ?? first.note}`;

  log(
    `| ${candidate.label} | ${(first.ms / 1000).toFixed(1)} s | ${warmAverage ? `${(warmAverage / 1000).toFixed(1)} s` : '-'} | ${status} |`,
  );
}
