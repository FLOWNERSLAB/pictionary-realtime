/// <reference types="node" />

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
 * - GET  fal/status                  → { hasKey }
 * - POST fal/token                   → short-lived realtime token for klein realtime
 * - GET  daydream/status             → { hasKey }
 * - POST daydream/streams            → create a StreamDiffusion stream, returns its WHIP url
 * - PATCH daydream/streams/:id       → hot-update prompt, seed, t_index, ControlNet weights
 * - GET  daydream/streams/:id/status → gateway status (why Daydream cut a stream)
 *
 * The frames themselves go browser ↔ provider (fal's WebSocket, Livepeer's WebRTC);
 * the server never sees an image.
 */

export type LabEnv = { FAL_KEY?: string; DAYDREAM_API_KEY?: string };

/**
 * The only app the token route mints for. Anyone who reaches the server could
 * otherwise mint tokens for any fal app on the team key.
 */
const REALTIME_APP = 'fal-ai/flux-2/klein/realtime';

const FAL_REST_URL = 'https://rest.alpha.fal.ai';
const TOKEN_EXPIRATION_SECONDS = 120;
const DAYDREAM_URL = 'https://api.daydream.live/v1/streams';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** `fal-ai/flux-2/klein/realtime` is allowed by its app alias, `flux-2`. */
const appAlias = (app: string) => app.split('/')[1] ?? app;

/**
 * Minted here, not through a generic proxy: fal ignores `allowed_apps` when the
 * request carries `x-fal-client-proxy` and returns a token allowed for nothing,
 * which the socket then rejects with `Forbidden`.
 */
const falToken = async (request: Request, key: string) => {
  const { app } = (await request.json().catch(() => ({}))) as { app?: string };

  if (app !== REALTIME_APP) return json(403, { error: `Realtime app not allowed: ${app ?? '(none)'}` });

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

/** `path` is what follows /api/, e.g. "fal/token" or "daydream/streams/str_x/status". */
export const handleApi = async (request: Request, path: string, env: LabEnv): Promise<Response> => {
  const route = path.replace(/^\/+|\/+$/g, '');

  if (route === 'fal/status') return json(200, { hasKey: Boolean(env.FAL_KEY) });
  if (route === 'daydream/status') return json(200, { hasKey: Boolean(env.DAYDREAM_API_KEY) });

  if (route === 'fal/token') {
    if (request.method !== 'POST') return json(405, { error: 'POST only' });
    if (!env.FAL_KEY) return json(401, { error: 'Falta FAL_KEY: en local va en .env (y reiniciar); en Vercel, en Environment Variables.' });

    return falToken(request, env.FAL_KEY);
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
