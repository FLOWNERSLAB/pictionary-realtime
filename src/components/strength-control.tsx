import { Kbd, Slider } from '@digo-labs/ui';

import { LADDER, inputBlurFor, rungIndex } from '../lib/prompt';

type StrengthControlProps = {
  value: number;
  onChange: (value: number) => void;
  /** What the value turns into on the engine in use, e.g. the t_index list on StreamDiffusion. */
  readout?: string;
  /** StreamDiffusion has no wording ladder: the rungs are only a scale there. */
  hint?: string;
};

/**
 * AI Strength, Krea's name for it: low keeps the drawing, high lets the prompt take
 * over. On klein it is a ladder of eight wordings (src/lib/prompt.ts), so the slider
 * shows the rungs as segments and names the one in use.
 */
export const StrengthControl = ({ value, onChange, readout, hint }: StrengthControlProps) => {
  const index = rungIndex(value);
  const rung = LADDER[index];
  const blur = inputBlurFor(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-3">
          <span className="text-sm font-medium">AI Strength</span>
          <span className="text-neutral-10 text-xs">
            dibujo <Kbd>[</Kbd> <Kbd>]</Kbd> prompt
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          {readout ? <span className="text-neutral-10 font-mono text-xs">{readout}</span> : null}
          <span className="text-accent-11 text-sm font-medium">{rung.label}</span>
          <span className="w-8 text-right font-mono text-sm tabular-nums">{Math.round(value * 100)}</span>
        </span>
      </div>

      <Slider value={value} min={0} max={1} step={0.01} onValueChange={next => onChange(Number(next))} aria-label="AI Strength" />

      <div className="lab-rungs" role="presentation">
        {LADDER.map((step, at) => {
          const from = at === 0 ? 0 : LADDER[at - 1].upTo;
          const width = Math.min(1, step.upTo) - from;

          return (
            <button
              key={step.label}
              type="button"
              className="lab-rung"
              style={{ flexBasis: `${width * 100}%` }}
              aria-pressed={at === index}
              title={step.hint}
              onClick={() => onChange(Math.round(((from + Math.min(1, step.upTo)) / 2) * 100) / 100)}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      <p className="text-neutral-10 text-xs">
        {hint ?? `${rung.hint}${blur ? ` Además el boceto llega desenfocado ${blur} px.` : ''}`}
      </p>
    </div>
  );
};
