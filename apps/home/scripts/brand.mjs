/**
 * brand.mjs — the brand mark, declared once.
 *
 * The mark's geometry lives in four documents that cannot share a runtime:
 * the sprite in index.html, the same sprite in privacy.html, the inline copy
 * in the social card, and assets/img/favicon.svg, which a browser fetches on
 * its own with no stylesheet attached. Hand-copying a path across four files
 * is how a logo ends up with three versions of itself; this module is the one
 * that counts, and build-brand.mjs writes the other four from it.
 *
 * The shape: four lobes, each a leaf swept from the centre and rotated a
 * quarter turn from the last. The control points are deliberately asymmetric
 * — the leading edge leaves the centre further out than the trailing edge —
 * so the mark turns rather than sits. A symmetric petal reads as a botanical
 * clover; this one reads as something in motion.
 */

export const VIEWBOX = '0 0 32 32';

/** One lobe, tip at twelve o'clock. The other three are this, rotated. */
export const LOBE = 'M16 16C9.8 13 8.6 5.4 15 1.8c7 2.6 7.6 10 1 14.2z';

export const ANGLES = [0, 90, 180, 270];

/**
 * The gradient runs corner to corner in USER space, not per-path. With the
 * default objectBoundingBox each lobe resolves the gradient against its own
 * box, so all four come out identically shaded and the mark reads as one flat
 * colour. Spanning 2→30 lets the top lobe sit in the orange and the bottom
 * one in the magenta, which is the whole point of a three-stop brand.
 */
export const GRADIENT = { x1: 2, y1: 2, x2: 30, y2: 30 };
export const STOPS = [0, 0.52, 1];

/** The four rotated lobes, as markup. `fill` is a paint server reference. */
export const lobes = (fill, indent = '') => ANGLES
  .map((a) => `${indent}<path d="${LOBE}" fill="${fill}"${a ? ` transform="rotate(${a} 16 16)"` : ''}/>`)
  .join('\n');

/** The gradient element, with each stop painted by `paint(i)`. */
export const gradient = (id, paint) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" `
  + `x1="${GRADIENT.x1}" y1="${GRADIENT.y1}" x2="${GRADIENT.x2}" y2="${GRADIENT.y2}">\n`
  + STOPS.map((o, i) => `      <stop offset="${o}" ${paint(i)}/>`).join('\n')
  + `\n    </linearGradient>`;
