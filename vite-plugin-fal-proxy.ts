import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const PROXY_PATH = '/api/fal/proxy';
const TOKEN_PATH = '/api/fal/token';
const REST_API_URL = 'https://rest.alpha.fal.ai';

export const TOKEN_EXPIRATION_SECONDS = 120;

/** `fal-ai/flux-2/klein/realtime` is allowed by its app alias, `flux-2`. */
const appAlias = (app: string) => app.split('/')[1] ?? app;
const TARGET_HEADER = 'x-fal-target-url';
const ALLOWED_HOSTS = [/(^|\.)fal\.ai$/, /(^|\.)fal\.run$/, /(^|\.)fal\.media$/];

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
 * Minimal server-side fal proxy, same contract as @fal-ai/server-proxy:
 * the browser client puts the real fal URL in `x-fal-target-url` and this
 * middleware attaches the key. The key never reaches the browser.
 */
type FalProxyOptions = {
  key?: string;
  /**
   * Endpoints the token route may mint for. Without this list anyone who can reach
   * the dev server could mint tokens for any fal app on the team key.
   */
  realtimeApps: readonly string[];
};

export const falProxy = ({ key, realtimeApps }: FalProxyOptions): Plugin => ({
  name: 'fal-proxy',
  configureServer(server) {
    // The realtime client swallows token failures, so the app asks up front.
    server.middlewares.use('/api/fal/status', (_req, res) => send(res, 200, { hasKey: Boolean(key) }));

    /**
     * Realtime tokens are minted here instead of through the generic proxy.
     * fal ignores `allowed_apps` when the request carries `x-fal-client-proxy`
     * and returns a token allowed for nothing, which the socket then rejects
     * with `Forbidden`. This is also the `tokenProvider` flow fal now recommends.
     */
    server.middlewares.use(TOKEN_PATH, async (req, res) => {
      if (!key) return send(res, 401, { error: 'FAL_KEY is not set.' });

      const { app } = JSON.parse((await readBody(req)).toString() || '{}') as { app?: string };

      if (!app) return send(res, 400, { error: 'Missing app' });
      if (!realtimeApps.includes(app)) return send(res, 403, { error: `Realtime app not allowed: ${app}` });

      const upstream = await fetch(`${REST_API_URL}/tokens/`, {
        method: 'POST',
        headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ allowed_apps: [appAlias(app)], token_expiration: TOKEN_EXPIRATION_SECONDS }),
      });

      const token = await upstream.text();

      res.statusCode = upstream.ok ? 200 : upstream.status;
      res.setHeader('content-type', 'text/plain');
      res.end(upstream.ok ? token.replace(/^"|"$/g, '') : token);
    });

    server.middlewares.use(PROXY_PATH, async (req, res) => {
      const targetUrl = req.headers[TARGET_HEADER];

      if (typeof targetUrl !== 'string') return send(res, 400, { error: `Missing ${TARGET_HEADER} header` });

      let target: URL;

      try {
        target = new URL(targetUrl);
      } catch {
        return send(res, 400, { error: `Invalid ${TARGET_HEADER}: ${targetUrl}` });
      }

      if (!ALLOWED_HOSTS.some(pattern => pattern.test(target.hostname)))
        return send(res, 412, { error: `Host not allowed: ${target.hostname}` });

      if (!key)
        return send(res, 401, { error: 'FAL_KEY is not set. Copy .env.example to .env and put your fal key there.' });

      const method = req.method ?? 'GET';
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);

      try {
        const upstream = await fetch(target, {
          method,
          body,
          headers: {
            authorization: `Key ${key}`,
            'content-type': (req.headers['content-type'] as string) ?? 'application/json',
            accept: (req.headers.accept as string) ?? 'application/json',
          },
        });

        res.statusCode = upstream.status;
        upstream.headers.forEach((value, name) => {
          if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) return;
          res.setHeader(name, value);
        });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (error) {
        send(res, 502, { error: `Proxy request failed: ${(error as Error).message}` });
      }
    });
  },
});
