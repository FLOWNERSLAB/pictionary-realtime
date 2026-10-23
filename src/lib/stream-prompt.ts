import type { Style } from '../data/styles';

/**
 * The prompt StreamDiffusion gets. SDXL-Turbo reads CLIP: short comma tags, the
 * most important first (it weighs the first tokens most and stops at 77), single
 * words rather than sentences. The hint goes first when there is one, then the
 * style's tags, then the framing. The style's `tags` carry no object nouns: CLIP
 * draws the nouns it reads ("studio softboxes" gave a light stand, 25 sep 2026).
 *
 * AI Strength does not live in these words: on StreamDiffusion it is `t_index_list`
 * and the line ControlNet weight (src/data/stream.ts).
 */
export const buildStreamPrompt = ({ style, hint, backdrop }: { style: Style; hint: string; backdrop: boolean }) => {
  const word = hint.trim().replace(/\s+/g, ' ');
  const parts = [word, style.tags].filter(Boolean);

  if (backdrop) parts.push('centered', `${style.backdrop} background`);

  return parts.join(', ');
};

export const STREAM_NEGATIVE = 'text, watermark, blurry, deformed, black outline';
