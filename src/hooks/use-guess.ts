import { useCallback, useEffect, useRef, useState } from 'react';

import type { Guess } from '../lib/guess';
import { GUESS_INPUT_SIZE, requestGuess } from '../lib/guess';
import { rasterizeSvg } from '../lib/raster';

export type GuessOptions = {
  enabled: boolean;
  hasDrawing: boolean;
  getSvg: () => SVGSVGElement | null;
  /** Bumped by the canvas on every pointer move: a guess is only asked for new ink. */
  dirtyRef: React.RefObject<number>;
};

/** The loop looks this often. */
const TICK_MS = 150;
/** Minimum spacing between two guesses: Haiku answers in ~0,8-1,2 s, so one in flight is enough. */
const GAP_MS = 900;
/** Ink must have settled this long: a guess mid-stroke reads half a line. */
const SETTLE_MS = 250;

/**
 * One vision call at a time, always on the newest drawing, only when it changed.
 * The guess survives until the canvas is cleared, so a pause in the drawing keeps
 * steering the render.
 */
export const useGuess = ({ enabled, hasDrawing, getSvg, dirtyRef }: GuessOptions) => {
  const [guess, setGuess] = useState<Guess | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState(0);

  const inFlight = useRef<AbortController | null>(null);
  const lastGuessed = useRef(-1);
  const lastSent = useRef(0);
  const lastInkFrame = useRef(-1);
  const lastInk = useRef(0);
  const ticking = useRef(false);
  const latest = useRef({ enabled, hasDrawing, getSvg, dirtyRef });

  useEffect(() => {
    latest.current = { enabled, hasDrawing, getSvg, dirtyRef };
  });

  const clear = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    lastGuessed.current = -1;
    setGuess(null);
    setPending(false);
  }, []);

  useEffect(() => {
    // Off: drop the call in flight and forget what was guessed, without a render.
    if (!enabled) {
      inFlight.current?.abort();
      inFlight.current = null;
      lastGuessed.current = -1;

      return;
    }

    const tick = async () => {
      const current = latest.current;
      const frame = current.dirtyRef.current;
      const now = performance.now();

      if (frame !== lastInkFrame.current) {
        lastInkFrame.current = frame;
        lastInk.current = now;
      }

      if (!current.hasDrawing) {
        if (lastGuessed.current !== -1) clear();

        return;
      }

      if (inFlight.current || frame === lastGuessed.current) return;
      if (now - lastInk.current < SETTLE_MS || now - lastSent.current < GAP_MS) return;

      const svg = current.getSvg();

      if (!svg) return;

      const raster = await rasterizeSvg(svg, GUESS_INPUT_SIZE, 0.6);

      if (!raster?.dataUrl) return;

      const controller = new AbortController();

      inFlight.current = controller;
      lastGuessed.current = frame;
      lastSent.current = performance.now();
      setPending(true);

      try {
        const next = await requestGuess(raster.dataUrl, controller.signal);

        if (controller.signal.aborted) return;

        setGuess(next);
        setError(null);
        setCalls(count => count + 1);
      } catch (fault) {
        if ((fault as Error).name !== 'AbortError') setError((fault as Error).message);
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setPending(false);
        }
      }
    };

    const loop = window.setInterval(() => {
      if (ticking.current) return;

      ticking.current = true;
      void tick()
        .catch(() => undefined)
        .finally(() => {
          ticking.current = false;
        });
    }, TICK_MS);

    return () => {
      window.clearInterval(loop);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [enabled, clear]);

  // While off, the last guess is kept but not shown; back on, the first stroke replaces it.
  return { guess: enabled ? guess : null, pending: enabled && pending, error, calls, clear };
};
