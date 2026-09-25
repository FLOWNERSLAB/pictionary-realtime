import type { Billing, LiveModel } from '../data/models';

export type Metrics = {
  sent: number;
  received: number;
  errors: number;
  /** Frames written off after the timeout. */
  timedOut: number;
  /** Frames lost because fal closed the socket under them; resent at once. */
  dropped: number;
  /** Frames the provider's safety filter returned black. They are not shown. */
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
 * `skipFirst`: in a request loop the first answer carries the cold start, which has
 * its own read-out. A streamed model measures cold start apart, so all samples count.
 */
export const summarize = ({ samples, arrivals }: Metrics, skipFirst = true): MetricsSummary => {
  // A stream shows frames long before any latency is measured.
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

export const estimateCost = (billing: Billing, metrics: Metrics) => {
  if (billing.unit === 'compute-second' && billing.usd) return billing.usd * metrics.sessionSeconds;
  if (billing.unit === 'image' && billing.usd) return billing.usd * metrics.received;

  return null;
};

export const format = (value: number, digits = 0) => value.toFixed(digits).replace('.', ',');

/** A row ready to paste into the results table of "Modelos en tiempo real - Comparativa". */
export const toMarkdownRow = (model: LiveModel, metrics: Metrics, preset: string) => {
  const { average, p50, fps } = summarize(metrics);
  const cost = estimateCost(model.billing, metrics);
  const costCell = cost === null ? model.billing.note : `~${format(cost, 3)} $ en ${format(metrics.sessionSeconds)} s`;

  return [
    `| ${model.label} (${model.engine})`,
    `${format(average)} ms (p50 ${format(p50)})`,
    format(fps, 1),
    '',
    '',
    '',
    costCell,
    `fal cloud · ${model.inputSize} px · preset ${preset}`,
    `${metrics.received}/${metrics.sent} frames, ${metrics.timedOut} caducados, ${metrics.blocked} bloqueados, ${metrics.errors} errores`,
    ' |',
  ].join(' | ');
};
