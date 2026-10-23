import type { DrawingStroke } from '@digo-labs/ui';
import { DEFAULT_DRAWING_BRUSH } from '@digo-labs/ui';

import sketches from '../data/sketches.json';

type Point = [number, number];

export type TestSketch = { id: string; word: string; strokes: Point[][] };

/**
 * Guest-grade doodles in canvas fractions, the same ones scripts/lab/sketches.py
 * renders for the measurements, so what the lab replays and what the report shows
 * are the same drawings. Replaying one gives every run identical input.
 */
export const TEST_SKETCHES: readonly TestSketch[] = Object.entries(sketches as unknown as Record<string, { word: string; strokes: Point[][] }>).map(
  ([id, sketch]) => ({ id, word: sketch.word, strokes: sketch.strokes }),
);

export const findSketch = (id: string) => TEST_SKETCHES.find(sketch => sketch.id === id) ?? TEST_SKETCHES[0];

const POINTS_PER_TICK = 2;
const TICK_MS = 20;

type Replay = {
  sketch: TestSketch;
  width: number;
  height: number;
  color: string;
  size: number;
  addStroke: (stroke: DrawingStroke) => void;
  updateStroke: (id: string, points: number[][]) => void;
  signal: AbortSignal;
  /** Called on every drawn tick, so the live loop sees the drawing change. */
  onInk: () => void;
};

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);

    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

const toCanvas = (sketch: TestSketch, width: number, height: number) => {
  const side = Math.min(width, height) * 0.86;
  const offsetX = (width - side) / 2;
  const offsetY = (height - side) / 2;

  return sketch.strokes.map(path => path.map(([x, y]) => [offsetX + x * side, offsetY + y * side, 0.5]));
};

const stroke = (points: number[][], color: string, size: number): DrawingStroke => ({
  id: crypto.randomUUID(),
  tool: 'pen',
  color,
  size,
  brush: DEFAULT_DRAWING_BRUSH,
  points,
  simulatePressure: true,
});

/**
 * The whole sketch at once, used to wake a cold endpoint before measuring.
 * One stroke per frame: the provider needs a render between additions.
 */
export const placeTestSketch = async ({ sketch, width, height, color, size, addStroke, signal }: Replay) => {
  for (const points of toCanvas(sketch, width, height)) {
    addStroke(stroke(points, color, size));
    await wait(TICK_MS * 2, signal);
  }
};

/** Draws the sketch stroke by stroke at pointer speed (a few seconds), enough for a dozen frames. */
export const replayTestSketch = async ({ sketch, width, height, color, size, addStroke, updateStroke, signal, onInk }: Replay) => {
  for (const points of toCanvas(sketch, width, height)) {
    const first = stroke(points.slice(0, 1), color, size);

    addStroke(first);

    for (let end = POINTS_PER_TICK; end < points.length + POINTS_PER_TICK; end += POINTS_PER_TICK) {
      await wait(TICK_MS, signal);
      updateStroke(first.id, points.slice(0, end));
      onInk();
    }

    await wait(180, signal);
  }
};

export const sleep = wait;
