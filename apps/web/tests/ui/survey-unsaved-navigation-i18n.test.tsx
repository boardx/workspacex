import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { useSurveyUnsavedNavigation } from "@/lib/survey/use-unsaved-navigation";
let locale: (next: Locale) => void;
let navigation: EventTarget;
function Driver() { locale = useI18n().setLocale; return null; }
function Form({ message }: { message?: string }) {
  useSurveyUnsavedNavigation(true, message);
  const [value, setValue] = React.useState("原草稿 {count}");
  return <input aria-label="raw-draft" value={value} onChange={event => setValue(event.target.value)} />;
}
function show(message?: string) { render(<I18nProvider initialLocale="zh-CN"><Driver /><Form message={message} /></I18nProvider>); }
function language(next: Locale) { act(() => locale(next)); }
function traverse() {
  const event = new Event("navigate", { cancelable: true });
  Object.defineProperty(event, "navigationType", { value: "traverse" }); navigation.dispatchEvent(event); return event;
}
function unload() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event; }
beforeEach(() => {
  navigation = new EventTarget(); Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
  vi.spyOn(window, "confirm").mockReturnValue(false); vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete (window as unknown as { navigation?: unknown }).navigation; });
it("uses current-language confirmation without reinstalling navigation guards or resetting the raw draft", () => {
  const add = vi.spyOn(navigation, "addEventListener"), remove = vi.spyOn(navigation, "removeEventListener"); show();
  const field = screen.getByRole("textbox", { name: "raw-draft" }) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "用户未保存 {name}" } }); field.focus(); field.setSelectionRange(2, 5);
  expect(traverse().defaultPrevented).toBe(true); expect(window.confirm).toHaveBeenLastCalledWith("离开将放弃未保存的修改，继续吗？");
  const listenerCount = add.mock.calls.length; language("en");
  expect(traverse().defaultPrevented).toBe(true); expect(window.confirm).toHaveBeenLastCalledWith("Leave and discard unsaved changes?");
  expect(add).toHaveBeenCalledTimes(listenerCount); expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "raw-draft" })).toBe(field); expect(field).toHaveValue("用户未保存 {name}");
  expect(field).toHaveFocus(); expect([field.selectionStart, field.selectionEnd]).toEqual([2, 5]);
});
it("keeps an accepted navigation approval through a locale change without prompting at unload", () => {
  vi.mocked(window.confirm).mockReturnValue(true); show(); expect(traverse().defaultPrevented).toBe(false); language("en");
  expect(unload().defaultPrevented).toBe(false); expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(traverse().defaultPrevented).toBe(false); expect(window.confirm).toHaveBeenLastCalledWith("Leave and discard unsaved changes?");
});
it("preserves the original approval expiry across locale changes", () => {
  vi.mocked(window.confirm).mockReturnValue(true); show(); traverse();
  act(() => vi.advanceTimersByTime(700)); language("en"); act(() => vi.advanceTimersByTime(301));
  expect(unload().defaultPrevented).toBe(true); expect(window.confirm).toHaveBeenCalledTimes(1);
  traverse(); expect(window.confirm).toHaveBeenLastCalledWith("Leave and discard unsaved changes?");
});
it("retains explicit caller-authored confirmation text across languages", () => {
  show("原提示 {count} / raw prompt"); traverse(); language("en"); traverse();
  expect(window.confirm).toHaveBeenCalledTimes(2); expect(window.confirm).toHaveBeenLastCalledWith("原提示 {count} / raw prompt");
});
