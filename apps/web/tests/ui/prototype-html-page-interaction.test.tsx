// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { designHtmlPage } from "@repo/contracts";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = designHtmlPage.sanitizeHtmlPage('<div class="p"><h1>标题</h1><button data-goto="1">去第二页</button></div>').html;
const link = designHtmlPage.htmlPageLinks(html)[0]!;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount(props: Partial<React.ComponentProps<typeof PrototypeCanvas>>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <PrototypeCanvas label="首页" root={{ id: "p1", type: "html", props: { html } }} links={[{ from: link.from, to: link.to }]} {...props} />,
    );
  });
  return host.querySelector("iframe") as HTMLIFrameElement;
}
const post = (frame: HTMLIFrameElement, data: unknown) =>
  act(() => { window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow })); });

describe("HTML 页：iframe 消息 → 画布行为", () => {
  it("预览态：goto 消息 ⇒ 跳到 links 里那一页", () => {
    const onNavigate = vi.fn();
    const frame = mount({ mode: "preview", onNavigate });
    post(frame, { source: "wsx-html-page", type: "goto", id: link.from });
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("编辑态：select 消息 ⇒ 先选中这一页、再选中那个元素", () => {
    const calls: string[] = [];
    const frame = mount({ mode: "edit", onSelect: (id) => calls.push(`node:${id}`), onSelectRef: (r) => calls.push(`ref:${String(r)}`) });
    post(frame, { source: "wsx-html-page", type: "select", ref: "r2" });
    expect(calls).toEqual(["node:p1", "ref:r2"]);
  });

  it("编辑态：点空白处（ref 为 null）⇒ 选中整页，不选元素", () => {
    const calls: string[] = [];
    const frame = mount({ mode: "edit", onSelect: (id) => calls.push(`node:${id}`), onSelectRef: (r) => calls.push(`ref:${String(r)}`) });
    post(frame, { source: "wsx-html-page", type: "select", ref: null });
    expect(calls).toEqual(["node:p1", "ref:null"]);
  });

  it("别的窗口发来的消息一律不理（source 不是这个 iframe）", () => {
    const onSelect = vi.fn();
    mount({ mode: "edit", onSelect });
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { source: "wsx-html-page", type: "select", ref: "r2" }, source: window })); });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("预览态不响应 select；编辑态不响应 goto", () => {
    const onNavigate = vi.fn();
    const onSelect = vi.fn();
    const p = mount({ mode: "preview", onNavigate, onSelect });
    post(p, { source: "wsx-html-page", type: "select", ref: "r2" });
    expect(onSelect).not.toHaveBeenCalled();
    act(() => root?.unmount());
    const e = mount({ mode: "edit", onNavigate, onSelect });
    post(e, { source: "wsx-html-page", type: "goto", id: link.from });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
