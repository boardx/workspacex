/**
 * UC-17.8 Sprint 1（2026-09-04 人类裁决 D1 / D3 / B1）—— 真栈化后的可执行断言。
 *
 * 断的七件事（每一条都是「按实际发出的请求 / 屏上实际出现的东西」，不是按源码）：
 *   ① D1：提交 payload 带按 `kind` 组好的 `structured`；全空时**不带这个键**。
 *   ② D3：`<input accept>` 与上限都来自契约（`FeedbackAttachmentMime.options` / `FEEDBACK_ATTACHMENT_MAX`）；
 *      不在白名单的类型不上传并点名说明；PDF 走文件类型图标而不是 `<img>`。
 *   ③ B1：「存为草稿」调 `POST /feedback/drafts`；失败时明说「没有被保存」且表单不清空。
 *   ④ B1：草稿列表三态——读取中 / 失败（说「没有丢」，可重试）/ 空，三者分得开。
 *   ⑤ B1：「继续完善」发送后用**服务端返回**的 chat 重渲染，前端不本地造 AI 文案。
 *   ⑥ B1：提交空草稿 ⇒ `DRAFT_EMPTY` 翻成可行动提示（有「去写正文」）。
 *   ⑦ B1：左栏「反馈草稿」徽标读 `GET /feedback/drafts/count`；读不到显示「—」，不是 0。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { feedbackLoop } from "@repo/contracts";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream: vi.fn(),
}));

import { ApiError } from "@/lib/api-client";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { DesignLoopDraftsScreen } from "@/components/design-loop/drafts-screen";
import type { FeedbackDraft } from "@/lib/live-feedback";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

type Call = [string, { method?: string; body?: Record<string, unknown> } | undefined];
const callsTo = (path: string, method: string) =>
  (apiRequest.mock.calls as Call[]).filter(([p, o]) => p === path && (o?.method ?? "GET") === method);

function renderDialog(onClose = () => undefined) {
  render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={onClose} />);
}

/**
 * issue #2679 ②——「这是什么」/标题只在 review 阶段展示（compose 阶段只有「详细说说」
 * + 语音 + 附件）。这些用例测的是 D3/B1 的请求体形状，不是渐进展示本身，所以统一
 * 先用一句占位话进 review。
 * 2026-09-10：附件区两个阶段都在，附件相关的用例不再需要先进 review。
 */
async function proceedToReview() {
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "占位" } });
  fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  await screen.findByTestId("feedback-submit");
}

function mockSubmitOk() {
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === "/feedback/structure-draft") throw new Error("ai unavailable");
    if (path === "/feedback" && opts?.method === "POST") return { feedbackId: "fb-1", status: "待处理" };
    return { items: [] };
  });
}

describe("① 2026-09-10：提交表单只有标题 + 详细说说，结构化内容铺进正文", () => {
  /** AI 整理接口按 kind 回一组结构化字段——这些内容该出现在正文里，而不是各自一个小框。 */
  function mockStructure(kind: string, detail: string, structured: Record<string, string>) {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/feedback/structure-draft") return { kind, title: "AI 起的标题", detail, structured };
      if (path === "/feedback" && opts?.method === "POST") return { feedbackId: "fb-1", status: "待处理" };
      return { items: [] };
    });
  }

  it("缺陷：AI 给的期望/实际结果按「标签：值」铺进「详细说说」，body 不带 structured 键", async () => {
    mockStructure("缺陷", "批准卡不记得预算。", { expectedResult: "记住上次的值", actualResult: "每次都是空的" });
    renderDialog();
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "批准卡不记得预算" } });
    fireEvent.click(screen.getByTestId("feedback-proceed-review"));
    await screen.findByTestId("feedback-submit");
    const detail = (screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement).value;
    expect(detail).toContain("批准卡不记得预算。");
    expect(detail).toContain("期望结果：\n记住上次的值");
    expect(detail).toContain("实际结果：\n每次都是空的");
    // 没有第二处可编辑的地方——那些小输入框已经不存在了。
    expect(screen.queryByTestId("feedback-field-expected")).toBeNull();
    expect(screen.queryByTestId("feedback-field-actual")).toBeNull();
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await screen.findByTestId("feedback-mine-empty");
    const [, opts] = callsTo("/feedback", "POST")[0]!;
    expect(opts!.body).not.toHaveProperty("structured");
    expect(opts!.body!.detail).toBe(detail);
    // 契约自己也认这个形状——不是前端编了一个服务端不收的对象。
    expect(feedbackLoop.operations.submitFeedback.in.safeParse(opts!.body).success).toBe(true);
  });

  it("需求：使用场景 / 期望能力 / 优先级也一样铺进正文，不另开输入框", async () => {
    mockStructure("需求", "希望能按项目筛选录音", { useScenario: "找上周那场录音", priorityScope: "P2 · 全员" });
    renderDialog();
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "希望能筛选" } });
    fireEvent.click(screen.getByTestId("feedback-proceed-review"));
    await screen.findByTestId("feedback-submit");
    const detail = (screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement).value;
    expect(detail).toContain("使用场景：\n找上周那场录音");
    expect(detail).toContain("优先级 · 影响范围：\nP2 · 全员");
    expect(screen.queryByTestId("feedback-field-scene")).toBeNull();
    expect(screen.queryByTestId("feedback-fields-req")).toBeNull();
  });

  it("AI 整理不可用 ⇒ 正文原样留着、标题退回派生，body 照样不带 structured 键", async () => {
    mockSubmitOk();
    renderDialog();
    await proceedToReview();
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "只有正文" } });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await screen.findByTestId("feedback-mine-empty");
    const [, opts] = callsTo("/feedback", "POST")[0]!;
    expect(opts!.body).not.toHaveProperty("structured");
    expect(opts!.body!.detail).toBe("只有正文");
  });

  it("「我提过的」渲染 structured；null 不渲染区块", async () => {
    const base = {
      kind: "缺陷", target: { kind: "product" }, targetLabel: null, title: "t", detail: "d", attachments: [],
      status: "待处理", statusReason: null, votes: 0, votedByMe: false, submittedByMe: true,
      occurredRoute: "/chat", appVersion: null, createdAt: "2026-09-04T00:00:00.000Z",
    };
    apiRequest.mockResolvedValue({
      items: [
        { ...base, id: "with", structured: { reproSteps: "1. 打开\n2. 点击" } },
        { ...base, id: "without", structured: null },
      ],
    });
    renderDialog();
    fireEvent.click(screen.getByTestId("feedback-tab-mine"));
    const view = await screen.findByTestId("feedback-mine-structured-with");
    expect(view.textContent).toContain("复现步骤");
    expect(view.textContent).toContain("2. 点击");
    expect(screen.queryByTestId("feedback-mine-structured-without")).toBeNull();
  });
});

describe("② D3：附件类型与上限来自契约", () => {
  it("accept 与上限文案都从契约派生", async () => {
    renderDialog();
    // 2026-09-10：附件入口 compose 阶段就在，不用先点「下一步」。
    const input = screen.getByTestId("feedback-attachment-input") as HTMLInputElement;
    expect(input.accept).toBe(feedbackLoop.FeedbackAttachmentMime.options.join(","));
    expect(input.accept).toContain("application/pdf");
    expect(input.accept).not.toBe("*/*");
    expect(screen.getByTestId("feedback-attachment-add").textContent).toContain(`/${feedbackLoop.FEEDBACK_ATTACHMENT_MAX}`);
  });

  it("zip 不在白名单 ⇒ 不上传、点名说明；PDF 上传且用文件图标而不是 <img>", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, text: async () => JSON.stringify({ attachmentId: "att-pdf", url: "/x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderDialog();
      const zip = new File([new Uint8Array([1])], "logs.zip", { type: "application/zip" });
      const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "repro.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [zip, pdf] } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("feedback-attachment-rejected").textContent).toContain("logs.zip");
      const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
      expect(JSON.parse(form.get("meta") as string).contentType).toBe("application/pdf");
      // PDF 没有 blob 预览：文件图标 + 文件名，没有 <img>。
      const fileTile = await screen.findByTestId(/^feedback-attachment-file-/);
      expect(fileTile.textContent).toContain("repro.pdf");
      expect(screen.getByTestId("feedback-attachment-list").querySelector("img")).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("浏览器给 .md 空 type 时按扩展名解出 text/markdown 上传，不是拒收", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, text: async () => JSON.stringify({ attachmentId: "att-md", url: "/x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderDialog();
      const md = new File(["# note"], "note.md", { type: "" });
      fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [md] } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
      expect(JSON.parse(form.get("meta") as string).contentType).toBe("text/markdown");
      expect(screen.queryByTestId("feedback-attachment-rejected")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("③ B1：存为草稿走真栈", () => {
  it("成功 ⇒ POST /feedback/drafts（draftId 与 structured 都不在 body）、清空表单、关弹层并跳草稿列表", async () => {
    const onClose = vi.fn();
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/feedback/drafts") return { draftId: "draft-1" };
      throw new Error(`unexpected ${path}`);
    });
    renderDialog(onClose);
    await proceedToReview();
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "先记一笔" } });
    fireEvent.click(screen.getByTestId("feedback-save-draft"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [, opts] = callsTo("/feedback/drafts", "POST")[0]!;
    // 2026-09-10：表单不再单独收结构化字段，所以 body 里连 `structured` 这个键都没有。
    expect(Object.keys(opts!.body!).sort()).toEqual(["appVersion", "detail", "kind", "occurredRoute", "target"].sort());
    expect(feedbackLoop.operations.createFeedbackDraft.in.safeParse(opts!.body).success).toBe(true);
    expect(routerPush).toHaveBeenCalledWith("/platform-admin/feedback-drafts");
  });

  it("失败 ⇒ 明说「草稿没有被保存」，正文与标题都还在，不关弹层", async () => {
    const onClose = vi.fn();
    apiRequest.mockRejectedValue(new Error("boom"));
    renderDialog(onClose);
    await proceedToReview();
    fireEvent.change(screen.getByTestId("feedback-title-input"), { target: { value: "标题还在吗" } });
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "还在吗" } });
    fireEvent.click(screen.getByTestId("feedback-save-draft"));
    const err = await screen.findByTestId("feedback-draft-error");
    expect(err.textContent).toContain("草稿没有被保存");
    expect((screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement).value).toBe("还在吗");
    expect((screen.getByTestId("feedback-title-input") as HTMLInputElement).value).toBe("标题还在吗");
    expect(onClose).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });
});

const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  id: "d1", kind: "缺陷", target: { kind: "product" }, title: "标题", detail: "正文", structured: null,
  attachments: [], chat: [{ role: "user", kind: "message", text: "第一句", at: "2026-09-04T00:00:00.000Z" }],
  refineSeeded: false, occurredRoute: "/chat", appVersion: null,
  createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z",
  ...over,
});

describe("④ B1：草稿列表三态", () => {
  it("读取中 ⇒ loading；回空 ⇒ empty（不是失败）", async () => {
    let resolve!: (v: unknown) => void;
    apiRequest.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<DesignLoopDraftsScreen />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    resolve({ items: [] });
    expect(await screen.findByTestId("empty")).toBeTruthy();
    expect(screen.queryByTestId("dep-failed")).toBeNull();
    expect(callsTo("/feedback/drafts", "GET")).toHaveLength(1);
  });

  it("读取失败 ⇒ dep-failed，说「没有丢」，重试再发一次请求", async () => {
    apiRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [draft()] });
    render(<DesignLoopDraftsScreen />);
    const failed = await screen.findByTestId("dep-failed");
    expect(failed.textContent).toContain("没有丢");
    expect(screen.queryByTestId("empty")).toBeNull();
    fireEvent.click(screen.getByTestId("drafts-retry"));
    expect(await screen.findByTestId("draft-card-d1")).toBeTruthy();
  });

  it("删除调 DELETE /feedback/drafts/:id 并从列表移除", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return { draftId: "d1" };
      return { items: [draft()] };
    });
    render(<DesignLoopDraftsScreen />);
    await screen.findByTestId("draft-card-d1");
    fireEvent.click(screen.getByTestId("draft-delete-d1"));
    /*
     * 迭代 34 起中间多了一步确认：草稿是用户手里唯一的那一份（没有回收站、没有撤销），
     * 而这个垃圾桶就挨着「提交给团队」。点一下先问，确认之后才真删——
     * 这条用例的原意（真的发 DELETE、行真的消失）原样保住。
     */
    expect(callsTo("/feedback/drafts/d1", "DELETE")).toHaveLength(0);
    expect(screen.getByTestId("draft-card-d1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("drafts-delete-confirm-yes"));
    await waitFor(() => expect(screen.queryByTestId("draft-card-d1")).toBeNull());
    expect(callsTo("/feedback/drafts/d1", "DELETE")).toHaveLength(1);
  });

  it("确认框里选「不删了」⇒ 一次请求都不发，草稿还在", async () => {
    // ⭐ 反证锚点：把确认拿掉（垃圾桶直接删）⇒ 这条红。
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === "DELETE") return { draftId: "d1" };
      return { items: [draft()] };
    });
    render(<DesignLoopDraftsScreen />);
    await screen.findByTestId("draft-card-d1");
    fireEvent.click(screen.getByTestId("draft-delete-d1"));
    expect((await screen.findByTestId("drafts-delete-confirm")).textContent).toContain("删了找不回来");
    fireEvent.click(screen.getByTestId("drafts-delete-confirm-no"));
    expect(screen.queryByTestId("drafts-delete-confirm")).toBeNull();
    expect(callsTo("/feedback/drafts/d1", "DELETE")).toHaveLength(0);
    expect(screen.getByTestId("draft-card-d1")).toBeTruthy();
  });
});

describe("⑤ B1：继续完善用服务端返回的 chat 重渲染", () => {
  it("发送 ⇒ PATCH appendChat（draftId 不进 body）；屏上出现的 AI 句子是服务端回的那句", async () => {
    const serverChat = [
      ...draft().chat,
      { role: "user", kind: "message", text: "所有入口一起改", at: "2026-09-04T00:01:00.000Z" },
      { role: "ai", kind: "message", text: "服务端追加的澄清问题", at: "2026-09-04T00:01:01.000Z" },
    ] as const;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") return { draft: draft({ chat: [...serverChat], refineSeeded: true }) };
      return { items: [draft()] };
    });
    render(<DesignLoopDraftsScreen />);
    await screen.findByTestId("draft-card-d1");
    fireEvent.click(screen.getByTestId("draft-refine-d1"));
    expect(screen.getByTestId("draft-refine-chat").textContent).toContain("第一句");
    fireEvent.change(screen.getByTestId("draft-refine-input"), { target: { value: "所有入口一起改" } });
    fireEvent.click(screen.getByTestId("draft-refine-send"));
    await waitFor(() => expect(screen.getByTestId("draft-refine-chat").textContent).toContain("服务端追加的澄清问题"));
    const [, opts] = callsTo("/feedback/drafts/d1", "PATCH")[0]!;
    expect(opts!.body).toEqual({ appendChat: { role: "user", kind: "message", text: "所有入口一起改" } });
    expect(opts!.body).not.toHaveProperty("draftId");
    expect(screen.getAllByTestId("draft-refine-turn-ai-message")).toHaveLength(1);
  });

  it("B5.1：source=fallback 的 AI 记录挂「固定回执」标识，source=model / 用户记录不挂", async () => {
    const serverChat = [
      { role: "ai", kind: "message", text: "固定的那句", at: "2026-09-05T00:00:00.000Z", source: "fallback" },
      { role: "user", kind: "message", text: "我的话", at: "2026-09-05T00:00:01.000Z" },
      { role: "ai", kind: "message", text: "模型的那句", at: "2026-09-05T00:00:02.000Z", source: "model" },
    ] as const;
    apiRequest.mockImplementation(async () => ({ items: [draft({ chat: [...serverChat], refineSeeded: true })] }));
    render(<DesignLoopDraftsScreen />);
    await screen.findByTestId("draft-card-d1");
    fireEvent.click(screen.getByTestId("draft-refine-d1"));
    expect(screen.getAllByTestId("draft-refine-turn-fallback")).toHaveLength(1);
    expect(screen.getAllByTestId("draft-refine-turn-ai-message")).toHaveLength(2);
    expect(screen.getByTestId("draft-refine-chat").textContent).toContain("固定回执");
  });

  it("「准备好，提交到收件箱」⇒ POST …/submit，成功后移出列表并把反馈 id 交给 onSubmitted", async () => {
    const onSubmitted = vi.fn();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/feedback/drafts/d1/submit" && opts?.method === "POST") return { feedbackId: "fb-9", status: "待处理" };
      return { items: [draft()] };
    });
    render(<DesignLoopDraftsScreen onSubmitted={onSubmitted} />);
    await screen.findByTestId("draft-card-d1");
    fireEvent.click(screen.getByTestId("draft-refine-d1"));
    fireEvent.click(screen.getByTestId("draft-refine-submit"));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("fb-9"));
    expect(screen.queryByTestId("draft-card-d1")).toBeNull();
    expect(screen.getByTestId("empty")).toBeTruthy();
  });
});

describe("⑥ B1：DRAFT_EMPTY 是可行动的提示", () => {
  it("提交空草稿 ⇒ 屏上说正文是空的并给「去写正文」，点了打开编辑 drawer；草稿仍在列表", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/submit")) throw new ApiError(422, "DRAFT_EMPTY", { reasonCode: "DRAFT_EMPTY" });
      return { items: [draft({ detail: "", title: null })] };
    });
    render(<DesignLoopDraftsScreen />);
    await screen.findByTestId("draft-card-d1");
    fireEvent.click(screen.getByTestId("draft-submit-d1"));
    const hint = await screen.findByTestId("drafts-submit-empty");
    expect(hint.textContent).toContain("正文");
    expect(hint.textContent).not.toContain("DRAFT_EMPTY");
    fireEvent.click(screen.getByTestId("drafts-submit-empty-edit"));
    expect(screen.getByTestId("draft-edit-drawer")).toBeTruthy();
    expect(screen.getByTestId("draft-card-d1")).toBeTruthy();
  });
});

describe("⑦ B1：左栏「反馈草稿」徽标", () => {
  const sessionState = { currentOrgId: "org-1" };
  beforeEach(() => {
    vi.doMock("@/components/session/session-provider", () => ({
      useOptionalSession: () => ({ session: { currentOrgId: sessionState.currentOrgId } }),
    }));
  });

  it("fetchLiveAdminNavCounts：count 来自 GET /feedback/drafts/count；读不到 ⇒ 不返回键 ⇒ 「—」", async () => {
    const { fetchLiveAdminNavCounts, buildAdminNavCountSources } = await import("@/lib/live-admin-nav-counts");
    const { resolveAdminNavCounts } = await import("@/lib/admin-nav-counts");
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/feedback/drafts/count") return { count: 3 };
      return [];
    });
    const ok = await fetchLiveAdminNavCounts("org-1");
    expect(ok["feedback-drafts"]).toBe(3);
    expect(resolveAdminNavCounts(buildAdminNavCountSources(["feedback-drafts"], ok))["feedback-drafts"]).toBe(3);

    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/feedback/drafts/count") throw new Error("count unavailable");
      return [];
    });
    const failed = await fetchLiveAdminNavCounts("org-1");
    expect("feedback-drafts" in failed).toBe(false);
    expect(resolveAdminNavCounts(buildAdminNavCountSources(["feedback-drafts"], failed))["feedback-drafts"]).toBe("—");
    // 徽标那一类挂了不传染兄弟项：agent 仍然是数字（listCapabilities 回了空数组 ⇒ 0）。
    expect(failed.agent).toBe(0);
  });
});

it("draft editor reopens persisted tags and saves an unconfirmed addition", async () => {
  let current = draft({tags:["旧标签"]});
  apiRequest.mockImplementation(async (_path: string, opts?: {method?:string;body?:Record<string,unknown>}) => {
    if (opts?.method === "PATCH") { current = {...current, tags:opts.body?.tags as string[]}; return {draft:current}; }
    return {items:[current]};
  });
  render(<DesignLoopDraftsScreen />);
  fireEvent.click(await screen.findByTestId("draft-open-d1"));
  expect(screen.getByTestId("feedback-tags-chip-旧标签")).toBeTruthy();
  fireEvent.change(screen.getByTestId("feedback-tags-input"), {target:{value:"新标签"}});
  fireEvent.click(screen.getByTestId("draft-edit-save"));
  await waitFor(() => expect(callsTo("/feedback/drafts/d1", "PATCH")[0]?.[1]?.body).toEqual({tags:["旧标签","新标签"]}));
});

describe("迭代 34：草稿是他唯一的那一份", () => {
  it("编辑抽屉关掉不再把改动丢掉——先存再关", async () => {
    /*
     * ⭐ 反证锚点：把关闭改回直接 `onClose()` ⇒ 这条红。
     * 点遮罩 / Esc / 右上角 × 三条路原来都是直接关，刚写的一段正文瞬间消失，而且一个字都不说。
     * 草稿本来就是"写一半的想法"，这一屏最不该做的就是悄悄扔掉它。
     */
    const patches: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (opts?.method === "PATCH") { patches.push(opts.body); return draft({ detail: "改完的正文" }); }
      return { items: [draft()] };
    });
    render(<DesignLoopDraftsScreen />);
    fireEvent.click(await screen.findByTestId("draft-open-d1"));
    await screen.findByTestId("draft-edit-drawer");
    fireEvent.change(screen.getByTestId("draft-edit-body"), { target: { value: "改完的正文" } });
    expect(screen.getByTestId("draft-edit-dirty").textContent).toContain("自动保存");
    fireEvent.click(screen.getByTestId("draft-edit-close"));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ detail: "改完的正文" });
    await waitFor(() => expect(screen.queryByTestId("draft-edit-drawer")).toBeNull());
  });

  it("没改过就关，不打一次空请求", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") throw new Error("不该发 PATCH");
      return { items: [draft()] };
    });
    render(<DesignLoopDraftsScreen />);
    fireEvent.click(await screen.findByTestId("draft-open-d1"));
    await screen.findByTestId("draft-edit-drawer");
    expect(screen.queryByTestId("draft-edit-dirty")).toBeNull();
    fireEvent.click(screen.getByTestId("draft-edit-close"));
    await waitFor(() => expect(screen.queryByTestId("draft-edit-drawer")).toBeNull());
    expect(callsTo("/feedback/drafts/d1", "PATCH")).toHaveLength(0);
  });

  it("附件说的是「截图（PNG）」，不是 image/png", async () => {
    // ⭐ 反证锚点：改回 `{a.mime}` ⇒ 这条红。契约里没有文件名，类型就是屏上唯一能说明它是什么的信息。
    apiRequest.mockImplementation(async () => ({
      items: [draft({ attachments: [{ id: "a1", url: "u", mime: "image/png" }] })],
    }));
    render(<DesignLoopDraftsScreen />);
    fireEvent.click(await screen.findByTestId("draft-open-d1"));
    const drawer = await screen.findByTestId("draft-edit-drawer");
    expect(drawer.textContent).toContain(feedbackLoop.FEEDBACK_ATTACHMENT_LABEL["image/png"]);
    expect(drawer.textContent).not.toContain("image/png");
  });

  it("卡片上的时间说得出「刚刚 / 今天」，不是只有一个日期", async () => {
    // ⭐ 反证锚点：改回 `toLocaleDateString("zh-CN")` ⇒ 这条红（今天改的和上周改的长得一样）。
    apiRequest.mockImplementation(async () => ({ items: [draft({ updatedAt: new Date().toISOString() })] }));
    render(<DesignLoopDraftsScreen />);
    const card = await screen.findByTestId("draft-card-d1");
    expect(card.textContent).toContain("刚刚");
  });

  it("「提交给团队」在按下之前就说清它会变成别人看得到的东西", async () => {
    // ⭐ 反证锚点：改回「直接提交」且不带 title ⇒ 这条红。
    apiRequest.mockImplementation(async () => ({ items: [draft()] }));
    render(<DesignLoopDraftsScreen />);
    const btn = await screen.findByTestId("draft-submit-d1");
    expect(btn.textContent).toContain("提交给团队");
    expect(btn.getAttribute("title")).toContain("看得到");
  });
});
