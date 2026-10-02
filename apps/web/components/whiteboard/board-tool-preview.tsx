import type { StickyVariant } from '@repo/whiteboard-core';

/** Keep the paper silhouette consistent in the picker and active tool. */
export function StickyToolPreview({ variant, color }: { variant: StickyVariant; color: string }) {
  return <span aria-hidden="true" data-sticky-variant={variant} className="block shrink-0 border border-border/30 shadow-sm" style={{ backgroundColor: color, width: variant === 'rectangle' ? 30 : 24, height: variant === 'rectangle' ? 19 : 24, borderRadius: variant === 'circle' ? '50%' : 2 }} />;
}
