import type { BoardFitInsets } from './board-chrome-fit';

export function boardCanvasStatusLayout(insets: BoardFitInsets) {
  return { bottom: insets.bottom, left: insets.left, right: insets.right };
}
