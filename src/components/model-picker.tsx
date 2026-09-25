import { Popover, PopoverPopup, PopoverTrigger } from '@digo-labs/ui';
import { useState } from 'react';

import type { LiveModel } from '../data/models';
import { TRANSPORT_LABEL, VERDICT_LABEL, isLiveFit, isStreamDiffusion } from '../data/models';

type ModelPickerProps = {
  models: readonly LiveModel[];
  value: string;
  onChange: (id: string) => void;
  /** Label above the list, e.g. "Modelo en vivo". */
  title: string;
  compact?: boolean;
  /**
   * The live picker splits fal from StreamDiffusion and pushes what does not work
   * live to the bottom of each lane. The reveal picker is one flat list.
   */
  purpose?: 'live' | 'finish';
};

const verdictTone: Record<LiveModel['verdict'], string> = {
  reference: 'text-accent-11',
  candidate: 'text-neutral-11',
  slow: 'text-warning-11',
  'finish-only': 'text-warning-11',
  unfit: 'text-error-11',
  broken: 'text-error-11',
};

const Badge = ({ model, purpose }: { model: LiveModel; purpose: 'live' | 'finish' }) => {
  // In the reveal list "only for the reveal" is the point, not a warning.
  if (purpose === 'finish' && model.verdict === 'finish-only') return null;

  return <span className={`ml-auto shrink-0 text-[11px] font-medium ${verdictTone[model.verdict]}`}>{VERDICT_LABEL[model.verdict]}</span>;
};

type OptionProps = { model: LiveModel; selected: boolean; purpose: 'live' | 'finish'; onPick: (id: string) => void };

const Option = ({ model, selected, purpose, onPick }: OptionProps) => {
  const fit = purpose === 'finish' || isLiveFit(model);

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => onPick(model.id)}
        className="lab-focus hover:bg-neutral-3 aria-selected:bg-neutral-3 flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={`text-sm font-medium ${fit ? '' : 'text-neutral-11'}`}>{model.label}</span>
          <span className="text-neutral-10 font-mono text-[11px]">{TRANSPORT_LABEL[model.transport]}</span>
          <Badge model={model} purpose={purpose} />
        </span>
        {!fit && model.why ? <span className={`text-xs ${verdictTone[model.verdict]}`}>{model.why}</span> : null}
        <span className="text-neutral-10 text-xs">{model.measured || 'Sin medir todavía'}</span>
      </button>
    </li>
  );
};

type LaneProps = {
  models: LiveModel[];
  value: string;
  purpose: 'live' | 'finish';
  onPick: (id: string) => void;
};

/** Fit models first; the rest below a divider, still selectable to re-measure them. */
const Lane = ({ models, value, purpose, onPick }: LaneProps) => {
  const fit = purpose === 'finish' ? models : models.filter(isLiveFit);
  const rest = purpose === 'finish' ? [] : models.filter(model => !isLiveFit(model));

  return (
    <>
      <ul role="group">
        {fit.map(model => (
          <Option key={model.id} model={model} selected={model.id === value} purpose={purpose} onPick={onPick} />
        ))}
      </ul>
      {rest.length ? (
        <>
          <p className="text-neutral-10 flex items-center gap-2 px-3 pt-3 pb-1 text-[11px] tracking-wide uppercase">
            No aptos para el directo
            <span className="bg-neutralA-4 h-px flex-1" />
          </p>
          <ul role="group">
            {rest.map(model => (
              <Option key={model.id} model={model} selected={model.id === value} purpose={purpose} onPick={onPick} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
};

/**
 * Every fal model swaps live: same proxy, same key. StreamDiffusion is a different
 * engine (continuous video over WebRTC, its own controls), so it gets its own lane.
 * The ones behind another provider's key are listed but locked.
 */
export const ModelPicker = ({ models, value, onChange, title, compact, purpose = 'live' }: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const current = models.find(model => model.id === value) ?? models[0];
  const ready = models.filter(model => !model.unavailable);
  const frames = ready.filter(model => !isStreamDiffusion(model));
  const streams = ready.filter(isStreamDiffusion);
  const locked = models.filter(model => model.unavailable);
  const currentFit = purpose === 'finish' || isLiveFit(current);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`lab-focus border-neutralA-5 hover:border-neutralA-8 flex min-w-0 items-center gap-3 rounded-full border text-left transition-colors ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}
      >
        <span className="flex min-w-0 flex-col">
          {compact ? null : (
            <span className="text-neutral-10 text-[11px] tracking-wide uppercase">
              {isStreamDiffusion(current) ? 'StreamDiffusion' : title}
            </span>
          )}
          <span className="truncate text-sm font-medium">{current.label}</span>
        </span>
        <span className="bg-neutral-3 text-neutral-11 rounded-full px-2 py-0.5 font-mono text-[11px]">
          {TRANSPORT_LABEL[current.transport]}
        </span>
        {currentFit ? null : (
          <span className={`text-[11px] font-medium ${verdictTone[current.verdict]}`}>{VERDICT_LABEL[current.verdict]}</span>
        )}
        <svg viewBox="0 0 12 12" className="text-neutral-10 size-3 shrink-0" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </PopoverTrigger>

      <PopoverPopup side="bottom" align="center" sideOffset={8} className="w-[min(92vw,460px)] p-0">
        <div className="border-neutralA-4 flex items-baseline justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-neutral-10 text-xs">Cambio en caliente, sin reiniciar</span>
        </div>

        <div className="max-h-[70vh] overflow-y-auto" role="listbox" aria-label={title}>
          {purpose === 'live' ? (
            <section className="p-1.5">
              <header className="px-3 pt-2 pb-1">
                <p className="text-neutral-12 text-xs font-medium">Imagen por frame · fal</p>
                <p className="text-neutral-10 text-xs">Cada trazo sale como una foto y vuelve una imagen.</p>
              </header>
              <Lane models={frames} value={value} purpose={purpose} onPick={pick} />
            </section>
          ) : (
            <div className="p-1.5">
              <Lane models={ready} value={value} purpose={purpose} onPick={pick} />
            </div>
          )}

          {purpose === 'live' && streams.length ? (
            // A card of its own: a different engine, not one more row of the fal list.
            <section className="border-accent-6 bg-accentA-2 mx-3 mt-1 mb-3 rounded-xl border p-1.5">
              <header className="px-3 pt-2 pb-1">
                <p className="text-accent-11 flex items-center gap-2 text-xs font-medium">
                  StreamDiffusion · Daydream
                  <span className="border-accent-6 text-accent-11 rounded-full border px-1.5 py-px font-mono text-[10px]">
                    vídeo continuo
                  </span>
                </p>
                <p className="text-neutral-10 text-xs">
                  Otro motor: el lienzo sale como vídeo por WebRTC y vuelve como vídeo, con sus propios controles en
                  Ajustes. Si la salida se corta a los ~6 s, son créditos agotados en Daydream.
                </p>
              </header>
              <Lane models={streams} value={value} purpose={purpose} onPick={pick} />
            </section>
          ) : null}

          {locked.length ? (
            <section className="border-neutralA-4 border-t p-1.5">
              <p className="text-neutral-10 px-3 pt-2 pb-1 text-[11px] tracking-wide uppercase">
                Otros proveedores · requieren clave y reiniciar
              </p>
              <ul>
                {locked.map(model => (
                  <li key={model.id} className="flex flex-col gap-1 rounded-lg px-3 py-2.5 opacity-70">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{model.label}</span>
                      <span className="text-neutral-10 font-mono text-[11px]">{TRANSPORT_LABEL[model.transport]}</span>
                      <span className="text-neutral-10 ml-auto text-[11px]">Bloqueado</span>
                    </span>
                    <span className="text-neutral-10 text-xs">{model.unavailable}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
