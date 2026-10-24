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
 * - GET  guess/status                → { hasKey }
 * - POST guess                       → { word, kind, confidence, ms }: what Claude thinks the doodle is
 *
 * The frames themselves go browser ↔ provider (fal's WebSocket, Livepeer's WebRTC);
 * the server never sees an image.
 */

export type LabEnv = { FAL_KEY?: string; DAYDREAM_API_KEY?: string; ANTHROPIC_API_KEY?: string };

/**
 * The live guess (Anticipar): one small vision call per settled stroke. Haiku 5.5
 * with thinking off answers a 448 px doodle in ~0,8-1,2 s for ~0,0001 $ (24 oct 2026,
 * same settings as pictionary-ink's judge).
 */
const GUESS_MODEL = 'claude-haiku-5-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GUESS_KINDS = ['animal', 'person', 'vehicle', 'building', 'plant', 'food', 'object', 'tool', 'instrument', 'nature', 'symbol', 'unknown'];
const GUESS_SYSTEM = 'You are a Pictionary guesser watching someone draw. You answer with one line in the exact format "word | kind | confidence" and no other words.';
const GUESS_QUESTION = `Someone is drawing this; it may be unfinished. Reply with ONLY one line in this exact format and nothing else:
word | kind | confidence
word = your best guess of what it will be, a noun or verb of 1-3 words, lower case, English. Write "nothing" if there is no readable shape yet.
kind = one of: ${GUESS_KINDS.join(', ')}.
confidence = an integer 0-100, how sure you are of the word.`;

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

const guess = async (request: Request, key: string) => {
  const { image } = (await request.json().catch(() => ({}))) as { image?: string };
  const prefix = 'data:image/jpeg;base64,';

  if (!image?.startsWith(prefix)) return json(400, { error: 'image debe ser un data URL JPEG en base64.' });

  const startedAt = Date.now();
  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: GUESS_MODEL,
      max_tokens: 24,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: GUESS_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.slice(prefix.length) } },
            { type: 'text', text: GUESS_QUESTION },
          ],
        },
      ],
    }),
  });

  if (!upstream.ok) return json(upstream.status, { error: `Claude: ${(await upstream.text()).slice(0, 300)}` });

  const body = (await upstream.json()) as { content?: { type: string; text?: string }[] };
  const raw = (body.content ?? [])
    .map(block => (block.type === 'text' ? (block.text ?? '') : ''))
    .join('')
    .trim()
    .toLowerCase();
  const line = raw.split('\n').filter(part => part.includes('|')).pop() ?? raw;
  const [wordPart = '', kindPart = '', confidencePart = ''] = line.split('|').map(part => part.trim());
  const word = wordPart === 'nothing' ? '' : wordPart.replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9 '-]/g, '').slice(0, 40);
  const kind = GUESS_KINDS.includes(kindPart) ? kindPart : 'unknown';
  const parsed = Number.parseInt(confidencePart, 10);
  const confidence = word ? Math.min(100, Math.max(0, Number.isNaN(parsed) ? 0 : parsed)) : 0;

  return json(200, { word, kind, confidence, ms: Date.now() - startedAt });
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
  if (route === 'guess/status') return json(200, { hasKey: Boolean(env.ANTHROPIC_API_KEY) });

  if (route === 'guess') {
    if (request.method !== 'POST') return json(405, { error: 'POST only' });
    if (!env.ANTHROPIC_API_KEY) return json(401, { error: 'Falta ANTHROPIC_API_KEY: en local va en .env (y reiniciar); en Vercel, en Environment Variables.' });

    try {
      return await guess(request, env.ANTHROPIC_API_KEY);
    } catch (error) {
      return json(502, { error: `Claude no responde: ${(error as Error).message}` });
    }
  }

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

    return handleApi(request, path, { FAL_KEY: process.env.FAL_KEY, DAYDREAM_API_KEY: process.env.DAYDREAM_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
  },
};
