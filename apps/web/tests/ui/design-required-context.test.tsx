import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: request }));
vi.mock("next/navigation", () => ({ usePathname: () => "/design", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
const project = { id: "p1", name: "合成原型", template: "mobile", problem: "原Design背景", criteria: [], frames: [], prototype: [], frameNotes: [], theme: "light", accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" }, tags: [], refImages: [], share: null, pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "u1", ownerName: "测试成员", createdAt: "2026-11-16", updatedAt: "2026-11-16" };
const basis = { requiredContextId: "class:design:p1:text-v2", requiredContextText: "正式文字 V2：比较两种领取方式。\n冻结来源 hash=" + "a".repeat(64) };
const posts = () => request.mock.calls.filter(([, options]) => options?.method === "POST");
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  request.mockReset(); request.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === "/pm-designs") return { items: [project] };
    if (path === "/pm-designs/p1/comments") return { items: [] };
    if (path === "/pm-designs/p1/chat" && options?.method === "POST") return { project, reply: { source: "model", applied: [], suggestions: [] } };
    throw new Error(`Unexpected ${path}`);
  });
});
async function send(text = "学生补充：只画已确认流程") { await screen.findByTestId("design-detail"); fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: text } }); fireEvent.click(screen.getByTestId("design-detail-send")); }
it("awaits the actual source guard with the real native project snapshot before append and adds fixed text exactly once", async () => {
  const read = deferred(), beforeSend = vi.fn((signal: AbortSignal, native?: { id: string; refImages: unknown[] }) => { signal.throwIfAborted(); expect(native).toMatchObject({ id: project.id, refImages: project.refImages }); return read.promise; });
  render(<DesignDetailScreen projectId="p1" {...basis} beforeSend={beforeSend} />); await send();
  expect(beforeSend).toHaveBeenCalledOnce(); expect(posts()).toHaveLength(0);
  await act(async () => read.resolve()); await waitFor(() => expect(posts()).toHaveLength(1));
  const text = posts()[0]![1].body.text;
  expect(text).toBe(`【已确认的原型制作依据（应用固定）】\n${basis.requiredContextText}\n\n【学生补充】\n学生补充：只画已确认流程`);
  expect(text.split(basis.requiredContextText)).toHaveLength(2);
});
it("preserves the student's text and makes no append request if beforeSend rejects", async () => {
  const beforeSend = vi.fn(async () => { throw new Error("AIDT_CONTEXT_CHANGED"); });
  render(<DesignDetailScreen projectId="p1" {...basis} beforeSend={beforeSend} />); await send();
  await screen.findByTestId("design-detail-retry"); expect(posts()).toHaveLength(0);
  expect(screen.getByTestId("design-detail-input")).toHaveValue("学生补充：只画已确认流程");
});
it("does not auto-start an AIDT generation even when the native autoStart prop is true", async () => {
  const beforeSend = vi.fn(async () => undefined);
  render(<DesignDetailScreen projectId="p1" {...basis} autoStart beforeSend={beforeSend} />); await screen.findByTestId("design-detail");
  expect(beforeSend).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0);
  await send(); await waitFor(() => expect(posts()).toHaveLength(1));
});
it("requires a real beforeSend guard and both saved context coordinates", async () => {
  const view = render(<DesignDetailScreen projectId="p1" {...basis} />); await screen.findByTestId("design-detail");
  fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "学生请求" } }); expect(screen.getByTestId("design-detail-send")).toBeDisabled();
  const beforeSend = vi.fn(async () => undefined); view.rerender(<DesignDetailScreen projectId="p1" requiredContextText={basis.requiredContextText} beforeSend={beforeSend} />);
  expect(screen.getByTestId("design-detail-send")).toBeDisabled(); expect(posts()).toHaveLength(0); expect(beforeSend).not.toHaveBeenCalled();
});
it("cancels a late guard result after the confirmed text revision changes", async () => {
  const read = deferred(), beforeSend = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); return read.promise; });
  const view = render(<DesignDetailScreen projectId="p1" {...basis} beforeSend={beforeSend} />); await send();
  const signal = beforeSend.mock.calls[0]![0];
  view.rerender(<DesignDetailScreen projectId="p1" {...basis} requiredContextId="new-revision" requiredContextText="正式文字 V3" beforeSend={beforeSend} />);
  expect(signal.aborted).toBe(true); await act(async () => read.resolve()); expect(posts()).toHaveLength(0);
});
it("rechecks a newly blocked state after awaiting a guard rather than appending", async () => {
  const read = deferred(), beforeSend = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); return read.promise; });
  const view = render(<DesignDetailScreen projectId="p1" {...basis} beforeSend={beforeSend} />); await send();
  view.rerender(<DesignDetailScreen projectId="p1" {...basis} beforeSend={beforeSend} sendBlockedReason="来源已撤权" />);
  await act(async () => read.resolve()); expect(posts()).toHaveLength(0);
});
it("retries the original student supplement and does not double-prefix the confirmed text", async () => {
  let count = 0; request.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === "/pm-designs") return { items: [project] }; if (path === "/pm-designs/p1/comments") return { items: [] };
    if (path === "/pm-designs/p1/chat" && options?.method === "POST") { if (++count === 1) throw new Error("temporary model failure"); return { project, reply: { source: "model", applied: [], suggestions: [] } }; }
    throw new Error(`Unexpected ${path}`);
  });
  const beforeSend = vi.fn(async () => undefined); render(<DesignDetailScreen projectId="p1" {...basis} beforeSend={beforeSend} />); await send();
  fireEvent.click(await screen.findByTestId("design-detail-retry")); await waitFor(() => expect(posts()).toHaveLength(2));
  expect(beforeSend).toHaveBeenCalledTimes(2); expect(posts()[0]![1].body.text).toBe(posts()[1]![1].body.text);
  expect(posts()[1]![1].body.text.split(basis.requiredContextText)).toHaveLength(2);
});

it.each(["button", "enter"])("generates with the confirmed text and prepared images through %s", async method => {
  const refImages = [{ id: "frozen-image", name: "source.png", size: 128, mime: "image/png", createdAt: "2026-11-22" }];
  const beforeSend = vi.fn(async () => ({ ...project, refImages })) as unknown as NonNullable<React.ComponentProps<typeof DesignDetailScreen>["beforeSend"]>;
  render(<DesignDetailScreen projectId="p1" compactGeneration {...basis} beforeSend={beforeSend} />);
  const input = await screen.findByTestId("design-detail-input");
  if (method === "button") fireEvent.click(screen.getByRole("button", { name: "生成" }));
  else {
    fireEvent.change(input, { target: { value: "使用简洁的页面布局" } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0]![1].body).toMatchObject({ refImageIds: ["frozen-image"] });
  expect(posts()[0]![1].body.text).toContain(basis.requiredContextText);
  expect(posts()[0]![1].body.text).toContain(method === "enter" ? "使用简洁的页面布局" : "生成原型");
});
