import fs from 'node:fs';

import { fal } from '@fal-ai/client';

import { sketchPng } from './sketch.mjs';

const key = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/FAL_KEY=(.+)/)?.[1].trim();

fal.config({ credentials: key, suppressLocalCredentialsWarning: true });

const image = `data:image/png;base64,${sketchPng(512).toString('base64')}`;
const prompt = 'a glossy 3D toy figurine, soft studio lighting, rounded plastic shapes, centered, plain background';

/** Same drawing, same prompt, filter on vs off: does the black frame go away? */
const cases = [
  ['fal-ai/lcm-sd15-i2i', { image_url: image, strength: 0.7, num_inference_steps: 4, guidance_scale: 1 }, 'enable_safety_checks'],
  [
    'fal-ai/sdxl-controlnet-union/image-to-image',
    { image_url: image, canny_image_url: image, canny_preprocess: true, controlnet_conditioning_scale: 0.7, num_inference_steps: 8, image_size: 'square' },
    'enable_safety_checker',
  ],
];

for (const [endpoint, base, flag] of cases)
  for (const filter of [true, false])
    for (const seed of [35, 36, 37]) {
      const started = Date.now();

      try {
        const { data } = await fal.subscribe(endpoint, { input: { ...base, prompt, seed, sync_mode: true, [flag]: filter } });
        const nsfw = data.has_nsfw_concepts ?? data.nsfw_content_detected;

        console.log(endpoint, `filter=${filter}`, `seed=${seed}`, `nsfw=${JSON.stringify(nsfw)}`, `${Date.now() - started} ms`);
      } catch (error) {
        console.log(endpoint, `filter=${filter}`, `seed=${seed}`, 'ERROR', error.status, JSON.stringify(error.body?.detail ?? error.message).slice(0, 200));
      }
    }
