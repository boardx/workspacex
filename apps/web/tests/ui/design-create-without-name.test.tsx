/**
 * #4331 U1 —— 新建设计时名称可以不填。
 *
 * 普通用户评测集（`e2e/novice-eval/`）里，新建流程唯一卡住人的一步是「只写了想做什么，创建按钮仍不可点——
 * 必须先起名字」。没起名时用「想做什么」的第一句当默认名，界面上明说，进去后随时能改；API 不变。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/studio/design-workbench",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import * as React from "react";
import { DesignWorkbenchHome, defaultProjectName } from "@/components/design-loop/workbench-screen";

afterEach(() => { cleanup(); apiRequest.mockReset(); });

describe("defaultProjectName", () => {
  it("取第一句、去掉首尾空白", () => {
    expect(defaultProjectName("  设计一个心理学 app。首页选心情  ")).toBe("设计一个心理学 app");
    expect(defaultProjectName("做个记账本\n能记一笔")).toBe("做个记账本");
  });
  it("超过 20 个字按码点截断并加省略号（不切坏 emoji）", () => {
    const long = "😀".repeat(25);
    expect(defaultProjectName(long)).toBe(`${"😀".repeat(20)}…`);
  });
  it("什么都没写 ⇒ 空串（创建按钮仍不可点）", () => {
    expect(defaultProjectName("   ")).toBe("");
  });
});

describe("新建弹窗：只写想做什么就能创建", () => {
  function mountWithCapture() {
    const posts: Record<string, unknown>[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [] };
      if (path === "/pm-designs" && opts?.method === "POST") {
        posts.push(opts.body!);
        return { project: { id: "p1", name: String(opts.body!.name), template: "mobile", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [], pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], theme: "light", tags: [], refImages: [], share: null, accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" }, ownerId: "u1", ownerName: "我", createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z" } };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" onOpenProject={vi.fn()} />);
    return posts;
  }

  it("⭐ 反证锚点：名称留空、只写一句想做什么 ⇒「跳过，直接创建」可点，提交的 name 是那一句", async () => {
    const posts = mountWithCapture();
    fireEvent.click(await screen.findByTestId("workbench-new"));
    fireEvent.change(screen.getByTestId("project-dialog-problem"), { target: { value: "设计一个心理学 app。首页选心情" } });
    const skip = screen.getByTestId("intake-skip-all");
    expect(skip).not.toBeDisabled();
    // 界面上明说会叫什么——不是偷偷替他起名。
    expect(screen.getByTestId("name-default")).toHaveTextContent("设计一个心理学 app");
    fireEvent.click(skip);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.name).toBe("设计一个心理学 app");
  });

  it("自己起了名字 ⇒ 用他起的，不被默认名盖掉", async () => {
    const posts = mountWithCapture();
    fireEvent.click(await screen.findByTestId("workbench-new"));
    fireEvent.change(screen.getByTestId("project-dialog-name"), { target: { value: "情绪日记" } });
    fireEvent.change(screen.getByTestId("project-dialog-problem"), { target: { value: "设计一个心理学 app" } });
    expect(screen.queryByTestId("name-default")).toBeNull();
    fireEvent.click(screen.getByTestId("intake-skip-all"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.name).toBe("情绪日记");
  });

  it("名字和想做什么都没写 ⇒ 仍不可点，提示写一句想做什么", async () => {
    mountWithCapture();
    fireEvent.click(await screen.findByTestId("workbench-new"));
    expect(screen.getByTestId("intake-skip-all")).toBeDisabled();
    expect(screen.getByTestId("err-name")).toHaveTextContent("写一句想做什么");
  });
});
