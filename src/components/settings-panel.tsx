import { Slider, Switch } from '@digo-labs/ui';
import type { ReactNode } from 'react';

import type { Settings } from '../data/model';
import { MEMORY_MAX, MODEL } from '../data/model';
import type { ControlNetKind, StreamSettings } from '../data/stream';
import { CONTROLNET_COPY, INPUT_LOOKS, LINE_PREPROCESSORS, STREAM_RECIPES, inputKept, streamForStrength } from '../data/stream';
import { format } from '../lib/metrics';
import { TEST_SKETCHES } from '../lib/test-sketch';

export type Engine = 'klein' | 'stream';

type SettingsPanelProps = {
  engine: Engine;
  settings: Settings;
  onChange: (next: Partial<Settings>) => void;
  stream: StreamSettings;
  onStream: (next: Partial<StreamSettings>) => void;
  strength: number;
  testSketchId: string;
  onTestSketch: (id: string) => void;
  prompt: string;
};

export const SettingsPanel = ({ engine, settings, onChange, stream, onStream, strength, testSketchId, onTestSketch, prompt }: SettingsPanelProps) => {
  const setControlNet = (kind: ControlNetKind, next: Partial<StreamSettings['controlnets'][ControlNetKind]>) =>
    onStream({ controlnets: { ...stream.controlnets, [kind]: { ...stream.controlnets[kind], ...next } } });
  const derived = streamForStrength(strength, stream);

  return (
    <div className="flex flex-col gap-6">
      {engine === 'klein' ? (
        <>
          <Group title="Generación">
            <Control
              label="Pasos"
              value={String(settings.steps)}
              hint="1 paso ~0,45 s, 2 ~0,55 s, 3 ~0,7 s, 6 ~1 s por frame (23 oct). Con 1-2 la imagen es más plana; con 3 ya hay detalle."
            >
              <Slider value={settings.steps} min={MODEL.steps.min} max={MODEL.steps.max} step={1} onValueChange={value => onChange({ steps: Number(value) })} />
            </Control>

            <Control
              label="Memoria del frame anterior"
              value={format(settings.memory, 2)}
              hint="Mezcla el latente del frame anterior: menos parpadeo, algo de arrastre. Por encima de 0,3 acumula manchas de color (medido el 23 oct), así que el tope es ese."
            >
              <Slider value={settings.memory} min={0} max={MEMORY_MAX} step={0.05} onValueChange={value => onChange({ memory: Number(value) })} />
            </Control>

            <Control label="Semilla" value={String(settings.seed)} hint="Fija: el mismo dibujo da el mismo resultado, sin parpadeo entre frames.">
              <Slider value={settings.seed} min={1} max={999} step={1} onValueChange={value => onChange({ seed: Number(value) })} />
            </Control>

            <Toggle
              label="Fondo del estilo"
              hint="Añade al prompt el fondo liso de cada estilo: evita que un garabato suelto crezca hasta ser una escena."
              checked={settings.backdrop}
              onChange={backdrop => onChange({ backdrop })}
            />
          </Group>

          <Group title="klein realtime">
            <Control label="Schedule μ" value={format(settings.scheduleMu, 1)} hint="Reparte el denoise entre pasos. Medido el 23 oct: entre 0,3 y 2,3 apenas cambia la imagen.">
              <Slider value={settings.scheduleMu} min={0.3} max={2.5} step={0.1} onValueChange={value => onChange({ scheduleMu: Number(value) })} />
            </Control>
            <Toggle label="Salida 1024 px" hint="square_hd en lugar de 768 px. Más nítido, más lento." checked={settings.hd} onChange={hd => onChange({ hd })} />
            <Toggle
              label="Interpolación RIFE"
              hint="fal intercala un frame entre dos consecutivos: más fluidez, algo más de latencia."
              checked={settings.interpolate}
              onChange={interpolate => onChange({ interpolate })}
            />
            <Control label="Espera mínima entre frames" value={`${settings.throttleMs} ms`} hint="Solo hay un frame en vuelo: esto es un tope inferior, no una cadencia.">
              <Slider value={settings.throttleMs} min={0} max={1000} step={16} onValueChange={value => onChange({ throttleMs: Number(value) })} />
            </Control>
          </Group>
        </>
      ) : (
        <>
          <Group title="StreamDiffusion">
            <div className="flex flex-col gap-2">
              <span className="text-sm">Recetas</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Recetas de StreamDiffusion">
                {STREAM_RECIPES.map(recipe => (
                  <button key={recipe.id} type="button" className="lab-chip" title={recipe.hint} onClick={() => onStream(recipe.apply(stream))}>
                    {recipe.label}
                  </button>
                ))}
              </div>
              <p className="text-neutral-10 text-xs">
                Punto de partida: «Scribble TD», trazo blanco sobre negro usado como mapa de líneas. Cambiar el preprocesador recarga el pipeline (~30 s).
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm">Entrada al modelo</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Entrada al modelo">
                {INPUT_LOOKS.map(look => (
                  <button key={look.id} type="button" className="lab-chip" aria-pressed={stream.inputLook === look.id} title={look.hint} onClick={() => onStream({ inputLook: look.id })}>
                    {look.label}
                  </button>
                ))}
              </div>
              <p className="text-neutral-10 text-xs">Tu papel no cambia: solo lo que recibe el modelo (miniatura en la esquina del lienzo).</p>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-sm">Prompt libre</span>
              <textarea
                value={stream.prompt}
                onChange={event => onStream({ prompt: event.target.value })}
                rows={2}
                placeholder="Vacío: pista + estilo. Escribe aquí para mandar tu prompt tal cual."
                className="border-neutralA-5 focus:border-accent-8 placeholder:text-neutral-9 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>

            <Control
              label="AI Strength → t_index"
              value={`[${derived.tIndex.join(', ')}]`}
              hint={`El slider de arriba pone la primera pasada donde sobrevive el ${Math.round(derived.kept * 100)} % del dibujo (0 = ruido puro). Aquí solo se elige cuántas pasadas y su separación.`}
            >
              <div className="grid grid-cols-2 gap-3">
                <Control label="Pasadas" value={String(stream.passes)}>
                  <Slider value={stream.passes} min={1} max={4} step={1} onValueChange={value => onStream({ passes: Number(value) })} />
                </Control>
                <Control label="Separación" value={String(stream.spread)}>
                  <Slider value={stream.spread} min={2} max={16} step={1} onValueChange={value => onStream({ spread: Number(value) })} />
                </Control>
              </div>
            </Control>

            <Control label="num_inference_steps" value={String(stream.steps)} hint={`La rejilla. El índice más alto conserva el ${Math.round(inputKept(stream.steps - 1, stream.steps) * 100)} % del dibujo.`}>
              <Slider value={stream.steps} min={10} max={100} step={1} onValueChange={value => onStream({ steps: Number(value) })} />
            </Control>

            <Control label="Guidance" value={format(stream.guidance, 1)} hint="SDXL-Turbo está destilado sin CFG: por encima de 1 la salida se llena de ruido.">
              <Slider value={stream.guidance} min={0} max={3} step={0.1} onValueChange={value => onStream({ guidance: Number(value) })} />
            </Control>
            <Control label="Delta" value={format(stream.delta, 2)} hint="Peso del ruido residual. Solo cuenta con guidance por encima de 1.">
              <Slider value={stream.delta} min={0} max={1} step={0.05} onValueChange={value => onStream({ delta: Number(value) })} />
            </Control>
            <Control label="Textura de fondo" value={format(stream.texture, 2)} hint="Ruido de color bajo el trazo: 0 objeto sobre fondo liso, 0,5 escena alrededor, 1 la escena manda.">
              <Slider value={stream.texture} min={0} max={1} step={0.05} onValueChange={value => onStream({ texture: Number(value) })} />
            </Control>
            <Control label="Semilla" value={String(settings.seed)} hint="Fija: sin parpadeo entre frames.">
              <Slider value={settings.seed} min={1} max={999} step={1} onValueChange={value => onChange({ seed: Number(value) })} />
            </Control>
            <Toggle
              label="Fondo del estilo"
              hint="Añade «centered, <fondo> background» al prompt."
              checked={settings.backdrop}
              onChange={backdrop => onChange({ backdrop })}
            />
            <Toggle
              label="Filtro NSFW"
              hint="Detector de Daydream, muy agresivo: cada frame marcado sale en negro puro. Apagado para probar; hará falta para el público."
              checked={stream.safetyChecker}
              onChange={safetyChecker => onStream({ safetyChecker })}
            />
          </Group>

          <Group title="ControlNet">
            <Toggle label={CONTROLNET_COPY.canny.label} hint={CONTROLNET_COPY.canny.hint} checked={stream.controlnets.canny.enabled} onChange={enabled => setControlNet('canny', { enabled })} />
            {stream.controlnets.canny.enabled ? (
              <>
                <Control
                  label="Peso base"
                  value={`${format(stream.controlnets.canny.scale, 2)} → ${format(derived.lineScale, 2)}`}
                  hint="AI Strength lo afloja: a 0 manda el trazo entero, a 100 queda el 40 % del peso base."
                >
                  <Slider value={stream.controlnets.canny.scale} min={0.05} max={1} step={0.05} onValueChange={value => setControlNet('canny', { scale: Number(value) })} />
                </Control>
                <div className="flex flex-col gap-2">
                  <span className="text-sm">Preprocesador</span>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Preprocesador de líneas">
                    {LINE_PREPROCESSORS.map(option => (
                      <button key={option.id} type="button" className="lab-chip" aria-pressed={stream.linePreprocessor === option.id} onClick={() => onStream({ linePreprocessor: option.id })}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {stream.linePreprocessor === 'canny' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Control label="Umbral bajo" value={String(stream.cannyLow)}>
                      <Slider value={stream.cannyLow} min={0} max={255} step={5} onValueChange={value => onStream({ cannyLow: Number(value) })} />
                    </Control>
                    <Control label="Umbral alto" value={String(stream.cannyHigh)}>
                      <Slider value={stream.cannyHigh} min={0} max={255} step={5} onValueChange={value => onStream({ cannyHigh: Number(value) })} />
                    </Control>
                  </div>
                ) : null}
              </>
            ) : null}
            {(['depth', 'tile'] as const).map(kind => (
              <div key={kind} className="flex flex-col gap-3">
                <Toggle label={CONTROLNET_COPY[kind].label} hint={CONTROLNET_COPY[kind].hint} checked={stream.controlnets[kind].enabled} onChange={enabled => setControlNet(kind, { enabled })} />
                {stream.controlnets[kind].enabled ? (
                  <Control label="Peso" value={format(stream.controlnets[kind].scale, 2)}>
                    <Slider value={stream.controlnets[kind].scale} min={0.05} max={1} step={0.05} onValueChange={value => setControlNet(kind, { scale: Number(value) })} />
                  </Control>
                ) : null}
              </div>
            ))}
          </Group>
        </>
      )}

      <Group title="Test estándar">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Boceto de prueba">
          {TEST_SKETCHES.map(sketch => (
            <button key={sketch.id} type="button" className="lab-chip" aria-pressed={sketch.id === testSketchId} onClick={() => onTestSketch(sketch.id)}>
              {sketch.word}
            </button>
          ))}
        </div>
        <p className="text-neutral-10 text-xs">
          <kbd className="font-mono">T</kbd> borra el lienzo y dibuja este boceto trazo a trazo con el bucle encendido, como lo haría una persona. Los
          mismos bocetos que usan las medidas de scripts/lab.
        </p>
      </Group>

      <details className="text-neutral-10 text-xs" open>
        <summary className="lab-focus cursor-pointer select-none">Prompt enviado</summary>
        <p className="mt-2 font-mono leading-relaxed">{prompt}</p>
      </details>
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
