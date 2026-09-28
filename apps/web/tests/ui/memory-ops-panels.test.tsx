/**
 * S8（#4365）—— 运营状态屏的「记忆抽取 SLO」与「记忆整合」两块，以及大脑页的「整理记录」（撤销）。
 * 只 mock `apiRequest` 这一层：路径与方法取自契约，返回值过契约 `out` 校验（真代码在跑）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { ConsolidationSettingPanel, ExtractionSloPanel } from "@/components/admin/memory-ops-panels";
import { OpsStatusScreen } from "@/components/admin/ops-status-screen";
import { ConsolidationHistory } from "@/components/brain/consolidation-history";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const SLO = (over: Record<string, unknown> = {}) => ({
  windowSeconds: 3600, processed: 12, modelJobs: 8, failed: 1, p95LatencyMs: 4200, failureRate: 0.125,
  stuckLeases: 0, deadLetters: 1, backlog: 3, oldestPendingSeconds: 9,
  gate: {
    skippedByReason: { greeting: 2, acknowledgement: 1, pure_question: 1, model_not_worth: 0 },
    modelCallsSaved: 4, modelCalls: 8, gateModelEnabled: false, gateModelChecks: 0, gateModelErrors: 0,
  },
  thresholds: { p95LatencyMs: 120000, failureRate: 0.2, stuckLeases: 0 },
  alerts: [],
  ...over,
});

describe("#4365 记忆抽取 SLO 面板", () => {
  it("三个指标有值、门控省下的调用，都在阈值内 ⇒ 没有横幅；挂在运营状态屏上、紧挨着抽取开关", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === knowledgeGraph.getPlatformExtractionSlo.path) return SLO();
      if (path === knowledgeGraph.getPlatformConsolidationSetting.path) return { enabled: false };
      if (path === knowledgeGraph.getPlatformExtractionSetting.path) return { providerConfigured: true, enabled: true };
      return {};
    });
    render(<OpsStatusScreen state="default" />);
    await screen.findByTestId("admin-extraction-slo-ok");
    expect(screen.getByTestId("admin-extraction-slo-p95").textContent).toContain("4.2 秒");
    expect(screen.getByTestId("admin-extraction-slo-failure-rate").textContent).toContain("12.5%");
    expect(screen.getByTestId("admin-extraction-slo-stuck").textContent).toContain("0 条");
    expect(screen.getByTestId("admin-extraction-gate-saved").textContent).toContain("省下 4 次抽取模型调用");
    expect(screen.queryByTestId("admin-extraction-slo-alert")).toBeNull();
    // 顺序：抽取开关 → SLO → 整合（「紧挨着部署抽取开关」）
    const ids = [...document.querySelectorAll("[data-testid^='admin-']")].map((e) => e.getAttribute("data-testid"));
    const i = (id: string) => ids.indexOf(id);
    expect(i("admin-platform-extraction")).toBeLessThan(i("admin-extraction-slo"));
    expect(i("admin-extraction-slo")).toBeLessThan(i("admin-consolidation"));
    expect(apiRequest).toHaveBeenCalledWith(knowledgeGraph.getPlatformExtractionSlo.path, { method: "GET" });
  });

  it("超阈值 ⇒ 顶部横幅逐项列出（值 + 阈值），对应的卡片标红", async () => {
    apiRequest.mockResolvedValue(SLO({
      stuckLeases: 2, p95LatencyMs: 180000,
      alerts: [{ metric: "p95_latency", value: 180000, threshold: 120000 }, { metric: "stuck_leases", value: 2, threshold: 0 }],
    }));
    render(<ExtractionSloPanel />);
    const banner = await screen.findByTestId("admin-extraction-slo-alert");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("admin-extraction-slo-alert-p95_latency").textContent).toBe("p95 延迟：180.0 秒（阈值 120.0 秒）");
    expect(screen.getByTestId("admin-extraction-slo-alert-stuck_leases").textContent).toBe("卡住的租约：2 条（阈值 0 条）");
    expect(screen.getByTestId("admin-extraction-slo-stuck").className).toMatch(/border-destructive/);
  });

  it("无权限 ⇒ 一句身份说明，不画数字", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockRejectedValue(new ApiError(403, "NOT_PLATFORM_SUPERUSER", {}));
    render(<ExtractionSloPanel />);
    await screen.findByTestId("admin-extraction-slo-forbidden");
    expect(screen.queryByTestId("admin-extraction-slo-p95")).toBeNull();
  });
});

describe("#4365 记忆整合开关面板", () => {
  it("默认关：显示「已关闭」，「现在整合一次」不可点；打开 ⇒ PUT，之后能整合一次并报计数", async () => {
    let enabled = false;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { enabled?: boolean } }) => {
      if (path === knowledgeGraph.setPlatformConsolidationSetting.path && opts?.method === "PUT") { enabled = opts.body?.enabled === true; return { enabled }; }
      if (path === knowledgeGraph.getPlatformConsolidationSetting.path) return { enabled };
      if (path === knowledgeGraph.runPlatformConsolidation.path) {
        return { users: 1, claimMerges: 1, entityMerges: 1, conflicts: 1, conflictsUnsurfaced: 0, failedUsers: 0 };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<ConsolidationSettingPanel />);
    await waitFor(() => expect(screen.getByTestId("admin-consolidation-state").textContent).toBe("已关闭"));
    expect((screen.getByTestId("admin-consolidation-run") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("admin-consolidation-toggle"));
    await waitFor(() => expect(screen.getByTestId("admin-consolidation-state").textContent).toBe("已开启"));
    expect(apiRequest).toHaveBeenCalledWith(knowledgeGraph.setPlatformConsolidationSetting.path, { method: "PUT", body: { enabled: true } });
    fireEvent.click(screen.getByTestId("admin-consolidation-run"));
    const msg = await screen.findByTestId("admin-consolidation-message");
    expect(msg.textContent).toContain("合并 1 条重复记忆、1 个实体写法，开了 1 张冲突卡");
  });

  it("关着时服务端拒绝整合（409 KG_CONSOLIDATION_DISABLED）⇒ 说人话", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiRequest.mockImplementation(async (path: string) => {
      if (path === knowledgeGraph.runPlatformConsolidation.path) throw new ApiError(409, "KG_CONSOLIDATION_DISABLED", {});
      return { enabled: true };
    });
    render(<ConsolidationSettingPanel />);
    fireEvent.click(await screen.findByTestId("admin-consolidation-run"));
    expect((await screen.findByTestId("admin-consolidation-message")).textContent).toContain("开关关着");
  });
});

const RUN = (state: "applied" | "undone" | "partially_undone", changeState: "applied" | "undone" | "undo_skipped" = "applied") => ({
  runId: "csl_1", createdAt: "2026-09-27T08:00:00Z", state, undoneAt: state === "applied" ? null : "2026-09-27T09:00:00Z",
  conflictsUnsurfaced: 0,
  changes: [
    { changeId: "csl_1-0", kind: "entity_merge", state: changeState, basis: "name", kept: { id: "o1", text: "项目A" }, other: { id: "o2", text: "项目 A" }, threadId: null, undoNote: null },
    { changeId: "csl_1-1", kind: "claim_merge", state: changeState, basis: "semantic", kept: { id: "c1", text: "我更喜欢简洁的回答" }, other: { id: "c2", text: "我更喜欢简洁一点的回答" }, threadId: null, undoNote: null },
    {
      changeId: "csl_1-2", kind: "conflict_opened", state: changeState === "undone" ? "undo_skipped" : changeState, basis: "conflict",
      kept: { id: "c3", text: "项目A 预算定为 50 万" }, other: { id: "c4", text: "项目 A 预算定为 60 万" }, threadId: "thr-b60",
      undoNote: changeState === "undone" ? "这张冲突卡已经处理过（或已随记忆改动结束），不再撤回" : null,
    },
  ],
});

describe("#4365 大脑页「整理记录」", () => {
  it("没有记录 ⇒ 整块不出现", async () => {
    apiRequest.mockResolvedValue({ runs: [] });
    render(<ConsolidationHistory />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(screen.queryByTestId("brain-consolidation")).toBeNull();
  });

  it("列出每处改动（两边的文字、矛盾给出去决定的链接）；撤销 ⇒ POST，按服务端结果显示哪些没撤回及原因，并通知大脑页刷新", async () => {
    const onChanged = vi.fn();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === knowledgeGraph.listMyConsolidationRuns.path) return { runs: [RUN("applied")] };
      if (path === "/knowledge-graph/me/consolidations/csl_1/undo" && opts?.method === "POST") return { run: RUN("partially_undone", "undone") };
      throw new Error(`unexpected ${path}`);
    });
    render(<ConsolidationHistory onChanged={onChanged} />);
    const merge = await screen.findByTestId("brain-consolidation-change-claim_merge");
    expect(merge.textContent).toContain("「我更喜欢简洁一点的回答」并入「我更喜欢简洁的回答」（两条的来源都保留）");
    expect(screen.getByTestId("brain-consolidation-change-entity_merge").textContent).toContain("「项目 A」并入「项目A」");
    const conflict = screen.getByTestId("brain-consolidation-change-conflict_opened");
    expect(conflict.textContent).toContain("不一致");
    expect(conflict.querySelector("a")?.getAttribute("href")).toBe("/chat/thr-b60");
    fireEvent.click(screen.getByTestId("brain-consolidation-undo"));
    await waitFor(() => expect(screen.getByTestId("brain-consolidation-run-state").textContent).toBe("已部分撤销"));
    expect(apiRequest).toHaveBeenCalledWith("/knowledge-graph/me/consolidations/csl_1/undo", { method: "POST", body: {} });
    expect(screen.getByTestId("brain-consolidation-change-conflict_opened").textContent).toContain("没有撤销：这张冲突卡已经处理过");
    expect(screen.queryByTestId("brain-consolidation-undo")).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
