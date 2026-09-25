/*
 * Style × word matrix, run inside the lab page (paste into the console or javascript_tool).
 *
 * 1. `node scripts/prompt-matrix/capture-server.mjs` (port 5191, saves to ./shots)
 * 2. In the lab: pick the model, press T so the house is drawn and the model is warm.
 *    For StreamDiffusion, apply the recipe first and leave the loop running.
 * 3. Paste this file, then `__matrixRun('klein', 'image')` or `__matrixRun('sdxl', 'video')`.
 *    Progress in `__matrix`; set `__matrix.abort = true` to stop.
 * 4. `node scripts/prompt-matrix/build-sheet.mjs <after-dir> [before-dir] [out.html]` builds the
 *    contact sheet (tabs klein / sdxl / sdxl-scribble, before and after side by side).
 *
 * klein sends one frame per prompt change, so 'image' waits for the first new frame
 * and then 1,5 s of quiet. A stream has no frame boundary: 'video' waits 3,5 s.
 * First run: 2026-09-25, 17 styles × (no word, «house») × (klein realtime, SDXL-Turbo Transformar).
 */
window.__matrixRun = async (tag, mode, subjects = ['', 'house']) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const state = (window.__matrix = { tag, status: 'running', done: 0, items: [], errors: [], abort: false });
  const input = document.querySelector('input[placeholder^="cohete"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const setSubject = v => {
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const chips = () => [...document.querySelectorAll('[aria-label="Estilo"] button')];
  const promptText = () =>
    [...document.querySelectorAll('details')]
      .find(d => d.querySelector('summary')?.textContent.includes('Prompt enviado'))
      ?.querySelector('p')?.textContent ?? '';
  const outImg = () => [...document.querySelectorAll('img')].find(i => i.alt?.startsWith('Render de'));
  const outVideo = () =>
    [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const post = (name, body) => fetch('http://localhost:5191/' + encodeURIComponent(name), { method: 'POST', body });
  const toJpeg = source => {
    const w = source.videoWidth || source.naturalWidth;
    const h = source.videoHeight || source.naturalHeight;
    const c = document.createElement('canvas');

    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(source, 0, 0, w, h);

    return c.toDataURL('image/jpeg', 0.88);
  };
  const settle = async () => {
    let last = outImg()?.src;
    let changedAt = 0;
    const t0 = performance.now();

    while (performance.now() - t0 < 25000) {
      await sleep(50);

      const src = outImg()?.src;

      if (src && src !== last) {
        last = src;
        changedAt = performance.now();
      }

      if (changedAt && performance.now() - changedAt > 1500) return true;
    }

    return false;
  };

  for (const subject of subjects) {
    setSubject(subject);
    await sleep(300);

    for (const [index, chip] of chips().entries()) {
      if (state.abort) break;

      const label = chip.textContent.trim();

      try {
        chip.click();

        let ok = true;

        if (mode === 'image') ok = await settle();
        else await sleep(3500);

        const source = mode === 'image' ? outImg() : outVideo();

        if (mode === 'image') await source.decode?.();

        const name = `${tag}__${subject ? 'word' : 'noword'}__${String(index).padStart(2, '0')}-${label.replace(/\W+/g, '').toLowerCase()}.jpg`;

        await post(name, toJpeg(source));
        state.items.push({ name, tag, preset: label, subject, prompt: promptText(), ok });
      } catch (error) {
        state.errors.push(`${label}: ${error.message}`);
      }

      state.done++;
    }
  }

  await post(`${tag}.json`, JSON.stringify(state.items, null, 2));
  state.status = 'done';
};
