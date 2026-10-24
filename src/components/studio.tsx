import type { DrawingStroke } from '@digo-labs/ui';
import { Button, Kbd, Tabs, TabsList, TabsTab, ToggleTheme, useDrawing } from '@digo-labs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Settings } from '../data/model';
import { DEFAULT_SETTINGS, MODEL } from '../data/model';
import type { StreamSettings } from '../data/stream';
import { STREAM_DEFAULTS, STREAM_MODEL, buildStreamParams, describeStreamStrength } from '../data/stream';
import { DEFAULT_STYLE_ID, STYLES, findStyle } from '../data/styles';
import { useDaydreamStream } from '../hooks/use-daydream-stream';
import { useGuess } from '../hooks/use-guess';
import { useLiveRender } from '../hooks/use-live-render';
import { hasFalKey } from '../lib/fal';
import { GUESS_CONFIDENT, hasGuessKey } from '../lib/guess';
import { estimateCost, format, summarize } from '../lib/metrics';
import { AI_STRENGTH_DEFAULT, buildPrompt, inputBlurFor, rungFor } from '../lib/prompt';
import { STREAM_NEGATIVE, buildStreamPrompt } from '../lib/stream-prompt';
import { TEST_SKETCHES, findSketch, replayTestSketch, sleep } from '../lib/test-sketch';
import { CanvasPanel } from './canvas-panel';
import { HistoryStrip } from './history-strip';
import { LatencyTape } from './latency-tape';
import { OutputPanel } from './output-panel';
import type { Engine } from './settings-panel';
import { SettingsPanel } from './settings-panel';
import { StrengthControl } from './strength-control';
import { StylePicker } from './style-picker';

type Layout = 'split' | 'overlay';

const PHASE_COPY = {
  off: 'Parado',
  connecting: 'Conectando',
  cold: 'Arrancando el modelo',
  live: 'En vivo',
  error: 'Error',
} as const;

const ENGINE_LABEL: Record<Engine, string> = { klein: 'Flux realtime', stream: 'StreamDiffusion' };

const INK = '#0a0a0a';
const INK_SIZE = 10;
/** Typing in the hint field changes the prompt; one frame per keystroke would be waste. */
const HINT_DEBOUNCE_MS = 350;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const useDebounced = <T,>(value: T, ms: number) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);

    return () => window.clearTimeout(timer);
  }, [value, ms]);

  return debounced;
};

export const Studio = () => {
  const drawing = useDrawing();
  const { strokes, isEmpty } = drawing;
  /**
   * The provider's actions close over its current strokes, so a copy held across
   * awaits writes stale state back (the test sketch vanished that way). The test
   * runner always goes through this ref.
   */
  const drawingRef = useRef(drawing);

  useEffect(() => {
    drawingRef.current = drawing;
  });

  const [engine, setEngine] = useState<Engine>('klein');
  const [styleId, setStyleId] = useState<string>(DEFAULT_STYLE_ID);
  const [hintInput, setHintInput] = useState('');
  const [strength, setStrength] = useState(AI_STRENGTH_DEFAULT);
  const [running, setRunning] = useState(false);
  const [layout, setLayout] = useState<Layout>('split');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [streamSettings, setStreamSettings] = useState<StreamSettings>(STREAM_DEFAULTS);
  const [testSketchId, setTestSketchId] = useState(TEST_SKETCHES[0].id);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [hasDaydreamKey, setHasDaydreamKey] = useState(true);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(true);
  /** Anticipar: the machine guesses the drawing and its guess steers the prompt. */
  const [anticipate, setAnticipate] = useState(true);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(0);
  const testAbort = useRef<AbortController | null>(null);

  const hint = useDebounced(hintInput, HINT_DEBOUNCE_MS);
  const style = findStyle(styleId);
  const rung = rungFor(strength);
  const isStream = engine === 'stream';

  const getSvg = useCallback(() => wrapperRef.current?.querySelector('svg') ?? null, []);

  const hasDrawing = strokes.some(stroke => stroke.tool === 'pen');

  // ── The live guess (both engines read it; a typed hint always wins over it)
  const guessing = useGuess({ enabled: running && anticipate && hasAnthropicKey && !hint.trim(), hasDrawing, getSvg, dirtyRef });
  const { guess } = guessing;
  /** What the history and the labels show as the subject: the hint, or the guess marked with ≈. */
  const shownHint = hint.trim() || (guess?.word ? `≈${guess.word}` : '');

  // ── Flux realtime lane (untouched by the stream lane)
  const prompt = useMemo(() => buildPrompt({ style, hint, guess, strength, backdrop: settings.backdrop }), [style, hint, guess, strength, settings.backdrop]);
  const inputBlur = inputBlurFor(strength);
  const meta = useMemo(
    () => ({ styleId: style.id, styleLabel: style.label, strength, rungLabel: rung.label, hint: shownHint }),
    [style.id, style.label, strength, rung.label, shownHint],
  );

  useEffect(() => {
    void hasFalKey().then(setHasKey);
    void hasGuessKey().then(setHasAnthropicKey);
    fetch('/api/daydream/status')
      .then(response => response.json())
      .then(({ hasKey: present }) => setHasDaydreamKey(Boolean(present)))
      .catch(() => setHasDaydreamKey(false));
  }, []);

  // Undo, clear and replayed strokes never fire a pointer move: mark them dirty too.
  useEffect(() => {
    dirtyRef.current += 1;
  }, [strokes]);

  // A new style, strength or parameter reaches the model without waiting for the next stroke.
  useEffect(() => {
    dirtyRef.current += 1;
  }, [prompt, settings, inputBlur]);

  const markDirty = useCallback(() => {
    dirtyRef.current += 1;
  }, []);

  const live = useLiveRender({ enabled: running && !isStream, prompt, settings, inputBlur, meta, hasDrawing, getSvg, dirtyRef });

  // ── StreamDiffusion lane
  const streamPrompt = useMemo(() => buildStreamPrompt({ style, hint, guess, backdrop: settings.backdrop }), [style, hint, guess, settings.backdrop]);
  const streamParams = useMemo(
    () => buildStreamParams({ prompt: streamPrompt, negative: STREAM_NEGATIVE, seed: settings.seed, strength, stream: streamSettings }),
    [streamPrompt, settings.seed, strength, streamSettings],
  );
  const stream = useDaydreamStream({
    enabled: running && isStream,
    params: streamParams,
    hasDrawing,
    texture: streamSettings.texture,
    look: streamSettings.inputLook,
    getSvg,
    dirtyRef,
  });
  const { probe } = stream;

  // What the panels read, whichever engine is on.
  const source = isStream
    ? {
        metrics: stream.metrics,
        error: stream.error,
        phase: stream.phase,
        waitingMs: stream.waitingMs,
        clearMetrics: stream.clearMetrics,
        blankWarning: stream.buffering
          ? 'La salida se ha cortado: Daydream está recargando el pipeline o reconectando. Vuelve sola.'
          : stream.blackout
            ? 'La salida lleva 3 s en negro puro. Si es tras cambiar el preprocesador, espera ~30 s; si no vuelve, para y empieza el bucle de nuevo.'
            : null,
      }
    : { metrics: live.metrics, error: live.error, phase: live.phase, waitingMs: live.waitingMs, clearMetrics: live.clearMetrics, blankWarning: live.blankWarning };
  const { metrics, error, phase, waitingMs, clearMetrics, blankWarning } = source;
  const { frames, output } = live;
  const stats = useMemo(() => summarize(metrics, !isStream), [metrics, isStream]);
  const cost = estimateCost(metrics);

  // The async test runner reads these after awaits, so it needs the latest values.
  const snapshot = useRef({ metrics, strength, phase, probe, isStream });

  useEffect(() => {
    snapshot.current = { metrics, strength, phase, probe, isStream };
  });

  const bumpStrength = useCallback((delta: number) => {
    setStrength(current => Math.round(Math.min(1, Math.max(0, current + delta)) * 100) / 100);
  }, []);

  /** Switching engines stops the loop: the two never run at once. */
  const selectEngine = useCallback((next: Engine) => {
    setEngine(next);
    setRunning(false);
    setPinned(null);
    setNotice(null);
  }, []);

  /**
   * The standard test: clear, switch the loop on, draw the chosen sketch stroke by
   * stroke at pointer speed, and report what the tape measured. Same drawing, same
   * style, same seed every time, so runs compare.
   */
  const runTest = useCallback(async () => {
    testAbort.current?.abort();

    const controller = new AbortController();
    const { signal } = controller;
    const size = drawingRef.current.viewportSize;

    testAbort.current = controller;
    setNotice(null);

    if (!size) {
      setNotice('El lienzo todavía no tiene tamaño.');

      return;
    }

    setTesting(true);

    try {
      drawingRef.current.clear();
      setRunning(true);
      setPinned(null);
      clearMetrics();
      await sleep(300, signal);

      const sketch = findSketch(testSketchId);

      await replayTestSketch({
        sketch,
        width: size.width,
        height: size.height,
        color: INK,
        size: INK_SIZE,
        addStroke: (stroke: DrawingStroke) => drawingRef.current.addStroke(stroke),
        updateStroke: (id, points) => drawingRef.current.updateStroke(id, points),
        signal,
        onInk: markDirty,
      });

      const startedAt = performance.now();

      if (snapshot.current.isStream) {
        // A stream has no frame to wait for: latency comes from the blackout probe.
        while (snapshot.current.phase !== 'live' && performance.now() - startedAt < 180000) await sleep(200, signal);
        await sleep(1000, signal);
        await snapshot.current.probe();
      } else {
        // Let the last frame land before reading the tape.
        while (snapshot.current.metrics.sent !== snapshot.current.metrics.received && performance.now() - startedAt < 15000) await sleep(100, signal);
      }

      const { metrics: measured, isStream: streamed } = snapshot.current;
      const summary = summarize(measured, !streamed);

      setNotice(
        streamed
          ? `Test «${sketch.word}» en StreamDiffusion: ${format(summary.fps, 1)} fps · latencia de extremo a extremo p50 ${format(summary.p50)} ms (${measured.received} sondeos) · 1er frame ${
              measured.firstFrameMs === null ? '-' : `${format(measured.firstFrameMs / 1000, 1)} s`
            }`
          : `Test «${sketch.word}»: ${measured.received} frames mientras se dibujaba · p50 ${format(summary.p50)} ms · p90 ${format(summary.p90)} ms · 1er frame ${
              measured.firstFrameMs === null ? '-' : `${format(measured.firstFrameMs / 1000, 1)} s`
            }`,
      );
    } catch (fault) {
      if ((fault as Error).name !== 'AbortError') setNotice((fault as Error).message);
    } finally {
      setTesting(false);
      testAbort.current = null;
    }
  }, [clearMetrics, markDirty, testSketchId]);

  const stopTest = useCallback(() => {
    testAbort.current?.abort();
    setTesting(false);
  }, []);

  // Keyboard: one hand on the pen, one on the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();

      if (key === ' ') {
        event.preventDefault();
        setRunning(current => !current);
      } else if (key === 't') void runTest();
      else if (key === 'o') setLayout(current => (current === 'split' ? 'overlay' : 'split'));
      else if (key === 'l' && isStream) void probe();
      else if (key === 'escape') {
        stopTest();
        setPinned(null);
      } else if (key === '[' || key === ']') bumpStrength(key === ']' ? 0.05 : -0.05);
      else if (/^[1-9]$/.test(key)) {
        const style = STYLES[Number(key) - 1];

        if (style) setStyleId(style.id);
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [bumpStrength, isStream, probe, runTest, stopTest]);

  const pinnedFrame = pinned === null ? null : frames.find(frame => frame.id === pinned);

  // The pinned frame left the history: back to live.
  if (pinned !== null && !pinnedFrame) setPinned(null);

  const shown = isStream ? null : (pinnedFrame ?? output);

  const empty = !running ? (
    <span className="flex max-w-xs flex-col items-center gap-2 text-sm">
      <span>Enciende el bucle y dibuja.</span>
      <span className="text-neutral-10 text-xs">
        <Kbd>Espacio</Kbd> enciende · <Kbd>T</Kbd> dibuja el boceto de prueba
      </span>
    </span>
  ) : phase === 'error' ? (
    <span className="max-w-xs text-sm">{isStream ? 'El stream no arrancó: el motivo está debajo del lienzo. Para y vuelve a empezar.' : 'fal no contesta: el motivo está debajo del lienzo.'}</span>
  ) : isStream && (phase === 'connecting' || phase === 'cold') ? (
    <span className="max-w-xs text-sm">
      {phase === 'connecting' ? 'Creando el stream en Daydream…' : `Cargando el pipeline de StreamDiffusion: ${format(waitingMs / 1000)} s.`} El primer frame queda
      medido aparte.
    </span>
  ) : phase === 'cold' && waitingMs > 3000 ? (
    <span className="max-w-xs text-sm">
      Arrancando {MODEL.label}: {format(waitingMs / 1000)} s. En frío fal puede tardar hasta minutos; el primer frame queda medido aparte.
    </span>
  ) : (
    <span className="max-w-xs text-sm">Dibuja en el papel: cada trazo sale hacia el modelo.</span>
  );

  const label = (
    <span className="bg-neutral-1/80 text-neutral-12 flex items-center gap-2 rounded-full px-3 py-1 text-xs backdrop-blur">
      <span className="lab-dot" data-phase={pinned === null ? phase : 'off'} />
      {isStream ? (
        <>
          {STREAM_MODEL.label} · {style.label} · {Math.round(strength * 100)}
          {shownHint ? ` · «${shownHint}»` : ''}
        </>
      ) : shown ? (
        <>
          {shown.styleLabel} · {shown.rungLabel} {Math.round(shown.strength * 100)}
          {shown.hint ? ` · «${shown.hint}»` : ''}
          {pinned !== null ? ' · fijado' : ''}
        </>
      ) : (
        MODEL.label
      )}
    </span>
  );

  const footer =
    shown && shown.latencyMs !== null ? (
      <span className="bg-neutral-1/80 rounded-full px-3 py-1 font-mono text-xs backdrop-blur">{format(shown.latencyMs)} ms</span>
    ) : null;

  const outputPanel = (
    <OutputPanel
      image={shown?.url ?? null}
      // On a blank canvas StreamDiffusion invents a figure from the prompt alone: keep it hidden, like fal.
      video={isStream && hasDrawing ? stream.video : null}
      alt={shown ? `${shown.styleLabel}, AI Strength ${Math.round(shown.strength * 100)}` : 'Render'}
      loading={running && (isStream ? phase === 'connecting' || phase === 'cold' : pinned === null && metrics.sent > metrics.received)}
      empty={empty}
      warning={pinned === null ? blankWarning : null}
      label={label}
      footer={footer}
      className={`size-full ${running && phase === 'live' && pinned === null ? 'lab-live-ring' : ''}`}
    />
  );

  // StreamDiffusion only: the frame the model gets, so the input look can be judged by eye.
  const inputPreview =
    isStream && stream.input ? (
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

  return (
    <div className="lab-shell text-neutral-12 flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Pictionary</span>
          <span className="text-accent-11 font-mono text-xs">lab</span>
        </div>

        <Tabs value={engine} onValueChange={value => selectEngine(value as Engine)} variant="underline">
          <TabsList>
            <TabsTab value="klein">{ENGINE_LABEL.klein}</TabsTab>
            <TabsTab value="stream" disabled={!hasDaydreamKey}>
              {ENGINE_LABEL.stream}
            </TabsTab>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-4">
          <span className="text-neutral-11 flex items-center gap-2 text-xs" aria-live="polite">
            <span className="lab-dot" data-phase={phase} />
            {PHASE_COPY[phase]}
            {stats.p50 ? <span className="font-mono tabular-nums">· {format(stats.p50)} ms</span> : null}
            {isStream && stats.fps ? <span className="font-mono tabular-nums">· {format(stats.fps, 1)} fps</span> : null}
          </span>
          <ToggleTheme />
        </div>
      </header>

      {hasKey ? null : (
        <p className="bg-warning-3 text-warning-11 px-6 py-2 text-sm">
          No hay FAL_KEY: copia <code>.env.example</code> a <code>.env</code>, pon tu clave de fal y reinicia el servidor (<code>npm run dev</code>). El
          lienzo funciona, pero fal responde 401.
        </p>
      )}
      {hasDaydreamKey ? null : (
        <p className="bg-neutral-3 text-neutral-11 px-6 py-2 text-xs">
          StreamDiffusion está bloqueado: falta <code>DAYDREAM_API_KEY</code> en <code>.env</code> (y reiniciar el servidor).
        </p>
      )}

      <main className="grid flex-1 gap-6 px-4 pb-6 md:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={layout} onValueChange={value => setLayout(value as Layout)} variant="underline">
              <TabsList>
                <TabsTab value="split">Lado a lado</TabsTab>
                <TabsTab value="overlay">Superpuesto</TabsTab>
              </TabsList>
            </Tabs>
            <span className="text-neutral-10 text-xs">
              <Kbd>O</Kbd> cambia la vista · <Kbd>1</Kbd>-<Kbd>9</Kbd> estilos · <Kbd>Esc</Kbd> para el test
              {isStream ? (
                <>
                  {' '}
                  · <Kbd>L</Kbd> mide la latencia
                </>
              ) : null}
            </span>
          </div>

          {layout === 'split' ? (
            <div className="mx-auto grid w-full max-w-[calc((100dvh-360px)*2+1rem)] gap-4 sm:grid-cols-2">
              <CanvasPanel wrapperRef={wrapperRef} onInk={markDirty} className="aspect-square w-full" emptyHint={isEmpty ? 'Dibuja aquí' : null} corner={inputPreview} />
              <div className="aspect-square w-full">{outputPanel}</div>
            </div>
          ) : (
            <div className="mx-auto aspect-square w-full max-w-[calc(100dvh-360px)] min-w-[280px]">
              <CanvasPanel wrapperRef={wrapperRef} onInk={markDirty} className="size-full" underlay={outputPanel} corner={inputPreview} />
            </div>
          )}

          {isStream ? null : <HistoryStrip frames={frames} pinned={pinned} onPin={setPinned} />}

          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="accent" onClick={() => setRunning(current => !current)} className="lab-cta min-w-44 rounded-full" aria-pressed={running}>
                {running ? 'Parar el bucle' : 'Empezar en vivo'}
                <Kbd className="ml-2 opacity-70">Espacio</Kbd>
              </Button>

              <label className="border-neutralA-5 focus-within:border-accent-8 flex min-w-0 flex-1 items-center gap-2 rounded-full border px-4 py-2 sm:max-w-xs">
                <span className="text-neutral-10 shrink-0 text-xs">Pista</span>
                <input
                  value={hintInput}
                  onChange={event => setHintInput(event.target.value)}
                  placeholder="qué es: cat, rocket, pizza…"
                  className="placeholder:text-neutral-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  aria-label="Pista: qué representa el dibujo"
                />
              </label>

              <button
                type="button"
                className="lab-chip"
                aria-pressed={anticipate && hasAnthropicKey}
                disabled={!hasAnthropicKey}
                onClick={() => setAnticipate(current => !current)}
                title={
                  hasAnthropicKey
                    ? 'La máquina adivina qué dibujas (Claude Haiku, una llamada por trazo) y su adivinanza entra en el prompt cuando no hay pista. Es el juego: nadie escribe la palabra.'
                    : 'Falta ANTHROPIC_API_KEY en .env'
                }
              >
                Anticipar
              </button>

              {anticipate && hasAnthropicKey && !hint.trim() ? (
                <span className="text-neutral-11 flex min-w-0 items-center gap-2 text-xs" aria-live="polite" title={guessing.error ?? undefined}>
                  <span className="lab-dot" data-phase={guessing.error ? 'error' : guessing.pending ? 'cold' : guess ? 'live' : 'off'} />
                  {guess?.word ? (
                    <>
                      <span className="text-neutral-12 truncate">cree que es «{guess.word}»</span>
                      <span className="font-mono tabular-nums">
                        {guess.confidence} %{guess.confidence < GUESS_CONFIDENT && guess.kind !== 'unknown' ? ` · ${guess.kind}` : ''} · {format(guess.ms)} ms
                      </span>
                    </>
                  ) : guess ? (
                    <span>todavía no ve nada</span>
                  ) : running ? (
                    <span>adivina al primer trazo</span>
                  ) : (
                    <span>adivina mientras dibujas</span>
                  )}
                </span>
              ) : null}

              {testing ? (
                <Button variant="outline" className="rounded-full" onClick={stopTest}>
                  Parar test <Kbd className="ml-2 opacity-70">Esc</Kbd>
                </Button>
              ) : (
                <Button variant="outline" className="rounded-full" onClick={() => void runTest()}>
                  Test «{findSketch(testSketchId).word}» <Kbd className="ml-2 opacity-70">T</Kbd>
                </Button>
              )}

              {isStream ? (
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={phase !== 'live' || stream.probing || testing}
                  onClick={() => void probe()}
                  title="Pone la entrada en plano 5 veces y mide cuánto tarda la salida en seguirla"
                >
                  {stream.probing ? 'Midiendo…' : 'Medir latencia'} <Kbd className="ml-2 opacity-70">L</Kbd>
                </Button>
              ) : null}
            </div>

            <StrengthControl
              value={strength}
              onChange={setStrength}
              readout={isStream ? describeStreamStrength(strength, streamSettings) : undefined}
              hint={
                isStream
                  ? 'En StreamDiffusion no hay escalera de frases: el valor mueve el t_index (cuánto del dibujo sobrevive al ruido) y afloja el ControlNet de líneas.'
                  : undefined
              }
            />

            <StylePicker value={styleId} onChange={setStyleId} />

            {error || notice ? (
              <p className={`${notice ? 'text-neutral-11' : 'text-error-11'} text-sm`} role="status">
                {notice ?? error}
              </p>
            ) : null}
          </div>

          <LatencyTape metrics={metrics} stats={stats} waitingMs={waitingMs} cost={cost} streamed={isStream} />
        </div>

        <aside className="border-neutralA-4 flex flex-col gap-5 xl:border-l xl:pl-6">
          <h2 className="text-neutral-10 text-[11px] tracking-wide uppercase">Ajustes · {ENGINE_LABEL[engine]}</h2>
          <SettingsPanel
            engine={engine}
            settings={settings}
            onChange={next => setSettings(current => ({ ...current, ...next }))}
            stream={streamSettings}
            onStream={next => setStreamSettings(current => ({ ...current, ...next }))}
            strength={strength}
            testSketchId={testSketchId}
            onTestSketch={setTestSketchId}
            prompt={isStream ? streamSettings.prompt.trim() || streamPrompt : prompt}
          />
        </aside>
      </main>
    </div>
  );
};
