/**
 * What the browser needs from fal, without the official client: a realtime token
 * from our server (api/lab.ts) and a reader for the frames the socket returns.
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

export const hasFalKey = async () => {
  try {
    const { hasKey } = (await (await fetch('/api/fal/status')).json()) as { hasKey?: boolean };

    return Boolean(hasKey);
  } catch {
    return false;
  }
};

type FalImage = { url?: string; content?: unknown; content_type?: string };

/**
 * The realtime socket answers with raw JPEG bytes in `images[0].content`; a base64
 * string or a hosted `url` are handled too, in case the shape changes.
 */
export const imageUrlFromResult = (result: unknown): string | null => {
  const image = (result as { images?: FalImage[] } | undefined)?.images?.[0];

  if (!image) return null;
  if (image.url) return image.url;

  const type = image.content_type ?? 'image/jpeg';

  if (image.content instanceof Uint8Array || image.content instanceof ArrayBuffer)
    return URL.createObjectURL(new Blob([image.content as BlobPart], { type }));
  if (typeof image.content === 'string') return `data:${type};base64,${image.content}`;

  return null;
};

/** A fully black frame is a safety-filter answer, not a render: it must not replace the last good one. */
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

export const errorMessage = (error: unknown) => {
  if (!error) return 'Error desconocido';

  return (error as Error).message ?? String(error);
};
