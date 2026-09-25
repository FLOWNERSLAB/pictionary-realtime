import type { DrawingStroke } from '@digo-labs/ui';
import { DEFAULT_DRAWING_BRUSH } from '@digo-labs/ui';

type Point = [number, number];

/** Straight segment sampled every ~1 % of the canvas, like a pointer would. */
const segment = (from: Point, to: Point): Point[] => {
  const steps = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.012));

  return Array.from({ length: steps + 1 }, (_, index) => [
    from[0] + ((to[0] - from[0]) * index) / steps,
    from[1] + ((to[1] - from[1]) * index) / steps,
  ]);
};

const polyline = (...corners: Point[]) =>
  corners.slice(1).flatMap((corner, index) => segment(corners[index], corner).slice(index ? 1 : 0));

const circle = (cx: number, cy: number, r: number): Point[] =>
  Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 47) * Math.PI * 2;

    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });

/**
 * The standard test: the same guest-grade doodle as `scripts/bench.mjs`
 * (house, roof, door, window, sun), in canvas fractions. Replaying it gives
 * every model identical input, so runs from different models compare fairly.
 */
export const TEST_SKETCH: Point[][] = [
  polyline([0.22, 0.47], [0.78, 0.47], [0.78, 0.84], [0.22, 0.84], [0.22, 0.47]),
  polyline([0.18, 0.49], [0.5, 0.24], [0.82, 0.49]),
  polyline([0.44, 0.84], [0.44, 0.66], [0.56, 0.66], [0.56, 0.84]),
  polyline([0.28, 0.55], [0.38, 0.55], [0.38, 0.64], [0.28, 0.64], [0.28, 0.55]),
  circle(0.82, 0.16, 0.07),
];

const POINTS_PER_TICK = 2;
const TICK_MS = 20;

type Replay = {
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

const toCanvas = (width: number, height: number) => {
  const side = Math.min(width, height) * 0.86;
  const offsetX = (width - side) / 2;
  const offsetY = (height - side) / 2;

  return TEST_SKETCH.map(path => path.map(([x, y]) => [offsetX + x * side, offsetY + y * side, 0.5]));
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
export const placeTestSketch = async ({ width, height, color, size, addStroke, signal }: Replay) => {
  for (const points of toCanvas(width, height)) {
    addStroke(stroke(points, color, size));
    await wait(TICK_MS * 2, signal);
  }
};

/** Draws the test sketch stroke by stroke at pointer speed (~9 s in total, enough for a few frames of a 2 s model). */
export const replayTestSketch = async ({ width, height, color, size, addStroke, updateStroke, signal, onInk }: Replay) => {
  for (const points of toCanvas(width, height)) {
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
