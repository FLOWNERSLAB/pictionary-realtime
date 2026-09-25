/**
 * Every model the lab can drive. fal ids were checked against the live catalog
 * and their OpenAPI input schemas on 2026-09-22.
 *
 * All fal models share the dev-server proxy and its FAL_KEY, so switching between
 * them is instant. Models from other providers need their own key in `.env`, and
 * Vite only reads `.env` on start: those are the ones that need a restart.
 */
import { REALTIME_ENDPOINTS } from './endpoints';
import type { StylePreset } from './presets';

export type Transport = 'ws' | 'http' | 'webrtc';

export type Provider = 'fal' | 'runware' | 'cloudflare' | 'daydream';

export type RenderParams = {
  prompt: string;
  negative: string;
  imageDataUrl: string;
  steps: number;
  strength: number;
  feedback: number;
  seed: number;
  /** klein realtime only. */
  scheduleMu?: number;
  interpolate?: boolean;
  hd?: boolean;
  /** StreamDiffusion only. */
  stream?: StreamSettings;
};

export type Billing = {
  /** What the provider actually meters. */
  unit: 'compute-second' | 'gpu-second' | 'image' | 'megapixel' | 'active-second';
  /** USD per unit, only where the provider publishes a rate. */
  usd?: number;
  note: string;
};

/**
 * Where a model stands after our own measurements, for the live loop:
 * - reference: works and is the one to beat in its lane
 * - candidate: not measured yet
 * - slow: works, but a frame takes over a second: no live feel
 * - unfit: answers fast enough, but the result is not usable (black frames, ignores the stroke)
 * - broken: gave no output in our tests
 * - finish-only: good for the one-off reveal, far too slow for the loop
 */
export type Verdict = 'reference' | 'candidate' | 'slow' | 'unfit' | 'broken' | 'finish-only';

/**
 * How the model takes its "how much to follow the drawing" knob:
 * - strength: img2img denoise (higher = more freedom from the sketch)
 * - control: ControlNet weight (higher = stricter to the lines)
 * - memory: klein realtime feedback, how much of the previous frame carries over
 */
export type GuideKind = 'strength' | 'control' | 'memory';

export type LiveModel = {
  id: string;
  provider: Provider;
  endpoint: string;
  label: string;
  /** One short line: family and size. */
  engine: string;
  transport: Transport;
  /** Side of the square raster we send, in pixels. */
  inputSize: number;
  steps: { min: number; max: number; default: number; allowed?: number[] };
  guide: GuideKind | null;
  /** How the style reaches the model: klein edits read an instruction, diffusion reads a description. */
  promptStyle: 'instruction' | 'description';
  billing: Billing;
  verdict: Verdict;
  /** Why a model is not fit for the live loop, in a few words. Shown next to its badge. */
  why?: string;
  /** What we measured, in one line. Empty if nobody measured it yet. */
  measured: string;
  notes: string;
  /** Present when the model cannot run yet: why, and what to do. */
  unavailable?: string;
  /** StreamDiffusion only: the ControlNets this pipeline serves, for the settings panel. */
  controlnets?: ControlNetKind[];
  buildInput: (params: RenderParams) => Record<string, unknown>;
};

/** The ControlNets Daydream serves, by what they read from the input frame. */
export type ControlNetKind = 'canny' | 'hed' | 'depth' | 'tile' | 'color';

export const CONTROLNET_COPY: Record<ControlNetKind, { label: string; hint: string }> = {
  canny: { label: 'Líneas (ControlNet canny)', hint: 'Sigue el trazo. Con el preprocesador «Lineart simple» lee la línea como línea; con «Canny» ve los dos bordes de cada trazo y salen tubos.' },
  hed: { label: 'HED (borde suave)', hint: 'Bordes suaves: lo más parecido a un scribble que ofrece Daydream.' },
  depth: { label: 'Depth', hint: 'Profundidad estimada del frame. Sobre un dibujo plano da poca información.' },
  tile: { label: 'Tile (feedback)', hint: 'Usa el frame anterior de salida como guía: menos parpadeo, más arrastre.' },
  color: { label: 'Color', hint: 'Pasa los colores de la entrada tal cual. Con tinta negra sobre blanco tiende al gris.' },
};

export type ControlNetSetting = { enabled: boolean; scale: number };

/**
 * What turns the frame into the control image for the canny ControlNet. Canny finds
 * both sides of a 3 px stroke, which is where the "black tubes" came from.
 * `standard_lineart` (blur minus image) turns dark-on-light line art into the
 * white-on-black lines that ControlNet expects. Changing it reloads the pipeline.
 * `passthrough` hands the input frame over untouched: with white strokes on black
 * it is already a line map, which is how StreamDiffusionTD's local mode uses its
 * scribble ControlNet (xinsir scribble + passthrough). Daydream has no scribble,
 * but its canny ControlNet reads the same white-on-black lines.
 */
export type LinePreprocessor = 'standard_lineart' | 'canny' | 'lineart' | 'soft_edge' | 'passthrough';

export const LINE_PREPROCESSORS: { id: LinePreprocessor; label: string }[] = [
  { id: 'standard_lineart', label: 'Lineart simple' },
  { id: 'canny', label: 'Canny' },
  { id: 'lineart', label: 'Lineart (modelo)' },
  { id: 'soft_edge', label: 'Borde suave' },
  { id: 'passthrough', label: 'Directo (scribble, con entrada en negro)' },
];

/**
 * How the drawing is painted into the video StreamDiffusion receives. The canvas the
 * guest draws on never changes. The dark looks come from TouchDesigner practice:
 * a black field with the stroke as white, grey or noise gives the model more to
 * hold on to than a thin black line on white paper.
 */
export type InputLook = 'paper' | 'white' | 'grey' | 'noise';

export const INPUT_LOOKS: { id: InputLook; label: string; hint: string }[] = [
  { id: 'paper', label: 'Papel', hint: 'Tinta sobre blanco, tal como se dibuja.' },
  { id: 'white', label: 'Blanco sobre negro', hint: 'Fondo negro, trazo blanco puro.' },
  { id: 'grey', label: 'Gris sobre negro', hint: 'Fondo negro, trazo gris medio.' },
  { id: 'noise', label: 'Ruido sobre negro', hint: 'Fondo negro, trazo relleno de ruido suave en escala de grises.' },
];

/** True when the input is light on black: the lineart preprocessor expects the opposite. */
export const isDarkLook = (look: InputLook) => look !== 'paper';

/**
 * Everything StreamDiffusion exposes that matters for a sketch. Nothing is on by
 * default: the values below are Daydream's own defaults and every ControlNet is off.
 */
export type StreamSettings = {
  /** Replaces style + word when not empty, like the prompt field of StreamDiffusionTD. */
  prompt: string;
  /** `num_inference_steps`: the grid `t_index_list` points into. */
  steps: number;
  /** `t_index_list` as typed: one UNet pass per entry, 0 = pure noise. */
  tIndex: number[];
  /** 0-1: smooth colour noise under the strokes, the TouchDesigner trick for sparse input. */
  texture: number;
  /** How the drawing is painted into the input video. */
  inputLook: InputLook;
  guidance: number;
  delta: number;
  cannyLow: number;
  cannyHigh: number;
  linePreprocessor: LinePreprocessor;
  safetyChecker: boolean;
  controlnets: Record<ControlNetKind, ControlNetSetting>;
};

/**
 * Neutral starting point, not a recipe: every ControlNet off, and the schedule the
 * StreamDiffusion README suggests for img2img without ControlNet (~[28, 40]).
 * The safety checker starts off: Daydream's (Freepik's detector, "low" already
 * counts as NSFW) swaps flagged frames for pure black, which read as a dead stream.
 */
export const STREAM_DEFAULTS: StreamSettings = {
  prompt: '',
  steps: 50,
  tIndex: [29, 39],
  texture: 0,
  inputLook: 'paper',
  guidance: 1,
  delta: 0.7,
  cannyLow: 100,
  cannyHigh: 200,
  linePreprocessor: 'standard_lineart',
  safetyChecker: false,
  controlnets: {
    canny: { enabled: false, scale: 0.5 },
    hed: { enabled: false, scale: 0.5 },
    depth: { enabled: false, scale: 0.5 },
    tile: { enabled: false, scale: 0.5 },
    color: { enabled: false, scale: 0.3 },
  },
};

export type StreamRecipe = {
  id: string;
  label: string;
  hint: string;
  /** Applied over the current settings; the prompt the user typed is kept. */
  apply: (current: StreamSettings) => StreamSettings;
};

const withLines = (current: StreamSettings, scale: number) => ({
  ...current.controlnets,
  canny: { enabled: true, scale },
});

const withoutLines = (current: StreamSettings) => ({
  ...current.controlnets,
  canny: { ...current.controlnets.canny, enabled: false },
});

/**
 * Measured on SDXL-Turbo on 24-25 sep 2026 with the house sketch and the 17 styles of then.
 * All keep guidance at 1: SDXL-Turbo is distilled without CFG, and at 1,5 the
 * output is already noise. Only ControlNet weights change, so no pipeline reload.
 * Each recipe also sets the input look it was measured with.
 */
export const STREAM_RECIPES: StreamRecipe[] = [
  {
    id: 'transform',
    label: 'Transformar',
    hint: 'Convierte el dibujo en el objeto del estilo. La palabra manda: con «cat» una casa sale gato.',
    apply: current => ({ ...current, steps: 50, tIndex: [4, 12], guidance: 1, inputLook: 'paper', linePreprocessor: 'standard_lineart', controlnets: withLines(current, 0.6) }),
  },
  {
    id: 'faithful',
    label: 'Fiel al trazo',
    hint: 'Pinta encima de tu dibujo sin cambiar su forma. Una palabra que no cuadra aparece dentro, no en su lugar.',
    apply: current => ({ ...current, steps: 50, tIndex: [12, 25], guidance: 1, inputLook: 'paper', linePreprocessor: 'standard_lineart', controlnets: withLines(current, 0.6) }),
  },
  {
    id: 'scene',
    label: 'Escena',
    hint: 'Fiel al trazo con textura 0,5: construye un escenario alrededor del dibujo. Mejor con prompt libre y «Proteger la silueta» apagado.',
    apply: current => ({ ...current, steps: 50, tIndex: [12, 25], guidance: 1, texture: 0.5, inputLook: 'paper', linePreprocessor: 'standard_lineart', controlnets: withLines(current, 0.6) }),
  },
  {
    id: 'black-td',
    label: 'Negro TD',
    hint: 'Como en TouchDesigner: trazo blanco sobre negro, sin ControlNet, t_index [8, 20]. Render limpio sobre fondo oscuro, sin contorno negro, y conserva la estructura del dibujo.',
    apply: current => ({ ...current, steps: 50, tIndex: [8, 20], guidance: 1, texture: 0, inputLook: 'white', controlnets: withoutLines(current) }),
  },
  {
    id: 'scribble-td',
    label: 'Scribble TD',
    hint: 'Como el modo local de StreamDiffusionTD: trazo blanco sobre negro usado tal cual como mapa de líneas (passthrough, 0,9) y t_index [4, 12]. Sigue el dibujo incluso sin palabra. Cambiar el preprocesador recarga el pipeline.',
    apply: current => ({
      ...current,
      steps: 50,
      tIndex: [4, 12],
      guidance: 1,
      texture: 0,
      inputLook: 'white',
      linePreprocessor: 'passthrough',
      controlnets: withLines(current, 0.9),
    }),
  },
  {
    id: 'default-td',
    label: 'Por defecto TD',
    hint: 'Los valores con los que arranca el backend de Daydream en StreamDiffusionTD 0.4.0: un paso en t_index 11, Depth 0,45 y Tile 0,21, sin líneas. Para comparar con lo que se ve en TouchDesigner.',
    apply: current => ({
      ...current,
      steps: 50,
      tIndex: [11],
      guidance: 1,
      delta: 0.7,
      controlnets: {
        ...current.controlnets,
        canny: { ...current.controlnets.canny, enabled: false },
        depth: { enabled: true, scale: 0.45 },
        tile: { enabled: true, scale: 0.21 },
      },
    }),
  },
  {
    id: 'neutral',
    label: 'Neutro',
    hint: 'Los valores de Daydream, todo apagado: devuelve un calco limpio del boceto.',
    apply: current => ({ ...STREAM_DEFAULTS, prompt: current.prompt, texture: current.texture, inputLook: current.inputLook, safetyChecker: current.safetyChecker }),
  },
];

/** SDXL-Turbo and SD-Turbo are distilled without CFG: guidance above 1 turns the output to noise. */
export const isTurbo = (model: LiveModel) => /turbo/i.test(model.id);

type DaydreamControlNet = { kind: ControlNetKind; model_id: string; preprocessor: string };

type DaydreamOptions = {
  modelId: string;
  verdict: Verdict;
  why?: string;
  /** Every ControlNet this pipeline serves. All go in at creation, see `daydream`. */
  controlnets: DaydreamControlNet[];
  notes: string;
  measured: string;
  /**
   * The SDXL and SD1.5 pipelines switch on an IP-Adapter by default with a fractal
   * texture as style image. SD-Turbo has none and rejects the key outright.
   */
  hasIpAdapter?: boolean;
};

/*
 * Tried on 2026-09-23 and dropped: sending the word and the style as two weighted
 * prompts (StreamDiffusion blends their embeddings). The word won, but the style
 * washed out into a flat icon even at equal weights. One prompt with the word
 * first ("house, a soft plush toy…") gave a felt house that follows the drawing.
 */

/**
 * StreamDiffusion noises the input at the first entry of `t_index_list` and runs one
 * UNet pass per entry, on a `num_inference_steps` LCM grid where index 0 is pure
 * noise (t=999) and higher indices keep more of the input. Daydream takes 1-4
 * entries in ascending order, each below the step count.
 * Measured 2026-09-23 on the house sketch with SDXL-Turbo at 50 steps: from index
 * ~20 up it returns a cleaned-up copy of the drawing; turning it into an object took
 * index 4-8 with a line ControlNet holding the shape.
 */
export const cleanIndexList = (indices: number[], steps: number) =>
  [...indices]
    .slice(0, 4)
    .map(index => Math.min(Math.max(0, Math.round(index)), steps - 1))
    .sort((a, b) => a - b);

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

/**
 * StreamDiffusion hosted by Daydream. The canvas goes out as a WebRTC video
 * (WHIP) and comes back as another (WHEP), so there is no per-frame request:
 * `buildInput` builds the stream's params, which are patched on every change.
 *
 * Adding or removing a ControlNet reloads the pipeline (~30 s), changing its weight
 * does not. So every ControlNet the model serves goes in from the start, and "off"
 * is weight 0, which is Daydream's own advice for disabling one without a reload.
 */
const daydream = (
  id: string,
  label: string,
  engine: string,
  { modelId, verdict, why, controlnets, notes, measured, hasIpAdapter = false }: DaydreamOptions,
): LiveModel => ({
  id,
  provider: 'daydream',
  endpoint: `daydream · ${modelId}`,
  label,
  engine,
  transport: 'webrtc',
  inputSize: 512,
  steps: { min: 1, max: 1, default: 1 },
  guide: null,
  promptStyle: 'description',
  billing: { unit: 'active-second', note: 'API de Daydream subvencionada por ahora: sin precio publicado.' },
  verdict,
  why,
  measured,
  notes,
  controlnets: controlnets.map(({ kind }) => kind),
  buildInput: ({ prompt, negative, seed, stream = STREAM_DEFAULTS }) => ({
    model_id: modelId,
    prompt: stream.prompt.trim() || prompt,
    negative_prompt: negative,
    seed,
    width: 512,
    height: 512,
    num_inference_steps: stream.steps,
    t_index_list: cleanIndexList(stream.tIndex, stream.steps),
    guidance_scale: stream.guidance,
    delta: stream.delta,
    use_safety_checker: stream.safetyChecker,
    controlnets: controlnets.map(({ kind, ...controlnet }) => {
      const setting = stream.controlnets[kind];
      const preprocessor = kind === 'canny' ? stream.linePreprocessor : controlnet.preprocessor;

      return {
        ...controlnet,
        preprocessor,
        conditioning_scale: setting.enabled ? setting.scale : 0,
        preprocessor_params: preprocessor === 'canny' ? { low_threshold: stream.cannyLow, high_threshold: stream.cannyHigh } : {},
        enabled: true,
        control_guidance_start: 0,
        control_guidance_end: 1,
      };
    }),
    ...(hasIpAdapter ? { ip_adapter: { enabled: false } } : {}),
  }),
});

const klein = (
  id: string,
  endpoint: string,
  label: string,
  engine: string,
  extra: Pick<LiveModel, 'verdict' | 'why' | 'measured' | 'notes' | 'billing'>,
): LiveModel => ({
  id,
  provider: 'fal',
  endpoint,
  label,
  engine,
  transport: 'http',
  inputSize: 768,
  steps: { min: 4, max: 8, default: 4 },
  guide: null,
  promptStyle: 'instruction',
  ...extra,
  buildInput: ({ prompt, imageDataUrl, steps, seed }) => ({
    prompt,
    image_urls: [imageDataUrl],
    image_size: 'square',
    num_inference_steps: Math.max(4, Math.min(steps, 8)),
    output_format: 'jpeg',
    sync_mode: true,
    seed,
  }),
});

export const LIVE_MODELS: readonly LiveModel[] = [
  {
    id: 'klein-realtime',
    provider: 'fal',
    endpoint: 'fal-ai/flux-2/klein/realtime',
    label: 'FLUX.2 klein realtime',
    engine: 'FLUX.2 [klein] · socket',
    transport: 'ws',
    inputSize: 704,
    steps: { min: 1, max: 8, default: 2 },
    guide: 'memory',
    promptStyle: 'instruction',
    billing: { unit: 'compute-second', usd: 0.00194, note: '0,00194 $ por segundo de cómputo (~42 $ por 6 h al 100 %)' },
    verdict: 'reference',
    measured: '587 ms p50 con 2 pasos · 1,7 fps dibujando (24 sep, socket propio)',
    notes:
      'El único endpoint de imagen de fal con worker realtime. Sin LoRA: el estilo va solo por prompt. «Memoria» mezcla el latente del frame anterior y estabiliza el parpadeo.',
    buildInput: ({ prompt, imageDataUrl, steps, feedback, seed, scheduleMu, interpolate, hd }) => ({
      prompt,
      image_url: imageDataUrl,
      image_size: hd ? 'square_hd' : 'square',
      num_inference_steps: steps,
      output_feedback_strength: feedback,
      schedule_mu: scheduleMu ?? 2.3,
      enable_interpolation: interpolate ?? false,
      seed,
    }),
  },
  klein('klein-4b-edit', 'fal-ai/flux-2/klein/4b/edit', 'FLUX.2 klein 4B edit', 'FLUX.2 [klein] 4B · HTTP', {
    verdict: 'slow',
    why: '1,8 s por frame: sirve para el revelado',
    measured: '1,8 s a 1024 px, sin arranque en frío',
    notes: 'El mismo modelo que el realtime, sin socket. Sirve para aislar cuánto aporta el WebSocket. Mínimo 4 pasos.',
    billing: { unit: 'megapixel', note: 'Por megapíxel de entrada y de salida.' },
  }),
  klein('klein-9b-edit', 'fal-ai/flux-2/klein/9b/edit', 'FLUX.2 klein 9B edit', 'FLUX.2 [klein] 9B · HTTP', {
    verdict: 'candidate',
    measured: '',
    notes: 'Más calidad que el 4B a cambio de latencia. Ojo: los pesos del 9B son no comerciales; por API de fal sí se puede usar.',
    billing: { unit: 'megapixel', note: 'Por megapíxel de entrada y de salida.' },
  }),
  {
    id: 'z-image-turbo',
    provider: 'fal',
    endpoint: 'fal-ai/z-image/turbo/image-to-image',
    label: 'Z-Image Turbo i2i',
    engine: 'Z-Image Turbo 6B · HTTP',
    transport: 'http',
    inputSize: 768,
    steps: { min: 1, max: 8, default: 4 },
    guide: 'strength',
    promptStyle: 'description',
    billing: { unit: 'gpu-second', note: 'Por segundo de GPU.' },
    verdict: 'unfit',
    why: 'Su filtro NSFW devuelve frames en negro',
    measured: '0,8 s por llamada, 263 ms de inferencia',
    notes:
      'El más rápido por HTTP, pero su filtro NSFW marca dibujos inocentes y devuelve el frame en negro; `enable_safety_checker: false` se ignora.',
    buildInput: ({ prompt, imageDataUrl, steps, strength, seed }) => ({
      prompt,
      image_url: imageDataUrl,
      strength,
      num_inference_steps: steps,
      acceleration: 'high',
      image_size: 'square',
      enable_safety_checker: false,
      sync_mode: true,
      seed,
    }),
  },
  {
    id: 'z-image-controlnet',
    provider: 'fal',
    endpoint: 'fal-ai/z-image/turbo/controlnet',
    label: 'Z-Image Turbo + canny',
    engine: 'Z-Image Turbo · ControlNet · HTTP',
    transport: 'http',
    inputSize: 768,
    steps: { min: 1, max: 8, default: 6 },
    guide: 'control',
    promptStyle: 'description',
    billing: { unit: 'gpu-second', note: 'Por segundo de GPU.' },
    verdict: 'finish-only',
    why: '4,4 s por frame',
    measured: '4,4 s por llamada, 3,4 s de inferencia',
    notes: 'El que más respeta el trazo (canny). Demasiado lento para el bucle; candidato a render final barato.',
    buildInput: ({ prompt, imageDataUrl, steps, strength, seed }) => ({
      prompt,
      image_url: imageDataUrl,
      preprocess: 'canny',
      control_scale: strength,
      num_inference_steps: steps,
      acceleration: 'high',
      image_size: 'square',
      sync_mode: true,
      seed,
    }),
  },
  {
    id: 'lightning-sdxl',
    provider: 'fal',
    endpoint: 'fal-ai/fast-lightning-sdxl/image-to-image',
    label: 'SDXL Lightning i2i',
    engine: 'SDXL Lightning · HTTP',
    transport: 'http',
    inputSize: 768,
    steps: { min: 1, max: 8, default: 2, allowed: [1, 2, 4, 8] },
    guide: 'strength',
    promptStyle: 'description',
    billing: { unit: 'gpu-second', note: 'Por segundo de GPU.' },
    verdict: 'unfit',
    why: 'Sin ControlNet no transforma el trazo',
    measured: '1,3 s por llamada, 319 ms de inferencia',
    notes: 'SDXL destilado a 1-8 pasos. Medido el 23 sep: rápido, pero sin ControlNet devuelve el garabato casi igual, no lo convierte en objeto.',
    buildInput: ({ prompt, imageDataUrl, steps, strength, seed }) => ({
      prompt,
      image_url: imageDataUrl,
      strength,
      num_inference_steps: [1, 2, 4, 8].reduce((best, value) => (Math.abs(value - steps) < Math.abs(best - steps) ? value : best)),
      image_size: 'square',
      format: 'jpeg',
      enable_safety_checker: false,
      safety_checker_version: 'v2',
      sync_mode: true,
      seed,
    }),
  },
  {
    id: 'lcm-sd15',
    provider: 'fal',
    endpoint: 'fal-ai/lcm-sd15-i2i',
    label: 'LCM SD1.5 i2i',
    engine: 'SD1.5 + LCM · HTTP',
    transport: 'http',
    inputSize: 512,
    steps: { min: 1, max: 12, default: 4 },
    guide: 'strength',
    promptStyle: 'description',
    billing: { unit: 'gpu-second', note: 'Por segundo de GPU (A100).' },
    verdict: 'slow',
    why: '1,6 s por frame y apenas transforma el trazo fino',
    measured: '1,6 s por llamada con 70 ms de inferencia · 128 s en frío',
    notes: 'El motor de tldraw draw-fast. La inferencia es casi gratis; lo que pesa es la petición. Calentar antes de usar. Con trazo fino sobre blanco apenas transforma: subir «Libertad» a 0,85 o más.',
    buildInput: ({ prompt, negative, imageDataUrl, steps, strength, seed }) => ({
      prompt,
      negative_prompt: negative,
      image_url: imageDataUrl,
      strength,
      num_inference_steps: steps,
      guidance_scale: 1,
      // LCM spells it `enable_safety_checks`, not `enable_safety_checker`.
      enable_safety_checks: false,
      sync_mode: true,
      seed,
    }),
  },
  {
    id: 'sdxl-controlnet-union',
    provider: 'fal',
    endpoint: 'fal-ai/sdxl-controlnet-union/image-to-image',
    label: 'SDXL ControlNet Union',
    engine: 'SDXL · union canny · HTTP',
    transport: 'http',
    inputSize: 768,
    steps: { min: 4, max: 30, default: 8 },
    guide: 'control',
    promptStyle: 'description',
    billing: { unit: 'gpu-second', note: 'Por segundo de GPU (A100).' },
    verdict: 'slow',
    why: '1,6 s por frame, 60 s en frío',
    measured: '1,6 s en caliente, 589 ms de inferencia · 60 s en frío',
    notes: 'Plan B de calidad con control por líneas. Su filtro NSFW v1 ponía en negro garabatos inocentes e ignora `enable_safety_checker: false`; con `safety_checker_version: v2` el mismo dibujo pasa.',
    buildInput: ({ prompt, negative, imageDataUrl, steps, strength, seed }) => ({
      prompt,
      negative_prompt: negative,
      image_url: imageDataUrl,
      canny_image_url: imageDataUrl,
      canny_preprocess: true,
      controlnet_conditioning_scale: strength,
      num_inference_steps: steps,
      image_size: 'square',
      enable_safety_checker: false,
      // The default v1 checker blacks out innocent doodles and ignores the flag above.
      // v2 let the same drawing, prompt and seed through (tested 2026-09-23).
      safety_checker_version: 'v2',
      sync_mode: true,
      seed,
    }),
  },
  {
    id: 'runware-klein',
    provider: 'runware',
    endpoint: 'runware · FLUX.2 klein 4B',
    label: 'klein 4B en Runware',
    engine: 'FLUX.2 [klein] 4B · socket',
    transport: 'ws',
    inputSize: 704,
    steps: { min: 4, max: 8, default: 4 },
    guide: null,
    promptStyle: 'instruction',
    billing: { unit: 'image', usd: 0.0006, note: 'Desde 0,0006 $ por imagen (tarifa pública, sin verificar).' },
    verdict: 'candidate',
    measured: '',
    notes: 'El mismo modelo por otro proveedor con WebSocket persistente: separa lo que cuesta la red de lo que cuesta fal.',
    unavailable: 'Falta el conector de Runware. Necesita RUNWARE_API_KEY en .env y reiniciar el servidor.',
    buildInput: () => ({}),
  },
  {
    id: 'cloudflare-klein',
    provider: 'cloudflare',
    endpoint: '@cf/black-forest-labs/flux-2-klein-4b',
    label: 'klein 4B en Workers AI',
    engine: 'FLUX.2 [klein] 4B · edge · HTTP',
    transport: 'http',
    inputSize: 512,
    steps: { min: 4, max: 4, default: 4 },
    guide: null,
    promptStyle: 'instruction',
    billing: { unit: 'image', note: 'Tarifa de Workers AI sin verificar.' },
    verdict: 'candidate',
    measured: '',
    notes: 'klein servido desde el edge de Cloudflare, cerca del venue. Entrada máxima 512 px, 4 pasos fijos.',
    unavailable: 'Falta el conector de Cloudflare. Necesita CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN en .env y reiniciar.',
    buildInput: () => ({}),
  },
  daydream('daydream-sdxl-turbo', 'SDXL-Turbo', 'StreamDiffusion · SDXL-Turbo · WebRTC', {
    modelId: 'stabilityai/sdxl-turbo',
    verdict: 'reference',
    controlnets: [
      { kind: 'canny', model_id: 'xinsir/controlnet-canny-sdxl-1.0', preprocessor: 'canny' },
      { kind: 'depth', model_id: 'xinsir/controlnet-depth-sdxl-1.0', preprocessor: 'depth_tensorrt' },
      { kind: 'tile', model_id: 'xinsir/controlnet-tile-sdxl-1.0', preprocessor: 'feedback' },
    ],
    notes:
      'La que recomienda Daydream. Receta medida el 24 sep con los 17 estilos de entonces (botón «Transformar»): palabra en inglés, líneas «Lineart simple» a 0,6, t_index [4, 12] y guidance 1. Guidance por encima de 1 da ruido.',
    measured: '495-547 ms de extremo a extremo · 20-22 fps · 1er frame 3,2-3,4 s (24 sep)',
    hasIpAdapter: true,
  }),
  daydream('daydream-dreamshaper', 'DreamShaper 8', 'StreamDiffusion · SD1.5 + LCM · WebRTC', {
    modelId: 'Lykon/dreamshaper-8',
    verdict: 'broken',
    why: 'Daydream no llegó a arrancar su pipeline',
    controlnets: [
      { kind: 'canny', model_id: 'lllyasviel/control_v11p_sd15_canny', preprocessor: 'canny' },
      { kind: 'depth', model_id: 'lllyasviel/control_v11f1p_sd15_depth', preprocessor: 'depth_tensorrt' },
      { kind: 'tile', model_id: 'lllyasviel/control_v11f1e_sd15_tile', preprocessor: 'feedback' },
    ],
    notes: 'SD1.5 con LCM-LoRA: la base que la comparativa propone para estilos por LoRA.',
    measured: 'No sacó ningún frame en 3,5 min el 23 sep: Daydream no tenía el pipeline caliente',
    hasIpAdapter: true,
  }),
  daydream('daydream-sd-turbo', 'SD-Turbo', 'StreamDiffusion · SD2.1 Turbo · WebRTC', {
    modelId: 'stabilityai/sd-turbo',
    verdict: 'unfit',
    why: 'Apenas transforma: devuelve el dibujo en plástico gris',
    controlnets: [
      { kind: 'canny', model_id: 'thibaud/controlnet-sd21-canny-diffusers', preprocessor: 'canny' },
      { kind: 'hed', model_id: 'thibaud/controlnet-sd21-hed-diffusers', preprocessor: 'soft_edge' },
      { kind: 'depth', model_id: 'thibaud/controlnet-sd21-depth-diffusers', preprocessor: 'depth_tensorrt' },
      { kind: 'color', model_id: 'thibaud/controlnet-sd21-color-diffusers', preprocessor: 'passthrough' },
    ],
    notes: 'El único con HED (borde suave). Rápido pero apenas transforma: incluso al máximo dio una casa de plástico gris.',
    measured: '490-504 ms de extremo a extremo · 20-22 fps · 1er frame 3,4 s en caliente',
  }),
  {
    id: 'lucy-realtime',
    provider: 'fal',
    endpoint: 'decart/lucy-2-5/realtime',
    label: 'Decart Lucy 2.5 realtime',
    engine: 'Lucy 2.5 · vídeo · WebRTC',
    transport: 'webrtc',
    inputSize: 704,
    steps: { min: 1, max: 1, default: 1 },
    guide: null,
    promptStyle: 'description',
    billing: { unit: 'active-second', usd: 0.02, note: '0,02 $ por segundo activo (10 veces klein).' },
    verdict: 'candidate',
    measured: '',
    notes: 'Vídeo a vídeo a ~30 fps: el lienzo entraría como stream con `canvas.captureStream()`. Falta saber si convierte un garabato en objeto o solo reestiliza.',
    unavailable: 'Va por WebRTC, no por frames: necesita su propio carril en el lab. Pendiente.',
    buildInput: () => ({}),
  },
];

/** The high-quality reveal fired once at the end of a round. */
export const FINISH_MODELS: readonly LiveModel[] = [
  klein('klein-4b-finish', 'fal-ai/flux-2/klein/4b/edit', 'FLUX.2 klein 4B edit', 'FLUX.2 [klein] 4B', {
    verdict: 'reference',
    measured: '1,8 s',
    notes: 'El render final más rápido de los medidos.',
    billing: { unit: 'megapixel', note: 'Por megapíxel de entrada y de salida.' },
  }),
  klein('klein-9b-finish', 'fal-ai/flux-2/klein/9b/edit', 'FLUX.2 klein 9B edit', 'FLUX.2 [klein] 9B', {
    verdict: 'candidate',
    measured: '',
    notes: 'Más detalle que el 4B.',
    billing: { unit: 'megapixel', note: 'Por megapíxel de entrada y de salida.' },
  }),
  {
    id: 'nano-banana-lite',
    provider: 'fal',
    endpoint: 'google/nano-banana-lite/edit',
    label: 'Nano Banana Lite edit',
    engine: 'Gemini image lite',
    transport: 'http',
    inputSize: 1024,
    steps: { min: 1, max: 1, default: 1 },
    guide: null,
    promptStyle: 'instruction',
    billing: { unit: 'image', note: 'Por imagen generada.' },
    verdict: 'candidate',
    measured: '',
    notes: 'Google anuncia menos de 2 s. Sin medir.',
    buildInput: ({ prompt, imageDataUrl, seed }) => ({
      prompt,
      image_urls: [imageDataUrl],
      aspect_ratio: '1:1',
      output_format: 'jpeg',
      sync_mode: true,
      seed,
    }),
  },
  {
    id: 'nano-banana-edit',
    provider: 'fal',
    endpoint: 'fal-ai/nano-banana/edit',
    label: 'Nano Banana edit',
    engine: 'Gemini image edit',
    transport: 'http',
    inputSize: 1024,
    steps: { min: 1, max: 1, default: 1 },
    guide: null,
    promptStyle: 'instruction',
    billing: { unit: 'image', note: 'Por imagen generada.' },
    verdict: 'finish-only',
    measured: '7,9 s',
    notes: 'Demasiado lento para un revelado de 3 a 6 s.',
    buildInput: ({ prompt, imageDataUrl }) => ({
      prompt,
      image_urls: [imageDataUrl],
      aspect_ratio: '1:1',
      num_images: 1,
      sync_mode: true,
    }),
  },
  {
    id: 'z-image-finish',
    provider: 'fal',
    endpoint: 'fal-ai/z-image/turbo/controlnet',
    label: 'Z-Image + canny (HQ)',
    engine: 'Z-Image Turbo · ControlNet',
    transport: 'http',
    inputSize: 1024,
    steps: { min: 8, max: 8, default: 8 },
    guide: null,
    promptStyle: 'description',
    billing: { unit: 'gpu-second', note: 'Por segundo de GPU.' },
    verdict: 'finish-only',
    measured: '4,4 s',
    notes: 'Render final barato que respeta el trazo.',
    buildInput: ({ prompt, imageDataUrl, seed }) => ({
      prompt,
      image_url: imageDataUrl,
      preprocess: 'canny',
      control_scale: 0.8,
      num_inference_steps: 8,
      image_size: 'square_hd',
      sync_mode: true,
      seed,
    }),
  },
];

export const VERDICT_LABEL: Record<Verdict, string> = {
  reference: 'Referencia',
  candidate: 'Sin medir',
  slow: 'Lento',
  unfit: 'No apto',
  broken: 'No funciona',
  'finish-only': 'Solo revelado',
};

/** Worth putting in front of a guest: it answers, fast, with a usable image. */
export const isLiveFit = (model: LiveModel) => model.verdict === 'reference' || model.verdict === 'candidate';

/** "Probar todos" measures everything that at least produces frames. */
export const isMeasurable = (model: LiveModel) => !model.unavailable && model.verdict !== 'broken' && model.verdict !== 'finish-only';

export const isStreamDiffusion = (model: LiveModel) => model.provider === 'daydream';

export const TRANSPORT_LABEL: Record<Transport, string> = { ws: 'WebSocket', http: 'HTTP', webrtc: 'WebRTC' };

export const isRealtimeEndpoint = (model: LiveModel) => REALTIME_ENDPOINTS.includes(model.endpoint);

export const findModel = (id: string, pool: readonly LiveModel[]) => pool.find(model => model.id === id) ?? pool[0];

/** Keeps the step count inside what the next model accepts. */
export const clampSteps = (model: LiveModel, steps: number) => {
  const { min, max, allowed } = model.steps;
  const clamped = Math.min(max, Math.max(min, steps));

  if (!allowed) return clamped;

  return allowed.reduce((best, value) => (Math.abs(value - clamped) < Math.abs(best - clamped) ? value : best));
};

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/**
 * One style, two languages:
 * - instruction (klein, Nano Banana): plain English sentences. Materials "rebuild" the
 *   sketch as a physical thing, media "redraw" it. The word, when there is one, only
 *   names what the sketch is: klein reads the drawing by itself (25 sep matrix).
 * - description (CLIP: SDXL-Turbo and the other diffusion models): the word first, then
 *   the style's short tags, because CLIP weighs the first tokens most and stops at 77.
 *
 * "Proteger la silueta" (guard) adds the backdrop of the style and, for instruction
 * models, the order to follow the drawn lines and add nothing. It started in
 * realtime-canvas: without it a lone doodle grows a scene around it. CLIP cannot read
 * "add nothing", so description models only get the framing.
 */
export const buildPrompt = (style: StylePreset, subject: string, model: LiveModel, guardSilhouette: boolean) => {
  const word = subject.trim();

  if (model.promptStyle === 'description') {
    const tags = word ? `${word}, ${style.tags}` : style.tags;

    return guardSilhouette ? `${tags}, centered, ${style.backdrop} background` : tags;
  }

  const sketch = word ? `this ${word} sketch` : 'this sketch';
  const transform =
    style.kind === 'material' ? `Rebuild ${sketch} as a physical object ${style.look}.` : `Redraw ${sketch} as ${style.look}.`;
  const parts = [transform, sentence(style.color), sentence(style.light)];

  if (guardSilhouette)
    parts.push(
      'Follow the drawn lines exactly: same outline, proportions and position, and add nothing that is not drawn.',
      sentence(`${style.backdrop} background, nothing else in the frame`),
    );

  return parts.join(' ');
};
