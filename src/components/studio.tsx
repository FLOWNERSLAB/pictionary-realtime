import type { DrawingStroke } from '@digo-labs/ui';
import { Button, Kbd, Tabs, TabsList, TabsTab, ToggleTheme, useDrawing } from '@digo-labs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FINISH_MODELS, INPUT_LOOKS, LIVE_MODELS, STREAM_DEFAULTS, TRANSPORT_LABEL, buildPrompt, clampSteps, findModel, isMeasurable } from '../data/models';
import { DEFAULT_PRESET_ID, STYLE_PRESETS } from '../data/presets';
import { useDaydreamStream } from '../hooks/use-daydream-stream';
import { useLiveRender } from '../hooks/use-live-render';
import type { BenchRun } from '../lib/bench-log';
import { clearRuns, deleteRun, loadRuns, makeThumbnail, runFromMetrics, saveRun } from '../lib/bench-log';
import { errorMessage, fal, imageUrlFromResult } from '../lib/fal';
import { estimateCost, format, summarize } from '../lib/metrics';
import { toSquareJpeg } from '../lib/raster';
import { placeTestSketch, replayTestSketch, sleep } from '../lib/test-sketch';
import { CanvasPanel } from './canvas-panel';
import { LatencyTape } from './latency-tape';
import { ModelPicker } from './model-picker';
import { OutputPanel } from './output-panel';
import { ResultsPanel } from './results-panel';
import type { LiveSettings } from './settings-panel';
import { SettingsPanel } from './settings-panel';

type Layout = 'split' | 'overlay';
type Lightbox = 'live' | 'reveal';
type TestState = { label: string; modelId: string } | null;

const PHASE_COPY = {
  off: 'Parado',
  connecting: 'Conectando',
  cold: 'Arrancando el modelo',
  live: 'En vivo',
  error: 'Error',
} as const;

const INK = '#0a0a0a';
const INK_SIZE = 10;

/** Waits until `check` passes, the timeout runs out, or the run is aborted. */
const until = async (check: () => boolean, timeoutMs: number, signal: AbortSignal) => {
  const startedAt = performance.now();

  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) return false;

    await sleep(100, signal);
  }

  return true;
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const Studio = () => {
  const drawing = useDrawing();
  const { strokes, exportImage, isEmpty } = drawing;
  /**
   * The provider's actions close over its current strokes, so a copy held across
   * awaits writes stale state back (the test sketch vanished that way). The test
   * runner always goes through this ref.
   */
  const drawingRef = useRef(drawing);

  useEffect(() => {
    drawingRef.current = drawing;
  });

  const [modelId, setModelId] = useState(LIVE_MODELS[0].id);
  const [finishId, setFinishId] = useState(FINISH_MODELS[0].id);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [subject, setSubject] = useState('');
  const [running, setRunning] = useState(false);
  const [layout, setLayout] = useState<Layout>('split');
  const [lightbox, setLightbox] = useState<Lightbox>('live');
  const [panel, setPanel] = useState('settings');
  const [settings, setSettings] = useState<LiveSettings>({
    steps: LIVE_MODELS[0].steps.default,
    strength: 0.7,
    memory: 0,
    throttleMs: 0,
    seed: 35,
    scheduleMu: 2.3,
    interpolate: false,
    hd: false,
    guardSilhouette: true,
    stream: STREAM_DEFAULTS,
  });

  const [revealImage, setRevealImage] = useState<string | null>(null);
  const [revealMs, setRevealMs] = useState(0);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [runs, setRuns] = useState<BenchRun[]>(() => loadRuns());
  const [test, setTest] = useState<TestState>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(0);
  const testAbort = useRef<AbortController | null>(null);

  const model = findModel(modelId, LIVE_MODELS);
  const finishModel = findModel(finishId, FINISH_MODELS);
  const preset = STYLE_PRESETS.find(candidate => candidate.id === presetId) ?? STYLE_PRESETS[0];
  const prompt = buildPrompt(preset, subject, model, settings.guardSilhouette);
  const finishPrompt = buildPrompt(preset, subject, finishModel, settings.guardSilhouette);

  useEffect(() => {
    fetch('/api/fal/status')
      .then(response => response.json())
      .then(({ hasKey: present }) => setHasKey(Boolean(present)))
      .catch(() => setHasKey(false));
  }, []);

  // Undo, clear and replayed strokes never fire a pointer move: mark them dirty too.
  useEffect(() => {
    dirtyRef.current += 1;
  }, [strokes]);

  // A new style or parameter reaches the model without waiting for the next stroke.
  useEffect(() => {
    dirtyRef.current += 1;
  }, [prompt, preset.negative, settings]);

  const markDirty = useCallback(() => {
    dirtyRef.current += 1;
  }, []);

  const getSvg = useCallback(() => wrapperRef.current?.querySelector('svg') ?? null, []);

  const isDaydream = model.provider === 'daydream';
  const hasDrawing = strokes.some(stroke => stroke.tool === 'pen');

  const live = useLiveRender({
    model,
    enabled: running && !isDaydream,
    throttleMs: settings.throttleMs,
    prompt,
    negative: preset.negative,
    steps: settings.steps,
    strength: settings.strength,
    feedback: 1 - settings.memory,
    seed: settings.seed,
    scheduleMu: settings.scheduleMu,
    interpolate: settings.interpolate,
    hd: settings.hd,
    getSvg,
    dirtyRef,
    // Eraser strokes alone are not a drawing.
    hasDrawing,
  });

  const streamParams = useMemo(
    () =>
      model.buildInput({
        prompt,
        negative: preset.negative,
        imageDataUrl: '',
        steps: settings.steps,
        strength: settings.strength,
        feedback: 1,
        seed: settings.seed,
        stream: settings.stream,
      }),
    [model, prompt, preset.negative, settings.steps, settings.strength, settings.seed, settings.stream],
  );

  const stream = useDaydreamStream({
    model,
    enabled: running && isDaydream,
    params: streamParams,
    hasDrawing,
    texture: settings.stream.texture,
    look: settings.stream.inputLook,
    getSvg,
    dirtyRef,
  });

  const { probe } = stream;

  // A streamed model has no per-frame answers: its still is only for thumbnails.
  const source = isDaydream
    ? {
        output: stream.still,
        metrics: stream.metrics,
        error: stream.error,
        blankWarning: stream.buffering
          ? 'La salida se ha cortado: Daydream está recargando el pipeline o reconectando. Vuelve sola.'
          : stream.blackout
            ? 'La salida lleva 3 s en negro puro. Si es tras cambiar el preprocesador, espera ~30 s; si no vuelve, para y empieza el bucle de nuevo.'
            : null,
        clearMetrics: stream.clearMetrics,
        waitingMs: stream.waitingMs,
        phase: stream.phase,
      }
    : live;
  const { output, metrics, error, blankWarning, clearMetrics, waitingMs, phase } = source;
  const stats = useMemo(() => summarize(metrics, !isDaydream), [metrics, isDaydream]);
  const cost = estimateCost(model.billing, metrics);

  // The async test runner reads these after awaits, so it needs the latest values.
  const snapshot = useRef({ metrics, output, model, preset, settings, phase, probe });
  // Consecutive saves in "Probar todos" land before React re-renders.
  const runsRef = useRef(runs);

  useEffect(() => {
    snapshot.current = { metrics, output, model, preset, settings, phase, probe };
    runsRef.current = runs;
  });

  const selectModel = useCallback((id: string) => {
    const next = findModel(id, LIVE_MODELS);

    if (next.unavailable) return;

    setModelId(next.id);
    // Each model starts on its own sensible step count, so runs compare like for like.
    setSettings(current => ({ ...current, steps: clampSteps(next, next.steps.default) }));
    setLightbox('live');
  }, []);

  const saveCurrent = useCallback(
    async (standard: boolean, firstFrameMs?: number | null) => {
      const { metrics: current, output: frame, model: measured, preset: style, settings: used } = snapshot.current;

      if (!current.received) return;

      const next = saveRun(runsRef.current, {
        modelId: measured.id,
        modelLabel: measured.label,
        transport: TRANSPORT_LABEL[measured.transport],
        preset: style.label,
        steps: used.steps,
        inputSize: measured.inputSize,
        standard,
        ...runFromMetrics(current),
        firstFrameMs: firstFrameMs ?? current.firstFrameMs,
        cost: estimateCost(measured.billing, current),
        thumbnail: await makeThumbnail(frame),
      });

      runsRef.current = next;
      setRuns(next);
    },
    [],
  );

  /**
   * The standard test, one model: wake the endpoint with the whole sketch (that
   * wait is the cold start), then clear, redraw it at pointer speed and measure
   * only that stretch. Same drawing, same style, same seed for every model.
   */
  const runStandardTest = useCallback(
    async (signal: AbortSignal) => {
      const size = drawingRef.current.viewportSize;

      if (!size) throw new Error('El lienzo todavía no tiene tamaño.');

      const paint = {
        width: size.width,
        height: size.height,
        color: INK,
        size: INK_SIZE,
        addStroke: (stroke: DrawingStroke) => drawingRef.current.addStroke(stroke),
        updateStroke: (id: string, points: number[][]) => drawingRef.current.updateStroke(id, points),
        signal,
        onInk: markDirty,
      };

      drawingRef.current.clear();
      setRunning(true);
      setLightbox('live');
      await sleep(150, signal);

      const wokeAt = performance.now();

      await placeTestSketch(paint);
      markDirty();

      const streamed = snapshot.current.model.provider === 'daydream';
      const woke = await until(
        () => (streamed ? snapshot.current.phase === 'live' : snapshot.current.metrics.received > 0),
        180000,
        signal,
      );

      if (!woke) throw new Error(`${snapshot.current.model.label} no contestó en 3 minutos.`);

      const coldMs = performance.now() - wokeAt;

      drawingRef.current.clear();
      await sleep(400, signal);
      clearMetrics();

      await replayTestSketch(paint);

      if (streamed) {
        // A stream has no frame to wait for: latency comes from the blackout probe.
        await sleep(1000, signal);
        await snapshot.current.probe();
      } else {
        // Let the last frame land before closing the measurement.
        await until(() => snapshot.current.metrics.sent === snapshot.current.metrics.received, 15000, signal);
      }

      await sleep(300, signal);
      await saveCurrent(true, coldMs);
    },
    [clearMetrics, markDirty, saveCurrent],
  );

  const startTest = useCallback(
    async (all: boolean) => {
      testAbort.current?.abort();

      const controller = new AbortController();
      const queue = all ? LIVE_MODELS.filter(isMeasurable) : [model];

      testAbort.current = controller;
      setNotice(null);
      setPanel('results');

      for (const [index, candidate] of queue.entries()) {
        if (controller.signal.aborted) break;

        setTest({ label: all ? `${index + 1}/${queue.length} · ${candidate.label}` : candidate.label, modelId: candidate.id });

        if (candidate.id !== snapshot.current.model.id) {
          selectModel(candidate.id);
          await sleep(600, controller.signal).catch(() => undefined);
        }

        try {
          await runStandardTest(controller.signal);
        } catch (fault) {
          if ((fault as Error).name === 'AbortError') break;

          setNotice(`${candidate.label}: ${errorMessage(fault)}`);
        }
      }

      setTest(null);
      testAbort.current = null;
    },
    [model, runStandardTest, selectModel],
  );

  const stopTest = useCallback(() => {
    testAbort.current?.abort();
    setTest(null);
  }, []);

  const reveal = useCallback(async () => {
    setRevealLoading(true);
    setRevealError(null);
    setLightbox('reveal');

    try {
      const exported = await exportImage({ width: finishModel.inputSize, background: '#ffffff', padding: 48 });

      if (!exported) throw new Error('El lienzo está vacío: dibuja algo antes de revelar.');

      const imageDataUrl = await toSquareJpeg(exported.dataUrl, finishModel.inputSize);

      if (!imageDataUrl) throw new Error('No se pudo rasterizar el dibujo.');

      const startedAt = performance.now();
      const { data } = await fal.subscribe(finishModel.endpoint, {
        input: finishModel.buildInput({
          prompt: finishPrompt,
          negative: preset.negative,
          imageDataUrl,
          steps: finishModel.steps.max,
          strength: 0.8,
          feedback: 1,
          seed: settings.seed,
        }),
      });

      setRevealMs(performance.now() - startedAt);
      setRevealImage(imageUrlFromResult(data));
    } catch (fault) {
      setRevealError(errorMessage(fault));
    } finally {
      setRevealLoading(false);
    }
  }, [exportImage, finishModel, finishPrompt, preset.negative, settings.seed]);

  // Keyboard: the lab is driven with one hand on the pen and one on the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();

      if (key === ' ') {
        event.preventDefault();
        setRunning(current => !current);
      } else if (key === 't') void startTest(false);
      else if (key === 'r' && !isEmpty) void reveal();
      else if (key === 'o') setLayout(current => (current === 'split' ? 'overlay' : 'split'));
      else if (key === 'g') void saveCurrent(false);
      else if (key === 'l' && isDaydream) void probe();
      else if (key === 'escape') stopTest();
      else if (/^[1-9]$/.test(key)) setPresetId(STYLE_PRESETS[Number(key) - 1]?.id ?? presetId);
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [isDaydream, isEmpty, presetId, reveal, saveCurrent, probe, startTest, stopTest]);

  // A stream's still exists only for result thumbnails: on screen it is the live video or nothing.
  const liveImage = lightbox === 'reveal' ? revealImage : isDaydream ? null : output;
  const liveEmpty =
    lightbox === 'reveal' ? (
      <span className="max-w-xs text-sm">
        {revealLoading ? 'Renderizando el resultado final…' : 'Pulsa «Revelar» para el render final de alta calidad.'}
      </span>
    ) : !running ? (
      <span className="flex max-w-xs flex-col items-center gap-2 text-sm">
        <span>Enciende el bucle y dibuja.</span>
        <span className="text-neutral-10 text-xs">
          <Kbd>Espacio</Kbd> enciende · <Kbd>T</Kbd> test estándar
        </span>
      </span>
    ) : isDaydream && phase === 'error' ? (
      <span className="max-w-xs text-sm">El stream no arrancó: el motivo está debajo del lienzo. Para y vuelve a empezar.</span>
    ) : isDaydream && (phase === 'connecting' || phase === 'cold') ? (
      <span className="max-w-xs text-sm">
        {phase === 'connecting' ? 'Creando el stream en Daydream…' : `Cargando el pipeline de StreamDiffusion: ${format(waitingMs / 1000)} s.`}{' '}
        El primer frame queda medido aparte.
      </span>
    ) : phase === 'cold' && waitingMs > 3000 ? (
      <span className="max-w-xs text-sm">
        Arrancando {model.label}: {format(waitingMs / 1000)} s. En frío fal puede tardar minutos; el primer frame queda
        medido aparte.
      </span>
    ) : (
      <span className="max-w-xs text-sm">Dibuja en el papel: cada trazo sale hacia el modelo.</span>
    );

  const lightboxLabel = (
    <span className="bg-neutral-1/80 text-neutral-12 flex items-center gap-2 rounded-full px-3 py-1 text-xs backdrop-blur">
      <span className="lab-dot" data-phase={lightbox === 'reveal' ? 'off' : phase} />
      {lightbox === 'reveal' ? finishModel.label : model.label}
    </span>
  );

  const lightboxFooter =
    lightbox === 'reveal' && revealMs ? (
      <span className="bg-neutral-1/80 rounded-full px-3 py-1 font-mono text-xs backdrop-blur">
        {format(revealMs / 1000, 2)} s de render
      </span>
    ) : null;

  const outputPanel = (
    <OutputPanel
      image={liveImage}
      // On a blank canvas StreamDiffusion invents a figure from the prompt alone: keep it hidden, like fal.
      video={isDaydream && lightbox === 'live' && hasDrawing ? stream.video : null}
      alt={`Render de ${lightbox === 'reveal' ? finishModel.label : model.label}`}
      loading={lightbox === 'reveal' ? revealLoading : running && (isDaydream ? phase === 'connecting' || phase === 'cold' : metrics.sent > metrics.received)}
      empty={liveEmpty}
      warning={lightbox === 'live' ? blankWarning : null}
      label={lightboxLabel}
      footer={lightboxFooter}
      className={`size-full ${running && phase === 'live' && lightbox === 'live' ? 'lab-live-ring' : ''}`}
    />
  );

  // StreamDiffusion only: the frame the model gets, so the input look can be judged by eye.
  const inputPreview =
    isDaydream && stream.input ? (
      <figure className="border-neutralA-6 bg-neutral-1/80 flex flex-col gap-1 rounded-lg border p-1 backdrop-blur">
        <video
          ref={element => {
            if (element && element.srcObject !== stream.input) element.srcObject = stream.input;
          }}
          autoPlay
          muted
          playsInline
          aria-label="Entrada que recibe StreamDiffusion"
          className="size-20 rounded object-cover"
        />
        <figcaption className="text-neutral-11 px-0.5 text-[10px]">Lo que recibe</figcaption>
      </figure>
    ) : null;

  const setInputLook = (inputLook: (typeof INPUT_LOOKS)[number]['id']) =>
    setSettings(current => ({ ...current, stream: { ...current.stream, inputLook } }));

  return (
    <div className="lab-shell text-neutral-12 flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Pictionary</span>
          <span className="text-accent-11 font-mono text-xs">lab</span>
        </div>

        <div className="order-3 w-full md:order-none md:w-auto md:flex-1 md:justify-center md:flex">
          <ModelPicker models={LIVE_MODELS} value={modelId} onChange={selectModel} title="Modelo en vivo" />
        </div>

        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <span className="text-neutral-11 hidden items-center gap-2 text-xs sm:flex" aria-live="polite">
            <span className="lab-dot" data-phase={phase} />
            {PHASE_COPY[phase]}
          </span>
          <ToggleTheme />
        </div>
      </header>

      {hasKey ? null : (
        <p className="bg-warning-3 text-warning-11 px-6 py-2 text-sm">
          No hay FAL_KEY: copia <code>.env.example</code> a <code>.env</code>, pon tu clave de fal y reinicia el servidor
          (<code>npm run dev</code>). El lienzo funciona, pero fal responde 401.
        </p>
      )}

      <main className="grid flex-1 gap-6 px-4 pb-6 md:px-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={layout} onValueChange={value => setLayout(value as Layout)} variant="underline">
              <TabsList>
                <TabsTab value="split">Lado a lado</TabsTab>
                <TabsTab value="overlay">Superpuesto</TabsTab>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={lightbox} onValueChange={value => setLightbox(value as Lightbox)} variant="underline">
                <TabsList>
                  <TabsTab value="live">En vivo</TabsTab>
                  <TabsTab value="reveal">Revelado</TabsTab>
                </TabsList>
              </Tabs>
              <ModelPicker models={FINISH_MODELS} value={finishId} onChange={setFinishId} title="Render final" compact purpose="finish" />
              <Button variant="outline" className="rounded-full" disabled={revealLoading || isEmpty} onClick={() => void reveal()}>
                {revealLoading ? 'Revelando…' : 'Revelar'} <Kbd className="ml-2 opacity-70">R</Kbd>
              </Button>
            </div>
          </div>

          {layout === 'split' ? (
            <div className="mx-auto grid w-full max-w-[calc((100dvh-300px)*2+1rem)] gap-4 sm:grid-cols-2">
              <CanvasPanel
                wrapperRef={wrapperRef}
                onInk={markDirty}
                className="aspect-square w-full"
                emptyHint={isEmpty ? 'Dibuja aquí' : null}
                corner={inputPreview}
              />
              <div className="aspect-square w-full">{outputPanel}</div>
            </div>
          ) : (
            <div className="mx-auto aspect-square w-full max-w-[calc(100dvh-300px)] min-w-[280px]">
              <CanvasPanel
                wrapperRef={wrapperRef}
                onInk={markDirty}
                className="size-full"
                underlay={outputPanel}
                corner={inputPreview}
              />
            </div>
          )}

          {isDaydream ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Entrada al modelo">
              <span className="text-neutral-10 mr-1 text-xs">Entrada al modelo</span>
              {INPUT_LOOKS.map(look => (
                <button
                  key={look.id}
                  type="button"
                  className="lab-chip"
                  aria-pressed={settings.stream.inputLook === look.id}
                  title={look.hint}
                  onClick={() => setInputLook(look.id)}
                >
                  {look.label}
                </button>
              ))}
              <span className="text-neutral-10 basis-full text-xs">
                Tu lienzo no cambia: solo lo que recibe el modelo (miniatura en la esquina). En negro el fondo de la salida sale
                oscuro y desaparece el contorno negro del trazo.
              </span>
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="accent"
                onClick={() => setRunning(current => !current)}
                className="lab-cta min-w-44 rounded-full"
                aria-pressed={running}
              >
                {running ? 'Parar el bucle' : 'Empezar en vivo'}
                <Kbd className="ml-2 opacity-70">Espacio</Kbd>
              </Button>

              {test ? (
                <Button variant="outline" className="rounded-full" onClick={stopTest}>
                  Parar test · {test.label}
                </Button>
              ) : (
                <>
                  <Button variant="outline" className="rounded-full" onClick={() => void startTest(false)}>
                    Test estándar <Kbd className="ml-2 opacity-70">T</Kbd>
                  </Button>
                  <Button variant="ghost" className="rounded-full" onClick={() => void startTest(true)}>
                    Probar todos
                  </Button>
                </>
              )}

              {isDaydream ? (
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={phase !== 'live' || stream.probing || Boolean(test)}
                  onClick={() => void probe()}
                  title="Pone el lienzo en negro 5 veces y mide cuánto tarda la salida en oscurecerse"
                >
                  {stream.probing ? 'Midiendo…' : 'Medir latencia'} <Kbd className="ml-2 opacity-70">L</Kbd>
                </Button>
              ) : null}

              <Button
                variant="ghost"
                className="rounded-full"
                disabled={!metrics.received || Boolean(test)}
                onClick={() => void saveCurrent(false)}
              >
                Guardar medida <Kbd className="ml-2 opacity-70">G</Kbd>
              </Button>

            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <label className="border-neutralA-5 focus-within:border-accent-8 flex min-w-0 items-center gap-2 rounded-full border px-4 py-2 md:w-64">
                <span className="text-neutral-10 shrink-0 text-xs">Palabra</span>
                <input
                  value={subject}
                  onChange={event => setSubject(event.target.value)}
                  placeholder="cohete, gato, taza…"
                  className="placeholder:text-neutral-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>

              <div className="lab-scroll-x flex min-w-0 flex-1 gap-2 overflow-x-auto pr-8" role="group" aria-label="Estilo">
                {STYLE_PRESETS.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className="lab-chip"
                    aria-pressed={candidate.id === presetId}
                    onClick={() => setPresetId(candidate.id)}
                    title={index < 9 ? `Tecla ${index + 1}` : undefined}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            </div>

            {error || revealError || notice ? (
              <p className="text-error-11 text-sm" role="alert">
                {notice ?? revealError ?? error}
              </p>
            ) : null}
          </div>

          <LatencyTape
            metrics={metrics}
            stats={stats}
            waitingMs={waitingMs}
            cost={cost}
            costNote={model.billing.note}
            streamed={isDaydream}
          />
        </div>

        <aside className="border-neutralA-4 flex flex-col gap-5 xl:border-l xl:pl-6">
          <Tabs value={panel} onValueChange={value => setPanel(String(value))} variant="underline">
            <TabsList>
              <TabsTab value="settings">Ajustes</TabsTab>
              <TabsTab value="results">Resultados{runs.length ? ` · ${runs.length}` : ''}</TabsTab>
            </TabsList>
          </Tabs>

          {panel === 'settings' ? (
            <SettingsPanel model={model} settings={settings} onChange={next => setSettings(current => ({ ...current, ...next }))} />
          ) : (
            <ResultsPanel
              runs={runs}
              onDelete={id => setRuns(current => deleteRun(current, id))}
              onClear={() => setRuns(clearRuns())}
            />
          )}

          <details className="text-neutral-10 mt-auto text-xs">
            <summary className="lab-focus cursor-pointer select-none">Prompt enviado</summary>
            <p className="mt-2 font-mono leading-relaxed">{(isDaydream && settings.stream.prompt.trim()) || prompt}</p>
          </details>
        </aside>
      </main>
    </div>
  );
};
