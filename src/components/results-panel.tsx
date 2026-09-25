import { Button, Switch } from '@digo-labs/ui';
import { useMemo, useState } from 'react';

import type { BenchRun } from '../lib/bench-log';
import { runsToMarkdown } from '../lib/bench-log';
import { format } from '../lib/metrics';

type ResultsPanelProps = {
  runs: BenchRun[];
  onDelete: (id: string) => void;
  onClear: () => void;
};

/**
 * The comparison: for each model, its best saved run (lowest p50), as a bar.
 * Runs from the standard test sketch are the fair ones; free drawing is shown
 * only when asked.
 */
export const ResultsPanel = ({ runs, onDelete, onClear }: ResultsPanelProps) => {
  const [standardOnly, setStandardOnly] = useState(true);
  const [copied, setCopied] = useState(false);

  const visible = useMemo(() => runs.filter(run => !standardOnly || run.standard), [runs, standardOnly]);

  const best = useMemo(() => {
    const byModel = new Map<string, BenchRun>();

    for (const run of visible) {
      const previous = byModel.get(run.modelId);

      if (run.frames > 0 && (!previous || run.p50 < previous.p50)) byModel.set(run.modelId, run);
    }

    return [...byModel.values()].sort((a, b) => a.p50 - b.p50);
  }, [visible]);

  const slowest = Math.max(1, ...best.map(run => run.p90));

  const copy = async () => {
    await navigator.clipboard.writeText(runsToMarkdown(visible));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-center justify-between gap-4 text-sm">
        <span className="flex flex-col gap-1">
          <span>Solo el test estándar</span>
          <span className="text-neutral-10 text-xs">El mismo dibujo para todos: la única comparación justa.</span>
        </span>
        <Switch checked={standardOnly} onCheckedChange={setStandardOnly} />
      </label>

      {best.length ? (
        <section className="flex flex-col gap-3" aria-label="Mejor medida por modelo">
          <h3 className="text-neutral-10 text-[11px] tracking-wide uppercase">Mejor p50 por modelo</h3>
          <ol className="flex flex-col gap-3">
            {best.map(run => (
              <li key={run.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{run.modelLabel}</span>
                  <span className="text-neutral-11 font-mono text-xs tabular-nums">
                    {format(run.p50)} ms · {format(run.fps, 1)} fps
                  </span>
                </div>
                <div className="bg-neutral-3 relative h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-neutral-6 absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(run.p90 / slowest) * 100}%` }}
                    title={`p90 ${format(run.p90)} ms`}
                  />
                  <div
                    className="bg-accent-9 absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(run.p50 / slowest) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="text-neutral-10 text-xs">Barra azul: p50. Gris: p90. Más corta es mejor.</p>
        </section>
      ) : (
        <p className="text-neutral-10 border-neutralA-5 rounded-xl border border-dashed p-4 text-sm">
          Aún no hay medidas{standardOnly ? ' del test estándar' : ''}. «Test estándar» dibuja la casa de prueba con el
          modelo elegido, mide y guarda solo. «Probar todos» lo repite con cada modelo.
        </p>
      )}

      {visible.length ? (
        <section className="flex flex-col gap-2" aria-label="Medidas guardadas">
          <h3 className="text-neutral-10 text-[11px] tracking-wide uppercase">Medidas guardadas ({visible.length})</h3>
          <ul className="flex flex-col">
            {visible.map(run => (
              <li key={run.id} className="border-neutralA-4 group flex items-center gap-3 border-b py-2.5 last:border-0">
                {run.thumbnail ? (
                  <img src={run.thumbnail} alt="" className="size-10 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="bg-neutral-3 size-10 shrink-0 rounded-md" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{run.modelLabel}</span>
                  <span className="text-neutral-10 truncate text-xs">
                    {run.standard ? 'Test estándar' : run.preset} · {run.steps} pasos · {run.frames}/{run.sent} frames
                  </span>
                </span>
                <span className="text-right font-mono text-xs tabular-nums">
                  <span className="block">{format(run.p50)} ms</span>
                  <span className="text-neutral-10 block">
                    1º {run.firstFrameMs === null ? '-' : `${format(run.firstFrameMs / 1000, 1)} s`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(run.id)}
                  className="lab-focus text-neutral-10 hover:text-error-11 rounded px-1 text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Borrar la medida de ${run.modelLabel}`}
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!visible.length} onClick={() => void copy()}>
          {copied ? 'Tabla copiada' : 'Copiar tabla markdown'}
        </Button>
        <Button variant="ghost" disabled={!runs.length} onClick={onClear}>
          Borrar todo
        </Button>
      </div>
    </div>
  );
};
