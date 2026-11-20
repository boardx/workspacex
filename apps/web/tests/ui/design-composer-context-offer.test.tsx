import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: request }));
vi.mock("next/navigation", () => ({ usePathname: () => "/design", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
const project = { id: "p1", name: "订座", template: "mobile", problem: "原Design背景", criteria: [], frames: [], prototype: [], frameNotes: [], theme: "light", accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" }, tags: [], refImages: [], share: null, pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-11-16", updatedAt: "2026-11-16" };
const offer = { id: "class:5:3", label: "已保存制作说明", text: "本轮问题：如何理解入口？\n生成前看法：可能清楚\nHMW：如何帮助赶课者？" };
beforeEach(() => { request.mockReset(); request.mockImplementation(async (path: string, options?: { method?: string; body?: { text: string } }) => {
  if (path === "/pm-designs") return { items: [project] };
  if (path === "/pm-designs/p1/comments") return { items: [] };
  if (path === "/pm-designs/p1/chat" && options?.method === "POST") return { project, reply: { source: "model", applied: [], suggestions: [] } };
  throw new Error(`Unexpected ${path}`);
}); });
const posts = () => request.mock.calls.filter(([, options]) => options?.method === "POST");
it("offers saved context in the existing native input, with no model request until the student explicitly sends", async () => {
  render(<DesignDetailScreen projectId="p1" composerContextOffer={offer} />); await screen.findByTestId("design-detail");
  expect(posts()).toHaveLength(0); expect(screen.getByTestId("design-detail-input")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "带入制作说明到输入框" }));
  expect(screen.getByTestId("design-detail-input")).toHaveValue(offer.text); expect(posts()).toHaveLength(0);
  const reviewed = `${offer.text}\n学生补充：只做静态示意。`;
  fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: reviewed } });
  fireEvent.click(screen.getByTestId("design-detail-send"));
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0]).toEqual(["/pm-designs/p1/chat", expect.objectContaining({ method: "POST", body: expect.objectContaining({ text: reviewed }) })]);
});
it("preserves an occupied native draft when saved context changes", async () => {
  const { rerender } = render(<DesignDetailScreen projectId="p1" composerContextOffer={offer} />); await screen.findByTestId("design-detail");
  fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "学生已有未发稿" } });
  rerender(<DesignDetailScreen projectId="p1" composerContextOffer={{ ...offer, id: "new", text: "更新后的来源" }} />);
  expect(screen.getByRole("button", { name: "带入制作说明到输入框" })).toBeDisabled();
  expect(screen.getByTestId("design-detail-input")).toHaveValue("学生已有未发稿"); expect(posts()).toHaveLength(0);
});
it("blocks native send routes during missing/unreadable saved question context while keeping the canvas visible", async () => {
  render(<DesignDetailScreen projectId="p1" sendBlockedReason="请先保存问题卡" />); await screen.findByTestId("design-detail");
  fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "先画一个界面" } });
  expect(screen.getByTestId("design-detail-send")).toBeDisabled();
  fireEvent.keyDown(screen.getByTestId("design-detail-input"), { key: "Enter" });
  fireEvent.click(screen.getByTestId("design-detail-starter-对话助手"));
  expect(posts()).toHaveLength(0); expect(screen.getByTestId("design-composer-blocked")).toHaveTextContent("请先保存问题卡");
});
it("keeps ordinary Design sending unchanged when no teaching props are supplied", async () => {
  render(<DesignDetailScreen projectId="p1" />); await screen.findByTestId("design-detail");
  expect(screen.queryByTestId("design-composer-context-offer")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "普通Design原有请求" } });
  fireEvent.click(screen.getByTestId("design-detail-send"));
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0]?.[1].body.text).toBe("普通Design原有请求");
});
it("does not consume autostart while blocked and preserves ordinary explicit autostart after readiness", async () => {
  const { rerender } = render(<DesignDetailScreen projectId="p1" autoStart sendBlockedReason="先保存问题卡" />);
  await screen.findByTestId("design-detail"); expect(posts()).toHaveLength(0);
  rerender(<DesignDetailScreen projectId="p1" autoStart />);
  await waitFor(() => expect(posts()).toHaveLength(1));
});
it("blocks independent variant generation, annotation model sends and missing-page regeneration shortcuts", async () => {
  const generated = { ...project, frames: ["首页", "缺失页"], prototype: [{ type: "text", id: "t", props: { content: "原有页面" } }, null] };
  const comment = { id: "c", nodeId: "t", frameIndex: 0, label: "原有页面", text: "学生已有批注", resolved: false, authorId: "u1", authorName: "我", createdAt: "2026-11-16", replies: [] };
  request.mockImplementation(async (path: string) => {
    if (path === "/pm-designs") return { items: [generated] };
    if (path === "/pm-designs/p1/comments") return { items: [comment] };
    throw new Error(`Unexpected mutation: ${path}`);
  });
  render(<DesignDetailScreen projectId="p1" sendBlockedReason="先保存问题卡" />); await screen.findByTestId("design-detail");
  fireEvent.pointerDown(screen.getByTestId("design-detail-more"), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId("design-detail-variants"));
  expect(posts()).toHaveLength(0);
  fireEvent.pointerDown(screen.getByTestId("design-detail-more"), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId("design-detail-mode-comment"));
  await screen.findByText("学生已有批注"); fireEvent.click(screen.getByTestId("design-comments-send"));
  fireEvent.click(screen.getByTestId("design-detail-view-single"));
  fireEvent.click(screen.getByTestId("design-detail-frame-1"));
  fireEvent.click(await screen.findByTestId("design-detail-regenerate-frame"));
  expect(posts()).toHaveLength(0);
  expect(request.mock.calls.filter(([, options]) => options?.method && options.method !== "GET")).toHaveLength(0);
});

it("uses the contained vertical workbench without dropping a native draft or changing model consent", async () => {
  const view = render(<DesignDetailScreen projectId="p1" composerContextOffer={offer} />);
  await screen.findByTestId("design-detail");
  expect(screen.getByTestId("design-detail")).not.toHaveAttribute("data-contained");
  const input = screen.getByTestId("design-detail-input");
  fireEvent.change(input,{target:{value:"学生在窄栏审阅后的静态原型说明"}});
  view.rerender(<DesignDetailScreen contained projectId="p1" composerContextOffer={offer} />);
  expect(screen.getByTestId("design-detail")).toHaveAttribute("data-contained","true");
  expect(screen.getByTestId("design-detail-input")).toBe(input);
  expect(input).toHaveValue("学生在窄栏审阅后的静态原型说明");expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByTestId("design-detail-send"));
  await waitFor(()=>expect(posts()).toHaveLength(1));
  expect(posts()[0]).toEqual(["/pm-designs/p1/chat",expect.objectContaining({body:expect.objectContaining({text:"学生在窄栏审阅后的静态原型说明"})})]);
});

it("keeps the native canvas available in a narrow host and makes layers an explicit reversible action", async () => {
  const generated = { ...project, frames: ["首页"], prototype: [{ type: "text", id: "t", props: { content: "已有原型内容" } }] };
  request.mockImplementation(async (path: string) => {
    if (path === "/pm-designs") return { items: [generated] };
    if (path === "/pm-designs/p1/comments") return { items: [] };
    throw new Error(`Unexpected mutation: ${path}`);
  });
  const view = render(<DesignDetailScreen projectId="p1" />);
  await screen.findByTestId("design-detail");
  const side = screen.getByTestId("design-detail-side");
  const toggle = screen.getByTestId("design-detail-side-toggle");
  expect(side).toHaveClass("md:static", "md:flex");
  expect(toggle).toHaveClass("md:hidden");
  view.rerender(<DesignDetailScreen contained projectId="p1" />);
  expect(side).not.toHaveClass("md:static");
  expect(side).not.toHaveClass("md:flex");
  expect(side).toHaveClass("absolute", "hidden");
  expect(toggle).not.toHaveClass("md:hidden");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(side).toHaveClass("absolute", "flex");
  expect(side).not.toHaveClass("hidden");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(side).toHaveClass("hidden");
  expect(posts()).toHaveLength(0);
});
