/** CSS viewport coordinates shared by creation panels and their parent buttons. */
export function boardMenuPosition(anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>, preferredWidth: number, viewport: { width: number; height: number }, gap = 8, parentTop = anchor.top) {
  const margin = 16;
  const width = Math.max(1, Math.min(preferredWidth, viewport.width - margin * 2));
  return {
    left: Math.max(margin, Math.min(viewport.width - width - margin, anchor.left + anchor.width / 2 - width / 2)),
    bottom: viewport.height - parentTop + gap,
    width,
    maxHeight: Math.max(44, parentTop - gap - margin),
  };
}
