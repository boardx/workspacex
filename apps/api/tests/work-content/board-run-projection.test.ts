/**
 * CT10 —— Board 只读运行卡投影（work-content V7 / E10；domain I-C11 / I-C12）。
 */
import { describe, expect, it } from "vitest";
import { board, workContent, workflowRuntime } from "@repo/contracts";
import {
  mapRunStatus,
  projectBoardWithRunCards,
  projectRunCard,
  type VisibleRunSummary,
} from "../../src/domain/board/workflow-run-card";
import { allReachableCardIds } from "../../src/domain/board/card-projection";
import { listBoardRunCards } from "../../src/application/board/list-board-run-cards";

function run(over: Partial<VisibleRunSummary> = {}): VisibleRunSummary {
  return {
    instanceId: "wi-1",
    workflowName: "线索到合格商机",
    subjectLabel: "Acme 公司",
    status: "running",
    initiatorUserId: "u-alice",
    agents: [
      { agentId: "ag-sales", digitalHumanId: null, displayName: "销售助理", avatarUrl: null },
      { agentId: "ag-research", digitalHumanId: null, displayName: "研究员", avatarUrl: "https://x/a.png" },
    ],
    projectId: "p-1",
    ...over,
  };
}

describe("SourceKind 单源", () => {
  it("board.SOURCE_KINDS 含 workflow_run，work-content 转出同一值", () => {
    expect(board.SOURCE_KINDS).toContain("workflow_run");
    expect(workContent.WORKFLOW_RUN_SOURCE_KIND).toBe(board.WORKFLOW_RUN_SOURCE_KIND);
  });
});

describe("I-C11 状态映射", () => {
  const expected: Record<string, [string, string]> = {
    running: ["in_progress", "in_progress"],
    cancelling: ["in_progress", "in_progress"],
    awaiting_gate_decision: ["review", "awaiting_review"],
    blocked_permission: ["review", "awaiting_review"],
    succeeded: ["done", "done"],
    rejected: ["done", "rejected"],
    failed: ["done", "failed"],
    cancelled: ["done", "failed"],
    needs_attention: ["done", "failed"],
  };
  it.each(workflowRuntime.WorkflowInstanceStatus.options)("%s", (s) => {
    const m = mapRunStatus(s);
    expect([m.column, m.badge]).toEqual(expected[s]);
  });
});

describe("projectRunCard", () => {
  it("产出合法契约卡：标题=Workflow 名+发起对象、头像、不可拖动、跳实例详情", () => {
    const card = projectRunCard(run());
    expect(() => workContent.BoardWorkflowRunCard.parse(card)).not.toThrow();
    expect(card.id).toBe("workflow_run:wi-1");
    expect(card.title).toBe("线索到合格商机 · Acme 公司");
    expect(card.agents.map((a) => a.agentId)).toEqual(["ag-sales", "ag-research"]);
    expect(card.draggable).toBe(false);
    expect(card.href).toBe("/workflows/runs/wi-1");
  });

  it("失败终态进 done 列并带失败徽标", () => {
    const card = projectRunCard(run({ status: "failed" }));
    expect(card.column).toBe("done");
    expect(card.badge).toBe("failed");
  });

  it("A1 无 Agent 时头像为空、无发起对象时标题只取 Workflow 名；转交链去重", () => {
    expect(projectRunCard(run({ agents: [], subjectLabel: null }))).toMatchObject({ agents: [], title: "线索到合格商机" });
    const dup = run().agents[0]!;
    expect(projectRunCard(run({ agents: [dup, dup] })).agents).toHaveLength(1);
  });

  it("纯函数：不改输入", () => {
    const input = run();
    const snap = JSON.stringify(input);
    projectRunCard(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

describe("两视图卡 ID 集合相同", () => {
  it("运行卡与任务卡合并后项目/全局视图可达 ID 一致且无丢卡", () => {
    const runCards = (["running", "awaiting_gate_decision", "failed"] as const).map((s, i) =>
      projectRunCard(run({ instanceId: `wi-${i}`, status: s })),
    );
    const res = projectBoardWithRunCards([{ id: "t-1", status: "inbox" }, { id: "t-2", status: "todo" }], runCards);
    expect(res.noCardLoss).toBe(true);
    expect([...allReachableCardIds(res.projectView)].sort()).toEqual([...allReachableCardIds(res.globalView)].sort());
    const review = res.projectView.columns.find((c) => c.status === "review")!;
    expect(review.cardIds).toEqual(["workflow_run:wi-1"]);
  });
});

describe("I-C12 先权限过滤再投影（listBoardRunCards）", () => {
  const runs = [run({ instanceId: "wi-a", initiatorUserId: "u-alice" }), run({ instanceId: "wi-b", initiatorUserId: "u-bob" })];
  const deps = (role: "admin" | "member" | null) => ({
    runs: { listRuns: async () => runs },
    access: { orgRoleOf: async () => role },
  });

  it("成员只看到自己发起的运行，他人运行卡 ID 不存在", async () => {
    const { cards } = await listBoardRunCards(deps("member"), { orgId: "o", viewerUserId: "u-alice" });
    const ids = cards.map((c) => c.id);
    expect(ids).toEqual(["workflow_run:wi-a"]);
    expect(ids).not.toContain("workflow_run:wi-b");
  });

  it("管理员看到全部；非组织成员一张都没有", async () => {
    expect((await listBoardRunCards(deps("admin"), { orgId: "o", viewerUserId: "u-x" })).cards).toHaveLength(2);
    expect((await listBoardRunCards(deps(null), { orgId: "o", viewerUserId: "u-x" })).cards).toEqual([]);
  });

  it("输出满足 operation out schema", async () => {
    const out = await listBoardRunCards(deps("admin"), { orgId: "o", viewerUserId: "u-x" });
    expect(() => workContent.operations.listBoardRunCards.out.parse(out)).not.toThrow();
  });
});

describe("应用层项目过滤（listBoardRunCards 的 projectId）", () => {
  const all = [
    run({ instanceId: "wi-p1", projectId: "p-1" }),
    run({ instanceId: "wi-p2", projectId: "p-2" }),
    run({ instanceId: "wi-none", projectId: null }),
  ];
  function scopedDeps() {
    const calls: (string | null)[] = [];
    return {
      calls,
      deps: {
        runs: { listRuns: async (_o: string, projectId: string | null) => (calls.push(projectId), projectId ? all.filter((r) => r.projectId === projectId) : all) },
        access: { orgRoleOf: async () => "admin" as const },
      },
    };
  }

  it("projectId 原样下传给运行源；缺省为 null（全局）", async () => {
    const s = scopedDeps();
    const scoped = await listBoardRunCards(s.deps, { orgId: "o", viewerUserId: "u", projectId: "p-1" });
    const global = await listBoardRunCards(s.deps, { orgId: "o", viewerUserId: "u" });
    expect(s.calls).toEqual(["p-1", null]);
    expect(scoped.cards.map((c) => c.id)).toEqual(["workflow_run:wi-p1"]);
    expect(global.cards.map((c) => c.id)).toEqual(["workflow_run:wi-p1", "workflow_run:wi-p2", "workflow_run:wi-none"]);
  });

  it("经真实用例取回的卡，项目视图与全局视图可达卡 ID 集合相同", async () => {
    for (const projectId of ["p-1", null]) {
      const { cards } = await listBoardRunCards(scopedDeps().deps, { orgId: "o", viewerUserId: "u", projectId });
      const res = projectBoardWithRunCards([{ id: "t-1", status: "todo" }], cards);
      expect(res.noCardLoss).toBe(true);
      expect([...allReachableCardIds(res.projectView)].sort()).toEqual([...allReachableCardIds(res.globalView)].sort());
      for (const c of cards) expect(allReachableCardIds(res.projectView).has(c.id)).toBe(true);
    }
  });
});

describe("读权限谓词单源", () => {
  it("listBoardRunCards 复用 WF03 canView，不内联第二份规则", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/application/board/list-board-run-cards.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import \{ canView \} from "\.\.\/workflow\/instance-projection"/);
    expect(src).not.toMatch(/initiatorUserId\s*===/);
    expect(src).not.toMatch(/===\s*"admin"/);
  });
});
