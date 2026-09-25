import fs from 'node:fs';

import { decode, encode } from '@msgpack/msgpack';

import { sketchPng } from './sketch.mjs';

/**
 * Diagnoses the klein realtime socket without the fal client's state machine:
 * what a pause costs, what a prompt change costs, what the server does when the
 * socket idles or the token expires, and whether a request id is echoed.
 * `SCENARIOS=style,idle,token,id node scripts/probe-socket.mjs`
 */
const key = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/FAL_KEY=(.+)/)?.[1].trim();

if (!key) throw new Error('FAL_KEY missing in .env');

const APP = 'fal-ai/flux-2/klein/realtime';
const SCENARIOS = (process.env.SCENARIOS ?? 'style,idle,token,id').split(',');
const t0 = Date.now();
const log = line => fs.writeSync(1, `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${line}\n`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const STYLES = [
  'a glossy 3D toy figurine, soft studio lighting, rounded plastic shapes',
  'a hand-carved wooden object, natural wood grain, warm studio lighting',
  'a watercolor painting on textured paper, soft washes of color',
  'a bold 2D cartoon illustration, thick clean outlines, flat vivid colors',
];

const image = `data:image/png;base64,${sketchPng(704).toString('base64')}`;

const mintToken = async expiration => {
  const startedAt = Date.now();
  const response = await fetch('https://rest.alpha.fal.ai/tokens/', {
    method: 'POST',
    headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ allowed_apps: ['flux-2'], token_expiration: expiration }),
  });

  if (!response.ok) throw new Error(`token ${response.status}: ${await response.text()}`);

  const token = (await response.text()).replace(/^"|"$/g, '');

  log(`token (${expiration} s) en ${Date.now() - startedAt} ms`);

  return token;
};

const open = async expiration => {
  const token = await mintToken(expiration);
  const startedAt = Date.now();
  const ws = new WebSocket(`wss://fal.run/${APP}?fal_jwt_token=${token}&max_buffering=2`);

  ws.binaryType = 'arraybuffer';

  const socket = { ws, waiters: [], closed: null };

  ws.onmessage = event => {
    const message = typeof event.data === 'string' ? JSON.parse(event.data) : decode(new Uint8Array(event.data));

    if (message?.images) {
      const waiter = socket.waiters.shift();

      waiter?.(message);

      return;
    }

    log(`   mensaje: ${JSON.stringify(message).slice(0, 300)}`);

    // An error answers the frame too, or the waiter hangs.
    if (message?.type === 'x-fal-error' && message.error !== 'TIMEOUT') socket.waiters.shift()?.(message);
  };
  ws.onclose = event => {
    socket.closed = { code: event.code, reason: event.reason, at: Date.now() };
    log(`   CIERRE code=${event.code} reason=${JSON.stringify(event.reason)}`);
    socket.waiters.splice(0).forEach(waiter => waiter(null));
  };
  ws.onerror = () => log('   onerror');

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    setTimeout(() => reject(new Error('handshake > 15 s')), 15000);
  });
  log(`socket abierto en ${Date.now() - startedAt} ms`);

  return socket;
};

const frame = async (socket, prompt, extra = {}) => {
  if (socket.ws.readyState !== WebSocket.OPEN) return { ms: null, note: `socket state ${socket.ws.readyState}` };

  const startedAt = Date.now();
  const answer = new Promise(resolve => {
    socket.waiters.push(resolve);
    setTimeout(() => resolve('timeout'), 20000);
  });

  socket.ws.send(
    encode({
      prompt: `Turn this into "${prompt}"`,
      image_url: image,
      image_size: 'square',
      num_inference_steps: 2,
      output_feedback_strength: 1,
      seed: 35,
      ...extra,
    }),
  );

  const result = await answer;
  const ms = Date.now() - startedAt;

  if (result === 'timeout') return { ms, note: 'SIN RESPUESTA 20 s' };
  if (!result) return { ms, note: 'socket cerrado' };
  if (!result.images) return { ms, note: `error ${JSON.stringify(result).slice(0, 200)}` };

  const keys = Object.keys(result).filter(name => name !== 'images');

  return { ms, note: keys.length ? `claves: ${keys.join(',')}` : '' };
};

const run = async (socket, label, prompt, extra) => {
  const { ms, note } = await frame(socket, prompt, extra);

  log(`${label.padEnd(34)} ${String(ms).padStart(6)} ms ${note}`);

  return ms;
};

if (SCENARIOS.includes('style')) {
  log('== ESTILO: mismo prompt vs prompt nuevo en cada frame ==');

  const socket = await open(600);

  for (let index = 0; index < 5; index += 1) await run(socket, `mismo prompt #${index + 1}`, STYLES[0]);
  for (let index = 0; index < 8; index += 1) await run(socket, `cambio de estilo #${index + 1}`, STYLES[(index + 1) % 4]);
  // Same four prompts again: a server-side prompt-embedding cache would show here.
  for (let index = 0; index < 4; index += 1) await run(socket, `estilo ya visto #${index + 1}`, STYLES[index]);
  for (let index = 0; index < 4; index += 1)
    await run(socket, `estilo inédito #${index + 1}`, `${STYLES[index]}, variation ${Date.now()}`);

  socket.ws.close(1000);
}

if (SCENARIOS.includes('idle')) {
  log('== PAUSAS: cuánto cuesta el frame tras X s sin enviar ==');

  const socket = await open(600);

  for (let index = 0; index < 3; index += 1) await run(socket, 'caliente', STYLES[0]);

  for (const pause of [3, 8, 15, 30, 60]) {
    log(`   pausa ${pause} s…`);
    await sleep(pause * 1000);

    if (socket.closed) {
      log(`   el socket se cerró durante la pausa (${pause} s)`);
      break;
    }

    await run(socket, `tras ${pause} s sin enviar`, STYLES[0]);
    await run(socket, `  siguiente`, STYLES[0]);
  }

  socket.ws.close(1000);
}

if (SCENARIOS.includes('token')) {
  log('== TOKEN: token de 30 s, un frame cada 5 s durante 75 s ==');

  const socket = await open(30);

  for (let elapsed = 0; elapsed < 75 && !socket.closed; elapsed += 5) {
    await run(socket, `t+${elapsed} s`, STYLES[0]);
    await sleep(5000);
  }

  if (!socket.closed) socket.ws.close(1000);
}

if (SCENARIOS.includes('life')) {
  log('== VIDA: frames seguidos durante 90 s, ¿cierra fal un socket activo? ==');

  const socket = await open(600);
  const openedAt = Date.now();
  let frames = 0;

  while (!socket.closed && Date.now() - openedAt < 90000) {
    const { ms, note } = await frame(socket, STYLES[frames % 4]);

    frames += 1;
    if (ms > 1200 || note.includes('cerrado')) log(`frame ${frames} ${ms} ms ${note}`);
  }

  log(socket.closed ? `cerrado a los ${((socket.closed.at - openedAt) / 1000).toFixed(1)} s tras ${frames} frames` : `sigue abierto a los 90 s (${frames} frames)`);
  if (!socket.closed) socket.ws.close(1000);
}

if (SCENARIOS.includes('fresh')) {
  log('== FRESCO: socket abierto sin ningún frame, ¿cuándo lo cierra fal? ==');

  const socket = await open(600);
  const openedAt = Date.now();

  while (!socket.closed && Date.now() - openedAt < 40000) await sleep(250);
  log(socket.closed ? `cerrado a los ${((socket.closed.at - openedAt) / 1000).toFixed(1)} s sin frames` : 'sigue abierto a los 40 s');
  if (!socket.closed) socket.ws.close(1000);
}

if (SCENARIOS.includes('ping')) {
  log('== PING: ¿un mensaje vacío mantiene vivo el socket sin cómputo? ==');

  const socket = await open(600);

  await run(socket, 'caliente', STYLES[0]);

  for (let elapsed = 5; elapsed <= 35 && !socket.closed; elapsed += 5) {
    await sleep(5000);
    log(`   ping t+${elapsed} s`);
    socket.ws.send(encode({}));
  }

  await sleep(1500);
  if (!socket.closed) await run(socket, 'frame tras 35 s de pings', STYLES[0]);
  if (!socket.closed) socket.ws.close(1000);
}

if (SCENARIOS.includes('id')) {
  log('== ID: ¿el servidor devuelve un id de petición? ==');

  const socket = await open(600);

  await run(socket, 'sin id', STYLES[0]);
  await run(socket, 'con request_id', STYLES[0], { request_id: 'probe-123' });
  socket.ws.close(1000);
}

process.exit(0);
