import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';

import { type LabEnv, handleApi } from './api/lab.ts';

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/**
 * Mounts api/lab.ts on the dev server, so `npm run dev` answers /api/* exactly as the
 * Vercel Function does. Only Node's req/res is translated; the routes live there.
 */
export const labApi = (env: LabEnv): Plugin => ({
  name: 'lab-api',
  configureServer(server) {
    server.middlewares.use('/api', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const headers = new Headers();

      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }

      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
      const response = await handleApi(new Request(url, { method, headers, body }), url.pathname, env);

      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  },
});
