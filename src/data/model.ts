/**
 * The one model the lab drives: fal's `fal-ai/flux-2/klein/realtime`, the only image
 * endpoint on fal with a realtime WebSocket worker (catalogue re-checked 23 oct 2026).
 * Everything else measured since September (Daydream StreamDiffusion, FLUX.1 i2i,
 * LoRAs, Z-Image, SDXL) was slower, blacked out frames, or needed its own GPU; it is
 * gone from the lab so what remains is what the show will run.
 *
 * Input schema (23 oct 2026): prompt, image_url (base64 JPEG, 704 px at 50 % quality
 * recommended), image_size square (768) | square_hd (1024), num_inference_steps 1-8,
 * output_feedback_strength 0-1 (1 = no memory), schedule_mu 0,3-2,5,
 * enable_interpolation, seed. No strength, no LoRA, no negative prompt.
 */
export const MODEL = {
  endpoint: 'fal-ai/flux-2/klein/realtime',
  label: 'FLUX.2 klein realtime',
  /** Side of the square JPEG we send. fal resizes anything else, so this is the sweet spot. */
  inputSize: 704,
  jpegQuality: 0.5,
  steps: { min: 1, max: 8, default: 3 },
  /** 0,00194 $ per compute second (~42 $ for 6 h at 100 %). */
  usdPerSecond: 0.00194,
} as const;

export type Settings = {
  steps: number;
  /** 0-0,3: share of the previous frame's latent carried over (klein's `output_feedback_strength` is 1 − this). */
  memory: number;
  seed: number;
  scheduleMu: number;
  hd: boolean;
  interpolate: boolean;
  /** Adds the style's plain backdrop to the prompt. */
  backdrop: boolean;
  /** Minimum ms between two frames; 0 = as fast as fal answers. */
  throttleMs: number;
};

/**
 * Memory above 0,3 (feedback below 0,7) piles colour artefacts frame after frame
 * (E1, 23 oct: at 0,5 the fourth frame was already stained); 0,3 only smooths flicker.
 */
export const MEMORY_MAX = 0.3;

export const DEFAULT_SETTINGS: Settings = {
  steps: MODEL.steps.default,
  memory: 0,
  seed: 35,
  scheduleMu: 2.3,
  hd: false,
  interpolate: false,
  backdrop: true,
  throttleMs: 0,
};

export type FrameInput = {
  prompt: string;
  imageDataUrl: string;
  settings: Settings;
};

export const buildInput = ({ prompt, imageDataUrl, settings }: FrameInput) => ({
  prompt,
  image_url: imageDataUrl,
  image_size: settings.hd ? 'square_hd' : 'square',
  num_inference_steps: Math.min(MODEL.steps.max, Math.max(MODEL.steps.min, Math.round(settings.steps))),
  output_feedback_strength: 1 - Math.min(MEMORY_MAX, Math.max(0, settings.memory)),
  schedule_mu: settings.scheduleMu,
  enable_interpolation: settings.interpolate,
  seed: settings.seed,
});
