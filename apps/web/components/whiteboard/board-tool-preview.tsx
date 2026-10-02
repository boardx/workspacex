import type { StickyVariant, ShapeVariant } from '@repo/whiteboard-core';

/** Shared by the picker and dock, so the selected tool previews its next object. */
export function StickyToolPreview({ variant, color }: { variant: StickyVariant; color: string }) {
  return <span aria-hidden="true" data-sticky-variant={variant} className="block shrink-0 border border-border/30 shadow-sm" style={{ backgroundColor: color, width: variant === 'rectangle' ? 30 : 24, height: variant === 'rectangle' ? 19 : 24, borderRadius: variant === 'circle' ? '50%' : 2 }} />;
}

export function ShapeToolPreview({ variant }: { variant: ShapeVariant }) {
  let shape: React.ReactNode;
  switch (variant) {
    case 'circle': shape = <circle cx="20" cy="20" r="15" />; break;
    case 'ellipse': shape = <ellipse cx="20" cy="20" rx="17" ry="12" />; break;
    case 'diamond': case 'decision': shape = <path d="M20 3 37 20 20 37 3 20Z" />; break;
    case 'triangle': shape = <path d="M20 4 37 35H3Z" />; break;
    case 'hexagon': shape = <path d="M11 5H29L38 20 29 35H11L2 20Z" />; break;
    case 'cloud': shape = <path d="M10 31C1 31 1 18 9 17 8 6 22 3 26 13 37 9 43 28 31 31Z" />; break;
    case 'database': shape = <><path d="M5 10V30C5 38 35 38 35 30V10" /><ellipse cx="20" cy="10" rx="15" ry="6" /><path d="M5 20C5 28 35 28 35 20" /></>; break;
    case 'document': shape = <path d="M6 4H26L34 12V36H6ZM26 4V12H34" />; break;
    case 'data': shape = <path d="M12 6H38L28 34H2Z" />; break;
    case 'predefined-process': shape = <><rect x="3" y="7" width="34" height="26" /><path d="M9 7V33M31 7V33" /></>; break;
    default: shape = <rect x="3" y="7" width="34" height="26" rx={variant === 'terminator' ? 13 : variant === 'rounded-rectangle' ? 6 : 0} />;
  }
  return <svg aria-hidden="true" viewBox="0 0 40 40" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">{shape}</svg>;
}
