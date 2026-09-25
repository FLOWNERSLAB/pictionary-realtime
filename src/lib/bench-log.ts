import type { Metrics } from './metrics';
import { summarize } from './metrics';

/** One saved measurement: a model, the settings it ran with, and what came back. */
export type BenchRun = {
  id: string;
  at: string;
  modelId: string;
  modelLabel: string;
  transport: string;
  preset: string;
  steps: number;
  inputSize: number;
  /** True when the frames came from the standard test sketch, so runs are comparable. */
  standard: boolean;
  frames: number;
  sent: number;
  errors: number;
  firstFrameMs: number | null;
  average: number;
  p50: number;
  p90: number;
  fps: number;
  cost: number | null;
  thumbnail: string | null;
};

const KEY = 'pictionary-lab/runs';
const LIMIT = 60;

export const loadRuns = (): BenchRun[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as BenchRun[];
  } catch {
    return [];
  }
};

const persist = (runs: BenchRun[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs.slice(0, LIMIT)));
  } catch {
    // Storage full or blocked: the run still shows for this session.
  }
};

export const saveRun = (runs: BenchRun[], run: Omit<BenchRun, 'id' | 'at'>) => {
  const next = [{ ...run, id: crypto.randomUUID(), at: new Date().toISOString() }, ...runs];

  persist(next);

  return next;
};

export const deleteRun = (runs: BenchRun[], id: string) => {
  const next = runs.filter(run => run.id !== id);

  persist(next);

  return next;
};

export const clearRuns = () => {
  persist([]);

  return [];
};

export const runFromMetrics = (metrics: Metrics) => {
  const { average, p50, p90, fps } = summarize(metrics);

  return {
    frames: metrics.received,
    sent: metrics.sent,
    errors: metrics.errors + metrics.timedOut + metrics.blocked,
    firstFrameMs: metrics.firstFrameMs,
    average,
    p50,
    p90,
    fps,
  };
};

/** Shrinks a frame to a small JPEG so dozens of runs fit in localStorage. */
export const makeThumbnail = (url: string | null, size = 96) =>
  new Promise<string | null>(resolve => {
    if (!url) return resolve(null);

    const image = new Image();

    image.crossOrigin = 'anonymous';
    image.onerror = () => resolve(null);
    image.onload = () => {
      const canvas = document.createElement('canvas');

      canvas.width = size;
      canvas.height = size;

      const context = canvas.getContext('2d');

      if (!context) return resolve(null);

      context.drawImage(image, 0, 0, size, size);

      try {
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      }
    };
    image.src = url;
  });

/** Markdown table of every saved run, for the vault note. */
export const runsToMarkdown = (runs: BenchRun[]) => {
  const format = (value: number, digits = 0) => value.toFixed(digits).replace('.', ',');
  const header =
    '| Modelo | Transporte | Test | 1er frame | Media | p50 | p90 | FPS | Frames | Coste | Fecha |\n|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|:--|';
  const rows = runs.map(run =>
    [
      `| ${run.modelLabel}`,
      run.transport,
      run.standard ? 'estándar' : `libre · ${run.preset}`,
      run.firstFrameMs === null ? '-' : `${format(run.firstFrameMs)} ms`,
      `${format(run.average)} ms`,
      `${format(run.p50)} ms`,
      `${format(run.p90)} ms`,
      format(run.fps, 1),
      `${run.frames}/${run.sent}`,
      run.cost === null ? 's/d' : `${format(run.cost, 3)} $`,
      `${run.at.slice(0, 16).replace('T', ' ')} |`,
    ].join(' | '),
  );

  return [header, ...rows].join('\n');
};
