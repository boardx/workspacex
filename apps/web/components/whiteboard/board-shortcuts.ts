/** All board shortcuts share focus, IME, native-event and repetition guards. */
export function shouldHandleBoardShortcut(event: KeyboardEvent, host: HTMLElement | null): boolean {
  if(event.defaultPrevented || event.isComposing || event.repeat || event.altKey || !host || !(event.target instanceof Node)) return false;
  // A previous listener can dismiss a picker and detach its focused button.
  // The native dispatch path retains the original owner for this same event.
  const path = event.composedPath();
  if(!host.contains(event.target) && !path.includes(host)) return false;
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const editable = 'input,textarea,select,[contenteditable="true"],[role="textbox"],[role="dialog"]';
  return !target?.closest(editable) && !path.some(node => node instanceof Element && node.matches(editable));
}
export const BOARD_TOOL_SHORTCUTS = { v: "select", h: "hand", n: "sticky", t: "text", s: "shape", p: "pen", l: "connector", e: "eraser" } as const;
