/**
 * @repo/contracts — 契约束 `module-routing`（phase-10-live-collaboration-orchestration，F07/F08）
 *
 * ⚠ **契约草案，尚未实现后端**：本文件随 F07/F08 一并实现前**先行落地**，
 *   供 ADR-023 第 ③ 件存在性门控（`lint-third-artifact.mjs`）与后续 sprint 引用；
 *   当前**无 controller 消费它**，`apps/api` 里没有对应路由实现。
 *   来源是 `phases/phase-10-live-collaboration-orchestration/contracts/module-routing/usecases.md`
 *   （已签核，`design-signoff.md` status: confirmed，2026-08-20 usamshen）——本文件
 *   逐条转写该文档的 `in`/`out`/`err`，不新增未签核的字段。
 *
 * ## 🛑 F08 硬阻断（design-signoff.md 显著标注，本文件不弱化）
 * `checklist`/`需要知道`/`已生成产出` 三类字段**全仓无契约来源**——不是待补细节，是字段本身
 * 不存在于仓库任何契约/仓储里。⇒ 本文件**不定义**这三类字段对应的操作，F08 停在 UI 骨架 + mock
 * 阶段，直到独立的契约设计确认三个来源问题（见 `KNOWN_CONTRACT_GAPS.R1`）。
 */
import { z } from "zod";
import { VIEWER_SCOPE_DENIED } from "./live-collab-viewer-role";
import { NotReady } from "./live-collab-stage-aggregation";

/* ───────────────────────────── 实体 ───────────────────────────── */

/** 五模块（不含图谱）的统一卡片形态（Q3 已裁候选 A：现状默认字段集）。 */
export const ModuleCard = z
  .object({
    id: z.string(),
    visibilityBadge: z.string(),
    statusBadge: z.string(),
    summary: z.string(),
    ownerAvatar: z.string().nullable(),
    openUrl: z.string(),
  })
  .strict();

/** `getModuleCards` 支持的四个模块键——`graph` 不走这个端口（见 `getGroupGraphSummary`）。 */
export const ModuleKey = z.enum(["chat", "interview", "research", "survey"]);

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /**
   * UC `getModuleCounts`（F07，读）。五模块侧栏计数徽标。
   *
   * ⚠ 具体来自哪个下游 phase 的真实接口尚未确认（usecases.md「签核时确认聚合方式」）——
   *   本操作只声明**编排层看到的聚合结果形状**，不代表本束会重新统计四个下游模块各自的数据。
   */
  getModuleCounts: {
    method: "GET",
    path: "/workshops/:workshopId/groups/:groupId/module-counts",
    in: z.object({ workshopId: z.string(), groupId: z.string() }).strict(),
    out: z
      .object({
        chat: z.number().int().nonnegative(),
        interview: z.number().int().nonnegative(),
        research: z.number().int().nonnegative(),
        survey: z.number().int().nonnegative(),
      })
      .strict(),
    /** ⚠ 权限拒绝复用 `viewer-role` 束的 `VIEWER_SCOPE_DENIED`，不重复定义（domain.md 不变量 3）。 */
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE"] as const,
  },

  /**
   * UC `getModuleCards`（F07，读）。四模块（不含图谱）统一卡片形态。
   *
   * ⚠ **本束不重新实现任一模块的内部领域逻辑**（domain.md 不变量 2）：这是只读聚合 + 路由跳转，
   *   不直接写四个下游模块各自的数据表。
   */
  getModuleCards: {
    method: "GET",
    path: "/workshops/:workshopId/groups/:groupId/module-cards",
    in: z.object({ workshopId: z.string(), groupId: z.string(), moduleKey: ModuleKey }).strict(),
    out: z.object({ cards: z.array(ModuleCard) }).strict(),
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE"] as const,
  },

  /**
   * UC `getGroupGraphSummary`（F07，读，图谱模块专属）。
   *
   * ⚠ **本轮只能是空壳**：真实的决策小树结构由 phase-02 知识图谱束的契约单一定义
   *   （usecases.md「待定，需 phase-02 契约束签核后确认形状」），本操作只声明「未就绪」，
   *   与 `stage-aggregation` 束的 `getKanbanBoard`/`getDecisionGraph` 用同一个「未就绪」
   *   响应形状约定（`{ ready, blockedBy }`），不另造一套。
   */
  getGroupGraphSummary: {
    method: "GET",
    path: "/workshops/:workshopId/groups/:groupId/graph-summary",
    in: z.object({ workshopId: z.string(), groupId: z.string() }).strict(),
    out: NotReady,
    err: [VIEWER_SCOPE_DENIED, "NO_PROJECT_ROLE"] as const,
  },
} as const;

/**
 * 已知契约缺口（对齐 `materials.ts`/`project.ts` `KNOWN_CONTRACT_GAPS` 惯例，
 * 缺口显式登记而非静默略过）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * F08 三类字段（checklist / 需要知道 / 已生成产出）全仓无契约来源，见文件头「🛑 硬阻断」。
   * 本文件刻意不为它们建操作——建一个空壳操作会制造「F08 已有契约」的假象，
   * 比完全不建更容易被误读为「已确认形状，只是还没接线」。
   */
  R1_F08_SIDEBAR_FIELDS_NO_SOURCE:
    "见 design-signoff.md『🛑 硬阻断』与 domain.md『[待定] 未决项』第二条；三类字段最终归属" +
    "哪个契约束（本束新建，还是分别归属对应下游 phase）尚无裁决，独立契约设计阶段前不建操作",
  /**
   * 图谱模块是否收敛成统一卡片形态外面套一层展开——需求本身的模糊点，不是实现细节，
   * 见 domain.md『[待定] 未决项』第一条。
   */
  R2_GRAPH_CARD_SHAPE_CONVERGENCE: "见 domain.md『[待定] 未决项』第一条",
  /**
   * 跨模块跳转的上下文携带方式（URL 参数 / 前端 state / 服务端 session）需要与 4 个下游 phase
   * 统一约定，`ModuleCard.openUrl` 目前只是一个字符串，未来可能需要收窄成结构化跳转参数。
   */
  R3_CROSS_MODULE_CONTEXT_CARRY: "见 usecases.md『签核前请重点确认』第二条",
} as const;
