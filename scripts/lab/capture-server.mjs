import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/**
 * Where the browser harness (sd-harness.js) drops what it captures from the lab:
 * frames of the StreamDiffusion output, the paper, and JSON logs.
 *
 *   SHOTS_DIR=<folder> node scripts/lab/capture-server.mjs   (port 5191)
 */
const OUT = process.env.SHOTS_DIR ?? path.join(process.cwd(), 'shots');

fs.mkdirSync(OUT, { recursive: true });

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') return res.end();
    if (req.method !== 'POST') return res.writeHead(405).end();

    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const name = decodeURIComponent(req.url.slice(1)).replace(/[^\w.\-/]/g, '_');
      const file = path.join(OUT, name);
      const body = Buffer.concat(chunks).toString('utf8');

      fs.mkdirSync(path.dirname(file), { recursive: true });

      if (name.endsWith('.json')) fs.writeFileSync(file, body);
      else fs.writeFileSync(file, Buffer.from(body.replace(/^data:[^,]+,/, ''), 'base64'));

      res.end('ok');
    });
  })
  .listen(5191, () => console.log('capture server on 5191 →', OUT));
