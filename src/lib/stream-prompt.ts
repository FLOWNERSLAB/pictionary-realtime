import type { Style } from '../data/styles';
import type { Guess } from './guess';
import { GUESS_CONFIDENT } from './guess';

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
export const buildStreamPrompt = ({ style, hint, guess = null, backdrop }: { style: Style; hint: string; guess?: Guess | null; backdrop: boolean }) => {
  const word = hint.trim().replace(/\s+/g, ' ') || (guess && guess.confidence >= GUESS_CONFIDENT ? guess.word : '');
  const parts = [word, style.tags].filter(Boolean);

  if (backdrop) parts.push('centered', `${style.backdrop} background`);

  return parts.join(', ');
};

export const STREAM_NEGATIVE = 'text, watermark, blurry, deformed, black outline';
