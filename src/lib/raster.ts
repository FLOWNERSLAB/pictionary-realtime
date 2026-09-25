const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo rasterizar el dibujo'));
    image.src = source;
  });

const drawSquare = (image: HTMLImageElement, width: number, height: number, size: number, quality: number) => {
  const canvas = document.createElement('canvas');

  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');

  if (!context) return null;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);

  const scale = size / Math.max(width, height);
  const targetWidth = width * scale;
  const targetHeight = height * scale;

  context.drawImage(image, (size - targetWidth) / 2, (size - targetHeight) / 2, targetWidth, targetHeight);

  return canvas.toDataURL('image/jpeg', quality);
};

/**
 * Serializes the live canvas SVG and rasterizes it to a square JPEG data URI.
 *
 * Going through the DOM rather than the provider's `exportImage` matters for the
 * realtime loop: the stroke the guest is drawing right now is already in the DOM,
 * and fal's realtime endpoint wants a base64 JPEG (CDN urls are rejected).
 */
/** Side of the thumbnail the ink is counted on. */
const INK_GRID = 64;
/** A cell darker than this (0-255 luminance) counts as ink. */
const INK_LUMA = 200;

/**
 * Cells of real ink on a 64 px thumbnail. Eraser leftovers, a stray click or an
 * erased-but-not-cleared canvas give a handful of faint specks: the model reads
 * those as "draw whatever the prompt says" and invents an object from nothing.
 */
const countInk = (image: HTMLImageElement, width: number, height: number) => {
  const canvas = document.createElement('canvas');

  canvas.width = INK_GRID;
  canvas.height = INK_GRID;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) return Infinity;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, INK_GRID, INK_GRID);
  context.drawImage(image, 0, 0, INK_GRID, (INK_GRID * height) / width);

  const { data } = context.getImageData(0, 0, INK_GRID, INK_GRID);
  let cells = 0;

  for (let index = 0; index < data.length; index += 4)
    if (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2] < INK_LUMA) cells += 1;

  return cells;
};

/** Below this many ink cells the frame counts as blank and is not sent. */
export const MIN_INK_CELLS = 6;

export const rasterizeSvg = async (svg: SVGSVGElement, size: number, quality = 0.5) => {
  const { width, height } = svg.getBoundingClientRect();

  if (!width || !height) return null;

  const clone = svg.cloneNode(true) as SVGSVGElement;

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.color = '#0a0a0a';

  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const markup = new XMLSerializer().serializeToString(clone);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);

  const ink = countInk(image, width, height);

  if (ink < MIN_INK_CELLS) return { dataUrl: null, ink };

  return { dataUrl: drawSquare(image, width, height, size, quality), ink };
};

/** Re-encodes the provider's PNG export (used for the reveal, where quality wins). */
export const toSquareJpeg = async (dataUrl: string, size: number, quality = 0.92) => {
  const image = await loadImage(dataUrl);

  return drawSquare(image, image.naturalWidth, image.naturalHeight, size, quality);
};
