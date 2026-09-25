/*
 * Contact sheet for the style matrix: one tab per model run, rows = styles, columns =
 * (no word, word) × (before, after), with the exact prompt under every image.
 *
 *   node build-sheet.mjs <after-dir> [before-dir] [out.html]
 *
 * Each dir holds the shots and one `<tag>.json` per run written by harness.js.
 * Rows follow the after run: styles dropped since "before" do not show.
 */
import fs from 'node:fs';
import path from 'node:path';

const [afterDir, beforeDir, out = path.join(afterDir, 'matriz.html')] = process.argv.slice(2);

const TABS = [
  { tag: 'klein', title: 'klein realtime', note: '2 pasos, semilla 35' },
  { tag: 'sdxl', title: 'SDXL-Turbo · Transformar', note: 'Daydream, t_index [4, 12], líneas 0,6' },
  { tag: 'sdxl-scribble', title: 'SDXL-Turbo · Scribble TD', note: 'Daydream, blanco sobre negro, passthrough 0,9, [4, 12]' },
];

const load = (dir, tag) => {
  const file = dir && path.join(dir, `${tag}.json`);

  if (!file || !fs.existsSync(file)) return [];

  return JSON.parse(fs.readFileSync(file, 'utf8')).map(item => ({ ...item, dir }));
};

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const image = item => `data:image/jpeg;base64,${fs.readFileSync(path.join(item.dir, item.name)).toString('base64')}`;

const figure = (item, alt) =>
  item
    ? `<figure><img loading="lazy" src="${image(item)}" alt="${escape(alt)}">${item.ok ? '' : '<span class="flag">frame sin confirmar</span>'}<figcaption>${escape(item.prompt)}</figcaption></figure>`
    : '<div class="empty">sin captura</div>';

const tabs = TABS.map(tab => ({ ...tab, after: load(afterDir, tab.tag), before: load(beforeDir, tab.tag) })).filter(tab => tab.after.length);

const section = tab => {
  const subjects = [...new Set(tab.after.map(item => item.subject))];
  const columns = subjects.flatMap(subject =>
    [
      tab.before.length ? { subject, when: 'antes', pool: tab.before } : null,
      { subject, when: tab.before.length ? 'después' : '', pool: tab.after },
    ].filter(Boolean),
  );
  const presets = [...new Set(tab.after.map(item => item.preset))];
  const head = columns
    .map(c => `<th class="${c.when === 'antes' ? 'before' : ''}">${c.subject ? `«${escape(c.subject)}»` : 'sin palabra'}<small>${c.when}</small></th>`)
    .join('');
  const rows = presets
    .map(preset => {
      const cells = columns
        .map(c => {
          const item = c.pool.find(candidate => candidate.subject === c.subject && candidate.preset === preset);

          return `<td class="${c.when === 'antes' ? 'before' : ''}">${figure(item, `${preset} · ${tab.title} · ${c.subject || 'sin palabra'} · ${c.when}`)}</td>`;
        })
        .join('');

      return `<tr><th class="row">${escape(preset)}</th>${cells}</tr>`;
    })
    .join('\n');

  return `<section id="${tab.tag}" class="panel"><p class="note">${escape(tab.note)}</p><div class="wrap"><table><thead><tr><th class="row">Estilo</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
};

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matriz de estilos</title>
<style>
  :root { --bg: #f6f4ef; --fg: #1d1b18; --muted: #6f6a60; --line: #dcd7cc; --card: #fffdf8; --dim: #ece8df; --accent: #2f6fb0; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #151412; --fg: #ece8df; --muted: #9c968a; --line: #2e2b26; --card: #1c1a17; --dim: #201e1a; --accent: #7fb2e5; } }
  :root[data-theme="dark"] { --bg: #151412; --fg: #ece8df; --muted: #9c968a; --line: #2e2b26; --card: #1c1a17; --dim: #201e1a; --accent: #7fb2e5; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  header { padding: 24px 16px 0; max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  header p, .note { margin: 0; color: var(--muted); max-width: 90ch; }
  .note { padding: 0 16px; max-width: 1400px; margin: 0 auto; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; padding: 16px; max-width: 1400px; margin: 0 auto; }
  nav button { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  nav button[aria-selected="true"] { border-color: var(--accent); color: var(--accent); }
  .panel { display: none; }
  .panel.on { display: block; }
  .wrap { overflow-x: auto; padding: 8px 16px 40px; }
  table { border-collapse: separate; border-spacing: 8px; margin: 0 auto; }
  th { position: sticky; top: 0; background: var(--bg); text-align: left; font-weight: 600; padding: 8px 4px; z-index: 1; }
  th small { display: block; font-weight: 400; color: var(--muted); }
  th.row { position: sticky; left: 0; vertical-align: top; width: 90px; padding-top: 12px; z-index: 2; }
  td { vertical-align: top; width: 240px; }
  td.before figure { background: var(--dim); opacity: .85; }
  figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  figcaption { font: 11px/1.4 ui-monospace, monospace; color: var(--muted); padding: 8px 10px; max-height: 7.2em; overflow: auto; }
  .flag { display: block; font-size: 11px; color: #b5651d; padding: 4px 10px 0; }
  .empty { color: var(--muted); font-size: 12px; padding: 8px; }
</style>
</head>
<body>
<header>
  <h1>Matriz de estilos${beforeDir ? ' · antes y después' : ''}</h1>
  <p>Casa del test estándar, semilla 35, «Proteger la silueta» activado. Bajo cada imagen, el prompt exacto que salió del lab. ${new Date().toLocaleDateString('es-ES')}.</p>
</header>
<nav role="tablist">${tabs.map((tab, index) => `<button role="tab" data-tab="${tab.tag}" aria-selected="${index === 0}">${escape(tab.title)}</button>`).join('')}</nav>
${tabs.map(section).join('\n')}
<script>
  const show = tag => {
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('on', panel.id === tag));
    document.querySelectorAll('nav button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tag)));
  };
  document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => show(button.dataset.tab)));
  show(${JSON.stringify(tabs[0]?.tag)});
</script>
</body>
</html>`;

fs.writeFileSync(out, html);
console.log('wrote', out, `${(html.length / 1e6).toFixed(1)} MB`);
