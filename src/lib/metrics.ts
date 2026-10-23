import { MODEL } from '../data/model';

export type Metrics = {
  sent: number;
  received: number;
  errors: number;
  /** Frames written off after the stall timeout. */
  timedOut: number;
  /** Frames lost because fal closed the socket under them; resent at once. */
  dropped: number;
  /** Frames fal's safety filter returned black. They are not shown. */
  blocked: number;
  /** Round trip of each frame, newest last. */
  samples: number[];
  /** `performance.now()` of each answer, to measure real throughput. */
  arrivals: number[];
  /** Seconds the loop was active with something on the canvas, for compute-second billing. */
  sessionSeconds: number;
  /** Time to the first answer of the session: cold start plus socket setup. */
  firstFrameMs: number | null;
};

export const EMPTY_METRICS: Metrics = {
  sent: 0,
  received: 0,
  errors: 0,
  timedOut: 0,
  dropped: 0,
  blocked: 0,
  samples: [],
  arrivals: [],
  sessionSeconds: 0,
  firstFrameMs: null,
};

const WINDOW = 60;

export const pushSample = (metrics: Metrics, latencyMs: number, at: number): Metrics => ({
  ...metrics,
  received: metrics.received + 1,
  samples: [...metrics.samples, latencyMs].slice(-WINDOW),
  arrivals: [...metrics.arrivals, at].slice(-WINDOW),
  firstFrameMs: metrics.firstFrameMs ?? latencyMs,
});

const percentile = (samples: number[], fraction: number) => {
  if (!samples.length) return 0;

  const sorted = [...samples].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

export type MetricsSummary = {
  average: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  /** Frames per second actually shown, from the gaps between answers while drawing. */
  fps: number;
};

/** Gaps longer than this mean the guest stopped drawing, not that the model was slow. */
const IDLE_GAP_MS = 2500;

const throughput = (arrivals: number[]) => {
  const gaps = arrivals
    .slice(1)
    .map((at, index) => at - arrivals[index])
    .filter(gap => gap < IDLE_GAP_MS);

  if (!gaps.length) return 0;

  return 1000 / (gaps.reduce((total, gap) => total + gap, 0) / gaps.length);
};

/**
 * `skipFirst`: in the request loop the first answer carries the cold start, which has
 * its own read-out. A streamed model measures cold start apart, so all samples count,
 * and it shows frames long before any latency is measured.
 */
export const summarize = ({ samples, arrivals }: Metrics, skipFirst = true): MetricsSummary => {
  if (!samples.length) return { average: 0, p50: 0, p90: 0, min: 0, max: 0, fps: throughput(arrivals) };

  const steady = skipFirst && samples.length > 1 ? samples.slice(1) : samples;
  const average = steady.reduce((total, value) => total + value, 0) / steady.length;

  return {
    average,
    p50: percentile(steady, 0.5),
    p90: percentile(steady, 0.9),
    min: Math.min(...steady),
    max: Math.max(...steady),
    fps: throughput(arrivals) || (average > 0 ? 1000 / average : 0),
  };
};

export const estimateCost = (metrics: Metrics) => MODEL.usdPerSecond * metrics.sessionSeconds;

export const format = (value: number, digits = 0) => value.toFixed(digits).replace('.', ',');
