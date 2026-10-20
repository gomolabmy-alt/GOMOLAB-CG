// Built-in shape library for the 'shape' TemplateElement kind — closed SVG
// paths sharing one viewBox so any pair of them morphs reasonably by
// default via GSAP's MorphSVGPlugin (see cgAnimationEngine.ts's buildMorph).
// A shape element isn't limited to these — ElementInspector also exposes a
// raw "Path (SVG d)" field for pasting a fully custom path.

export const SHAPE_VIEWBOX = '0 0 100 100';

export const SHAPE_LIBRARY: Record<string, string> = {
  circle: 'M50,2 A48,48 0 1,0 50.01,2 Z',
  square: 'M5,5 L95,5 L95,95 L5,95 Z',
  triangle: 'M50,5 L95,90 L5,90 Z',
  star: 'M50,3 L61,37 L98,37 L68,58 L79,92 L50,71 L21,92 L32,58 L2,37 L39,37 Z',
  heart: 'M50,88 C20,65 2,45 2,25 C2,8 15,2 27,2 C37,2 46,9 50,18 C54,9 63,2 73,2 C85,2 98,8 98,25 C98,45 80,65 50,88 Z',
  hexagon: 'M25,5 L75,5 L98,50 L75,95 L25,95 L2,50 Z',
  pentagon: 'M50,3 L95,37 L78,90 L22,90 L5,37 Z',
  diamond: 'M50,2 L92,50 L50,98 L8,50 Z',
  arrow: 'M5,35 L60,35 L60,10 L98,50 L60,90 L60,65 L5,65 Z',
  cross: 'M35,5 L65,5 L65,35 L95,35 L95,65 L65,65 L65,95 L35,95 L35,65 L5,65 L5,35 L35,35 Z',
};

export const DEFAULT_SHAPE = 'circle';
