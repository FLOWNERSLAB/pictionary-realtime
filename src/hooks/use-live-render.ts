import { useCallback, useEffect, useRef, useState } from 'react';

import type { LiveModel } from '../data/models';
import { errorMessage, fal, flaggedAsNsfw, imageUrlFromResult, isBlankFrame, realtimeToken } from '../lib/fal';
import type { Metrics } from '../lib/metrics';
import { EMPTY_METRICS, pushSample } from '../lib/metrics';
import { rasterizeSvg } from '../lib/raster';
import type { RealtimeSocket } from '../lib/realtime-socket';
import { createRealtimeSocket } from '../lib/realtime-socket';

export type LiveRenderOptions = {
  model: LiveModel;
  enabled: boolean;
  /** Minimum milliseconds between two frames sent to the model. */
  throttleMs: number;
  prompt: string;
  negative: string;
  steps: number;
  strength: number;
  feedback: number;
  seed: number;
  scheduleMu: number;
  interpolate: boolean;
  hd: boolean;
  /** With an empty canvas there is nothing to interpret, so nothing is sent. */
  hasDrawing: boolean;
  getSvg: () => SVGSVGElement | null;
  /** Bumped by the canvas on every pointer move, so we only send changed frames. */
  dirtyRef: React.RefObject<number>;
};

export type LivePhase = 'off' | 'connecting' | 'cold' | 'live' | 'error';

/** Compute is billed while the guest is drawing; this long without ink counts as idle. */
const IDLE_AFTER_MS = 2000;

/** The loop polls this often; `throttleMs` is the minimum spacing between sends. */
const TICK_MS = 40;

/**
 * A frame with no answer after this long is written off, so the loop never wedges.
 * The first frame of a session gets far longer: fal boots the model on demand and
 * a cold endpoint has taken over three minutes to answer its first request.
 */
const FRAME_TIMEOUT_MS = 15000;
const COLD_START_TIMEOUT_MS = 240000;

/**
 * On a warm socket a frame takes ~0,5-0,9 s, so one with no answer after a few
 * times the median is lost (fal dropped it, or the socket died quietly), not slow.
 * It is written off and the newest drawing goes out again; a second stall in a row
 * recycles the socket. Before this, a lost frame froze the loop for the full 15 s.
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
  const [output, setOutput] = useState<string | null>(null);
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
  /** Bumped on reset, so an answer from a previous model or session is ignored. */
  const generation = useRef(0);
  const lastFrame = useRef(-1);
  const lastSend = useRef(0);
  const lastInk = useRef(0);
  const lastInkFrame = useRef(-1);
  const objectUrl = useRef<string | null>(null);
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

  const publish = useCallback((url: string | null) => {
    // Revoked a beat later: the crossfade still paints the previous frame.
    const previous = objectUrl.current;

    if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1500);

    objectUrl.current = url?.startsWith('blob:') ? url : null;
    setOutput(url);
  }, []);

  const frameTimeout = () => (warmRef.current ? FRAME_TIMEOUT_MS : COLD_START_TIMEOUT_MS);

  /** How long the frame in flight may take before it counts as lost. */
  const stallTimeout = () => {
    if (!warmRef.current) return COLD_START_TIMEOUT_MS;
    if (latest.current.model.transport !== 'ws') return FRAME_TIMEOUT_MS;

    return Math.min(STALL_CEILING_MS, Math.max(STALL_FLOOR_MS, STALL_FACTOR * median(recent.current)));
  };

  const receive = useCallback(
    (result: unknown, sentAt: number | null, gen: number) => {
      if (gen !== generation.current) return;

      inFlight.current = null;
      warmRef.current = true;
      setWarm(true);

      const url = imageUrlFromResult(result);

      // The guest cleared or erased while this frame was out: do not paint it.
      if (!url || blankCanvas.current || !latest.current.hasDrawing) return;

      const now = performance.now();

      // A late answer to a frame already written off still paints (it is newer than
      // what is on screen) but its round trip is unknown, so it is not a sample.
      if (sentAt !== null) {
        const latency = now - sentAt;

        stalls.current = 0;
        recent.current = [...recent.current, latency].slice(-12);
        setMetrics(current => pushSample(current, latency, now));
      }

      // A black frame (safety filter) never replaces the last good one: the guest keeps
      // seeing their drawing interpreted, and the badge says a frame was blocked.
      void isBlankFrame(url).then(blank => {
        if (gen !== generation.current) return;

        if (!blank) {
          publish(url);
          setError(null);
          setBlankWarning(null);

          return;
        }

        if (url.startsWith('blob:')) URL.revokeObjectURL(url);

        setMetrics(current => ({ ...current, blocked: current.blocked + 1 }));
        setBlankWarning(
          flaggedAsNsfw(result)
            ? 'El filtro NSFW del proveedor ha devuelto un frame en negro. Se mantiene el anterior.'
            : 'El modelo ha devuelto un frame en negro. Se mantiene el anterior.',
        );
      });
    },
    [publish],
  );

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current = null;
    lastFrame.current = -1;
    lastPrompt.current = null;
    recent.current = [];
    stalls.current = 0;
    warmRef.current = false;
    setWarm(false);
    setMetrics(EMPTY_METRICS);
    setError(null);
    setBlankWarning(null);
    publish(null);
  }, [publish]);

  /** Starts a fresh measurement without dropping the warm connection or the frame on screen. */
  const clearMetrics = useCallback(() => setMetrics(EMPTY_METRICS), []);

  const { model, enabled } = options;
  const transport = model.transport;

  // Switching models wipes the panel: otherwise the previous model's last frame stays
  // on screen while the new one warms up, and looks like the new model's answer.
  useEffect(() => {
    reset();
  }, [model.id, reset]);

  // One socket per model while the loop is on, opened now so the first stroke finds it warm.
  const connection = useRef<RealtimeSocket | null>(null);

  useEffect(() => {
    if (!enabled || transport !== 'ws') return;

    const gen = generation.current;

    connection.current = createRealtimeSocket({
      app: model.endpoint,
      token: realtimeToken,
      // The socket does not echo request ids; with one frame in flight it needs none.
      onResult: result => receive(result, inFlight.current, gen),
      onError: message => {
        if (gen !== generation.current) return;

        inFlight.current = null;
        setError(message);
        setMetrics(current => ({ ...current, errors: current.errors + 1 }));
      },
      // The frame in flight died with the socket: resend the newest drawing on the next one.
      onDrop: reason => {
        if (gen !== generation.current || inFlight.current === null) return;

        inFlight.current = null;
        lastFrame.current = -1;
        setMetrics(current => ({ ...current, dropped: current.dropped + 1 }));
        console.info(`[live] ${reason}: se reenvía el último dibujo`);
      },
    });

    return () => {
      connection.current?.close();
      connection.current = null;
    };
  }, [enabled, model.endpoint, model.id, receive, transport]);

  const send = useCallback(
    async (imageDataUrl: string) => {
      const current = latest.current;
      const gen = generation.current;
      const styleKey = `${current.prompt}\n${current.negative}`;
      // With memory on, the first frame of a new style would still blend the old
      // style's latent and the change would creep in over several frames.
      const newStyle = lastPrompt.current !== null && lastPrompt.current !== styleKey;

      lastPrompt.current = styleKey;

      const input = current.model.buildInput({
        prompt: current.prompt,
        negative: current.negative,
        imageDataUrl,
        steps: current.steps,
        strength: current.strength,
        feedback: newStyle ? 1 : current.feedback,
        seed: current.seed,
        scheduleMu: current.scheduleMu,
        interpolate: current.interpolate,
        hd: current.hd,
      });
      const sentAt = performance.now();

      inFlight.current = sentAt;
      lastSend.current = sentAt;
      setMetrics(previous => ({ ...previous, sent: previous.sent + 1 }));

      if (current.model.transport === 'ws') {
        if (!connection.current) {
          inFlight.current = null;

          return;
        }

        connection.current.send(input);

        return;
      }

      try {
        const { data } = await fal.subscribe(current.model.endpoint, {
          input,
          abortSignal: AbortSignal.timeout(frameTimeout()),
        });

        receive(data, sentAt, gen);
      } catch (fault) {
        if (gen !== generation.current) return;

        inFlight.current = null;

        if ((fault as Error)?.name === 'TimeoutError' || (fault as Error)?.name === 'AbortError') {
          setMetrics(previous => ({ ...previous, timedOut: previous.timedOut + 1 }));
          setError(`Sin respuesta en ${Math.round(frameTimeout() / 1000)} s. El endpoint no contesta.`);
        } else {
          setError(errorMessage(fault));
          setMetrics(previous => ({ ...previous, errors: previous.errors + 1 }));
        }
      }
    },
    [receive],
  );

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
          publish(null);
        }

        return;
      }

      if (inFlight.current !== null) {
        if (now - inFlight.current < stallTimeout()) return;

        // Written off as lost: resend the newest drawing even if nothing changed since.
        inFlight.current = null;
        lastFrame.current = -1;
        stalls.current += 1;
        setMetrics(previous => ({ ...previous, timedOut: previous.timedOut + 1 }));

        // Twice in a row with the socket still open: fal is not answering on it any more.
        if (current.model.transport === 'ws' && stalls.current >= STALLS_BEFORE_RECYCLE) {
          stalls.current = 0;
          connection.current?.recycle('dos frames sin respuesta');
        }
      }

      if (frame === lastFrame.current) return;
      if (now - lastSend.current < current.throttleMs) return;

      const svg = current.getSvg();

      if (!svg) return;

      lastFrame.current = frame;

      const raster = await rasterizeSvg(svg, current.model.inputSize);

      if (cancelled || !raster) return;

      // Specks and eraser leftovers are not a drawing: keep the light box empty.
      if (!raster.dataUrl) {
        blankCanvas.current = true;
        publish(null);

        return;
      }

      blankCanvas.current = false;

      // Not awaited: an HTTP frame resolves on its own and must not hold the tick.
      void send(raster.dataUrl);
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

    // Billing clock and the "waiting for an answer" read-out, once per second is plenty.
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
  }, [enabled, publish, send]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const phase: LivePhase = !enabled
    ? 'off'
    : error && !output
      ? 'error'
      : warm
        ? 'live'
        : metrics.sent > 0
          ? 'cold'
          : 'connecting';

  return { output, metrics, error, blankWarning, reset, clearMetrics, transport, waitingMs, warm, phase };
};
