/**
 * The live guess: what the machine thinks is being drawn, from a small vision call
 * (api/lab.ts → Claude Haiku). In the show nobody may type the word, so this is the
 * only way the prompt can say "a cat" while a cat is being drawn: the machine
 * guesses, and its guess steers the render. The guest sees the guess, which is the
 * game (24 oct 2026, David: "¿puede anticiparse a lo que estoy dibujando?").
 */
export type GuessKind =
  | 'animal'
  | 'person'
  | 'vehicle'
  | 'building'
  | 'plant'
  | 'food'
  | 'object'
  | 'tool'
  | 'instrument'
  | 'nature'
  | 'symbol'
  | 'unknown';

export type Guess = {
  /** Best guess, 1-3 lower-case English words. Empty when the model saw nothing. */
  word: string;
  kind: GuessKind;
  /** 0-100. */
  confidence: number;
  /** Round trip of the vision call in ms. */
  ms: number;
  at: number;
};

/** Below this the guess only lends its kind ("some kind of animal"), never the word. */
export const GUESS_CONFIDENT = 55;

/** Side of the JPEG the guesser gets: ~270 image tokens, enough to read a doodle. */
export const GUESS_INPUT_SIZE = 448;

export const requestGuess = async (imageDataUrl: string, signal?: AbortSignal): Promise<Guess> => {
  const response = await fetch('/api/guess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl }),
    signal,
  });

  if (!response.ok) throw new Error(`La adivinanza falló: ${await response.text()}`);

  const body = (await response.json()) as Omit<Guess, 'at'>;

  return { ...body, at: Date.now() };
};

export const hasGuessKey = async () => {
  try {
    const { hasKey } = (await (await fetch('/api/guess/status')).json()) as { hasKey?: boolean };

    return Boolean(hasKey);
  } catch {
    return false;
  }
};

const article = (word: string) => (/^(a|an|the|some|two|three)\s/i.test(word) ? word : /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/**
 * What the prompt may call the subject on the strength of a guess alone: the word
 * when the model is sure, the broad kind when it only has a hunch, nothing when it
 * has neither (then the prompt says "what it depicts", as with no hint).
 */
export const subjectFromGuess = (guess: Guess | null): string | null => {
  if (!guess) return null;
  if (guess.word && guess.confidence >= GUESS_CONFIDENT) return article(guess.word);
  if (guess.kind !== 'unknown' && guess.kind !== 'object') return `some kind of ${guess.kind}`;

  return null;
};
