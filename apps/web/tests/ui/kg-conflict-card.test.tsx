/**
 * phase-18 F16 —— 回答下的矛盾提醒卡（U-5，uc-18-6 D / V3 / V4；R5 只有所有者能处理）。
 *
 * 两层：
 *  · `ConflictPromptCard` 本身：文案（「这和你 {M/D} 说的『…』不一致」）、三个出口各自交出去的选择、
 *    「两条都留」要两句适用条件、失败时给人话且按钮恢复、非所有者只读。
 *  · 经 `TurnMemoryLine` 的真实接线：数据来自 `getTurnMemory.prompt`（契约 `out` 校验），点击发出的是
 *    **真实请求体** `applyHumanAction{resolveConflict}`（经契约 `in` 校验），版本号点击时现取，
 *    失败码翻成人话、内部码不上屏。网络在 `fetch` 层打桩成一个有状态的小服务端。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { knowledgeGraph, type KgConflictPrompt, type KgHumanAction } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { ConflictPromptCard, ConflictPromptGoneError } from "@/components/chat/knowledge/conflict-prompt-card";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { onKnowledgeReload, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";

const THREAD = "thr-kg-conflict";
const PROMPT: KgConflictPrompt = {
  promptId: "kgp-1",
  newerClaim: { id: "c-new", statement: "项目A 上线改到 10/1" },
  olderClaim: { id: "c-old", statement: "项目A 9/29 上线", saidAt: "2026-09-20T04:00:00Z" },
};
const localMonthDay = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
};

/* ── 卡片本身 ─────────────────────────────────────────────────────── */

describe("ConflictPromptCard", () => {
  it("说清楚是哪两句冲突：「这和你 {日期} 说的『旧的』不一致」+ 现在说的新的", () => {
    render(<ConflictPromptCard prompt={PROMPT} canResolve onResolve={vi.fn()} />);
    expect(screen.getByTestId("kg-conflict-text")).toHaveTextContent(
      `这和你 ${localMonthDay(PROMPT.olderClaim.saidAt)} 说的「项目A 9/29 上线」不一致。现在你说的是「项目A 上线改到 10/1」。`,
    );
  });

  it.each([
    ["kg-conflict-keep-new", "keep_new", "已改成以新的为准"],
    ["kg-conflict-ignore", "ignore", "好的，这处不再提醒"],
  ] as const)("点 %s ⇒ 交出 %s，成功后收成一行结果", async (testId, resolution, note) => {
    const onResolve = vi.fn(async () => {});
    render(<ConflictPromptCard prompt={PROMPT} canResolve onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId(testId));
    expect(await screen.findByTestId("kg-conflict-resolved")).toHaveTextContent(note);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(resolution, undefined);
    expect(screen.queryByTestId("kg-conflict-card")).not.toBeInTheDocument();
  });

  it("两条都留：先填两句适用条件（缺一句不能保存），保存时交出去修剪过的两句；取消回到三个选项", async () => {
    const onResolve = vi.fn(async () => {});
    render(<ConflictPromptCard prompt={PROMPT} canResolve onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId("kg-conflict-keep-both"));
    expect(onResolve).not.toHaveBeenCalled();
    const save = screen.getByTestId("kg-conflict-both-save");
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId("kg-conflict-cond-newer"), { target: { value: "  迁移演练通过后 " } });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByTestId("kg-conflict-both-cancel"));
    expect(screen.getByTestId("kg-conflict-keep-new")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kg-conflict-keep-both"));
    fireEvent.change(screen.getByTestId("kg-conflict-cond-older"), { target: { value: "演练没过就按原计划" } });
    expect(screen.getByTestId("kg-conflict-both-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("kg-conflict-both-save"));
    expect(await screen.findByTestId("kg-conflict-resolved")).toHaveTextContent("两条都留下了");
    expect(onResolve).toHaveBeenCalledWith("keep_both", { newer: "迁移演练通过后", older: "演练没过就按原计划" });
  });

  it("失败：卡片上给那句人话，按钮恢复可以再试；不出现内部码", async () => {
    const onResolve = vi.fn()
      .mockRejectedValueOnce(new Error("这条提醒已经不在了。"))
      .mockResolvedValueOnce(undefined);
    render(<ConflictPromptCard prompt={PROMPT} canResolve onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId("kg-conflict-keep-new"));
    expect(await screen.findByTestId("kg-conflict-error")).toHaveTextContent("这条提醒已经不在了。");
    expect(screen.getByTestId("kg-conflict-keep-new")).toBeEnabled();
    fireEvent.click(screen.getByTestId("kg-conflict-ignore"));
    expect(await screen.findByTestId("kg-conflict-resolved")).toHaveTextContent("好的，这处不再提醒");
    expect(document.body.textContent).not.toContain("KG_");
  });

  it("onResolve 抛「卡已不在」⇒ 收成一行说明（不是错误态、没有按钮）", async () => {
    const onResolve = vi.fn().mockRejectedValue(new ConflictPromptGoneError("这条提醒已经不在了。"));
    render(<ConflictPromptCard prompt={PROMPT} canResolve onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId("kg-conflict-ignore"));
    expect(await screen.findByTestId("kg-conflict-gone")).toHaveTextContent("这条提醒已经不在了。");
    expect(screen.queryByTestId("kg-conflict-error")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("处理中：按钮都不可点，不会连发两次", async () => {
    let finish: () => void = () => {};
    const onResolve = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    render(<ConflictPromptCard prompt={PROMPT} canResolve onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId("kg-conflict-keep-new"));
    await waitFor(() => expect(screen.getByTestId("kg-conflict-ignore")).toBeDisabled());
    fireEvent.click(screen.getByTestId("kg-conflict-keep-new"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    finish();
    await screen.findByTestId("kg-conflict-resolved");
  });

  it("不是对话创建者：只看到提醒文字，没有任何按钮", () => {
    render(<ConflictPromptCard prompt={PROMPT} canResolve={false} onResolve={vi.fn()} />);
    const card = screen.getByTestId("kg-conflict-card");
    expect(within(card).getByTestId("kg-conflict-text")).toBeInTheDocument();
    expect(within(card).queryAllByRole("button")).toEqual([]);
  });
});

/* ── 经 TurnMemoryLine 的真实接线（getTurnMemory → applyHumanAction） ───── */

interface Server {
  revision: number;
  prompt: KgConflictPrompt | null;
  actions: { basedOnRevision: number; action: KgHumanAction }[];
  onAction: (body: Server["actions"][number]) => Response | undefined;
}
let server: Server;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const failure = (status: number, reasonCode: string) => json({ error: "rejected", traceId: "t-1", reasonCode }, status);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-conflict");
  server = { revision: 4, prompt: PROMPT, actions: [], onAction: () => undefined };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/messages/msg-9/memory`) {
      return json(knowledgeGraph.getTurnMemory.out.parse({
        messageId: "msg-9", captured: [], pending: false, recalled: [], recallDegraded: false,
        prompt: server.prompt === null ? null : { type: "conflict", conflict: server.prompt },
      }));
    }
    if (path === `/knowledge-graph/threads/${THREAD}` && (init?.method ?? "GET") === "GET") {
      return json(knowledgeGraph.getThreadKnowledge.out.parse({
        scope: { kind: "chat_session", id: THREAD }, revision: server.revision, objects: [], claims: [], edges: [],
        ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only",
        extractionActive: true,
      }));
    }
    if (path === `/knowledge-graph/threads/${THREAD}/actions` && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Server["actions"][number];
      server.actions.push(body);
      const override = server.onAction(body);
      if (override) return override;
      server.revision += 1;
      return json({ revision: server.revision, actionId: `act-${String(server.actions.length)}` });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  publishKnowledgeSnapshot(null);
});

const owner = () => publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 1 });

describe("TurnMemoryLine：本轮的矛盾提醒卡", () => {
  it("以新的为准：发出 resolveConflict{keep_new}，版本号是点击时现取的（不是面板快照里的旧号），完成后让记忆面板重读", async () => {
    owner();
    const reloads: string[] = [];
    const off = onKnowledgeReload((t) => reloads.push(t));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-conflict-keep-new"));
    expect(await screen.findByTestId("kg-conflict-resolved")).toHaveTextContent("已改成以新的为准");
    expect(server.actions).toEqual([{ basedOnRevision: 4, action: { type: "resolveConflict", promptId: "kgp-1", resolution: "keep_new" } }]);
    expect(reloads).toEqual([THREAD]);
    off();
  });

  it("两条都留：请求体带上两句适用条件", async () => {
    owner();
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-conflict-keep-both"));
    fireEvent.change(screen.getByTestId("kg-conflict-cond-newer"), { target: { value: "迁移演练通过后" } });
    fireEvent.change(screen.getByTestId("kg-conflict-cond-older"), { target: { value: "演练没过就按原计划" } });
    fireEvent.click(screen.getByTestId("kg-conflict-both-save"));
    await screen.findByTestId("kg-conflict-resolved");
    expect(server.actions).toEqual([{
      basedOnRevision: 4,
      action: { type: "resolveConflict", promptId: "kgp-1", resolution: "keep_both", conditions: { newer: "迁移演练通过后", older: "演练没过就按原计划" } },
    }]);
  });

  it("忽略：发出 resolveConflict{ignore}", async () => {
    owner();
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-conflict-ignore"));
    await screen.findByTestId("kg-conflict-resolved");
    expect(server.actions.map((a) => a.action)).toEqual([{ type: "resolveConflict", promptId: "kgp-1", resolution: "ignore" }]);
  });

  it.each([
    [409, "KG_REVISION_CHANGED", "内容已变化"],
    [403, "KG_NOT_OWNER", "只有对话的创建者可以修改这里的记忆。"],
  ])("服务端拒绝（%s %s）⇒ 卡片上是人话，内部码不上屏", async (status, code, text) => {
    owner();
    server.onAction = () => failure(status, code);
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-conflict-ignore"));
    expect(await screen.findByTestId("kg-conflict-error")).toHaveTextContent(text);
    expect(document.body.textContent).not.toContain("KG_");
    expect(screen.queryByTestId("kg-conflict-resolved")).not.toBeInTheDocument();
  });

  it("卡已经不在了（别的标签页处理过 / 一条被改掉，KG_PROMPT_NOT_FOUND）⇒ 收成一行说明，不再留按钮", async () => {
    owner();
    server.onAction = () => failure(404, "KG_PROMPT_NOT_FOUND");
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-conflict-keep-new"));
    expect(await screen.findByTestId("kg-conflict-gone")).toHaveTextContent("这条提醒已经不在了。");
    expect(screen.queryByTestId("kg-conflict-card")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(document.body.textContent).not.toContain("KG_");
  });

  it("非所有者：卡片只读，没有按钮；不发任何写请求", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: false, revision: 1 });
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    const card = await screen.findByTestId("kg-conflict-card");
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expect(server.actions).toEqual([]);
  });

  it("这一轮没有提醒：不画卡（也不画别的）", async () => {
    owner();
    server.prompt = null;
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
