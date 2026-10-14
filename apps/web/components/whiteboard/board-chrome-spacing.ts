/** Physical chrome spacing stays stable when users enlarge text independently. */
export const BOARD_CHROME_SPACING = { edge: 16, headerGap: 16, stackedGap: 12, dockBottom: 20, padding: 4, gap: 2 } as const;
export function boardMindmapControlsLayout(width: number, headerBottom: number, navigationBottom: number) {
  return { left: BOARD_CHROME_SPACING.edge,
    top: Math.max(headerBottom + BOARD_CHROME_SPACING.headerGap, width < 640 ? navigationBottom + BOARD_CHROME_SPACING.stackedGap : 0),
    maxWidth: Math.max(0, width - BOARD_CHROME_SPACING.edge * 2) };
}
