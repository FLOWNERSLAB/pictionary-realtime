/**
 * Browser harness for the StreamDiffusion lane. Evaluated inside the lab page (paste
 * in the console, or run through a browser tool) with scripts/lab/capture-server.mjs
 * listening on 5191. It drives the real UI (style chips, strength rungs, hint field,
 * the T test) and grabs frames off the output <video> and the paper, so what it
 * records is exactly what the guest sees.
 *
 *   __sd.matrix({ styles: ['photo', …], strengths: [0.25, 0.55, 0.85], tag: 'house' })
 *   __sd.record({ seconds: 12, fps: 10, tag: 'cat', test: true })
 *   __sd.stats()
 */
(() => {
  const SERVER = 'http://localhost:5191';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const post = (name, body) => fetch(`${SERVER}/${name}`, { method: 'POST', body, mode: 'cors' }).then(r => r.ok);
  const video = () => document.querySelector('video[aria-label^="Render"], .lab-lightbox video');
  const paper = () => document.querySelector('.lab-ink svg');

  // A hidden window does not paint the <video>, so drawImage(video) gives black. The
  // frames are read off a clone of the track instead (same trick as the lab's hook).
  let latestFrame = null;
  let tapped = null;

  const tap = () => {
    const v = video();
    const track = v?.srcObject?.getVideoTracks?.()[0];

    if (!track || tapped === track) return;

    tapped = track;

    const reader = new MediaStreamTrackProcessor({ track: track.clone() }).readable.getReader();

    (async () => {
      while (tapped === track) {
        const { value, done } = await reader.read();

        if (done || !value) break;

        latestFrame?.close();
        latestFrame = value;
      }
    })();
  };

  const grab = (quality = 0.82) => {
    tap();

    const frame = latestFrame;

    if (!frame) return null;

    const c = document.createElement('canvas');

    c.width = frame.displayWidth;
    c.height = frame.displayHeight;
    c.getContext('2d').drawImage(frame, 0, 0);

    return c.toDataURL('image/jpeg', quality);
  };

  // The paper as a PNG (the SVG is drawn into a canvas), so Python can read it.
  const grabPaper = () =>
    new Promise(resolve => {
      const svg = paper();

      if (!svg) return resolve(null);

      const { width, height } = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);

      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      clone.style.color = '#0a0a0a';

      const image = new Image();

      image.onload = () => {
        const c = document.createElement('canvas');

        c.width = 512;
        c.height = 512;

        const ctx = c.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 512, 512);
        ctx.drawImage(image, 0, 0, 512, 512);
        resolve(c.toDataURL('image/png'));
      };
      image.onerror = () => resolve(null);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    });

  const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const chip = (label, selector = 'button.lab-chip') => [...document.querySelectorAll(selector)].find(b => b.textContent.trim().replace(/^\d\s*/, '') === label);
  const setStyle = id => {
    const labels = { photo: 'Natural', studio: 'Estudio', cinematic: 'Cine', film35: '35 mm', golden: 'Hora dorada', night: 'Noche', macro: 'Macro', bw: 'Blanco y negro', clay: 'Arcilla', chrome: 'Cromo', glass: 'Cristal', wood: 'Madera', papercraft: 'Papel', neon: 'Neón', watercolor: 'Acuarela', ink: 'Tinta', oil: 'Óleo', cartoon: 'Cartoon', pixel: 'Pixel', riso: 'Risografía' };

    chip(labels[id])?.click();
  };
  // The slider is a custom component: the rung buttons under it are the reliable handle
  // (each sets the middle of its band), then [ and ] move 0,05 at a time.
  const RUNGS = [[0, 0.12], [0.12, 0.25], [0.25, 0.38], [0.38, 0.5], [0.5, 0.62], [0.62, 0.75], [0.75, 0.88], [0.88, 1]];
  const setStrength = value => {
    const index = Math.max(0, RUNGS.findIndex(([, upTo]) => value < upTo));
    const at = index < 0 ? RUNGS.length - 1 : index;
    const [from, upTo] = RUNGS[at];
    const mid = Math.round(((from + upTo) / 2) * 100) / 100;
    const button = document.querySelectorAll('button.lab-rung')[at];

    if (!button) return false;

    button.click();

    const steps = Math.round((value - mid) / 0.05);

    for (let k = 0; k < Math.abs(steps); k += 1) key(steps > 0 ? ']' : '[');

    return true;
  };
  const setHint = text => {
    const input = document.querySelector('input[aria-label^="Pista"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const stats = () => {
    const header = document.querySelector('header [aria-live]')?.textContent ?? '';
    const readout = [...document.querySelectorAll('.lab-tape dd')].map(d => d.textContent);

    return { header, tape: readout };
  };

  const matrix = async ({ styles, strengths = [0.25, 0.55, 0.85], tag = 'run', settleMs = 1800 }) => {
    const log = [];

    for (const style of styles) {
      setStyle(style);

      for (const strength of strengths) {
        setStrength(strength);
        await sleep(settleMs);

        const at = performance.now();
        const frame = grab();

        if (frame) await post(`matrix/${tag}-${style}-${Math.round(strength * 100)}.jpg`, frame);

        log.push({ style, strength, at, ok: Boolean(frame) });
      }
    }

    await post(`matrix/${tag}-log.json`, JSON.stringify({ log, stats: stats() }));

    return log.length;
  };

  const record = async ({ seconds = 12, fps = 10, tag = 'take', test = false }) => {
    const frames = [];
    const t0 = performance.now();

    if (test) key('t');

    let index = 0;

    while (performance.now() - t0 < seconds * 1000) {
      const at = performance.now() - t0;
      const out = grab(0.75);
      const sheet = await grabPaper();

      if (out) await post(`record/${tag}/out-${String(index).padStart(3, '0')}.jpg`, out);
      if (sheet) await post(`record/${tag}/paper-${String(index).padStart(3, '0')}.png`, sheet);

      frames.push({ index, at: Math.round(at), out: Boolean(out), paper: Boolean(sheet) });
      index += 1;

      const next = t0 + (index * 1000) / fps;

      await sleep(Math.max(0, next - performance.now()));
    }

    await post(`record/${tag}/log.json`, JSON.stringify({ tag, seconds, fps, frames, stats: stats() }));

    return frames.length;
  };

  window.__sd = { matrix, record, stats, setStyle, setStrength, setHint, grab, key };

  return 'harness ready';
})();
