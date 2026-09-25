import { fal } from '@fal-ai/client';

/**
 * Every request goes through api/lab.ts (Vite in dev, a Vercel Function when
 * deployed), which attaches FAL_KEY server side. The browser bundle never sees the key.
 */
fal.config({ proxyUrl: '/api/fal/proxy' });

export { fal };

/**
 * Mints the realtime token on the server (api/lab.ts). The generic proxy cannot do it:
 * fal drops `allowed_apps` when the request is proxied, and the socket then
 * answers `Forbidden` on the first frame.
 */
export const realtimeToken = async (app: string) => {
  const response = await fetch('/api/fal/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app }),
  });

  if (!response.ok) throw new Error(`No se pudo obtener el token realtime: ${await response.text()}`);

  return response.text();
};

type FalImage = {
  url?: string;
  content?: unknown;
  content_type?: string;
  width?: number;
  height?: number;
};

const toBlobUrl = (content: unknown, contentType = 'image/jpeg') => {
  if (content instanceof Uint8Array || content instanceof ArrayBuffer)
    return URL.createObjectURL(new Blob([content as BlobPart], { type: contentType }));

  if (typeof content === 'string') return `data:${contentType};base64,${content}`;

  return null;
};

/**
 * fal returns three different image shapes: a hosted `url`, raw bytes over the
 * realtime socket (`content` as Uint8Array), or base64 in `content`.
 */
export const imageUrlFromResult = (result: unknown): string | null => {
  const images = (result as { images?: FalImage[] } | undefined)?.images;
  const image = images?.[0];

  if (!image) return null;
  if (image.url) return image.url;

  return toBlobUrl(image.content, image.content_type);
};

type ValidationDetail = { msg?: string; loc?: (string | number)[] };

/**
 * fal's safety checker false-positives on these sketch renders and answers with a
 * fully black image instead of an error. Z-Image ignores `enable_safety_checker`,
 * so the only way to know is to look at the pixels.
 */
export const isBlankFrame = (url: string) =>
  new Promise<boolean>(resolve => {
    const image = new Image();

    image.onerror = () => resolve(false);
    image.onload = () => {
      const canvas = document.createElement('canvas');

      canvas.width = 16;
      canvas.height = 16;

      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) return resolve(false);

      context.drawImage(image, 0, 0, 16, 16);

      const { data } = context.getImageData(0, 0, 16, 16);
      let total = 0;

      for (let index = 0; index < data.length; index += 4) total += data[index] + data[index + 1] + data[index + 2];

      resolve(total / (16 * 16 * 3) < 8);
    };
    image.src = url;
  });

export const flaggedAsNsfw = (result: unknown) =>
  Boolean((result as { has_nsfw_concepts?: boolean[] } | undefined)?.has_nsfw_concepts?.some(Boolean));

export const errorMessage = (error: unknown) => {
  if (!error) return 'Error desconocido';

  const detail = (error as { body?: { detail?: unknown } }).body?.detail;

  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail))
    return (detail as ValidationDetail[])
      .map(item => `${item.loc?.slice(-1)[0] ?? 'input'}: ${item.msg ?? JSON.stringify(item)}`)
      .join(' · ');

  return (error as Error).message ?? String(error);
};
