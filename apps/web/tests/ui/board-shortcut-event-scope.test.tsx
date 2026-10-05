import { afterEach, expect, it } from "vitest";
import { shouldHandleBoardShortcut } from "@/components/whiteboard/board-shortcuts";
const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
function dispatchScope({ outside = false, input = false, dialog = false, composing = false, repeat = false, prevented = false } = {}) {
  const host = document.createElement("section"), picker = document.createElement("div"), target = document.createElement(input ? "input" : "button");
  if (dialog) picker.setAttribute("role", "dialog");
  picker.append(target); host.append(picker); document.body.append(host);
  let detached = false, owned = false, handled: boolean | undefined;
  const dismiss = () => { target.remove(); detached = !host.contains(target); };
  const check = (event: KeyboardEvent) => { owned = event.composedPath().includes(host); handled = shouldHandleBoardShortcut(event, host); };
  host.addEventListener("keydown", dismiss, { capture: true });
  window.addEventListener("keydown", check);
  disposers.push(() => window.removeEventListener("keydown", check));
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, isComposing: composing, repeat });
  if (prevented) event.preventDefault();
  (outside ? document.body : target).dispatchEvent(event);
  return { handled, detached, owned };
}
it("keeps the original board scope when an earlier listener unmounts the focused picker", () => {
  expect(dispatchScope()).toEqual({ handled: true, detached: true, owned: true });
});
it("continues to reject outside events", () => {
  expect(dispatchScope({ outside: true })).toEqual({ handled: false, detached: false, owned: false });
});
it("retains input protection after detachment", () => { expect(dispatchScope({ input: true }).handled).toBe(false); });
it("retains original dialog ancestry after detachment", () => { expect(dispatchScope({ dialog: true }).handled).toBe(false); });
it("continues to reject IME, repeat and already handled events", () => {
  expect(dispatchScope({ composing: true }).handled).toBe(false);
  expect(dispatchScope({ repeat: true }).handled).toBe(false);
  expect(dispatchScope({ prevented: true }).handled).toBe(false);
});
