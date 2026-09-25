/**
 * A style preset is a set of prompt pieces, not a finished prompt. Buttons, not typing:
 * the client asked for drawing, not prompting. `buildPrompt` in models.ts puts the
 * pieces together in the language each model reads.
 *
 * Rules that came out of the 25 sep 2026 matrix (Research/Pruebas/matriz-estilos-antes):
 * - No object nouns ("figurine", "sign", "plush toy", "vase"): with no word in the
 *   prompt SDXL-Turbo draws that noun instead of the sketch (Plush gave a teddy bear).
 * - Always name colours: klein keeps the black ink and returns grey objects otherwise.
 * - The backdrop belongs to the style: a fixed "light background" fought Neon.
 * - CLIP draws the nouns in the tags too: "studio softboxes" gave a light stand,
 *   "pigment blooms" flowers, "blown glass" a drinking glass, "pattern" a plate.
 *   The prose `look` can keep them, klein reads them as description.
 */
export type StylePreset = {
  id: string;
  label: string;
  /**
   * - material: the sketch becomes a physical thing made of something ("Rebuild … carved from wood")
   * - medium: the sketch is redrawn in another technique ("Redraw … as a watercolor painting")
   */
  kind: 'material' | 'medium';
  /** For instruction models. Material: what it is made of. Medium: "a/an …" technique. */
  look: string;
  /** Named colors, never "colorful". */
  color: string;
  light: string;
  /** Plain backdrop, without the word "background". */
  backdrop: string;
  /** For CLIP models: short comma tags, most important first, under ~20 tokens. */
  tags: string;
  /** Only models with real CFG read it (not klein, not SDXL-Turbo at guidance 1). */
  negative: string;
};

const NEGATIVE = 'text, watermark, blurry, deformed';

export const STYLE_PRESETS = [
  {
    id: 'studio',
    label: 'Studio',
    kind: 'material',
    look: 'made of matte and gloss plastic like a finished industrial design prototype, with precise bevels',
    color: 'off-white body with warm grey details and one bright orange accent',
    light: 'clean softbox studio light, soft contact shadow',
    backdrop: 'seamless light grey',
    tags: 'industrial design prototype, matte white plastic, orange accent, precise bevels, softbox light',
    negative: `sketch, flat, clutter, ${NEGATIVE}`,
  },
  {
    id: 'wood',
    label: 'Wood',
    kind: 'material',
    look: 'carved from warm walnut and oak, visible wood grain, smooth sanded edges',
    color: 'honey, amber and dark walnut browns',
    light: 'warm studio light, soft shadow',
    backdrop: 'plain warm off-white',
    tags: 'carved walnut and oak wood, wood grain, sanded edges, honey brown, warm light',
    negative: `plastic, metal, flat, ${NEGATIVE}`,
  },
  {
    id: 'stone',
    label: 'Stone',
    kind: 'material',
    look: 'carved from pale travertine with chiselled edges and fine pores',
    color: 'warm sand, ivory and terracotta tones',
    light: 'soft museum light from the side',
    backdrop: 'plain warm beige',
    tags: 'carved travertine stone, chiselled edges, sand ivory terracotta, museum light',
    negative: `plastic, glossy, cartoon, ${NEGATIVE}`,
  },
  {
    id: 'glass',
    label: 'Glass',
    kind: 'material',
    look: 'blown from thick polished glass, with refractions and caustics on the floor',
    color: 'clear glass tinted amber and teal',
    light: 'bright backlight, sharp highlights',
    backdrop: 'plain light grey',
    tags: 'solid cast glass, translucent, amber and teal tint, refraction, caustics, backlight',
    negative: `opaque, matte, flat, ${NEGATIVE}`,
  },
  {
    id: 'cartoon',
    label: 'Cartoon',
    kind: 'medium',
    look: 'a bold 2D cartoon with thick clean black outlines and flat cel shading',
    color: 'every area filled with saturated red, yellow, blue and green',
    light: 'flat light, one simple shadow tone',
    backdrop: 'plain white',
    tags: '2D cartoon, thick black outlines, flat cel shading, saturated primary colors',
    negative: `photo, 3d render, gradient, ${NEGATIVE}`,
  },
  {
    id: 'toy',
    label: '3D Toy',
    kind: 'material',
    look: 'made of glossy injection-molded vinyl, like a designer toy, with chunky rounded shapes',
    color: 'bright candy colors, each part a different one: coral, lemon yellow, mint and sky blue',
    light: 'soft studio light, subtle contact shadow',
    backdrop: 'plain soft pastel',
    tags: 'glossy vinyl designer toy, chunky rounded plastic, coral yellow mint sky blue, studio light',
    negative: `flat, 2d, sketch, ${NEGATIVE}`,
  },
  {
    id: 'plush',
    label: 'Plush',
    kind: 'material',
    look: 'sewn from soft felt and fleece, stuffed and puffy, with stitched seams along the drawn lines',
    color: 'warm pastel felt in peach, butter yellow and sage green',
    light: 'soft diffuse daylight',
    backdrop: 'plain cream',
    tags: 'stuffed felt and fleece, stitched seams, puffy, peach butter yellow sage green, soft light',
    negative: `hard surface, metal, glossy, ${NEGATIVE}`,
  },
  {
    id: 'ceramic',
    label: 'Ceramic',
    kind: 'material',
    look: 'made of glossy glazed ceramic with hand-painted patterns',
    color: 'cobalt blue, terracotta and cream glaze',
    light: 'soft studio light with specular highlights',
    backdrop: 'plain warm neutral',
    tags: 'glossy glazed ceramic, painted glaze, cobalt blue terracotta cream, specular highlights',
    negative: `rough, flat illustration, ${NEGATIVE}`,
  },
  {
    id: 'neon',
    label: 'Neon',
    kind: 'material',
    look: 'made of glowing neon glass tubes that follow every drawn line',
    color: 'hot pink and electric cyan light',
    light: 'strong glow and bloom, colored reflections on the wall',
    backdrop: 'dark brick wall at night',
    tags: 'glowing neon tubes, hot pink and electric cyan, light bloom, dark brick wall at night',
    negative: `daylight, flat colors, ${NEGATIVE}`,
  },
  {
    id: 'ink',
    label: 'Ink',
    kind: 'medium',
    look: 'a confident hand-inked brush drawing, strokes of varying width, a few ink splatters',
    color: 'black ink only',
    light: 'no shading beyond hatching',
    backdrop: 'off-white paper',
    tags: 'black ink brush drawing, varying line width, hatching, ink splatter, off-white paper',
    negative: `color, photo, 3d render, ${NEGATIVE}`,
  },
  {
    id: 'chrome',
    label: 'Chrome',
    kind: 'material',
    look: 'made of mirror-polished liquid chrome with an iridescent sheen',
    color: 'silver reflecting rainbow iridescence',
    light: 'studio softboxes reflected in the metal',
    backdrop: 'plain dark graphite',
    tags: 'liquid chrome, mirror polished metal, iridescent rainbow reflections, dark graphite',
    negative: `matte, flat, sketch, ${NEGATIVE}`,
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    kind: 'medium',
    look: 'a loose watercolor painting, wet washes that bleed past the drawn lines, pigment blooms',
    color: 'indigo, rose and ochre washes',
    light: 'soft, no hard shadows',
    backdrop: 'white cold-press paper',
    tags: 'loose watercolor painting, wet washes, bleeding edges, indigo rose ochre, white paper',
    negative: `digital, 3d render, vector, ${NEGATIVE}`,
  },
  {
    id: 'pixel',
    label: 'Pixel',
    kind: 'medium',
    look: 'a 16-bit pixel art sprite with chunky square pixels and a one-pixel dark outline',
    color: 'every area filled with flat color from a bright 12-color palette',
    light: 'two-tone pixel shading',
    backdrop: 'plain dark navy',
    tags: '16-bit pixel art sprite, chunky square pixels, bright limited palette, dark navy',
    negative: `smooth, antialiased, photo, ${NEGATIVE}`,
  },
  {
    id: 'sticker',
    label: 'Sticker',
    kind: 'medium',
    look: 'a die-cut glossy vinyl sticker with a thick white border and a soft drop shadow',
    color: 'bold saturated flat colors',
    light: 'glossy highlight across the sticker',
    backdrop: 'plain light grey',
    tags: 'die-cut vinyl sticker, thick white border, bold flat colors, glossy, drop shadow',
    negative: `photo, realistic, complex background, ${NEGATIVE}`,
  },
] as const satisfies readonly StylePreset[];

export const DEFAULT_PRESET_ID = 'toy';
