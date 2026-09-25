import { Slider, Switch } from '@digo-labs/ui';
import type { ReactNode } from 'react';

import type { ControlNetKind, LiveModel, StreamSettings } from '../data/models';
import { CONTROLNET_COPY, LINE_PREPROCESSORS, STREAM_RECIPES, inputKept, isTurbo } from '../data/models';
import { format } from '../lib/metrics';

export type LiveSettings = {
  steps: number;
  strength: number;
  /** klein realtime: share of the previous frame's latent carried into the next. */
  memory: number;
  throttleMs: number;
  seed: number;
  scheduleMu: number;
  interpolate: boolean;
  hd: boolean;
  guardSilhouette: boolean;
  /** StreamDiffusion (Daydream) only. */
  stream: StreamSettings;
};

type SettingsPanelProps = {
  model: LiveModel;
  settings: LiveSettings;
  onChange: (next: Partial<LiveSettings>) => void;
};

const GUIDE_COPY = {
  strength: {
    label: 'Libertad frente al trazo',
    hint: 'Alto: el modelo se inventa más. Bajo: calca tu dibujo.',
  },
  control: {
    label: 'Fidelidad a las líneas',
    hint: 'Peso del ControlNet canny sobre tus trazos.',
  },
  memory: {
    label: 'Memoria del frame anterior',
    hint: 'Mezcla el frame anterior en el siguiente: menos parpadeo, más arrastre.',
  },
} as const;

export const SettingsPanel = ({ model, settings, onChange }: SettingsPanelProps) => {
  const guide = model.guide ? GUIDE_COPY[model.guide] : null;
  const isKleinRealtime = model.id === 'klein-realtime';
  const { stream } = settings;
  const setStream = (next: Partial<StreamSettings>) => onChange({ stream: { ...stream, ...next } });
  const setControlNet = (kind: ControlNetKind, next: Partial<StreamSettings['controlnets'][ControlNetKind]>) =>
    setStream({ controlnets: { ...stream.controlnets, [kind]: { ...stream.controlnets[kind], ...next } } });
  const kept = (index: number) => Math.round(inputKept(index, stream.steps) * 100);
  const setIndex = (position: number, value: number) =>
    setStream({ tIndex: stream.tIndex.map((index, at) => (at === position ? value : index)) });
  const setPasses = (count: number) => {
    const current = stream.tIndex;
    const last = current[current.length - 1] ?? 30;

    setStream({
      tIndex:
        count <= current.length
          ? current.slice(0, count)
          : [...current, ...Array.from({ length: count - current.length }, (_, extra) => Math.min(last + 5 * (extra + 1), stream.steps - 1))],
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Group title="Modelo">
        <p className="text-neutral-11 text-sm">{model.notes}</p>
        <dl className="text-neutral-10 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt>Endpoint</dt>
          <dd className="text-neutral-12 truncate font-mono">{model.endpoint}</dd>
          <dt>Entrada</dt>
          <dd className="text-neutral-12 font-mono">{model.inputSize} px JPEG</dd>
          <dt>Tarifa</dt>
          <dd className="text-neutral-12">{model.billing.note}</dd>
        </dl>
      </Group>

      <Group title="Generación">
        {model.steps.min === model.steps.max ? null : (
          <Control label="Pasos" value={String(settings.steps)} hint={model.steps.allowed ? `Solo ${model.steps.allowed.join(', ')}` : undefined}>
            <Slider
              value={settings.steps}
              min={model.steps.min}
              max={model.steps.max}
              step={1}
              onValueChange={value => onChange({ steps: Number(value) })}
            />
          </Control>
        )}

        {guide ? (
          <Control
            label={guide.label}
            value={format(model.guide === 'memory' ? settings.memory : settings.strength, 2)}
            hint={guide.hint}
          >
            <Slider
              value={model.guide === 'memory' ? settings.memory : settings.strength}
              min={model.guide === 'memory' ? 0 : 0.05}
              max={model.guide === 'memory' ? 0.9 : 1}
              step={0.05}
              onValueChange={value =>
                onChange(model.guide === 'memory' ? { memory: Number(value) } : { strength: Number(value) })
              }
            />
          </Control>
        ) : null}

        <Control label="Semilla" value={String(settings.seed)} hint="Fija: el mismo dibujo da el mismo resultado, sin parpadeo entre frames.">
          <Slider value={settings.seed} min={1} max={999} step={1} onValueChange={value => onChange({ seed: Number(value) })} />
        </Control>

        <Toggle
          label="Proteger la silueta"
          hint="Añade el fondo liso de cada estilo y, en klein, la orden de seguir el trazo sin añadir nada. Evita que el modelo invente una escena alrededor."
          checked={settings.guardSilhouette}
          onChange={guardSilhouette => onChange({ guardSilhouette })}
        />
      </Group>

      {isKleinRealtime ? (
        <Group title="klein realtime">
          <Control label="Schedule μ" value={format(settings.scheduleMu, 1)} hint="Reparte el denoise. Más bajo, cambios más suaves.">
            <Slider value={settings.scheduleMu} min={0.3} max={2.5} step={0.1} onValueChange={value => onChange({ scheduleMu: Number(value) })} />
          </Control>
          <Toggle
            label="Interpolación RIFE"
            hint="fal intercala frames: más fluidez, algo más de latencia."
            checked={settings.interpolate}
            onChange={interpolate => onChange({ interpolate })}
          />
          <Toggle
            label="Salida 1024 px"
            hint="square_hd en lugar de 768 px."
            checked={settings.hd}
            onChange={hd => onChange({ hd })}
          />
        </Group>
      ) : null}

      {model.provider === 'daydream' ? (
        <>
          <Group title="StreamDiffusion">
            <div className="flex flex-col gap-2">
              <span className="text-sm">Recetas</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Recetas de StreamDiffusion">
                {STREAM_RECIPES.map(recipe => (
                  <button key={recipe.id} type="button" className="lab-chip" title={recipe.hint} onClick={() => setStream(recipe.apply(stream))}>
                    {recipe.label}
                  </button>
                ))}
              </div>
              <p className="text-neutral-10 text-xs">
                Punto de partida medido; luego ajusta a mano. «Transformar» con palabra, «Fiel al trazo» sin ella o con una
                categoría, «Escena» con prompt libre, «Negro TD» para el look de TouchDesigner (cambia la entrada a blanco
                sobre negro), «Scribble TD» para que siga el trazo sin palabra, «Por defecto TD» para comparar con
                StreamDiffusionTD.
              </p>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm">Prompt</span>
              <textarea
                value={stream.prompt}
                onChange={event => setStream({ prompt: event.target.value })}
                rows={3}
                placeholder="Vacío: estilo + palabra. Escribe aquí para mandar tu prompt tal cual."
                className="border-neutralA-5 focus:border-accent-8 placeholder:text-neutral-9 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
              />
              <span className="text-neutral-10 text-xs">
                Como en StreamDiffusionTD. Para escenas, apaga «Proteger la silueta»: añade «plain background».
              </span>
            </label>
            <Control label="num_inference_steps" value={String(stream.steps)} hint="La rejilla a la que apuntan los t_index.">
              <Slider
                value={stream.steps}
                min={10}
                max={100}
                step={1}
                onValueChange={value =>
                  setStream({ steps: Number(value), tIndex: stream.tIndex.map(index => Math.min(index, Number(value) - 1)) })
                }
              />
            </Control>
            <Control
              label="t_index_list"
              value={`[${stream.tIndex.join(', ')}]`}
              hint="Una pasada de UNet por entrada (1-4). Más entradas: más detalle, menos fps y la salida va entradas − 1 frames por detrás."
            >
              <Slider value={stream.tIndex.length} min={1} max={4} step={1} onValueChange={value => setPasses(Number(value))} />
            </Control>
            {stream.tIndex.map((index, position) => (
              <Control
                key={position}
                label={`t_index ${position + 1}`}
                value={`${index} · ${kept(index)} %`}
                hint={
                  position === 0
                    ? 'Aquí entra el ruido. 0 = ruido puro. Bajo: reinventa. Alto: se parece a la entrada. El % es cuánto del dibujo sobrevive.'
                    : undefined
                }
              >
                <Slider value={index} min={0} max={stream.steps - 1} step={1} onValueChange={value => setIndex(position, Number(value))} />
              </Control>
            ))}
            <Control
              label="Guidance"
              value={format(stream.guidance, 1)}
              hint="Con 1 no hay CFG: delta y el prompt negativo no hacen nada. Por encima de 1 activa RCFG (self): más caro."
            >
              <Slider value={stream.guidance} min={0} max={3} step={0.1} onValueChange={value => setStream({ guidance: Number(value) })} />
              {isTurbo(model) && stream.guidance > 1 ? (
                <p className="text-error-11 text-xs">
                  {model.label} está destilado sin CFG: por encima de 1 la salida se llena de ruido (medido el 24 sep).
                </p>
              ) : null}
            </Control>
            <Control label="Delta" value={format(stream.delta, 2)} hint="Peso del ruido residual de StreamDiffusion. Solo cuenta con guidance por encima de 1.">
              <Slider value={stream.delta} min={0} max={1} step={0.05} onValueChange={value => setStream({ delta: Number(value) })} />
            </Control>
            <Control
              label="Textura de fondo"
              value={format(stream.texture, 2)}
              hint="Ruido de color suave bajo el trazo, el truco de TouchDesigner. Medido: 0 = objeto sobre fondo liso, 0,5 = escena alrededor del dibujo, 1 = la escena manda y el trazo pierde peso."
            >
              <Slider value={stream.texture} min={0} max={1} step={0.05} onValueChange={value => setStream({ texture: Number(value) })} />
            </Control>
            <Toggle
              label="Filtro NSFW"
              hint="Detector de Freepik: muy agresivo, y cada frame marcado sale en negro puro. Apagado para probar; hará falta para el público."
              checked={stream.safetyChecker}
              onChange={safetyChecker => setStream({ safetyChecker })}
            />
            <p className="text-neutral-10 text-xs">
              La palabra manda mucho: con «cat» una casa dibujada sale gato. El texto lo lee CLIP, que entiende palabras sueltas en
              español («gato») pero no frases: mejor una o dos palabras, en inglés si puedes.
            </p>
          </Group>

          <Group title="ControlNet">
            <p className="text-neutral-10 -mt-2 text-xs">Todos apagados de salida. Encender, apagar y cambiar el peso va en caliente.</p>
            {(model.controlnets ?? []).map(kind => {
              const setting = stream.controlnets[kind];
              const copy = CONTROLNET_COPY[kind];

              return (
                <div key={kind} className="flex flex-col gap-3">
                  <Toggle label={copy.label} hint={copy.hint} checked={setting.enabled} onChange={enabled => setControlNet(kind, { enabled })} />
                  {setting.enabled ? (
                    <Control label="Peso" value={format(setting.scale, 2)}>
                      <Slider value={setting.scale} min={0.05} max={1} step={0.05} onValueChange={value => setControlNet(kind, { scale: Number(value) })} />
                    </Control>
                  ) : null}
                  {kind === 'canny' && setting.enabled ? (
                    <>
                      <div className="flex flex-col gap-2">
                        <span className="text-sm">Preprocesador</span>
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Preprocesador de líneas">
                          {LINE_PREPROCESSORS.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              className="lab-chip"
                              aria-pressed={stream.linePreprocessor === option.id}
                              onClick={() => setStream({ linePreprocessor: option.id })}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-neutral-10 text-xs">Cambiarlo recarga el pipeline (~30 s).</p>
                      </div>
                      {stream.linePreprocessor === 'canny' ? (
                        <>
                          <Control label="Umbral bajo" value={String(stream.cannyLow)} hint="Cambiar los umbrales recarga el pipeline (~30 s).">
                            <Slider value={stream.cannyLow} min={0} max={255} step={5} onValueChange={value => setStream({ cannyLow: Number(value) })} />
                          </Control>
                          <Control label="Umbral alto" value={String(stream.cannyHigh)}>
                            <Slider value={stream.cannyHigh} min={0} max={255} step={5} onValueChange={value => setStream({ cannyHigh: Number(value) })} />
                          </Control>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </Group>
        </>
      ) : (
        <Group title="Bucle">
          <Control label="Espera mínima entre frames" value={`${settings.throttleMs} ms`} hint="Solo un frame en vuelo: esto es un tope inferior, no una cadencia.">
            <Slider value={settings.throttleMs} min={0} max={1000} step={16} onValueChange={value => onChange({ throttleMs: Number(value) })} />
          </Control>
        </Group>
      )}
    </div>
  );
};

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-4">
    <h3 className="text-neutral-10 text-[11px] tracking-wide uppercase">{title}</h3>
    {children}
  </section>
);

const Control = ({ label, value, hint, children }: { label: string; value: string; hint?: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="text-neutral-11 font-mono text-xs tabular-nums">{value}</span>
    </div>
    {children}
    {hint ? <p className="text-neutral-10 text-xs">{hint}</p> : null}
  </div>
);

const Toggle = ({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) => (
  <label className="flex items-start justify-between gap-4">
    <span className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <span className="text-neutral-10 text-xs">{hint}</span>
    </span>
    <Switch checked={checked} onCheckedChange={onChange} />
  </label>
);
