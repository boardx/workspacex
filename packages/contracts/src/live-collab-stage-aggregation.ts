/**
 * @repo/contracts — 契约束 `stage-aggregation`（phase-10-live-collaboration-orchestration，F09/F10）
 *
 * ⚠ **契约草案，尚未实现后端**：本文件随 F09/F10 一并实现前**先行落地**，
 *   供 ADR-023 第 ③ 件存在性门控（`lint-third-artifact.mjs`）与后续 sprint 引用；
 *   当前**无 controller 消费它**，`apps/api` 里没有对应路由实现。
 *   来源是 `phases/phase-10-live-collaboration-orchestration/contracts/stage-aggregation/usecases.md`
 *   （已签核，`design-signoff.md` status: confirmed，2026-08-20 usamshen）——本文件
 *   逐条转写该文档的 `in`/`out`/`err`，不新增未签核的字段。
 *
 * ## 🛑 硬阻断（design-signoff.md 显著标注，本文件不弱化）
 * 看板卡片/决策树节点的**真实领域字段形状由 phase-02 单一定义**，本束不重新声明
 * （domain.md 不变量 1：两份同构定义即便字段一致也算「同一事实声明两处」）。phase-02 目前
 * 整体 `not_started`、`contracts/` 只签了 `survey` 一个束——本文件的两个查询端口因此
 * **只能声明「未就绪」响应**，不得声明任何看起来像真实数据的字段。
 */
import { z } from "zod";
import { VIEWER_SCOPE_DENIED } from "./live-collab-viewer-role";

/**
 * 跨 phase「消费另一个 not_started phase」的通用「未就绪」响应形状。
 * `module-routing` 束的 `getGroupGraphSummary` 用的是同一个形状——本文件是这个约定的落点，
 * 两束都从这里引用，不各自重复声明。
 */
export const NotReady = z
  .object({
    ready: z.literal(false),
    blockedBy: z.literal("phase-02"),
  })
  .strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /**
   * UC `getKanbanBoard`（F09，读）。
   *
   * ⚠ **本轮只能是空壳**（domain.md 不变量 2）：phase-02 对应束未签核期间，只返回
   *   `{ ready: false, blockedBy: "phase-02" }`，不返回 `cards` 等看似真实的数据字段。
   * ⚠ 权限拒绝要发生在「是否就绪」判断之前（domain.md 不变量 4）——`err` 里的
   *   `VIEWER_SCOPE_DENIED` 优先于 `NotReady` 响应，不是先给未就绪再判权限。
   */
  getKanbanBoard: {
    method: "GET",
    path: "/workshops/:workshopId/kanban-board",
    in: z.object({ workshopId: z.string() }).strict(),
    out: NotReady,
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE"] as const,
  },

  /**
   * UC `getDecisionGraph`（F10，读）。同 `getKanbanBoard` 的「未就绪」约束，
   * 真实决策树节点字段由 phase-02 F11/F15/F16 对应契约束定义。
   */
  getDecisionGraph: {
    method: "GET",
    path: "/workshops/:workshopId/decision-graph",
    in: z.object({ workshopId: z.string() }).strict(),
    out: NotReady,
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE"] as const,
  },

  /**
   * UC `broadcastToGroupLeads`（F09，写，**不依赖 phase-02 数据**）。
   *
   * ⚠ domain.md 不变量 3：本操作的成功与否不依赖看板/图谱数据是否就绪——
   *   `getKanbanBoard` 返回未就绪的同时，本操作仍应正常返回成功，两者互不阻塞。
   *   这是本束用例设计里唯一可能绕开硬阻断、先行开工的口子（usecases.md 逐字）。
   */
  broadcastToGroupLeads: {
    method: "POST",
    path: "/workshops/:workshopId/broadcasts",
    in: z.object({ workshopId: z.string(), message: z.string().min(1) }).strict(),
    out: z
      .object({
        sentAt: z.string(),
        visibleToAllGroups: z.literal(true),
      })
      .strict(),
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE"] as const,
  },

  /**
   * UC `dispatchNextWork`（F10，写，动作本身可独立设计，但工作项本体依赖 phase-02 F17）。
   *
   * ⚠ `workItemId` 目前只是一个不透明字符串——「下一步可开展的工作」的领域模型属于
   *   phase-02 F17，本操作只能先确认「派发」这个动作的触发/反馈形态，不能定义工作项本体字段
   *   （见 `KNOWN_CONTRACT_GAPS.A2`）。
   */
  dispatchNextWork: {
    method: "POST",
    path: "/workshops/:workshopId/next-work-dispatches",
    in: z
      .object({
        workshopId: z.string(),
        workItemId: z.string(),
        targetGroupId: z.string(),
      })
      .strict(),
    out: z.object({ dispatched: z.literal(true) }).strict(),
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE", "UPSTREAM_BUNDLE_NOT_SIGNED"] as const,
  },
} as const;

/**
 * 已知契约缺口（对齐 `materials.ts`/`project.ts` `KNOWN_CONTRACT_GAPS` 惯例，
 * 缺口显式登记而非静默略过）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * 看板卡片字段（当前议题/时间戳/AI 摘要引述/进度条）、决策树节点字段（领先/在议待决/冲突/
   * 已否决/待验证）由 phase-02 对应束的契约文件单一定义，本文件不得抢先声明——
   * phase-02 目前 `not_started`，`getKanbanBoard`/`getDecisionGraph` 的 `out` 因此恒为 `NotReady`。
   */
  A1_KANBAN_GRAPH_FIELDS_OWNED_BY_PHASE_02:
    "见 design-signoff.md『🛑 硬阻断』与 domain.md 不变量 1/2；phase-02 契约束签核后，" +
    "本文件的两个端口需改为引用 phase-02 契约文件的类型，不是自己重新写一份",
  /**
   * `dispatchNextWork` 的「工作项」结构完全依赖 phase-02 F17 的「下一步可开展的工作」领域模型，
   * `workItemId` 目前是不透明字符串占位。
   */
  A2_WORK_ITEM_SHAPE_OWNED_BY_PHASE_02_F17: "见 domain.md『[待定] 未决项』第二条",
  /**
   * 观察者能否看到本束两个聚合视图——与 `viewer-role` 束 Q1 共享同一个未决问题，
   * 不在本束单独裁决，避免与 `viewer-role` 束的结论打架。
   */
  A3_OBSERVER_VISIBILITY_SHARED_WITH_VIEWER_ROLE: "见 domain.md『[待定] 未决项』第一条",
} as const;
