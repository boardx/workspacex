/** Reserved identity for source artifacts used only to transport a rendered canvas to Board. */
const BOARD_TRANSPORT_PREFIX = '[board-transport] ';
export function boardTransportTitle(title: string): string {
  return `${BOARD_TRANSPORT_PREFIX}${title}`;
}
export function isBoardTransportTitle(title: string): boolean {
  return title.startsWith(BOARD_TRANSPORT_PREFIX);
}
