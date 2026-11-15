import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AidtAssistantPanel } from "@/features/aidt/components/aidt-assistant-panel";

afterEach(() => { vi.unstubAllGlobals(); });
it("keeps native composer DOM and unsent text through closing/reopening and returns focus to the opener", () => {
  function Workspace() {
    const [open, setOpen] = React.useState(false);
    const close = React.useCallback(() => setOpen(false), []);
    return <><button onClick={() => setOpen(true)}>打开本步引导师</button><AidtAssistantPanel open={open} fullPage={false} onClose={close}><textarea aria-label="原生聊天输入" defaultValue="未发送草稿" /></AidtAssistantPanel></>;
  }
  render(<Workspace />); const opener = screen.getByRole("button", { name: "打开本步引导师" }); opener.focus(); fireEvent.click(opener);
  expect(screen.getByRole("button", { name: "关闭 AI 引导师" })).toHaveFocus(); const composer = screen.getByLabelText("原生聊天输入"); fireEvent.change(composer, { target: { value: "学生正在编辑的原生聊天草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭 AI 引导师" })); expect(opener).toHaveFocus(); expect(screen.getByLabelText("原生聊天输入")).toBe(composer); fireEvent.click(opener); composer.focus(); fireEvent.keyDown(composer, { key: "Escape" }); expect(opener).toHaveFocus(); expect(screen.getByLabelText("原生聊天输入")).toHaveValue("学生正在编辑的原生聊天草稿"); expect(screen.getByTestId("aidt-assistant-panel")).not.toBeVisible();
});
it("does not consume another member plugin's Escape, IME composition or an already handled Escape", () => {
  const close = vi.fn(); render(<><AidtAssistantPanel open fullPage={false} onClose={close}><textarea aria-label="AI输入" /></AidtAssistantPanel><input aria-label="成员讨论输入" /></>);
  const member = screen.getByLabelText("成员讨论输入"), ai = screen.getByLabelText("AI输入"); member.focus(); fireEvent.keyDown(member, { key: "Escape" }); fireEvent.keyDown(document, { key: "Escape" }); expect(close).not.toHaveBeenCalled();
  ai.focus(); fireEvent.keyDown(ai, { key: "Escape", isComposing: true }); fireEvent.keyDown(ai, { key: "Escape", keyCode: 229 }); const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); handled.preventDefault(); fireEvent(ai, handled); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(ai, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1);
});
it("keeps typing focus and the same composer when the mobile visual viewport changes or returns to full-page Chat", () => {
  vi.stubGlobal("innerWidth", 375);
  const viewport = Object.assign(new EventTarget(), { width: 375, height: 812, offsetTop: 0, offsetLeft: 0 }); vi.stubGlobal("visualViewport", viewport);
  const removeListener = vi.spyOn(viewport, "removeEventListener"), close = vi.fn();
  const view = render(<AidtAssistantPanel open fullPage={false} onClose={close}><textarea aria-label="原生聊天输入" defaultValue="键盘打开前的草稿" /></AidtAssistantPanel>);
  const composer = screen.getByLabelText("原生聊天输入"); composer.focus(); act(() => { viewport.height = 380; viewport.offsetTop = 24; viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); }); expect(composer).toHaveFocus(); expect(screen.getByLabelText("原生聊天输入")).toBe(composer);
  view.rerender(<AidtAssistantPanel open fullPage onClose={close}><textarea aria-label="原生聊天输入" defaultValue="键盘打开前的草稿" /></AidtAssistantPanel>); expect(screen.getByLabelText("原生聊天输入")).toBe(composer); expect(composer).toHaveValue("键盘打开前的草稿"); expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function)); expect(removeListener).toHaveBeenCalledWith("scroll", expect.any(Function)); composer.focus(); fireEvent.keyDown(composer, { key: "Escape" }); expect(close).not.toHaveBeenCalled();
});
