/**
 * Design tokens for every diagram and canvas template.
 * See VISUAL-SPEC.md §0 — no plugin should hardcode colors.
 */

export const INK = '#1e293b';
export const INK_SOFT = '#64748b';
export const LINE = '#cbd5e1';
export const PAPER = '#ffffff';
export const CANVAS_BG = '#f8fafc';

export const PRIMARY = '#4f46e5';
export const PRIMARY_SOFT = '#eef2ff';

/** Categorical palette (8 hues, uniform saturation). */
export const PALETTE = [
  '#818cf8', // indigo
  '#f472b6', // pink
  '#4ade80', // green
  '#fbbf24', // amber
  '#38bdf8', // sky
  '#f87171', // red
  '#a78bfa', // violet
  '#2dd4d4', // teal
] as const;

/** Soft backgrounds matching PALETTE by index. */
export const PALETTE_SOFT = [
  '#e0e7ff',
  '#fce7f3',
  '#dcfce7',
  '#fef3c7',
  '#e0f2fe',
  '#fee2e2',
  '#ede9fe',
  '#ccfbf1',
] as const;

export const STICKY_FILL = '#fef3c7';
export const STICKY_STROKE = '#f59e0b';
/** Sticky fills rotated per template section. */
export const STICKY_ROTATION = ['#fef3c7', '#fce7f3', '#dcfce7', '#e0f2fe'] as const;

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT = { title: 18, section: 14, body: 13, small: 11 } as const;

export const RADIUS = { node: 8, card: 6 } as const;
export const STROKE_W = { normal: 1.5, strong: 2 } as const;

/** fabric.Shadow options for primary nodes/cards (not decorations). */
export const NODE_SHADOW = {
  color: 'rgba(15,23,42,0.10)',
  blur: 6,
  offsetX: 0,
  offsetY: 2,
} as const;

export const paletteAt = (i: number): string => PALETTE[i % PALETTE.length]!;
export const paletteSoftAt = (i: number): string => PALETTE_SOFT[i % PALETTE_SOFT.length]!;
export const stickyFillAt = (i: number): string => STICKY_ROTATION[i % STICKY_ROTATION.length]!;
