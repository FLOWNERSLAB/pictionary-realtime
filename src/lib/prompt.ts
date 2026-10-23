import type { Style } from '../data/styles';

/**
 * The prompt klein realtime gets, from three parts that never mix:
 *
 *   [fidelity · AI Strength + hint]  [style look]  [light + palette]  [backdrop]
 *
 * klein realtime is an edit model: the sketch goes in as reference tokens and there
 * is no img2img `strength`. Krea's "AI Strength" (low: the drawing itself, high: the
 * prompt reinterprets it) is rebuilt here with words, measured on 23 oct 2026
 * (scripts/lab/exp_ladder.py, 5 sketches × photo and watercolor):
 *
 * - below ~0,3 the model must be asked for a *drawing* that keeps the lines, and the
 *   style has to step back to colour and light. Told "follow the lines exactly" but
 *   also "photograph it", klein shoots a finished photo every time (E1).
 * - from ~0,3 up the full style applies. Fiel and Acabado keep the ink as the only
 *   subject and use the hint only as materials: that is the one wording where klein
 *   does not complete the object from a single stroke (E5, 23 oct: 'turn this sketch
 *   into a house' makes a whole house out of one rectangle, Krea's img2img never
 *   does). From Limpio up the hint names the subject and the object completes;
 *   above ~0,75 the reference is also blurred so the exact lines stop counting.
 *
 * Mirrors scripts/lab/promptkit.py: keep both in step.
 */
export type Rung = {
  /** AI Strength below this value uses the rung. */
  upTo: number;
  /** Short Spanish label for the slider. */
  label: string;
  /** What the rung does, one line, for the read-out. */
  hint: string;
  /** `{S}` is the subject phrase. */
  text: string;
  /** The style steps back to colour and light only. */
  softStyle: boolean;
};

export const LADDER: readonly Rung[] = [
  {
    upTo: 0.12,
    label: 'Calco',
    hint: 'Devuelve el dibujo tal cual, solo teñido con los colores del estilo.',
    text: 'This is a line drawing of {S}. Keep it a line drawing: the exact same lines, outline, proportions and position on the same white sheet, nothing added.',
    softStyle: true,
  },
  {
    upTo: 0.25,
    label: 'Coloreado',
    hint: 'Las mismas líneas, rellenas de color plano y un sombreado ligero.',
    text: 'Render this drawing of {S} exactly as drawn: every line where it is, same proportions and position, flat and simple, with only light shading and colour.',
    softStyle: true,
  },
  {
    upTo: 0.38,
    label: 'Recorte',
    hint: 'El dibujo tal cual, pero ya hecho en el estilo: como un recorte fotografiado.',
    text: 'Render this drawing of {S} exactly as drawn: every line where it is, same proportions and position, flat and simple, with only light shading and colour.',
    softStyle: false,
  },
  {
    upTo: 0.5,
    label: 'Fiel',
    hint: 'La tinta es lo único que existe: se textura con los materiales de la pista. No completa el objeto.',
    text: 'Treat the ink as the only subject: keep exactly the drawn shapes, where they are, and texture them as if they were made of the materials of {S}. Add no other shapes.',
    softStyle: false,
  },
  {
    upTo: 0.62,
    label: 'Acabado',
    hint: 'Como Fiel, con el detalle de superficie de la pista. Sigue sin completar lo que no está dibujado.',
    text: 'Treat the ink as the only subject: keep exactly the drawn shapes, where they are, and texture them as if they were made of the materials of {S}, with the surface detail {S} would have. Add no other shapes.',
    softStyle: false,
  },
  {
    upTo: 0.75,
    label: 'Limpio',
    hint: 'Aquí la pista ya manda: el objeto se completa aunque falten trazos; el dibujo es la composición.',
    text: 'Turn this sketch into {S}. Use the drawing as the layout and clean up the shape so it clearly reads as {S}.',
    softStyle: false,
  },
  {
    upTo: 0.88,
    label: 'Libre',
    hint: 'El dibujo solo sitúa y da la pose; la forma se rediseña.',
    text: 'Create {S}, using this sketch only as a rough guide for placement and pose. Redesign the shape freely, with full detail.',
    softStyle: false,
  },
  {
    upTo: 1.01,
    label: 'Prompt',
    hint: 'Manda el prompt: del dibujo solo queda dónde está.',
    text: 'Create {S}. Ignore the exact lines of the sketch; only keep it roughly in the same place in the frame.',
    softStyle: false,
  },
];

export const AI_STRENGTH_DEFAULT = 0.55;

export const rungIndex = (strength: number) => {
  const index = LADDER.findIndex(rung => strength < rung.upTo);

  return index < 0 ? LADDER.length - 1 : index;
};

export const rungFor = (strength: number) => LADDER[rungIndex(strength)];

/**
 * Above 0,75 the reference itself goes softer: a blurred sketch loosens the shape a
 * little more than words alone (E1, 23 oct: blur 20 px turned the cat into a different,
 * more detailed cat). Radius in px at 704 px.
 */
export const inputBlurFor = (strength: number) => (strength > 0.75 ? Math.round(((strength - 0.75) / 0.25) * 14) : 0);

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * "cat" → "a cat", "an apple" stays, "" → "what it depicts". The hint only names what
 * the sketch is; klein reads the drawing on its own and, with a photo style, needs the
 * word to recognise a crude doodle (22 oct: pizza → metal sign without it).
 */
export const subjectPhrase = (hint: string) => {
  const word = hint.trim().replace(/\s+/g, ' ');

  if (!word) return 'what it depicts';

  return /^(a|an|the|some|two|three)\s/i.test(word) ? word : `a ${word}`;
};

export const styleClause = (style: Style, soft: boolean) =>
  soft
    ? `Hint at the look only through colour and light: ${style.palette}, ${style.light}.`
    : `${style.look}. ${capital(style.light)}, ${style.palette}.`;

export type PromptInput = {
  style: Style;
  hint: string;
  strength: number;
  /** Adds the style's plain backdrop so a lone doodle does not grow a scene around it. */
  backdrop: boolean;
};

export const buildPrompt = ({ style, hint, strength, backdrop }: PromptInput) => {
  const rung = rungFor(strength);
  const parts = [rung.text.replaceAll('{S}', subjectPhrase(hint)), styleClause(style, rung.softStyle)];

  if (backdrop && !rung.softStyle) parts.push(`${capital(style.backdrop)} behind it, nothing else in the frame.`);

  return parts.join(' ');
};
