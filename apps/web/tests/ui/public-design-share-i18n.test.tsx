import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SharedDesignView } from "@/components/design-loop/shared-design-view";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { ApiError } from "@/lib/api-client";
import type { SharedDesign } from "@/lib/live-design-workbench";
import type { designPrototype } from "@repo/contracts";

const LINK_ID = "public-design-fixture";
const NOW = new Date("2026-11-05T12:00:00Z").getTime();
const rawHtml = "<main><h1>原始设计 {title}</h1><button data-id='next'>用户按钮</button></main>";
const firstPage: designPrototype.PrototypeNode = {
  type: "stack", id: "first", children: [
    { type: "text", id: "raw", props: { content: "模型原文 {name}", variant: "body" } },
    { type: "button", id: "next", props: { label: "原始下一页", variant: "primary" } },
  ],
};
function snapshot(overrides: Partial<SharedDesign> = {}): SharedDesign {
  return {
    name: "用户原型 {name}", template: "mobile", theme: "dark", accent: "blue",
    tokens: { brand: null, font: "sans", radius: "default", density: "default" },
    frames: ["原始首页", "原始次页"], prototype: [firstPage, firstPage],
    frameNotes: ["原始说明 {note}", "次页说明"],
    frameLinks: [[{ from: "next", to: 1 }], []],
    publishedAt: new Date(NOW - 2 * 60_000).toISOString(), ownerName: "原始作者",
    problem: "原始问题 {problem}", criteria: ["原始目标 {criterion}"], ...overrides,
  };
}
function LocaleControl() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en")}>test English</button><button onClick={() => setLocale("zh-CN")}>test Chinese</button></>;
}
function mount(load: NonNullable<ComponentProps<typeof SharedDesignView>["load"]>, initialLocale: Locale = "en") {
  return render(<I18nProvider initialLocale={initialLocale}><LocaleControl /><SharedDesignView token={LINK_ID} load={load} /></I18nProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("public design share current-locale chrome", () => {
  // Reverting the loading projection to its original Chinese literal must fail this case.
  it("localizes the mounted loading state without starting another load", () => {
    const load = vi.fn(() => new Promise<{ design: SharedDesign }>(() => {}));
    mount(load);
    const loading = screen.getByTestId("shared-design-loading");
    expect(loading.textContent).toContain("Opening…");
    fireEvent.click(screen.getByText("test Chinese"));
    expect(screen.getByTestId("shared-design-loading")).toBe(loading);
    expect(loading.textContent).toContain("正在打开…");
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(LINK_ID);
  });

  it("projects metadata and snapshot instructions while preserving all authored content and DOM", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const load = vi.fn(async () => ({ design: snapshot() }));
    mount(load);
    const view = await screen.findByTestId("shared-design-view");
    const name = screen.getByTestId("shared-design-name");
    const meta = screen.getByTestId("shared-design-meta");
    expect(meta.textContent).toBe("原始作者 · Published 2 minutes ago · Read-only");
    expect(screen.getByTestId("shared-design-brief").textContent).toContain("Problem and goals");
    expect(view.textContent).toContain("This is a read-only snapshot from 2 minutes ago.");
    expect(view.textContent).toContain("Ask the sender for a new link to see the latest version.");
    expect(screen.getByTestId("language-switcher")).toBeTruthy();
    for (const raw of ["用户原型 {name}", "原始问题 {problem}", "原始目标 {criterion}", "原始说明 {note}", "模型原文 {name}"]) expect(view.textContent).toContain(raw);
    fireEvent.click(screen.getByText("test Chinese"));
    expect(screen.getByTestId("shared-design-view")).toBe(view);
    expect(screen.getByTestId("shared-design-name")).toBe(name);
    expect(meta.textContent).toBe("原始作者 · 发布于 2 分钟前 · 只读");
    expect(view.textContent).toContain("找发给你的人再发一条");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps navigation and back-stack when locale changes", async () => {
    const load = vi.fn(async () => ({ design: snapshot() }));
    mount(load);
    await screen.findByTestId("shared-design-view");
    fireEvent.click(screen.getByText("原始下一页"));
    expect(screen.getByTestId("shared-design-frame-1").getAttribute("aria-pressed")).toBe("true");
    const back = screen.getByTestId("shared-design-back");
    expect(back.textContent).toBe("Back");
    fireEvent.click(screen.getByText("test Chinese"));
    expect(screen.getByTestId("shared-design-back")).toBe(back);
    expect(back.textContent).toBe("返回");
    expect(screen.getByTestId("shared-design-frame-1").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(back);
    expect(screen.getByTestId("shared-design-frame-0").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("shared-design-back")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps missing or revoked links indistinguishable and never offers retry in either locale", async () => {
    const load = vi.fn(async () => { throw new ApiError(404, "SHARE_NOT_FOUND", {}); });
    mount(load);
    const error = await screen.findByTestId("shared-design-error");
    expect(error.textContent).toContain("This share link cannot be opened");
    expect(error.textContent).toContain("Ask the sender for a new link.");
    expect(screen.queryByTestId("shared-design-retry")).toBeNull();
    fireEvent.click(screen.getByText("test Chinese"));
    expect(screen.getByTestId("shared-design-error")).toBe(error);
    expect(error.textContent).toContain("取消分享");
    expect(screen.queryByTestId("shared-design-retry")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("changes a temporary error in place and retries only after the explicit action", async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(503, null, {});
      return { design: snapshot() };
    });
    mount(load);
    const error = await screen.findByTestId("shared-design-error");
    expect(error.textContent).toContain("Could not open this link. Please try again later.");
    const retry = screen.getByTestId("shared-design-retry");
    expect(retry.textContent).toBe("Try again");
    fireEvent.click(screen.getByText("test Chinese"));
    expect(screen.getByTestId("shared-design-error")).toBe(error);
    expect(screen.getByTestId("shared-design-retry")).toBe(retry);
    expect(retry.textContent).toBe("再试一次");
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await screen.findByTestId("shared-design-view");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("renders the actual empty design message in the current locale", async () => {
    mount(async () => ({ design: snapshot({ frames: [], prototype: [], frameNotes: [], frameLinks: [] }) }));
    const empty = await screen.findByTestId("shared-design-empty");
    expect(empty.textContent).toBe("This prototype has no pages yet.");
    fireEvent.click(screen.getByText("test Chinese"));
    expect(empty.textContent).toBe("这份原型还没有页面。");
  });

  it("localizes fallback frame names and the actual ungenerated canvas without enabling regeneration", async () => {
    mount(async () => ({ design: snapshot({ frames: [""], prototype: [null], frameNotes: [""], frameLinks: [[]] }) }));
    const frame = await screen.findByTestId("shared-design-frame-0");
    expect(frame.textContent).toBe("Page 1 (not drawn yet)");
    const canvas = screen.getByTestId("design-detail-phone-ungenerated");
    expect(canvas.textContent).toContain("This page could not be drawn. Other pages are unaffected.");
    expect(within(canvas).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByText("test Chinese"));
    expect(frame.textContent).toBe("第 1 页（还没画）");
    expect(canvas.textContent).toContain("这一页没画出来。其余页不受影响。");
    cleanup();
    mount(async () => ({ design: snapshot({ frames: ["原始首页"], prototype: [], frameNotes: [], frameLinks: [] }) }));
    const placeholder = await screen.findByTestId("design-detail-phone-placeholder");
    expect(placeholder.textContent).toContain("No prototype yet.");
    expect(placeholder.textContent).toContain("Describe what you want to make in the conversation, and I’ll draw it.");
    expect(within(placeholder).queryByRole("button")).toBeNull();
  });

  it("updates HTML preview ARIA while preserving the same iframe and exact srcdoc bytes", async () => {
    const load = vi.fn(async () => ({ design: snapshot({ prototype: [{ type: "html", id: "html-page", props: { html: rawHtml } }] }) }));
    mount(load);
    const frame = await screen.findByTestId("design-html-page");
    const srcdoc = frame.getAttribute("srcdoc");
    expect(srcdoc).toContain("原始设计 {title}");
    expect(frame.getAttribute("title")).toBe("Page preview");
    fireEvent.click(screen.getByText("test Chinese"));
    expect(screen.getByTestId("design-html-page")).toBe(frame);
    expect(frame.getAttribute("title")).toBe("页面预览");
    expect(frame.getAttribute("srcdoc")).toBe(srcdoc);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("translates public footer and chart chrome while keeping data labels and values verbatim", async () => {
    const root: designPrototype.PrototypeNode = { type: "stack", id: "accessible", children: [
      { type: "footer", id: "footer", props: { brand: "原始品牌", links: ["原始链接"], note: "原始页脚" } },
      { type: "chart", id: "chart", props: { kind: "line", labels: ["原始标签"], values: [42], unit: "原始单位" } },
      { type: "board", id: "board", props: { items: [] } },
      { type: "select", id: "select", props: { label: "原始选项标签", options: ["原始选择"] } },
    ] };
    mount(async () => ({ design: snapshot({ prototype: [root] }) }));
    const view = await screen.findByTestId("shared-design-view");
    expect(within(view).getByRole("navigation", { name: "Footer links" }).textContent).toContain("原始链接");
    expect(within(view).getByRole("img", { name: "Line chart: 原始标签 42原始单位" })).toBeTruthy();
    expect(within(view).getByRole("img", { name: /^Canvas:/ })).toBeTruthy();
    expect(view.textContent).toContain("Unit: 原始单位");
    const select = within(view).getByRole("combobox", { name: "原始选项标签" });
    expect(within(select).getByRole("option", { name: "Please select" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "原始选择" } });
    fireEvent.click(screen.getByText("test Chinese"));
    expect(within(view).getByRole("combobox", { name: "原始选项标签" })).toBe(select);
    expect(select).toHaveValue("原始选择");
    expect(within(view).getByRole("navigation", { name: "页脚链接" })).toBeTruthy();
    expect(view.textContent).toContain("原始品牌");
    expect(view.textContent).toContain("原始页脚");
    await waitFor(() => expect(within(view).getByRole("img", { name: "折线图：原始标签 42原始单位" })).toBeTruthy());
  });
});
