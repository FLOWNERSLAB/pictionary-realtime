import type { Metrics, MetricsSummary } from '../lib/metrics';
import { format } from '../lib/metrics';

type LatencyTapeProps = {
  metrics: Metrics;
  stats: MetricsSummary;
  waitingMs: number;
  cost: number | null;
  costNote: string;
  /**
   * WebRTC stream: frames arrive continuously, so FPS is live from the start,
   * but latency only exists once the blackout probe ran (key L).
   */
  streamed?: boolean;
};

const SLOTS = 60;
/** The tape's ceiling. Anything slower is clipped and drawn in the error colour. */
const CEILING_MS = 2400;
const GUIDES = [500, 1000, 2000];

const tone = (ms: number) => (ms <= 700 ? 'var(--color-accent-9)' : ms <= 1400 ? 'var(--color-warning-9)' : 'var(--color-error-9)');

/**
 * The signature of the lab: every frame leaves one tick on a tape, like a
 * seismograph. Tall ticks are slow frames; the gap on the right is the frame
 * still out, growing until it lands.
 */
export const LatencyTape = ({ metrics, stats, waitingMs, cost, costNote, streamed = false }: LatencyTapeProps) => {
  const samples = metrics.samples.slice(-(SLOTS - 1));
  const width = 100 / SLOTS;
  const height = (ms: number) => Math.max(2, (Math.min(ms, CEILING_MS) / CEILING_MS) * 100);
  const hasData = samples.length > 0;

  return (
    <section className="lab-tape grid gap-x-8 gap-y-4 md:grid-cols-[auto_minmax(0,1fr)_auto]" aria-label="Latencia por frame">
      <div className="flex items-end gap-3">
        {hasData ? (
          <span className="lab-numeral" aria-live="polite">
            {format(stats.p50)}
          </span>
        ) : (
          // Humane has no dash glyph worth showing: an empty meter reads as a white bar.
          <span className="text-neutral-9 mb-1 font-mono text-2xl">{streamed ? 'pulsa L' : 'sin datos'}</span>
        )}
        <span className="text-neutral-11 mb-2 flex flex-col text-xs leading-tight">
          <span>ms p50</span>
          <span>{streamed ? 'de extremo a extremo' : 'por frame'}</span>
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-20 w-full self-end md:h-24" role="img">
        <title>{hasData ? `Últimos ${samples.length} frames` : 'Sin frames todavía'}</title>
        {GUIDES.map(guide => (
          <line
            key={guide}
            x1="0"
            x2="100"
            y1={100 - height(guide)}
            y2={100 - height(guide)}
            stroke="var(--color-neutral-6)"
            strokeWidth="0.4"
            strokeDasharray="0.8 1.2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {samples.map((ms, index) => (
          <rect
            key={metrics.received - samples.length + index}
            x={index * width + width * 0.2}
            y={100 - height(ms)}
            width={width * 0.6}
            height={height(ms)}
            rx="0.3"
            fill={tone(ms)}
            className={index === samples.length - 1 ? 'lab-tick-in' : undefined}
          />
        ))}
        {waitingMs > 0 ? (
          <rect
            x={samples.length * width + width * 0.2}
            y={100 - height(waitingMs)}
            width={width * 0.6}
            height={height(waitingMs)}
            rx="0.3"
            fill="none"
            stroke="var(--color-neutral-9)"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 self-end text-sm md:grid-cols-3">
        <Figure label="FPS reales" value={hasData || (streamed && stats.fps) ? format(stats.fps, 1) : '-'} />
        <Figure label="p90" value={hasData ? `${format(stats.p90)} ms` : '-'} />
        <Figure
          label="1er frame"
          value={metrics.firstFrameMs === null ? '-' : `${format(metrics.firstFrameMs / 1000, 1)} s`}
        />
        <Figure
          label={streamed ? 'Mediciones' : 'Frames'}
          value={`${metrics.received}/${metrics.sent}`}
          title={streamed ? 'Rondas del test de apagado que obtuvieron respuesta' : undefined}
        />
        <Figure
          label="Fallos"
          value={String(metrics.errors + metrics.timedOut + metrics.blocked)}
          title={`${metrics.errors} errores · ${metrics.timedOut} sin respuesta · ${metrics.dropped} por socket cerrado (reenviados) · ${metrics.blocked} en negro por el filtro NSFW`}
        />
        <Figure label="Coste" value={cost === null ? 's/d' : `${format(cost, 3)} $`} title={costNote} />
      </dl>
    </section>
  );
};

const Figure = ({ label, value, title }: { label: string; value: string; title?: string }) => (
  <div className="flex flex-col gap-0.5" title={title}>
    <dt className="text-neutral-10 text-[11px] tracking-wide uppercase">{label}</dt>
    <dd className="font-mono tabular-nums">{value}</dd>
  </div>
);
