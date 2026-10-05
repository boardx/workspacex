/** All board shortcuts share focus, IME, native-event and repetition guards. */
export function shouldHandleBoardShortcut(event: KeyboardEvent, host: HTMLElement | null): boolean {
  if(event.defaultPrevented || event.isComposing || event.repeat || event.altKey || !host || !(event.target instanceof Node) || !host.contains(event.target)) return false;
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  return !target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="dialog"]');
}
export const BOARD_TOOL_SHORTCUTS = { v: "select", h: "hand", n: "sticky", t: "text", s: "shape", p: "pen", l: "connector", e: "eraser" } as const;
