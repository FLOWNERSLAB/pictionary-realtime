/**
 * The style catalogue. A style is a *treatment* of the render, never a subject:
 * it says how the picture is made (camera, material, medium), how it is lit, which
 * colours it uses and what sits behind. It contains no object noun klein could draw
 * instead of the sketch: no "toy", "figurine", "sign", "vase", "plush". That rule is
 * what keeps "Cartoon" from turning every drawing into a toy (23 oct 2026 audit).
 *
 * What the picture *is* comes only from the sketch and the optional hint; how closely
 * the lines are followed is AI Strength's business (src/lib/prompt.ts). The three
 * never mix inside a style.
 *
 * Measured on klein realtime on 23 oct 2026 (scripts/lab/exp_styles.py).
 */
export type StyleGroup = 'photo' | 'material' | 'art';

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

export const STYLE_GROUP_LABEL: Record<StyleGroup, string> = {
  photo: 'Foto',
  material: 'Materia',
  art: 'Arte',
};

export const STYLES: readonly Style[] = [
  {
    id: 'photo',
    group: 'photo',
    label: 'Natural',
    look: 'Photograph it with a real camera in natural daylight, true-to-life materials and textures, 50 mm lens, slight depth of field',
    light: 'soft natural daylight',
    palette: 'true-to-life colors',
    backdrop: 'a simple real-world setting',
    tags: 'photorealistic, natural daylight, 50mm, true-to-life colors, sharp detail',
  },
  {
    id: 'studio',
    group: 'photo',
    label: 'Estudio',
    look: 'Photograph it as a clean studio product shot, crisp detail, subtle reflections on the surface it stands on',
    light: 'large softbox light with a gentle contact shadow',
    palette: 'accurate, slightly muted colors',
    backdrop: 'seamless light grey',
    tags: 'studio product photography, softbox light, seamless light grey, crisp, subtle reflection',
  },
  {
    id: 'cinematic',
    group: 'photo',
    label: 'Cine',
    look: 'Shoot it like a film still, anamorphic lens, shallow depth of field, volumetric haze',
    light: 'dramatic side light with a cool rim light',
    palette: 'teal shadows and amber highlights',
    backdrop: 'a dim, atmospheric space',
    tags: 'cinematic film still, anamorphic, shallow depth of field, teal and amber, volumetric haze',
  },
  {
    id: 'film35',
    group: 'photo',
    label: '35 mm',
    look: 'Shoot it on 35 mm analogue film, fine grain, slightly faded tones, gentle halation on highlights',
    light: 'available light',
    palette: 'warm faded colors with soft blacks',
    backdrop: 'an everyday real place',
    tags: '35mm film photo, fine grain, faded warm tones, halation, available light',
  },
  {
    id: 'golden',
    group: 'photo',
    label: 'Hora dorada',
    look: 'Photograph it outdoors at golden hour, long soft shadows and a touch of lens flare',
    light: 'warm low sun from behind',
    palette: 'gold, amber and deep blue sky',
    backdrop: 'an open outdoor space',
    tags: 'golden hour photo, warm low sun, long shadows, lens flare, deep blue sky',
  },
  {
    id: 'night',
    group: 'photo',
    label: 'Noche',
    look: 'Photograph it at night in a city street, neon reflections on wet asphalt, high ISO',
    light: 'mixed neon and street light',
    palette: 'cyan and magenta light on dark tones',
    backdrop: 'a rainy street at night',
    tags: 'night street photo, neon reflections, wet asphalt, cyan and magenta light, high iso',
  },
  {
    id: 'macro',
    group: 'photo',
    label: 'Macro',
    look: 'Photograph it as an extreme close-up macro shot, razor-thin focus plane, visible micro texture, creamy bokeh',
    light: 'soft diffused light',
    palette: 'natural colors',
    backdrop: 'blurred, out of focus',
    tags: 'macro photo, extreme close-up, razor thin focus, micro texture, creamy bokeh',
  },
  {
    id: 'bw',
    group: 'photo',
    label: 'Blanco y negro',
    look: 'Photograph it in black and white, documentary style, strong contrast and visible grain',
    light: 'hard directional light',
    palette: 'pure black and white, no color',
    backdrop: 'a plain, slightly textured wall',
    tags: 'black and white documentary photo, high contrast, grain, hard light',
  },
  {
    id: 'clay',
    group: 'material',
    label: 'Arcilla',
    look: 'Make it hand-sculpted from modelling clay, fingerprints and tool marks visible, matte surface, photographed on a table',
    light: 'soft daylight from a window',
    palette: 'terracotta, cream and sage green clay',
    backdrop: 'a plain wooden table top',
    tags: 'hand-sculpted modelling clay, fingerprints, matte, terracotta cream sage green, soft window light',
  },
  {
    id: 'chrome',
    group: 'material',
    label: 'Cromo',
    look: 'Make it mirror-polished liquid chrome, every surface reflecting the room',
    light: 'studio light with sharp reflections',
    palette: 'silver with faint iridescent tints',
    backdrop: 'plain dark graphite',
    tags: 'liquid chrome, mirror polished metal, iridescent reflections, dark graphite',
  },
  {
    id: 'glass',
    group: 'material',
    label: 'Cristal',
    look: 'Make it cast in thick translucent glass, with refractions and caustics on the floor',
    light: 'bright backlight with sharp highlights',
    palette: 'clear glass tinted amber and teal',
    backdrop: 'plain light grey',
    tags: 'cast translucent glass, amber and teal tint, refraction, caustics, backlight',
  },
  {
    id: 'wood',
    group: 'material',
    label: 'Madera',
    look: 'Make it carved from solid walnut, visible wood grain and smooth sanded edges',
    light: 'warm workshop light',
    palette: 'honey, amber and dark brown',
    backdrop: 'plain warm off-white',
    tags: 'carved solid walnut, wood grain, sanded edges, honey amber brown, warm light',
  },
  {
    id: 'papercraft',
    group: 'material',
    label: 'Papel',
    look: 'Make it cut and folded from layered colored paper, papercraft with crisp edges and soft paper shadows',
    light: 'soft top light',
    palette: 'coral, mustard, teal and cream paper',
    backdrop: 'plain cream paper',
    tags: 'layered papercraft, cut colored paper, crisp edges, paper shadows, coral mustard teal cream',
  },
  {
    id: 'neon',
    group: 'material',
    label: 'Neón',
    look: 'Make it bent from glowing neon tubes that follow the drawn lines, glow and bloom, colored reflections on the wall',
    light: 'its own neon glow',
    palette: 'hot pink and electric cyan',
    backdrop: 'a dark brick wall at night',
    tags: 'glowing neon tubes, hot pink and electric cyan, light bloom, dark brick wall at night',
  },
  {
    id: 'watercolor',
    group: 'art',
    label: 'Acuarela',
    look: 'Paint it as a loose watercolor, wet washes bleeding past the lines, pigment blooms, visible paper grain',
    light: 'flat, no hard shadows',
    palette: 'indigo, rose and ochre washes',
    backdrop: 'white cold-press paper',
    tags: 'loose watercolor painting, wet washes, bleeding edges, indigo rose ochre, white paper',
  },
  {
    id: 'ink',
    group: 'art',
    label: 'Tinta',
    look: 'Draw it as a confident brush-and-ink illustration, strokes of varying width, hatching, a few splatters',
    light: 'no shading beyond hatching',
    palette: 'black ink only',
    backdrop: 'off-white paper',
    tags: 'black ink brush drawing, varying line width, hatching, ink splatter, off-white paper',
  },
  {
    id: 'oil',
    group: 'art',
    label: 'Óleo',
    look: 'Paint it as a thick impasto oil painting, visible brush strokes and palette-knife texture',
    light: 'warm gallery light raking across the paint',
    palette: 'rich earth tones with a cobalt accent',
    backdrop: 'a plain painted canvas',
    tags: 'impasto oil painting, thick brush strokes, palette knife texture, earth tones, cobalt accent',
  },
  {
    id: 'cartoon',
    group: 'art',
    label: 'Cartoon',
    look: 'Draw it as a bold flat 2D cartoon, thick clean black outlines, flat cel shading, no 3D volume',
    light: 'flat light with one simple shadow tone',
    palette: 'saturated red, yellow, blue and green fills',
    backdrop: 'plain white',
    tags: 'flat 2D cartoon, thick black outlines, flat cel shading, saturated primary colors',
  },
  {
    id: 'pixel',
    group: 'art',
    label: 'Pixel',
    look: 'Draw it as 16-bit pixel art, chunky square pixels, one-pixel dark outline, two-tone pixel shading',
    light: 'flat two-tone shading',
    palette: 'a bright limited 12-color palette',
    backdrop: 'plain dark navy',
    tags: '16-bit pixel art, chunky square pixels, limited bright palette, dark navy',
  },
  {
    id: 'riso',
    group: 'art',
    label: 'Risografía',
    look: 'Print it as a two-color risograph, grainy halftone texture, slight misregistration between the colors',
    light: 'flat',
    palette: 'fluorescent pink and teal blue ink',
    backdrop: 'plain off-white paper',
    tags: 'two-color risograph print, halftone grain, misregistration, fluorescent pink and teal',
  },
];

export const DEFAULT_STYLE_ID = 'photo';

export const findStyle = (id: string) => STYLES.find(style => style.id === id) ?? STYLES[0];

export const stylesIn = (group: StyleGroup) => STYLES.filter(style => style.group === group);

/** Keys 1-9 pick the first nine styles in catalogue order. */
export const styleKey = (id: string) => {
  const index = STYLES.findIndex(style => style.id === id);

  return index >= 0 && index < 9 ? String(index + 1) : null;
};
