import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where shots land. `SHOTS_DIR` keeps each run apart (before / after). */
const OUT = process.env.SHOTS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

fs.mkdirSync(OUT, { recursive: true });

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') return res.end();

    if (req.method === 'GET') {
      const file = path.join(OUT, decodeURIComponent(req.url.slice(1)));

      if (!fs.existsSync(file)) return res.writeHead(404).end();

      res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/jpeg');

      return res.end(fs.readFileSync(file));
    }

    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const name = decodeURIComponent(req.url.slice(1)).replace(/[^\w.-]/g, '_');
      const body = Buffer.concat(chunks).toString('utf8');

      if (name.endsWith('.json')) fs.writeFileSync(path.join(OUT, name), body);
      else fs.writeFileSync(path.join(OUT, name), Buffer.from(body.replace(/^data:[^,]+,/, ''), 'base64'));

      console.log('saved', name);
      res.end('ok');
    });
  })
  .listen(5191, () => console.log('capture server on 5191 →', OUT));
