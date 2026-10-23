import { createBroadcast, createPlayer } from '@daydreamlive/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { InputLook } from '../data/stream';
import { isDarkLook } from '../data/stream';
import type { Metrics } from '../lib/metrics';
import { EMPTY_METRICS } from '../lib/metrics';
import { rasterizeSvg } from '../lib/raster';
import type { LivePhase } from './use-live-render';

export type DaydreamStreamOptions = {
  enabled: boolean;
  /** Stream params from `model.buildInput`: created with them, hot-patched when they change. */
  params: Record<string, unknown>;
  hasDrawing: boolean;
  /** 0-1: colour noise painted under the strokes before sending. */
  texture: number;
  /** How the drawing is painted into the input video. */
  look: InputLook;
  getSvg: () => SVGSVGElement | null;
  dirtyRef: React.RefObject<number>;
};

/** Chromium's insertable streams; not in TypeScript's DOM lib yet. */
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack });
  readable: ReadableStream<VideoFrame>;
}

type Broadcast = ReturnType<typeof createBroadcast>;
type Player = ReturnType<typeof createPlayer>;

const SIZE = 512;
const FEED_FPS = 30;
/** Arrivals and luma are sampled every video frame but pushed to React at this pace. */
const FLUSH_MS = 250;
/** Params patched while the pipeline boots answer "Stream not ready yet"; this long between retries. */
const PATCH_RETRY_MS = 2000;
/**
 * Only coalesces a slider drag. A style click reaches the output in ~0,7 s, of which
 * the PATCH round trip is ~0,2 s: at 250 ms this wait was a third of the switch.
 */
const PATCH_DEBOUNCE_MS = 60;
/** Livepeer keeps answering 404 on WHEP until the pipeline is up; cold starts run to minutes. */
const PLAYER_ATTEMPTS = 120;

/** This long of pure black output, with a drawing on the canvas, counts as a stuck stream. */
const BLACKOUT_MS = 3000;

/** Daydream's gateway status is where a server-side cut is explained. */
const STATUS_POLL_MS = 3000;

const GATEWAY_ERRORS: Record<string, string> = {
  credit_exhaustion: 'la cuenta de Daydream se ha quedado sin créditos. Hay que recargar en app.daydream.live',
};

const explainGatewayError = (message: string) => {
  const code = Object.keys(GATEWAY_ERRORS).find(key => message.includes(key));

  return `Daydream ha cortado el stream: ${code ? GATEWAY_ERRORS[code] : message} (${message}).`;
};

/** Smooth colour blobs: a tiny random image scaled up with smoothing. */
const makeTexture = () => {
  const small = document.createElement('canvas');
  const big = document.createElement('canvas');

  small.width = 6;
  small.height = 6;
  big.width = SIZE;
  big.height = SIZE;

  const tiny = small.getContext('2d');
  const wide = big.getContext('2d');

  if (!tiny || !wide) return big;

  for (let x = 0; x < 6; x += 1)
    for (let y = 0; y < 6; y += 1) {
      tiny.fillStyle = `hsl(${Math.random() * 360} 70% ${55 + Math.random() * 30}%)`;
      tiny.fillRect(x, y, 1, 1);
    }

  wide.imageSmoothingEnabled = true;
  wide.imageSmoothingQuality = 'high';
  wide.drawImage(small, 0, 0, SIZE, SIZE);

  return big;
};

/** Smooth greyscale noise: three octaves of tiny random images scaled up with smoothing. */
const makeNoise = () => {
  const canvas = document.createElement('canvas');

  canvas.width = SIZE;
  canvas.height = SIZE;

  const context = canvas.getContext('2d');

  if (!context) return canvas;

  context.fillStyle = '#808080';
  context.fillRect(0, 0, SIZE, SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  for (const [cells, alpha] of [[8, 0.8], [32, 0.5], [128, 0.3]] as const) {
    const small = document.createElement('canvas');
    const tiny = small.getContext('2d');

    small.width = cells;
    small.height = cells;

    if (!tiny) continue;

    for (let x = 0; x < cells; x += 1)
      for (let y = 0; y < cells; y += 1) {
        tiny.fillStyle = `hsl(0 0% ${25 + Math.random() * 75}%)`;
        tiny.fillRect(x, y, 1, 1);
      }

    context.globalAlpha = alpha;
    context.drawImage(small, 0, 0, SIZE, SIZE);
  }

  context.globalAlpha = 1;

  return canvas;
};

/**
 * The drawing as light-on-black for the dark looks. Ink coverage becomes alpha
 * (coloured pens count by their darkest channel), then the fill goes in through it:
 * white, mid grey, or the noise field.
 */
const makeStrokeLayer = (drawing: HTMLImageElement, look: InputLook, noise: HTMLCanvasElement) => {
  const layer = document.createElement('canvas');

  layer.width = SIZE;
  layer.height = SIZE;

  const context = layer.getContext('2d', { willReadFrequently: true });

  if (!context) return layer;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, SIZE, SIZE);
  context.drawImage(drawing, 0, 0, SIZE, SIZE);

  const pixels = context.getImageData(0, 0, SIZE, SIZE);
  const { data } = pixels;
  const shade = look === 'grey' ? 128 : 255;

  for (let index = 0; index < data.length; index += 4) {
    const coverage = 255 - Math.min(data[index], data[index + 1], data[index + 2]);

    data[index] = shade;
    data[index + 1] = shade;
    data[index + 2] = shade;
    data[index + 3] = coverage;
  }

  context.putImageData(pixels, 0, 0);

  if (look === 'noise') {
    context.globalCompositeOperation = 'source-in';
    context.drawImage(noise, 0, 0);
    context.globalCompositeOperation = 'source-over';
  }

  return layer;
};

const PROBE = {
  rounds: 5,
  /** Quiet time before each round so the output settles back on the drawing. */
  settleMs: 1500,
  /** A round with no visible response after this long counts as timed out. */
  timeoutMs: 5000,
  /** The output luma must move by at least this much (0-255) toward the flash to count as the answer. */
  minDrop: 40,
};

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/**
 * Everything but what is fixed when the stream is created. Prompt, seed, guidance,
 * delta, `t_index_list` and ControlNet weights hot-swap; canny thresholds and the
 * safety checker make Daydream reload the pipeline (~30 s) on its own.
 * `model_id` is left out of the diff only: every PATCH carries it again.
 */
const patchParams = ({ model_id: _model, width: _width, height: _height, ip_adapter: _ipAdapter, ...rest }: Record<string, unknown>) =>
  rest;

/** Each param serialised on its own, so two sets can be compared key by key. */
const snapshot = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, JSON.stringify(value)]));

const readError = async (response: Response) => {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as { error?: string; message?: string };

    return body.error ?? body.message ?? text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
};

/**
 * StreamDiffusion on Daydream: the drawing is painted into an offscreen canvas,
 * sent as a 30 fps WebRTC video (WHIP) and the styled video comes back (WHEP).
 * There is no request per frame, so the fal per-request floor does not apply.
 *
 * Latency cannot be read off a frame the way it is for fal, because frames are not
 * paired with answers. `probe()` measures it glass to glass instead: it flashes
 * the input to a flat frame (black, or white on the dark looks) and times how long
 * the output takes to follow.
 */
export const useDaydreamStream = (options: DaydreamStreamOptions) => {
  const [phase, setPhase] = useState<LivePhase>('off');
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [video, setVideo] = useState<MediaStream | null>(null);
  const [still, setStill] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [waitingMs, setWaitingMs] = useState(0);
  /** The output dropped and the player is reconnecting (e.g. Daydream reloading the pipeline). */
  const [buffering, setBuffering] = useState(false);
  /** The exact video sent to Daydream, for the thumbnail on the canvas. */
  const [input, setInput] = useState<MediaStream | null>(null);
  /**
   * The output has been pure black for a while with a drawing on the canvas. Seen once
   * on 25 sep 2026: a stream stayed black at full fps until it was recreated.
   */
  const [blackout, setBlackout] = useState(false);

  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  const streamId = useRef<string | null>(null);
  /** What the running pipeline has, so a patch carries only what changed. */
  const applied = useRef<Record<string, string>>({});
  const ready = useRef(false);
  /** While true the feed sends a flat frame (black, or white on the dark looks) instead of the drawing. */
  const probeFlash = useRef(false);
  /** Mean luma of each output frame, newest last, with its arrival time. */
  const luma = useRef<{ at: number; value: number }[]>([]);
  const arrivals = useRef<number[]>([]);
  const probeAbort = useRef<AbortController | null>(null);

  const { enabled } = options;
  const active = enabled;

  const clearMetrics = useCallback(() => {
    arrivals.current = [];
    setMetrics(current => ({ ...EMPTY_METRICS, firstFrameMs: current.firstFrameMs }));
  }, []);

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let broadcast: Broadcast | null = null;
    let player: Player | null = null;
    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
    let tap: MediaStreamTrack | null = null;

    const startedAt = performance.now();
    const canvas = document.createElement('canvas');
    // Opaque on purpose: WebRTC drops alpha, and transparent pixels arrive as black.
    const context = canvas.getContext('2d', { alpha: false });
    const probeCanvas = document.createElement('canvas');
    const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });

    canvas.width = SIZE;
    canvas.height = SIZE;
    probeCanvas.width = 16;
    probeCanvas.height = 16;

    if (!context || !probeContext) return;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, SIZE, SIZE);

    const feed = canvas.captureStream(FEED_FPS);
    const texture = makeTexture();
    const noise = makeNoise();

    setInput(feed);

    // The drawing is re-rasterised only when it changes, but repainted every tick:
    // captureStream emits a frame per paint, and the pipeline needs a steady input.
    let drawing: HTMLImageElement | null = null;
    let lastFrame = -1;
    let rasterizing = false;
    /** The dark looks' stroke layer, rebuilt only when the drawing or the look changes. */
    let strokes: { source: HTMLImageElement; look: InputLook; layer: HTMLCanvasElement } | null = null;

    const paint = window.setInterval(() => {
      const current = latest.current;
      const frame = current.dirtyRef.current;
      const svg = current.getSvg();

      if (frame !== lastFrame && !rasterizing && svg) {
        lastFrame = frame;
        rasterizing = true;

        void rasterizeSvg(svg, SIZE, 0.92)
          .then(raster => (raster?.dataUrl ? loadImage(raster.dataUrl) : null))
          .then(image => {
            drawing = image;
          })
          .catch(() => undefined)
          .finally(() => {
            rasterizing = false;
          });
      }

      const dark = isDarkLook(current.look);

      if (probeFlash.current) {
        context.fillStyle = dark ? '#ffffff' : '#000000';
        context.fillRect(0, 0, SIZE, SIZE);

        return;
      }

      context.fillStyle = dark ? '#000000' : '#ffffff';
      context.fillRect(0, 0, SIZE, SIZE);

      const textureAmount = current.texture;

      if (textureAmount > 0) {
        context.globalAlpha = textureAmount;
        context.drawImage(texture, 0, 0);
        context.globalAlpha = 1;
      }

      if (!drawing || !current.hasDrawing) return;

      if (!dark) {
        // Multiply keeps the ink and lets the texture show through the white paper.
        context.globalCompositeOperation = 'multiply';
        context.drawImage(drawing, 0, 0, SIZE, SIZE);
        context.globalCompositeOperation = 'source-over';

        return;
      }

      if (strokes?.source !== drawing || strokes.look !== current.look)
        strokes = { source: drawing, look: current.look, layer: makeStrokeLayer(drawing, current.look, noise) };

      context.drawImage(strokes.layer, 0, 0);
    }, 1000 / FEED_FPS);

    const flush = window.setInterval(() => {
      const now = performance.now();

      // A stalled output must read as 0 fps, not as the last rate it had.
      arrivals.current = arrivals.current.filter(at => now - at < 3000);

      setMetrics(current => ({
        ...current,
        arrivals: arrivals.current.slice(-60),
        sessionSeconds: ready.current ? current.sessionSeconds + FLUSH_MS / 1000 : current.sessionSeconds,
      }));
      setWaitingMs(ready.current ? 0 : now - startedAt);

      // Mean luma under 2 for the last 3 s while there is a drawing and no probe flash.
      const recentLuma = luma.current.filter(sample => now - sample.at < BLACKOUT_MS);

      setBlackout(
        ready.current &&
          latest.current.hasDrawing &&
          !probeFlash.current &&
          recentLuma.length > 10 &&
          now - (luma.current[0]?.at ?? now) > BLACKOUT_MS &&
          recentLuma.every(sample => sample.value < 2),
      );
    }, FLUSH_MS);

    let lastStill = 0;

    const onFrame = (frame: VideoFrame) => {
      const now = performance.now();

      probeContext.drawImage(frame, 0, 0, 16, 16);

      const { data } = probeContext.getImageData(0, 0, 16, 16);
      let total = 0;

      for (let index = 0; index < data.length; index += 4)
        total += 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

      luma.current = [...luma.current.slice(-120), { at: now, value: total / (data.length / 4) }];
      arrivals.current = [...arrivals.current.slice(-120), now];

      if (!ready.current) {
        ready.current = true;
        setPhase('live');
        setMetrics(current => ({ ...current, firstFrameMs: now - startedAt }));
      }

      // A still of the output every couple of seconds, for result thumbnails.
      if (now - lastStill > 2000) {
        lastStill = now;

        const shot = document.createElement('canvas');

        shot.width = frame.displayWidth;
        shot.height = frame.displayHeight;
        shot.getContext('2d')?.drawImage(frame, 0, 0);
        setStill(shot.toDataURL('image/jpeg', 0.8));
      }
    };

    /**
     * Frames are read as they are decoded, off a clone of the track. A video
     * element's frame callback would stop whenever the window is not painting.
     */
    const watch = async (track: MediaStreamTrack) => {
      const own = track.clone();
      const ownReader = new MediaStreamTrackProcessor({ track: own }).readable.getReader();

      tap = own;
      reader = ownReader;

      // Ends when the track does: the player then reconnects with a new stream.
      while (!disposed) {
        const { value, done } = await ownReader.read();

        if (done || !value) break;

        try {
          onFrame(value);
        } finally {
          value.close();
        }
      }
    };

    /** Shows a (re)connected output and starts counting its frames. */
    const attach = (output: MediaStream) => {
      const track = output.getVideoTracks()[0];

      if (!track) return;

      void reader?.cancel().catch(() => undefined);
      tap?.stop();
      setVideo(output);
      setBuffering(false);
      void watch(track);
    };

    const start = async () => {
      setPhase('connecting');
      setError(null);

      const response = await fetch('/api/daydream/streams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pipeline: 'streamdiffusion', params: latest.current.params }),
      });

      if (!response.ok) throw new Error(`Daydream no creó el stream: ${await readError(response)}`);

      const created = (await response.json()) as { id: string; whip_url: string };

      if (disposed) return;

      streamId.current = created.id;
      applied.current = snapshot(patchParams(latest.current.params));
      broadcast = createBroadcast({
        whipUrl: created.whip_url,
        stream: feed,
        video: { bitrate: 1_500_000, maxFramerate: FEED_FPS },
        // Livepeer drops the ingest every few seconds on bad days; the SDK resumes it.
        reconnect: { maxAttempts: 30 },
      });
      broadcast.on('error', fault => !disposed && setError(`Envío: ${fault.message}`));

      await broadcast.connect();

      if (disposed) return;

      setPhase('cold');

      const whepUrl = broadcast.whepUrl;

      if (!whepUrl) throw new Error('Livepeer no devolvió la URL de reproducción (WHEP).');

      if (!('MediaStreamTrackProcessor' in window))
        throw new Error('Este navegador no deja leer los frames del stream: usa Chrome, Brave o Edge.');

      const receiver = createPlayer(whepUrl, { reconnect: { maxAttempts: PLAYER_ATTEMPTS, baseDelayMs: 1000 } });

      player = receiver;
      receiver.on('error', fault => !disposed && setError(`Recepción: ${fault.message}`));
      // When the output drops, the SDK reconnects with a brand-new MediaStream.
      receiver.on('stateChange', state => {
        if (disposed) return;

        if (state === 'buffering') setBuffering(true);
        if (state === 'playing' && receiver.stream) attach(receiver.stream);
      });

      await receiver.connect();

      if (disposed || !receiver.stream) return;

      attach(receiver.stream);
    };

    // WebRTC only sees the peer go quiet; the reason lives in the gateway status.
    const status = window.setInterval(async () => {
      const id = streamId.current;

      if (!id || disposed) return;

      const body = await fetch(`/api/daydream/streams/${id}/status`)
        .then(response => (response.ok ? response.json() : null))
        .catch(() => null);
      const message = body?.data?.gateway_status?.error?.error_message as string | undefined;

      if (!message || disposed) return;

      setError(explainGatewayError(message));
      setPhase('error');
      window.clearInterval(status);
    }, STATUS_POLL_MS);

    start().catch(fault => {
      if (disposed) return;

      setError((fault as Error).message);
      setPhase('error');
      setMetrics(current => ({ ...current, errors: current.errors + 1 }));
    });

    return () => {
      disposed = true;
      probeAbort.current?.abort();
      window.clearInterval(paint);
      window.clearInterval(flush);
      window.clearInterval(status);
      void reader?.cancel().catch(() => undefined);
      tap?.stop();
      feed.getTracks().forEach(track => track.stop());
      void broadcast?.stop();
      void player?.stop();
      streamId.current = null;
      applied.current = {};
      ready.current = false;
      probeFlash.current = false;
      luma.current = [];
      arrivals.current = [];
      setVideo(null);
      setInput(null);
      setBlackout(false);
      setBuffering(false);
      setStill(null);
      setPhase('off');
      setWaitingMs(0);
      setMetrics(EMPTY_METRICS);
    };
  }, [active]);

  const wanted = JSON.stringify(snapshot(patchParams(options.params)));
  /** One PATCH at a time: two in flight can land in the wrong order and leave the old value on. */
  const patching = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!active || phase !== 'live') return;

    let cancelled = false;
    let timer = 0;

    const patch = async () => {
      const previous = patching.current;
      let release = () => {};

      patching.current = new Promise<void>(resolve => {
        release = resolve;
      });

      try {
        await previous;
        await send();
      } finally {
        release();
      }
    };

    const send = async () => {
      const id = streamId.current;

      if (cancelled || !id) return;

      // Only what changed: resending an untouched field Daydream treats as structural
      // (safety checker, preprocessor params) could reload the pipeline for nothing.
      const target = JSON.parse(wanted) as Record<string, string>;
      const changed = Object.keys(target).filter(key => target[key] !== applied.current[key]);

      if (!changed.length) return;

      // `model_id` goes in every PATCH, as in Daydream's own examples. Without it the
      // API answers 200 but drops about half the updates when they come a second or
      // two apart (24 sep 2026: 3 of 6 styles lost; with it, 8 of 8 at 1 s apart).
      const params = {
        model_id: latest.current.params.model_id,
        ...Object.fromEntries(changed.map(key => [key, JSON.parse(target[key])])),
      };
      const response = await fetch(`/api/daydream/streams/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params }),
      }).catch(() => null);

      // Recorded even if a newer change cancelled this effect meanwhile: the server has
      // these values now, and resending a ControlNet list could reload the pipeline.
      if (response?.ok && streamId.current === id) {
        applied.current = { ...applied.current, ...Object.fromEntries(changed.map(key => [key, target[key]])) };

        return;
      }

      if (cancelled) return;

      // Right after the first frame the API can still say "not ready": try again.
      if (response?.status === 404) {
        timer = window.setTimeout(() => void patch(), PATCH_RETRY_MS);

        return;
      }

      setError(response ? `No se pudo actualizar el stream: ${await readError(response)}` : 'Daydream no responde.');
    };

    timer = window.setTimeout(() => void patch(), PATCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, wanted, phase]);

  /**
   * Glass-to-glass latency: flash the input flat and time how long the output
   * takes to follow. Covers capture, encode, both network legs, the model and
   * decode, i.e. what a guest feels between a stroke and its answer.
   */
  const probe = useCallback(async (rounds = PROBE.rounds) => {
    if (!ready.current) return;

    probeAbort.current?.abort();

    const controller = new AbortController();

    probeAbort.current = controller;
    setProbing(true);

    try {
      for (let round = 0; round < rounds && !controller.signal.aborted; round += 1) {
        await sleep(PROBE.settleMs);

        const recent = luma.current.slice(-10);

        if (!recent.length) continue;

        const baseline = recent.reduce((total, sample) => total + sample.value, 0) / recent.length;
        // On the dark looks the flash is white, and the answer is the output brightening.
        const brighten = isDarkLook(latest.current.look);
        const reached = brighten
          ? (value: number) => value > baseline + Math.max(PROBE.minDrop, (255 - baseline) * 0.35)
          : (value: number) => value < baseline - Math.max(PROBE.minDrop, baseline * 0.35);
        const sentAt = performance.now();

        probeFlash.current = true;
        setMetrics(current => ({ ...current, sent: current.sent + 1 }));

        let answeredAt: number | null = null;

        while (!controller.signal.aborted && performance.now() - sentAt < PROBE.timeoutMs) {
          answeredAt = luma.current.find(sample => sample.at > sentAt && reached(sample.value))?.at ?? null;

          if (answeredAt) break;

          await sleep(10);
        }

        probeFlash.current = false;

        const latency = answeredAt === null ? null : answeredAt - sentAt;

        setMetrics(current =>
          latency === null
            ? { ...current, timedOut: current.timedOut + 1 }
            : { ...current, received: current.received + 1, samples: [...current.samples, latency].slice(-60) },
        );
      }
    } finally {
      probeFlash.current = false;
      setProbing(false);
    }
  }, []);

  useEffect(() => () => probeAbort.current?.abort(), []);

  return { phase, error, metrics, video, input, still, probing, probe, clearMetrics, waitingMs, buffering, blackout };
};
