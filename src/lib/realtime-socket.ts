import { decode, encode } from '@msgpack/msgpack';

/**
 * Our own client for fal's realtime socket, replacing `fal.realtime.connect`.
 *
 * Measured against klein realtime on 24 sep 2026 (`scripts/probe-socket.mjs`):
 * - fal closes every socket ~30 s after its runner is ready, busy or not, with the
 *   normal code 1000 (54 frames in a row, closed at 44 s after a 13 s cold start);
 *   one that never gets a frame is closed at ~31 s with `TIMEOUT: no inputs`;
 * - a new socket can land on a cold runner: its first frame took 13 s mid-session;
 * - any invalid message (an empty "ping") is answered with INTERNAL_ERROR and a close,
 *   so there is no free keepalive;
 * - a prompt change costs nothing on the server (same ~0,6 s as the same prompt).
 * The official client reports none of those 1000 closes: the frame in flight was
 * lost and the loop waited 15 s for it, typically after a pause to pick a style.
 * It then reconnected lazily inside a frame, sometimes onto a cold runner.
 *
 * This client rotates instead: at 15 s of life it opens a standby socket, warms it
 * with the last frame sent (answer discarded), and swaps it in at the next moment
 * with no frame in flight. A cold runner warms up behind the scenes while the old
 * socket keeps painting. If a socket still dies under a frame, `onDrop` tells the
 * loop to resend the newest drawing at once.
 */
export type RealtimeSocketOptions = {
  /** Endpoint id, e.g. `fal-ai/flux-2/klein/realtime`. */
  app: string;
  token: (app: string) => Promise<string>;
  /** fal's server-side queue per socket. With one frame in flight, 1-2 is enough. */
  maxBuffering?: number;
  onResult: (result: unknown) => void;
  onError: (message: string) => void;
  /** The socket closed or was recycled: whatever was in flight will never answer. */
  onDrop: (reason: string) => void;
};

export type RealtimeSocket = {
  send: (input: Record<string, unknown>) => void;
  /** Drops the current socket and swaps in a fresh one (a stalled frame is written off). */
  recycle: (reason: string) => void;
  close: () => void;
};

type FalMessage = { type?: string; status?: string; error?: string; reason?: string; images?: unknown };

type Link = {
  ws: WebSocket;
  openedAt: number;
  /** Answered at least one frame: its runner is warm. */
  warm: boolean;
  /** Warm-up answers still to come; they are discarded, not painted. */
  skip: number;
};

type Message = Uint8Array<ArrayBuffer>;

/** Half of fal's ~30 s socket life: room for the standby to warm even on a cold runner. */
const ROTATE_AFTER_MS = 15000;
const CHECK_MS = 1000;
/** Back-off between failed attempts (the first retry is immediate), so a bad key does not hammer fal. */
const RETRY_MS = [0, 0, 500, 1500, 4000];

const decodeMessage = async (data: unknown) =>
  (typeof data === 'string'
    ? JSON.parse(data)
    : decode(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data as ArrayBuffer))) as FalMessage;

const isOpen = (link: Link | null): link is Link => link?.ws.readyState === WebSocket.OPEN;

export const createRealtimeSocket = (options: RealtimeSocketOptions): RealtimeSocket => {
  const { app, token, maxBuffering = 2, onResult, onError, onDrop } = options;

  /** The socket frames go to. */
  let active: Link | null = null;
  /** The replacement: opening, warming, or warm and waiting for the active one to go quiet. */
  let standby: Link | null = null;
  let opening = false;
  let disposed = false;
  let failures = 0;
  let retry: number | undefined;
  /** The active socket owes the loop an answer. A swap never happens under a frame. */
  let awaiting = false;
  /** A frame no socket could take yet: the newest one wins. */
  let pending: Message | null = null;
  /** The last frame actually sent, reused to warm the next socket. */
  let lastInput: Message | null = null;

  const retire = (link: Link | null) => {
    if (link && link.ws.readyState <= WebSocket.OPEN) link.ws.close(1000);
  };

  // The loop keeps one frame in flight and decides when one is lost, so a frame goes
  // straight out; it only waits behind a warm-up answer on a just-promoted socket.
  const flush = () => {
    if (!pending || !isOpen(active) || active.skip > 0) return;

    active.ws.send(pending);
    lastInput = pending;
    awaiting = true;
    pending = null;
  };

  /**
   * Promotes the standby once it is warm and the active socket owes nothing. If the
   * active one is already dead, the standby goes in even while still warming: it is
   * the fastest way back, and the pending frame follows its warm-up answer.
   */
  const swap = () => {
    if (!isOpen(standby)) return;
    if (isOpen(active) && (awaiting || !standby.warm)) return;

    const previous = active;

    active = standby;
    standby = null;
    awaiting = false;
    retire(previous);
    flush();
  };

  const schedule = () => {
    if (disposed) return;

    window.clearTimeout(retry);
    retry = window.setTimeout(() => void open(), RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
  };

  const onMessage = (link: Link, message: FalMessage) => {
    const failed = (message.type === 'x-fal-error' && message.error !== 'TIMEOUT') || message.status === 'error';

    // TIMEOUT is fal announcing an idle close: the rotation should have beaten it.
    if (!message.images && !failed) return;

    if (link.skip > 0) {
      link.skip -= 1;
      link.warm = true;

      if (link === active) flush();
      else swap();

      return;
    }

    if (link !== active) return;

    awaiting = false;

    if (message.images) {
      link.warm = true;
      failures = 0;
      onResult(message);
    } else onError(message.type === 'x-fal-error' ? `${message.error}: ${message.reason ?? ''}` : (message.error ?? 'Error del socket'));

    swap();
  };

  const onClose = (link: Link, code: number) => {
    if (disposed) return;

    // The replacement died before it was promoted: the active one still serves, try again.
    if (link === standby) {
      standby = null;
      failures += 1;
      schedule();

      return;
    }

    if (link !== active) return;

    active = null;

    if (awaiting) {
      failures += 1;
      onDrop(code === 1000 ? 'fal cerró el socket con un frame en vuelo' : `socket cerrado (${code})`);
    }

    awaiting = false;
    swap();

    if (!active) schedule();
  };

  const open = async () => {
    if (disposed || opening || standby) return;

    opening = true;

    try {
      const jwt = await token(app);

      if (disposed) return;

      const params = new URLSearchParams({ fal_jwt_token: jwt, max_buffering: String(maxBuffering) });
      const link: Link = { ws: new WebSocket(`wss://fal.run/${app}?${params}`), openedAt: 0, warm: false, skip: 0 };

      link.ws.binaryType = 'arraybuffer';
      standby = link;

      link.ws.onopen = () => {
        if (disposed) return retire(link);

        failures = 0;
        link.openedAt = performance.now();

        // Nothing drawn yet: nothing to warm with, and nothing to lose by going live cold.
        if (lastInput) {
          link.ws.send(lastInput);
          link.skip = 1;
        } else link.warm = true;

        swap();
      };
      link.ws.onmessage = event => {
        void decodeMessage(event.data)
          .then(message => onMessage(link, message))
          .catch(fault => onError((fault as Error).message));
      };
      link.ws.onclose = event => onClose(link, event.code);
    } catch (fault) {
      failures += 1;
      onError((fault as Error).message);
      schedule();
    } finally {
      opening = false;
    }
  };

  const watch = window.setInterval(() => {
    if (disposed || standby || opening || !isOpen(active)) return;
    if (performance.now() - active.openedAt > ROTATE_AFTER_MS) void open();
  }, CHECK_MS);

  void open();

  return {
    send: input => {
      pending = encode(input) as Message;
      flush();
      swap();

      if (!active && !standby && !opening) schedule();
    },
    recycle: reason => {
      const previous = active;

      active = null;
      awaiting = false;
      retire(previous);

      if (previous) onDrop(reason);

      swap();

      if (!active && !standby && !opening) schedule();
    },
    close: () => {
      disposed = true;
      window.clearTimeout(retry);
      window.clearInterval(watch);
      pending = null;
      retire(active);
      retire(standby);
      active = null;
      standby = null;
    },
  };
};
