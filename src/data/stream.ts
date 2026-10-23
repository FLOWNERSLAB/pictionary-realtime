/**
 * The second engine: StreamDiffusion (SDXL-Turbo) hosted by Daydream, over WebRTC.
 * The canvas goes out as a 30 fps video (WHIP) and the styled video comes back
 * (WHEP): there is no request per frame, so it runs at ~20 fps with ~500 ms glass to
 * glass (measured 24-25 sep 2026). It is a different animal from klein:
 *
 * - it reads CLIP tags, not sentences (src/lib/stream-prompt.ts);
 * - the drawing is a *starting latent* noised at `t_index_list[0]`, not a reference:
 *   that is where AI Strength lives here, with a line ControlNet holding the shape;
 * - the input is painted as white strokes on black (TouchDesigner practice): the
 *   scribble-style ControlNet reads it as a line map and the output gets no black
 *   outlines. The paper the guest draws on never changes.
 *
 * Needs DAYDREAM_API_KEY in .env (and a restart) and a Chromium browser.
 */

export type ControlNetKind = 'canny' | 'depth' | 'tile';

export type ControlNetSetting = { enabled: boolean; scale: number };

export const CONTROLNET_COPY: Record<ControlNetKind, { label: string; hint: string }> = {
  canny: { label: 'Líneas', hint: 'Sigue el trazo. Con «Directo» lee el trazo blanco sobre negro tal cual, como el scribble de StreamDiffusionTD.' },
  depth: { label: 'Profundidad', hint: 'Profundidad estimada del frame. Sobre un dibujo plano da poca información.' },
  tile: { label: 'Tile (feedback)', hint: 'Usa el frame anterior de salida como guía: menos parpadeo, más arrastre.' },
};

/**
 * What turns the frame into the control image for the line ControlNet. `passthrough`
 * hands the frame over untouched: with white strokes on black it already is a line
 * map. `standard_lineart` is for ink on white paper. Changing it reloads the pipeline (~30 s).
 */
export type LinePreprocessor = 'passthrough' | 'standard_lineart' | 'canny' | 'lineart' | 'soft_edge';

export const LINE_PREPROCESSORS: { id: LinePreprocessor; label: string }[] = [
  { id: 'passthrough', label: 'Directo (scribble)' },
  { id: 'standard_lineart', label: 'Lineart simple' },
  { id: 'canny', label: 'Canny' },
  { id: 'lineart', label: 'Lineart (modelo)' },
  { id: 'soft_edge', label: 'Borde suave' },
];

/** How the drawing is painted into the video StreamDiffusion receives. */
export type InputLook = 'white' | 'grey' | 'noise' | 'paper';

export const INPUT_LOOKS: { id: InputLook; label: string; hint: string }[] = [
  { id: 'white', label: 'Blanco sobre negro', hint: 'Fondo negro, trazo blanco puro. Lo que usa StreamDiffusionTD.' },
  { id: 'grey', label: 'Gris sobre negro', hint: 'Fondo negro, trazo gris medio.' },
  { id: 'noise', label: 'Ruido sobre negro', hint: 'Fondo negro, trazo relleno de ruido suave.' },
  { id: 'paper', label: 'Papel', hint: 'Tinta sobre blanco, tal como se dibuja. Pide el preprocesador «Lineart simple».' },
];

export const isDarkLook = (look: InputLook) => look !== 'paper';

export type StreamSettings = {
  /** Replaces style + hint when not empty, like the prompt field of StreamDiffusionTD. */
  prompt: string;
  /** `num_inference_steps`: the grid `t_index_list` points into. */
  steps: number;
  /** Number of UNet passes (1-4). Their positions come from AI Strength. */
  passes: number;
  /** Gap between consecutive passes on the grid. */
  spread: number;
  /** 0-1: smooth colour noise under the strokes. */
  texture: number;
  inputLook: InputLook;
  guidance: number;
  delta: number;
  linePreprocessor: LinePreprocessor;
  cannyLow: number;
  cannyHigh: number;
  safetyChecker: boolean;
  /** Depth and tile are manual; the line ControlNet's weight follows AI Strength. */
  controlnets: Record<ControlNetKind, ControlNetSetting>;
};

/**
 * Measured 25 sep 2026 as «Scribble TD»: white strokes on black used as the line map
 * (passthrough), two passes from index 4. Follows the drawing even without a word.
 */
export const STREAM_DEFAULTS: StreamSettings = {
  prompt: '',
  steps: 50,
  passes: 2,
  spread: 8,
  texture: 0,
  inputLook: 'white',
  guidance: 1,
  delta: 0.7,
  linePreprocessor: 'passthrough',
  cannyLow: 100,
  cannyHigh: 200,
  safetyChecker: false,
  controlnets: {
    canny: { enabled: true, scale: 0.9 },
    depth: { enabled: false, scale: 0.45 },
    tile: { enabled: false, scale: 0.21 },
  },
};

export type StreamRecipe = { id: string; label: string; hint: string; apply: (current: StreamSettings) => StreamSettings };

export const STREAM_RECIPES: StreamRecipe[] = [
  {
    id: 'scribble',
    label: 'Scribble TD',
    hint: 'Trazo blanco sobre negro usado tal cual como mapa de líneas (0,9), dos pasadas. Sigue el dibujo incluso sin pista.',
    apply: current => ({ ...current, inputLook: 'white', linePreprocessor: 'passthrough', passes: 2, spread: 8, texture: 0, controlnets: { ...current.controlnets, canny: { enabled: true, scale: 0.9 } } }),
  },
  {
    id: 'paper',
    label: 'Papel + lineart',
    hint: 'Tinta sobre blanco con el preprocesador «Lineart simple» a 0,6: el render sale con contorno negro.',
    apply: current => ({ ...current, inputLook: 'paper', linePreprocessor: 'standard_lineart', passes: 2, spread: 8, controlnets: { ...current.controlnets, canny: { enabled: true, scale: 0.6 } } }),
  },
  {
    id: 'black',
    label: 'Negro sin líneas',
    hint: 'Blanco sobre negro sin ControlNet: render limpio sobre fondo oscuro, conserva la estructura.',
    apply: current => ({ ...current, inputLook: 'white', passes: 2, spread: 12, texture: 0, controlnets: { ...current.controlnets, canny: { ...current.controlnets.canny, enabled: false } } }),
  },
  {
    id: 'scene',
    label: 'Escena',
    hint: 'Textura de color 0,5 bajo el trazo: construye un escenario alrededor del dibujo.',
    apply: current => ({ ...current, texture: 0.5 }),
  },
];

/** sqrt(alpha_bar) of SD's scaled-linear schedule: the share of the input left at a timestep. */
const SIGNAL = (() => {
  const values: number[] = [];
  let product = 1;

  for (let step = 0; step < 1000; step += 1) {
    const beta = (Math.sqrt(0.00085) + ((Math.sqrt(0.012) - Math.sqrt(0.00085)) * step) / 999) ** 2;

    product *= 1 - beta;
    values.push(Math.sqrt(product));
  }

  return values;
})();

/** How much of the drawing survives the noise added at an index of a `steps` grid. */
export const inputKept = (index: number, steps: number) => SIGNAL[999 - Math.round((999 / steps) * index)] ?? 0;

export const cleanIndexList = (indices: number[], steps: number) =>
  [...indices]
    .slice(0, 4)
    .map(index => Math.min(Math.max(0, Math.round(index)), steps - 1))
    .sort((a, b) => a - b);

/**
 * AI Strength on StreamDiffusion, Krea's way: the first `t_index` is the one whose
 * kept share of the drawing is closest to 1 − strength (index 0 = pure noise, high
 * index = the drawing comes back almost untouched), and the line ControlNet loosens
 * its grip as strength grows. Measured 23-25 sep: from index ~20 up the output is a
 * cleaned-up copy of the drawing; turning it into an object took index 4-8.
 */
export const streamForStrength = (strength: number, stream: StreamSettings) => {
  // The useful band on SDXL-Turbo (measured 23-25 sep and 23 oct, 50-step grid): index
  // ~20 hands the drawing back as a tinted copy, ~11 keeps its shape as an object, ~4
  // reinvents from the word. A straight 1 − strength on the kept share put the middle
  // of the slider at a copy (45 % kept = index 22), so the band is mapped directly.
  const scaled = (20 - 17 * strength) * (stream.steps / 50);
  // Never pure noise, and leave room for the later passes.
  const first = Math.min(Math.max(2, Math.round(scaled)), stream.steps - 1 - stream.spread * (stream.passes - 1));

  const tIndex = cleanIndexList(
    Array.from({ length: stream.passes }, (_, pass) => first + pass * stream.spread),
    stream.steps,
  );
  const lineScale = Math.round((stream.controlnets.canny.scale * (1 - 0.6 * strength) + Number.EPSILON) * 100) / 100;

  return { tIndex, lineScale, kept: inputKept(first, stream.steps) };
};

export const describeStreamStrength = (strength: number, stream: StreamSettings) => {
  const { tIndex, lineScale, kept } = streamForStrength(strength, stream);

  return `t_index [${tIndex.join(', ')}] · ${Math.round(kept * 100)} % del dibujo${stream.controlnets.canny.enabled ? ` · líneas ${lineScale.toFixed(2).replace('.', ',')}` : ''}`;
};

export const STREAM_MODEL = {
  id: 'daydream-sdxl-turbo',
  modelId: 'stabilityai/sdxl-turbo',
  label: 'StreamDiffusion · SDXL-Turbo',
  controlnets: [
    { kind: 'canny' as const, model_id: 'xinsir/controlnet-canny-sdxl-1.0', preprocessor: 'canny' },
    { kind: 'depth' as const, model_id: 'xinsir/controlnet-depth-sdxl-1.0', preprocessor: 'depth_tensorrt' },
    { kind: 'tile' as const, model_id: 'xinsir/controlnet-tile-sdxl-1.0', preprocessor: 'feedback' },
  ],
};

export type StreamParamsInput = { prompt: string; negative: string; seed: number; strength: number; stream: StreamSettings };

/**
 * The stream's params: created with them, hot-patched when they change. Every
 * ControlNet goes in from the start (adding one later reloads the pipeline, ~30 s)
 * and "off" is weight 0, Daydream's own advice. SDXL-Turbo is distilled without CFG:
 * guidance above 1 turns the output to noise. The SDXL pipeline switches on an
 * IP-Adapter with a fractal texture by default: sent off explicitly.
 */
export const buildStreamParams = ({ prompt, negative, seed, strength, stream }: StreamParamsInput) => {
  const { tIndex, lineScale } = streamForStrength(strength, stream);

  return {
    model_id: STREAM_MODEL.modelId,
    prompt: stream.prompt.trim() || prompt,
    negative_prompt: negative,
    seed,
    width: 512,
    height: 512,
    num_inference_steps: stream.steps,
    t_index_list: tIndex,
    guidance_scale: stream.guidance,
    delta: stream.delta,
    use_safety_checker: stream.safetyChecker,
    controlnets: STREAM_MODEL.controlnets.map(({ kind, ...controlnet }) => {
      const setting = stream.controlnets[kind];
      const preprocessor = kind === 'canny' ? stream.linePreprocessor : controlnet.preprocessor;
      const scale = kind === 'canny' ? (setting.enabled ? lineScale : 0) : setting.enabled ? setting.scale : 0;

      return {
        ...controlnet,
        preprocessor,
        conditioning_scale: scale,
        preprocessor_params: preprocessor === 'canny' ? { low_threshold: stream.cannyLow, high_threshold: stream.cannyHigh } : {},
        enabled: true,
        control_guidance_start: 0,
        control_guidance_end: 1,
      };
    }),
    ip_adapter: { enabled: false },
  };
};
