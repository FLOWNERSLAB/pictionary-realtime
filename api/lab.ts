/**
 * Server side of the lab: the only place that sees FAL_KEY and DAYDREAM_API_KEY.
 *
 * Written against the Web Request/Response API so the same code runs as a Vercel
 * Function (this file, reached through the rewrite in vercel.json) and inside the
 * Vite dev server (vite-plugin-api.ts adapts Node's req/res to it). It has no
 * relative imports on purpose: Vercel runs functions as plain ESM, where an
 * extensionless import fails at runtime.
 *
 * Routes, all under /api:
 * - GET  fal/status                    → { hasKey }
 * - POST fal/token                     → realtime token for an allowed app
 * - *    fal/proxy                     → same contract as @fal-ai/server-proxy
 * - GET  daydream/status               → { hasKey }
 * - POST daydream/streams              → create a stream, returns its WHIP url
 * - PATCH daydream/streams/:id         → hot-update prompt, seed, ControlNet weights
 * - GET  daydream/streams/:id/status   → gateway status (why Daydream cut a stream)
 */

export type LabEnv = { FAL_KEY?: string; DAYDREAM_API_KEY?: string };

/**
 * fal endpoints with a realtime WebSocket worker: the token route only mints for
 * these, or anyone who reaches the server could mint tokens for any fal app on the
 * team key. Keep in sync with src/data/endpoints.ts.
 */
const REALTIME_APPS = ['fal-ai/flux-2/klein/realtime'];

const FAL_REST_URL = 'https://rest.alpha.fal.ai';
const TOKEN_EXPIRATION_SECONDS = 120;
const FAL_TARGET_HEADER = 'x-fal-target-url';
const FAL_HOSTS = [/(^|\.)fal\.ai$/, /(^|\.)fal\.run$/, /(^|\.)fal\.media$/];
const DAYDREAM_URL = 'https://api.daydream.live/v1/streams';

/** Hop-by-hop or already-decoded: forwarding them breaks the body. */
const DROPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** `fal-ai/flux-2/klein/realtime` is allowed by its app alias, `flux-2`. */
const appAlias = (app: string) => app.split('/')[1] ?? app;

const forward = async (upstream: Response) => {
  const headers = new Headers();

  upstream.headers.forEach((value, name) => {
    if (!DROPPED_HEADERS.includes(name)) headers.set(name, value);
  });

  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
};

/**
 * Realtime tokens are minted here instead of through the generic proxy. fal ignores
 * `allowed_apps` when the request carries `x-fal-client-proxy` and returns a token
 * allowed for nothing, which the socket then rejects with `Forbidden`.
 */
const falToken = async (request: Request, key: string) => {
  const { app } = (await request.json().catch(() => ({}))) as { app?: string };

  if (!app) return json(400, { error: 'Missing app' });
  if (!REALTIME_APPS.includes(app)) return json(403, { error: `Realtime app not allowed: ${app}` });

  const upstream = await fetch(`${FAL_REST_URL}/tokens/`, {
    method: 'POST',
    headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ allowed_apps: [appAlias(app)], token_expiration: TOKEN_EXPIRATION_SECONDS }),
  });
  const token = await upstream.text();

  return new Response(upstream.ok ? token.replace(/^"|"$/g, '') : token, {
    status: upstream.ok ? 200 : upstream.status,
    headers: { 'content-type': 'text/plain' },
  });
};

/** The browser client puts the real fal URL in `x-fal-target-url`; this attaches the key. */
const falProxy = async (request: Request, key: string) => {
  const targetUrl = request.headers.get(FAL_TARGET_HEADER);

  if (!targetUrl) return json(400, { error: `Missing ${FAL_TARGET_HEADER} header` });

  let target: URL;

  try {
    target = new URL(targetUrl);
  } catch {
    return json(400, { error: `Invalid ${FAL_TARGET_HEADER}: ${targetUrl}` });
  }

  if (!FAL_HOSTS.some(pattern => pattern.test(target.hostname))) return json(412, { error: `Host not allowed: ${target.hostname}` });

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  try {
    return await forward(
      await fetch(target, {
        method: request.method,
        body,
        headers: {
          authorization: `Key ${key}`,
          'content-type': request.headers.get('content-type') ?? 'application/json',
          accept: request.headers.get('accept') ?? 'application/json',
        },
      }),
    );
  } catch (error) {
    return json(502, { error: `Proxy request failed: ${(error as Error).message}` });
  }
};

/**
 * Daydream's REST API only creates and tunes streams; the video goes browser ↔
 * Livepeer over WebRTC and never touches this server.
 */
const daydream = async (request: Request, rest: string, key: string) => {
  const method = request.method;

  if (method === 'POST' && rest) return json(405, { error: 'POST va sin id.' });
  if (method === 'PATCH' && !/^str_[A-Za-z0-9]+$/.test(rest)) return json(400, { error: `Stream id no válido: ${rest}` });
  if (method === 'GET' && !/^str_[A-Za-z0-9]+\/status$/.test(rest)) return json(400, { error: `Ruta no válida: ${rest}` });
  if (!['POST', 'PATCH', 'GET'].includes(method)) return json(405, { error: `Método no permitido: ${method}` });

  try {
    const upstream = await fetch(rest ? `${DAYDREAM_URL}/${rest}` : DAYDREAM_URL, {
      method,
      body: method === 'GET' ? undefined : await request.arrayBuffer(),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    });

    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    return json(502, { error: `Daydream no responde: ${(error as Error).message}` });
  }
};

/** `path` is what follows /api/, e.g. "fal/proxy" or "daydream/streams/str_x/status". */
export const handleApi = async (request: Request, path: string, env: LabEnv): Promise<Response> => {
  const route = path.replace(/^\/+|\/+$/g, '');

  if (route === 'fal/status') return json(200, { hasKey: Boolean(env.FAL_KEY) });
  if (route === 'daydream/status') return json(200, { hasKey: Boolean(env.DAYDREAM_API_KEY) });

  if (route === 'fal/token' || route === 'fal/proxy') {
    if (!env.FAL_KEY) return json(401, { error: 'Falta FAL_KEY: en local va en .env (y reiniciar); en Vercel, en Environment Variables.' });

    return route === 'fal/token' ? falToken(request, env.FAL_KEY) : falProxy(request, env.FAL_KEY);
  }

  if (route === 'daydream/streams' || route.startsWith('daydream/streams/')) {
    if (!env.DAYDREAM_API_KEY)
      return json(401, { error: 'Falta DAYDREAM_API_KEY: en local va en .env (y reiniciar); en Vercel, en Environment Variables.' });

    return daydream(request, route.slice('daydream/streams'.length).replace(/^\//, ''), env.DAYDREAM_API_KEY);
  }

  return json(404, { error: `Ruta no encontrada: /api/${route}` });
};

/**
 * Vercel entry. vercel.json rewrites /api/<anything> to /api/lab?path=<anything>:
 * a real file wins over the rewrite, so this function is reached only that way.
 */
export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/?/, '');

    return handleApi(request, path, { FAL_KEY: process.env.FAL_KEY, DAYDREAM_API_KEY: process.env.DAYDREAM_API_KEY });
  },
};
