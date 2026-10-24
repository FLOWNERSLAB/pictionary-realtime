import catalogue from './styles.json';

/**
 * The style catalogue lives in styles.json, the one copy the app and the Python
 * harness (scripts/lab/promptkit.py) both read. The rules are at the top of that file;
 * in short: a style is a treatment (camera, material, medium, world), never the word
 * being drawn. It may name a world the sketch is read in (product design, brutalist
 * building, game asset), which is what Krea's examples do, but never an object noun
 * klein could draw instead of the sketch (24 oct 2026, after David's Krea videos).
 *
 * The 24 oct cut dropped the six photography moods (cinematic, 35 mm, golden hour,
 * night, macro, black and white): they only changed the lighting of the same photo.
 */
export type StyleGroup = 'photo' | 'render' | 'material' | 'art';

export type Style = {
  id: string;
  group: StyleGroup;
  label: string;
  /** How the render is made, imperative, no object nouns. */
  look: string;
  light: string;
  /** Named colours, never "colorful". */
  palette: string;
  /** What sits behind, without the word "background". */
  backdrop: string;
  /** For StreamDiffusion (CLIP): short comma tags, most important first, no object nouns. */
  tags: string;
};

export const STYLE_GROUPS: readonly StyleGroup[] = ['photo', 'render', 'material', 'art'];

export const STYLE_GROUP_LABEL = catalogue.groups as Record<StyleGroup, string>;

export const STYLES: readonly Style[] = catalogue.styles as Style[];

export const DEFAULT_STYLE_ID = 'photo';

export const findStyle = (id: string) => STYLES.find(style => style.id === id) ?? STYLES[0];

export const stylesIn = (group: StyleGroup) => STYLES.filter(style => style.group === group);

/** Keys 1-9 pick the first nine styles in catalogue order. */
export const styleKey = (id: string) => {
  const index = STYLES.findIndex(style => style.id === id);

  return index >= 0 && index < 9 ? String(index + 1) : null;
};
