import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const API_URL = 'https://api.daydream.live/v1/streams';

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

/**
 * Daydream's REST API only creates and tunes streams; the video itself goes
 * browser ↔ Livepeer over WebRTC and never touches this server. So the proxy
 * is just three routes that attach the key:
 * - POST /api/daydream/streams       → create a stream, returns its WHIP url
 * - PATCH /api/daydream/streams/:id  → hot-update prompt, seed, ControlNet weights
 * - GET /api/daydream/streams/:id/status → gateway status, where Daydream says why it
 *   cut a stream (e.g. `credit_exhaustion`) while WebRTC only sees the peer vanish
 */
export const daydreamProxy = ({ key }: { key?: string }): Plugin => ({
  name: 'daydream-proxy',
  configureServer(server) {
    server.middlewares.use('/api/daydream/status', (_req, res) => send(res, 200, { hasKey: Boolean(key) }));

    server.middlewares.use('/api/daydream/streams', async (req, res) => {
      if (!key) return send(res, 401, { error: 'Falta DAYDREAM_API_KEY en .env (y reiniciar el servidor).' });

      // Mounted on a prefix, so `req.url` is what follows it: "/" or "/str_…".
      const id = (req.url ?? '/').replace(/^\/+/, '').split('?')[0];
      const method = req.method ?? 'GET';

      if (method === 'POST' && id) return send(res, 405, { error: 'POST va sin id.' });
      if (method === 'PATCH' && !/^str_[A-Za-z0-9]+$/.test(id)) return send(res, 400, { error: `Stream id no válido: ${id}` });
      if (method === 'GET' && !/^str_[A-Za-z0-9]+\/status$/.test(id)) return send(res, 400, { error: `Ruta no válida: ${id}` });
      if (!['POST', 'PATCH', 'GET'].includes(method)) return send(res, 405, { error: `Método no permitido: ${method}` });

      try {
        const upstream = await fetch(id ? `${API_URL}/${id}` : API_URL, {
          method,
          body: method === 'GET' ? undefined : await readBody(req),
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        });

        res.statusCode = upstream.status;
        res.setHeader('content-type', 'application/json');
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (error) {
        send(res, 502, { error: `Daydream no responde: ${(error as Error).message}` });
      }
    });
  },
});
