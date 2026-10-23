import type { LiveFrame } from '../hooks/use-live-render';
import { format } from '../lib/metrics';

type HistoryStripProps = {
  frames: LiveFrame[];
  /** Frame pinned in the light box, or null while it follows the live output. */
  pinned: number | null;
  onPin: (id: number | null) => void;
};

/**
 * The last frames, newest on the right, so a style or strength change can be
 * compared against what came before without redrawing. Click one to hold it in
 * the light box; the live output keeps arriving underneath.
 */
export const HistoryStrip = ({ frames, pinned, onPin }: HistoryStripProps) => {
  if (!frames.length) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="lab-scroll-x flex min-w-0 flex-1 gap-2 overflow-x-auto pr-8" role="listbox" aria-label="Últimos frames">
        {frames.map(frame => (
          <button
            key={frame.id}
            type="button"
            role="option"
            aria-selected={pinned === frame.id}
            className="lab-thumb"
            title={`${frame.styleLabel} · ${frame.rungLabel} ${Math.round(frame.strength * 100)}${frame.hint ? ` · «${frame.hint}»` : ''}${frame.latencyMs === null ? '' : ` · ${format(frame.latencyMs)} ms`}`}
            onClick={() => onPin(pinned === frame.id ? null : frame.id)}
          >
            <img src={frame.url} alt="" />
            <span className="lab-thumb-label">
              {frame.styleLabel} · {Math.round(frame.strength * 100)}
            </span>
          </button>
        ))}
      </div>
      {pinned !== null ? (
        <button type="button" className="lab-chip shrink-0" onClick={() => onPin(null)}>
          Volver al directo
        </button>
      ) : null}
    </div>
  );
};
