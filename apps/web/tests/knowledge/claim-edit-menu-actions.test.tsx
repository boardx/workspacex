/**
 * phase-18 F10 —— 记忆面板里人的编辑动作（uc-18-3 R3 / R4 / R5 / E3，U-1 撤销，U-2 一键对/不对 + 全部确认）。
 *
 * 网络在 `fetch` 层打桩成一个有状态的小服务端：GET 返回当前读模型，POST .../actions 记下请求体、
 * 按用例改状态并把 revision + 1。于是断言的是**真实请求体**（经契约 `in` 校验后发出）以及
 * 「成功后重读 → 界面在 2 秒内变过来」这一整条链，不是某个回调被调了。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import {
  knowledgeGraph,
  type KgClaim,
  type KgHumanAction,
  type KgObject,
} from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";
import { ThreadKnowledgeTab, useThreadKnowledge } from "@/components/chat/knowledge/thread-knowledge-tab";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";

const THREAD = "thr-kg-edit";
const SCOPE = { kind: "chat_session", id: THREAD } as const;
const UI_DEADLINE = { timeout: 2_000 };

function triOf(status: KgClaim["status"]): KgClaim["triState"] {
  return status === "accepted" ? "confirmed" : status === "contested" ? "conflict" : "pending";
}
function claim(id: string, kind: KgClaim["kind"], statement: string, status: KgClaim["status"], about: string[]): KgClaim {
  return {
    id, scope: SCOPE, kind, statement, status, triState: triOf(status), confidence: 0.8, createdBy: "model",
    reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: about,
    supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}
function object(id: string, kind: KgObject["kind"], name: string): KgObject {
  return { id, scope: SCOPE, kind, name, aliases: [], createdBy: "model", claimCount: 1 };
}

/* ── 有状态的桩服务端 ─────────────────────────────────────────────── */

interface Server {
  revision: number;
  canEdit: boolean;
  claims: KgClaim[];
  objects: KgObject[];
  actions: { basedOnRevision: number; action: KgHumanAction }[];
  gets: number;
  /** 返回 Response = 用它回（失败用例）；返回 undefined = 按默认规则改状态并 200。 */
  onAction: (body: { basedOnRevision: number; action: KgHumanAction }) => Response | undefined;
}
let server: Server;

function readModel(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE, revision: server.revision, objects: server.objects, claims: server.claims, edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: server.canEdit, canPromote: true, visibility: "owner_only",
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function failure(status: number, reasonCode: string): Response {
  return json({ error: "rejected", traceId: "t-1", reasonCode }, status);
}

function setStatus(id: string, status: KgClaim["status"]): void {
  server.claims = server.claims.map((c) => (c.id === id ? { ...c, status, triState: triOf(status) } : c));
}

/** 默认的服务端语义（够本文件断言用；真实规则在 apps/api）。 */
function applyDefault(a: KgHumanAction): void {
  switch (a.type) {
    case "confirmClaim": setStatus(a.claimId, "accepted"); break;
    case "confirmClaims": a.claimIds.forEach((id) => setStatus(id, "accepted")); break;
    case "reviseClaim": {
      const old = server.claims.find((c) => c.id === a.claimId);
      if (old) {
        server.claims = server.claims.filter((c) => c.id !== a.claimId)
          .concat({ ...old, id: `${a.claimId}-v2`, statement: a.statement, supersedesClaimId: a.claimId, createdBy: "human" });
      }
      break;
    }
    case "revokeClaim": server.claims = server.claims.filter((c) => c.id !== a.claimId); break;
    case "markContested": a.claimIds.forEach((id) => setStatus(id, "contested")); break;
    case "renameObject": server.objects = server.objects.map((o) => (o.id === a.objectId ? { ...o, name: a.name } : o)); break;
    case "mergeObjects": server.objects = server.objects.filter((o) => o.id !== a.mergeObjectId); break;
    case "splitObject": server.objects = server.objects.concat(object(`${a.objectId}-split`, "person", a.newName)); break;
    default: break;
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-edit");
  server = {
    revision: 7,
    canEdit: true,
    objects: [object("obj-a", "person", "王五"), object("obj-b", "organization", "客户 B"), object("obj-c", "person", "小王")],
    claims: [
      claim("c-decide", "decision", "王五决定周五发版。", "accepted", ["obj-a"]),
      claim("c-fact", "fact", "客户 B 需要中文界面。", "proposed", ["obj-b", "obj-a"]),
      claim("c-todo", "todo", "赵六整理发版清单。", "reviewed", []),
      claim("c-risk", "risk", "周五发版可能赶不上测试。", "contested", ["obj-a"]),
    ],
    actions: [],
    gets: 0,
    onAction: () => undefined,
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}` && (init?.method ?? "GET") === "GET") {
      server.gets += 1;
      return json(readModel());
    }
    if (path === `/knowledge-graph/threads/${THREAD}/actions` && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Server["actions"][number];
      server.actions.push(body);
      const override = server.onAction(body);
      if (override) return override;
      applyDefault(body.action);
      server.revision += 1;
      return json({ revision: server.revision, actionId: `act-${String(server.actions.length)}` });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

function Harness() {
  const state = useThreadKnowledge(THREAD);
  return <ThreadKnowledgeTab state={state} />;
}

async function renderPanel() {
  const utils = render(<Harness />);
  await screen.findByTestId("kg-list");
  return utils;
}

/** Radix DropdownMenu 靠 pointerdown 开（jsdom 下 click 不开），菜单项靠 click 选中。 */
function openMenuItem(claimId: string, item: string): void {
  fireEvent.pointerDown(screen.getByTestId(`kg-claim-edit-trigger-${claimId}`), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByTestId(`kg-action-${item}-${claimId}`));
}

const lastAction = () => server.actions.at(-1);

/* ── 各动作的请求体 + 成功后重读 ─────────────────────────────────── */

describe("所有者的编辑动作：请求体对、成功后 2 秒内界面跟着变", () => {
  it("一键「对」：confirmClaim，带当前 revision；条目变成「你确认过」", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-yes-c-fact"));
    await waitFor(() => expect(lastAction()).toEqual({ basedOnRevision: 7, action: { type: "confirmClaim", claimId: "c-fact" } }));
    await waitFor(
      () => expect(within(screen.getByTestId("kg-claim-c-fact")).getByTestId("kg-tri-state-confirmed")).toBeInTheDocument(),
      UI_DEADLINE,
    );
    expect(server.gets).toBe(2);
  });

  it("菜单「确认（对）」：同一个 confirmClaim；下一次动作带上重读后的新 revision", async () => {
    await renderPanel();
    openMenuItem("c-todo", "confirm");
    await waitFor(() => expect(lastAction()?.action).toEqual({ type: "confirmClaim", claimId: "c-todo" }));
    await waitFor(() => expect(within(screen.getByTestId("kg-claim-c-todo")).getByTestId("kg-tri-state-confirmed")).toBeInTheDocument(), UI_DEADLINE);
    fireEvent.click(screen.getByTestId("kg-row-yes-c-fact"));
    await waitFor(() => expect(lastAction()?.basedOnRevision).toBe(8));
  });

  it("「全部确认」：confirmClaims 只含「AI 记下的」（不含有矛盾的）", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-confirm-all"));
    await waitFor(() => expect(lastAction()).toEqual({
      basedOnRevision: 7, action: { type: "confirmClaims", claimIds: ["c-fact", "c-todo"] },
    }));
    await waitFor(() => expect(screen.queryByTestId("kg-confirm-all")).not.toBeInTheDocument(), UI_DEADLINE);
  });

  it("「不对」→「改写」：reviseClaim 带新说法；新说法出现、旧的消失", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-no-c-fact"));
    fireEvent.click(screen.getByTestId("kg-row-revise-c-fact"));
    const dialog = await screen.findByTestId("kg-revise-dialog-c-fact");
    expect(within(dialog).getByTestId("kg-revise-submit-c-fact")).toBeDisabled(); // 没改不让提交
    fireEvent.change(within(dialog).getByTestId("kg-revise-input-c-fact"), { target: { value: "客户 B 需要中英双语界面。" } });
    fireEvent.click(within(dialog).getByTestId("kg-revise-submit-c-fact"));
    await waitFor(() => expect(lastAction()?.action).toEqual({
      type: "reviseClaim", claimId: "c-fact", statement: "客户 B 需要中英双语界面。",
    }));
    await waitFor(() => expect(screen.getByText("客户 B 需要中英双语界面。")).toBeInTheDocument(), UI_DEADLINE);
    expect(screen.queryByText("客户 B 需要中文界面。")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-revise-dialog-c-fact")).not.toBeInTheDocument();
  });

  it("「不对」→「忘掉这条」：二次确认后 revokeClaim；这一条从列表消失", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-no-c-fact"));
    fireEvent.click(screen.getByTestId("kg-row-forget-c-fact"));
    const dialog = await screen.findByTestId("kg-delete-confirm-c-fact");
    expect(within(dialog).getByTestId("kg-delete-impact-c-fact")).toHaveTextContent("客户 B 需要中文界面。");
    expect(server.actions).toHaveLength(0); // 打开确认框本身不发请求
    fireEvent.click(within(dialog).getByTestId("kg-delete-confirm-btn-c-fact"));
    await waitFor(() => expect(lastAction()?.action).toEqual({ type: "revokeClaim", claimId: "c-fact" }));
    await waitFor(() => expect(screen.queryByTestId("kg-claim-c-fact")).not.toBeInTheDocument(), UI_DEADLINE);
  });

  it("菜单「忘掉这条」同样先确认；取消不发请求", async () => {
    await renderPanel();
    openMenuItem("c-decide", "delete");
    const dialog = await screen.findByTestId("kg-delete-confirm-c-decide");
    fireEvent.click(within(dialog).getByTestId("kg-delete-cancel-c-decide"));
    await waitFor(() => expect(screen.queryByTestId("kg-delete-confirm-c-decide")).not.toBeInTheDocument());
    expect(server.actions).toHaveLength(0);
  });

  it("「标为有矛盾」：选另一条后 markContested 两条；两条都变成「有矛盾」", async () => {
    await renderPanel();
    openMenuItem("c-fact", "contest");
    const dialog = await screen.findByTestId("kg-contest-dialog-c-fact");
    expect(within(dialog).queryByTestId("kg-contest-target-c-fact-c-fact")).not.toBeInTheDocument(); // 不能和自己矛盾
    fireEvent.click(within(dialog).getByTestId("kg-contest-target-c-fact-c-todo"));
    fireEvent.click(within(dialog).getByTestId("kg-contest-submit-c-fact"));
    await waitFor(() => expect(lastAction()?.action).toEqual({ type: "markContested", claimIds: ["c-fact", "c-todo"] }));
    await waitFor(() => {
      expect(within(screen.getByTestId("kg-claim-c-fact")).getByTestId("kg-tri-state-conflict")).toBeInTheDocument();
      expect(within(screen.getByTestId("kg-claim-c-todo")).getByTestId("kg-tri-state-conflict")).toBeInTheDocument();
    }, UI_DEADLINE);
  });

  it("「合并」：保留这一条关联的人和事，并入另一个 → mergeObjects", async () => {
    await renderPanel();
    openMenuItem("c-decide", "merge");
    const dialog = await screen.findByTestId("kg-merge-dialog-c-decide");
    expect(within(dialog).getByTestId("kg-merge-keep-c-decide-obj-a")).toBeChecked();
    expect(within(dialog).queryByTestId("kg-merge-other-c-decide-obj-a")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId("kg-merge-other-c-decide-obj-c"));
    fireEvent.click(within(dialog).getByTestId("kg-merge-submit-c-decide"));
    await waitFor(() => expect(lastAction()).toEqual({
      basedOnRevision: 7, action: { type: "mergeObjects", keepObjectId: "obj-a", mergeObjectId: "obj-c" },
    }));
    await waitFor(() => expect(server.gets).toBe(2), UI_DEADLINE);
    expect(screen.queryByTestId("kg-merge-dialog-c-decide")).not.toBeInTheDocument();
  });

  it("「改名」：renameObject 带新名字；选别的人和事时输入框换成它的名字", async () => {
    await renderPanel();
    openMenuItem("c-fact", "rename");
    const dialog = await screen.findByTestId("kg-rename-dialog-c-fact");
    const input = within(dialog).getByTestId("kg-rename-input-c-fact");
    expect(input).toHaveValue("客户 B");
    fireEvent.click(within(dialog).getByTestId("kg-rename-object-c-fact-obj-a"));
    expect(input).toHaveValue("王五");
    fireEvent.change(input, { target: { value: "王五（产品）" } });
    fireEvent.click(within(dialog).getByTestId("kg-rename-submit-c-fact"));
    await waitFor(() => expect(lastAction()?.action).toEqual({ type: "renameObject", objectId: "obj-a", name: "王五（产品）" }));
    await waitFor(() => expect(server.gets).toBe(2), UI_DEADLINE);
  });

  it("「拆分」：splitObject 带新名字与跟着走的记忆", async () => {
    await renderPanel();
    openMenuItem("c-decide", "split");
    const dialog = await screen.findByTestId("kg-split-dialog-c-decide");
    const submit = within(dialog).getByTestId("kg-split-submit-c-decide");
    expect(submit).toBeDisabled(); // 没有新名字
    fireEvent.change(within(dialog).getByTestId("kg-split-name-c-decide"), { target: { value: "王五（客户方）" } });
    expect(within(dialog).getByTestId("kg-split-claim-c-decide-c-decide")).toBeChecked();
    fireEvent.click(within(dialog).getByTestId("kg-split-claim-c-decide-c-fact"));
    fireEvent.click(submit);
    await waitFor(() => expect(lastAction()?.action).toEqual({
      type: "splitObject", objectId: "obj-a", newName: "王五（客户方）", moveClaimIds: ["c-decide", "c-fact"],
    }));
    await waitFor(() => expect(server.gets).toBe(2), UI_DEADLINE);
  });

  it("这一条没关联人和事：合并 / 拆分 / 改名禁用", async () => {
    await renderPanel();
    fireEvent.pointerDown(screen.getByTestId("kg-claim-edit-trigger-c-todo"), { button: 0, ctrlKey: false });
    for (const item of ["merge", "split", "rename"]) {
      expect(screen.getByTestId(`kg-action-${item}-c-todo`)).toHaveAttribute("data-disabled");
    }
  });
});

/* ── 非所有者 ───────────────────────────────────────────────────── */

describe("非所有者（canEdit=false）", () => {
  it("没有任何编辑入口：菜单、一键对/不对、全部确认都不渲染，也不会发写请求", async () => {
    server.canEdit = false;
    await renderPanel();
    expect(screen.getByTestId("kg-readonly-badge")).toBeInTheDocument();
    for (const id of ["c-decide", "c-fact", "c-todo", "c-risk"]) {
      expect(screen.queryByTestId(`kg-claim-edit-trigger-${id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`kg-claim-edit-menu-${id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`kg-row-yes-${id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`kg-row-no-${id}`)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId("kg-confirm-all")).not.toBeInTheDocument();
    expect(server.actions).toHaveLength(0);
  });
});

/* ── 失败 ───────────────────────────────────────────────────────── */

describe("失败时说人话", () => {
  it("确认一条有矛盾的：显示 KG_CONTESTED_NEEDS_RESOLUTION 的人话，不显示内部码", async () => {
    server.onAction = () => failure(409, "KG_CONTESTED_NEEDS_RESOLUTION");
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-yes-c-fact"));
    const err = await screen.findByTestId("kg-action-error");
    expect(err).toHaveTextContent("有矛盾的记忆要先选保留哪条，才能确认");
    expect(document.body.textContent).not.toContain("KG_");
    expect(within(screen.getByTestId("kg-claim-c-fact")).getByTestId("kg-tri-state-pending")).toBeInTheDocument();
  });

  it("菜单上「有矛盾」的一条：确认禁用并说明原因", async () => {
    await renderPanel();
    fireEvent.pointerDown(screen.getByTestId("kg-claim-edit-trigger-c-risk"), { button: 0, ctrlKey: false });
    expect(screen.getByTestId("kg-action-confirm-c-risk")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("kg-confirm-blocked-c-risk")).toHaveTextContent("有矛盾的记忆要先选保留哪条才能确认");
  });

  it("并发改动（KG_REVISION_CHANGED）：提示「内容已变化」并重读；再操作带新 revision", async () => {
    let first = true;
    server.onAction = () => {
      if (!first) return undefined;
      first = false;
      server.revision = 12; // 别人刚改过
      setStatus("c-todo", "accepted");
      return failure(409, "KG_REVISION_CHANGED");
    };
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-yes-c-fact"));
    expect(await screen.findByTestId("kg-action-error")).toHaveTextContent("内容已变化");
    await waitFor(() => expect(within(screen.getByTestId("kg-claim-c-todo")).getByTestId("kg-tri-state-confirmed")).toBeInTheDocument(), UI_DEADLINE);
    expect(server.gets).toBe(2);

    fireEvent.click(screen.getByTestId("kg-row-yes-c-fact"));
    await waitFor(() => expect(lastAction()).toEqual({ basedOnRevision: 12, action: { type: "confirmClaim", claimId: "c-fact" } }));
    await waitFor(() => expect(screen.queryByTestId("kg-action-error")).not.toBeInTheDocument());
  });

  it("对话框里失败：对话框留着、面板顶部给人话；契约外的码给通用说法", async () => {
    server.onAction = () => failure(400, "KG_INVALID_REQUEST");
    await renderPanel();
    openMenuItem("c-fact", "revise");
    const dialog = await screen.findByTestId("kg-revise-dialog-c-fact");
    fireEvent.change(within(dialog).getByTestId("kg-revise-input-c-fact"), { target: { value: "改过的说法" } });
    fireEvent.click(within(dialog).getByTestId("kg-revise-submit-c-fact"));
    expect(await screen.findByTestId("kg-action-error")).toHaveTextContent("没能保存这次修改，请稍后重试。");
    expect(screen.getByTestId("kg-revise-dialog-c-fact")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("KG_");
  });

  it("KG_NOT_OWNER：说明只有创建者能改", async () => {
    server.onAction = () => failure(403, "KG_NOT_OWNER");
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-yes-c-fact"));
    expect(await screen.findByTestId("kg-action-error")).toHaveTextContent("只有对话的创建者可以修改这里的记忆");
  });
});

/* ── 回答下「撤销」（U-1） ─────────────────────────────────────────── */

describe("回答下「撤销」：逐条忘掉本轮记下的", () => {
  const TURN_PATH = `/knowledge-graph/threads/${THREAD}/messages/msg-1/memory`;
  function withTurnMemory(): void {
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
      if (path === TURN_PATH) {
        return json({
          messageId: "msg-1",
          captured: [{ claimId: "c-fact", statement: "客户 B 需要中文界面。" }, { claimId: "c-todo", statement: "赵六整理发版清单。" }],
          pending: false,
          prompt: null,
          recalled: [],
          recallDegraded: false,
        });
      }
      return inner(input, init);
    });
  }

  it("所有者：两条 revokeClaim 依次发出（revision 逐次推进），完成后记忆面板重读", async () => {
    withTurnMemory();
    render(<><Harness /><TurnMemoryLine threadId={THREAD} messageId="msg-1" /></>);
    await screen.findByTestId("kg-list");
    const undo = await screen.findByTestId("kg-turn-captured-undo");
    fireEvent.click(undo);
    await screen.findByTestId("kg-turn-captured-undone");
    expect(server.actions).toEqual([
      { basedOnRevision: 7, action: { type: "revokeClaim", claimId: "c-fact" } },
      { basedOnRevision: 8, action: { type: "revokeClaim", claimId: "c-todo" } },
    ]);
    await waitFor(() => {
      expect(screen.queryByTestId("kg-claim-c-fact")).not.toBeInTheDocument();
      expect(screen.queryByTestId("kg-claim-c-todo")).not.toBeInTheDocument();
    }, UI_DEADLINE);
  });

  it("已经在面板里忘掉的那条（KG_CLAIM_NOT_FOUND）不算失败", async () => {
    withTurnMemory();
    server.onAction = (b) => (b.action.type === "revokeClaim" && b.action.claimId === "c-fact" ? failure(404, "KG_CLAIM_NOT_FOUND") : undefined);
    render(<><Harness /><TurnMemoryLine threadId={THREAD} messageId="msg-1" /></>);
    await screen.findByTestId("kg-list");
    fireEvent.click(await screen.findByTestId("kg-turn-captured-undo"));
    await screen.findByTestId("kg-turn-captured-undone");
    expect(server.actions.map((a) => a.basedOnRevision)).toEqual([7, 7]);
  });

  it("撤销失败：这一行下给人话，不显示内部码", async () => {
    withTurnMemory();
    server.onAction = () => failure(409, "KG_REVISION_CHANGED");
    render(<><Harness /><TurnMemoryLine threadId={THREAD} messageId="msg-1" /></>);
    await screen.findByTestId("kg-list");
    fireEvent.click(await screen.findByTestId("kg-turn-captured-undo"));
    expect(await screen.findByTestId("kg-turn-undo-error")).toHaveTextContent("内容已变化");
    expect(document.body.textContent).not.toContain("KG_");
  });

  it("非所有者：不渲染「撤销」", async () => {
    withTurnMemory();
    server.canEdit = false;
    render(<><Harness /><TurnMemoryLine threadId={THREAD} messageId="msg-1" /></>);
    await screen.findByTestId("kg-list");
    await screen.findByTestId("kg-turn-captured");
    expect(screen.queryByTestId("kg-turn-captured-undo")).not.toBeInTheDocument();
  });
});

/* ── R5 用词 ──────────────────────────────────────────────────────── */

describe("编辑界面文案不含 R5 禁用词", () => {
  function copyOf(root: HTMLElement): string {
    const attrs = [...root.querySelectorAll("[aria-label],[title],[placeholder]")]
      .map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("placeholder") ?? ""}`);
    return `${root.textContent ?? ""} ${attrs.join(" ")}`;
  }
  function expectClean(text: string): void {
    for (const word of KG_BANNED_USER_FACING_WORDS) expect(text, `出现了禁用词「${word}」`).not.toContain(word);
  }

  it("菜单、六种对话框、行内对/不对、失败提示", async () => {
    server.onAction = () => failure(409, "KG_CONTESTED_NEEDS_RESOLUTION");
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-row-no-c-fact"));
    expectClean(copyOf(document.body));

    for (const item of ["revise", "contest", "merge", "split", "rename", "delete"]) {
      openMenuItem("c-fact", item);
      await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
      expectClean(copyOf(document.body));
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }

    fireEvent.pointerDown(screen.getByTestId("kg-claim-edit-trigger-c-risk"), { button: 0, ctrlKey: false });
    expectClean(copyOf(document.body));
    fireEvent.keyDown(screen.getByTestId("kg-claim-edit-menu-c-risk"), { key: "Escape" });

    await act(async () => { fireEvent.click(screen.getByTestId("kg-row-yes-c-todo")); });
    await screen.findByTestId("kg-action-error");
    expectClean(copyOf(document.body));
  });
});
