import { useCallback, useEffect, useRef, useState } from 'react';

import type { Settings } from '../data/model';
import { MODEL, buildInput } from '../data/model';
import { imageUrlFromResult, isBlankFrame, realtimeToken } from '../lib/fal';
import type { Metrics } from '../lib/metrics';
import { EMPTY_METRICS, pushSample } from '../lib/metrics';
import { rasterizeSvg } from '../lib/raster';
import type { RealtimeSocket } from '../lib/realtime-socket';
import { createRealtimeSocket } from '../lib/realtime-socket';

export type FrameMeta = {
  styleId: string;
  styleLabel: string;
  strength: number;
  rungLabel: string;
  hint: string;
};

export type LiveFrame = FrameMeta & {
  id: number;
  url: string;
  /** Round trip in ms; null for a late answer whose request was already written off. */
  latencyMs: number | null;
  at: number;
  prompt: string;
};

export type LiveRenderOptions = {
  enabled: boolean;
  prompt: string;
  settings: Settings;
  /** Gaussian blur on the raster, in px: the high end of AI Strength. */
  inputBlur: number;
  /** What the frame was asked for, kept with it in the history. */
  meta: FrameMeta;
  /** With an empty canvas there is nothing to interpret, so nothing is sent. */
  hasDrawing: boolean;
  getSvg: () => SVGSVGElement | null;
  /** Bumped by the canvas on every pointer move, so we only send changed frames. */
  dirtyRef: React.RefObject<number>;
};

export type LivePhase = 'off' | 'connecting' | 'cold' | 'live' | 'error';

/** Compute is billed while the guest is drawing; this long without ink counts as idle. */
const IDLE_AFTER_MS = 2000;

/** The loop polls this often; `settings.throttleMs` is the minimum spacing between sends. */
const TICK_MS = 40;

/** Frames kept for the history strip; older object URLs are revoked. */
const HISTORY = 18;

/**
 * The first frame of a session gets long: fal boots the model on demand and a cold
 * endpoint has taken over three minutes to answer its first request.
 */
const COLD_START_TIMEOUT_MS = 240000;

/**
 * On a warm socket a frame takes ~0,5-0,9 s, so one with no answer after a few
 * times the median is lost (fal dropped it, or the socket died quietly), not slow.
 * It is written off and the newest drawing goes out again; a second stall in a row
 * recycles the socket. Before this, a lost frame froze the loop for 15 s.
 */
const STALL_FLOOR_MS = 2500;
const STALL_CEILING_MS = 6000;
const STALL_FACTOR = 3;
const STALLS_BEFORE_RECYCLE = 2;

const median = (values: number[]) => {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * One frame in flight, always the newest drawing. With two, the frame the guest
 * is waiting for sits behind an older one and the felt lag doubles.
 */
export const useLiveRender = (options: LiveRenderOptions) => {
  const [frames, setFrames] = useState<LiveFrame[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [error, setError] = useState<string | null>(null);
  const [blankWarning, setBlankWarning] = useState<string | null>(null);
  const [waitingMs, setWaitingMs] = useState(0);
  const [warm, setWarm] = useState(false);

  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  /** Send time of the frame in flight, or null. Only one at a time. */
  const inFlight = useRef<number | null>(null);
  /** What the frame in flight asked for. */
  const inFlightMeta = useRef<{ meta: FrameMeta; prompt: string } | null>(null);
  /** Bumped on reset, so an answer from a previous session is ignored. */
  const generation = useRef(0);
  const frameId = useRef(0);
  const lastFrame = useRef(-1);
  const lastSend = useRef(0);
  const lastInk = useRef(0);
  const lastInkFrame = useRef(-1);
  const warmRef = useRef(false);
  /** Last raster had no real ink; answers still in flight for it are dropped. */
  const blankCanvas = useRef(false);
  /** A tick is rasterizing or sending: the 40 ms interval must not start a second one. */
  const ticking = useRef(false);
  /** Recent round trips on the socket, to tell a slow frame from a lost one. */
  const recent = useRef<number[]>([]);
  const stalls = useRef(0);
  /** Prompt of the last frame sent: a new style goes out without the old frame's memory. */
  const lastPrompt = useRef<string | null>(null);
  const connection = useRef<RealtimeSocket | null>(null);

  const push = useCallback((frame: LiveFrame | null) => {
    setFrames(current => {
      const next = frame ? [...current, frame] : [];
      const evicted = next.length > HISTORY ? next.splice(0, next.length - HISTORY) : current.filter(() => !frame);

      // Revoked a beat later: the crossfade still paints the previous frame.
      window.setTimeout(() => evicted.forEach(old => old.url.startsWith('blob:') && URL.revokeObjectURL(old.url)), 1500);

      return next;
    });
  }, []);

  /** How long the frame in flight may take before it counts as lost. */
  const stallTimeout = () => {
    if (!warmRef.current) return COLD_START_TIMEOUT_MS;

    return Math.min(STALL_CEILING_MS, Math.max(STALL_FLOOR_MS, STALL_FACTOR * median(recent.current)));
  };

  const receive = useCallback(
    (result: unknown, gen: number) => {
      if (gen !== generation.current) return;

      const sentAt = inFlight.current;
      const asked = inFlightMeta.current;

      inFlight.current = null;
      inFlightMeta.current = null;
      warmRef.current = true;
      setWarm(true);

      const url = imageUrlFromResult(result);

      // The guest cleared or erased while this frame was out: do not paint it.
      if (!url || blankCanvas.current || !latest.current.hasDrawing) return;

      const now = performance.now();
      const latency = sentAt === null ? null : now - sentAt;

      // A late answer to a frame already written off still paints (it is newer than
      // what is on screen) but its round trip is unknown, so it is not a sample.
      if (latency !== null) {
        stalls.current = 0;
        recent.current = [...recent.current, latency].slice(-12);
        setMetrics(current => pushSample(current, latency, now));
      }

      // A black frame (safety filter) never replaces the last good one: the guest keeps
      // seeing their drawing interpreted, and the badge says a frame was blocked.
      void isBlankFrame(url).then(blank => {
        if (gen !== generation.current) return;

        if (!blank) {
          frameId.current += 1;
          push({ ...(asked?.meta ?? latest.current.meta), prompt: asked?.prompt ?? latest.current.prompt, id: frameId.current, url, latencyMs: latency, at: Date.now() });
          setError(null);
          setBlankWarning(null);

          return;
        }

        if (url.startsWith('blob:')) URL.revokeObjectURL(url);

        setMetrics(current => ({ ...current, blocked: current.blocked + 1 }));
        setBlankWarning('fal ha devuelto un frame en negro (filtro de seguridad). Se mantiene el anterior.');
      });
    },
    [push],
  );

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current = null;
    inFlightMeta.current = null;
    lastFrame.current = -1;
    lastPrompt.current = null;
    recent.current = [];
    stalls.current = 0;
    warmRef.current = false;
    setWarm(false);
    setMetrics(EMPTY_METRICS);
    setError(null);
    setBlankWarning(null);
    push(null);
  }, [push]);

  /** Starts a fresh measurement without dropping the warm socket or the frames on screen. */
  const clearMetrics = useCallback(() => setMetrics(EMPTY_METRICS), []);

  const { enabled } = options;

  // One socket while the loop is on, opened now so the first stroke finds it warm.
  useEffect(() => {
    if (!enabled) return;

    const gen = generation.current;

    connection.current = createRealtimeSocket({
      app: MODEL.endpoint,
      token: realtimeToken,
      // The socket does not echo request ids; with one frame in flight it needs none.
      onResult: result => receive(result, gen),
      onError: message => {
        if (gen !== generation.current) return;

        inFlight.current = null;
        inFlightMeta.current = null;
        setError(message);
        setMetrics(current => ({ ...current, errors: current.errors + 1 }));
      },
      // The frame in flight died with the socket: resend the newest drawing on the next one.
      onDrop: reason => {
        if (gen !== generation.current || inFlight.current === null) return;

        inFlight.current = null;
        inFlightMeta.current = null;
        lastFrame.current = -1;
        setMetrics(current => ({ ...current, dropped: current.dropped + 1 }));
        console.info(`[live] ${reason}: se reenvía el último dibujo`);
      },
    });

    return () => {
      connection.current?.close();
      connection.current = null;
    };
  }, [enabled, receive]);

  const send = useCallback((imageDataUrl: string) => {
    const current = latest.current;

    if (!connection.current) return;

    // With memory on, the first frame of a new style would still blend the old
    // style's latent and the change would creep in over several frames.
    const newStyle = lastPrompt.current !== null && lastPrompt.current !== current.prompt;

    lastPrompt.current = current.prompt;

    const settings = newStyle ? { ...current.settings, memory: 0 } : current.settings;
    const input = buildInput({ prompt: current.prompt, imageDataUrl, settings });
    const sentAt = performance.now();

    inFlight.current = sentAt;
    inFlightMeta.current = { meta: current.meta, prompt: current.prompt };
    lastSend.current = sentAt;
    setMetrics(previous => ({ ...previous, sent: previous.sent + 1 }));
    connection.current.send(input);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      const current = latest.current;
      const frame = current.dirtyRef.current;
      const now = performance.now();

      if (frame !== lastInkFrame.current) {
        lastInkFrame.current = frame;
        lastInk.current = now;
      }

      // An empty canvas would just let the model invent something from the prompt.
      if (!current.hasDrawing) {
        blankCanvas.current = true;

        if (lastFrame.current !== frame) {
          lastFrame.current = frame;
          push(null);
        }

        return;
      }

      if (inFlight.current !== null) {
        if (now - inFlight.current < stallTimeout()) return;

        // Written off as lost: resend the newest drawing even if nothing changed since.
        inFlight.current = null;
        inFlightMeta.current = null;
        lastFrame.current = -1;
        stalls.current += 1;
        setMetrics(previous => ({ ...previous, timedOut: previous.timedOut + 1 }));

        // Twice in a row with the socket still open: fal is not answering on it any more.
        if (stalls.current >= STALLS_BEFORE_RECYCLE) {
          stalls.current = 0;
          connection.current?.recycle('dos frames sin respuesta');
        }
      }

      if (frame === lastFrame.current) return;
      if (now - lastSend.current < current.settings.throttleMs) return;

      const svg = current.getSvg();

      if (!svg) return;

      lastFrame.current = frame;

      const raster = await rasterizeSvg(svg, MODEL.inputSize, MODEL.jpegQuality, current.inputBlur);

      if (cancelled || !raster) return;

      // Specks and eraser leftovers are not a drawing: keep the light box empty.
      if (!raster.dataUrl) {
        blankCanvas.current = true;
        push(null);

        return;
      }

      blankCanvas.current = false;
      send(raster.dataUrl);
    };

    // Rasterizing a busy canvas can outlast the 40 ms tick. Without this guard two
    // ticks each sent a frame, the answers came back mismatched and one could be
    // dropped by fal's buffer, which froze the loop until the timeout.
    const loop = window.setInterval(() => {
      if (ticking.current) return;

      ticking.current = true;
      void tick()
        .catch(() => undefined)
        .finally(() => {
          ticking.current = false;
        });
    }, TICK_MS);

    // Billing clock and the "waiting for an answer" read-out, four times a second is plenty.
    const clock = window.setInterval(() => {
      const now = performance.now();

      if (latest.current.hasDrawing && !blankCanvas.current && now - lastInk.current < IDLE_AFTER_MS)
        setMetrics(previous => ({ ...previous, sessionSeconds: previous.sessionSeconds + 0.25 }));

      setWaitingMs(inFlight.current === null ? 0 : now - inFlight.current);
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(loop);
      window.clearInterval(clock);
      setWaitingMs(0);
    };
  }, [enabled, push, send]);

  // Stopping the loop keeps the frames on screen; the next start measures afresh.
  useEffect(() => {
    if (enabled) return;

    generation.current += 1;
    inFlight.current = null;
    inFlightMeta.current = null;
    lastFrame.current = -1;
    lastPrompt.current = null;
    warmRef.current = false;
  }, [enabled]);

  // `warm` only means something while the loop is on; a restart starts cold.
  const [warmFor, setWarmFor] = useState(false);

  if (warmFor !== enabled) {
    setWarmFor(enabled);
    if (!enabled) setWarm(false);
  }

  useEffect(
    () => () => {
      setFrames(current => {
        current.forEach(frame => frame.url.startsWith('blob:') && URL.revokeObjectURL(frame.url));

        return [];
      });
    },
    [],
  );

  const output = frames.at(-1) ?? null;

  const phase: LivePhase = !enabled
    ? 'off'
    : error && !output
      ? 'error'
      : warm
        ? 'live'
        : metrics.sent > 0
          ? 'cold'
          : 'connecting';

  return { frames, output, metrics, error: enabled ? error : null, blankWarning, reset, clearMetrics, waitingMs, warm, phase };
};
