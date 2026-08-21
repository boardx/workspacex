/**
 * @repo/contracts — 契约束 `segment-engine`（phase-10-live-collaboration-orchestration，F03/F04）
 *
 * ⚠ **契约草案，尚未实现后端**：本文件随 F03/F04 一并实现前**先行落地**，
 *   供 ADR-023 第 ③ 件存在性门控（`lint-third-artifact.mjs`）与后续 sprint 引用；
 *   当前**无 controller 消费它**，`apps/api` 里没有对应路由实现。
 *   来源是 `phases/phase-10-live-collaboration-orchestration/contracts/segment-engine/usecases.md`
 *   （已签核，`design-signoff.md` status: confirmed，2026-08-20 usamshen）——本文件
 *   逐条转写该文档的 `in`/`out`/`err`，不新增未签核的字段。
 *
 * ## 环节状态单一事实源（domain.md 不变量 1）
 * `listAgendaSegments`/`advanceAgendaSegment`（F963 已接，定义在 `project.ts`）**是**唯一事实源，
 * 本束**不重新声明**这两个操作——直接 `export` 引用，不建同构的第二份类型/操作定义。
 * 本文件只新增一个操作：`getSegmentCountdown`（跨 phase-01 议程束的骨架草案）。
 */
import { z } from "zod";
import { operations as projectOperations, AgendaSegment } from "./project";

/* ── 复用，非新增（domain.md 不变量 1）───────────────────────────── */

/** 编排层状态条必须是这两个操作的另一种渲染，不是重新发起一次查询后得到的第二份状态。 */
export const listAgendaSegments = projectOperations.listAgendaSegments;
export const advanceAgendaSegment = projectOperations.advanceAgendaSegment;
export { AgendaSegment };

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  listAgendaSegments,
  advanceAgendaSegment,

  /**
   * UC `getSegmentCountdown`（F04，读，**新增，跨 phase-01 议程束**）。
   *
   * ⚠ **落点未定**（design-signoff.md 硬阻断）：`listAgendaSegments` 目前只返回
   *   `{title, state}` 一类字段（不含剩余时长），本操作是本束向 phase-01 议程束提出的
   *   **契约变更请求**，不是 phase-01 已同意的字段——归属最终应长在 `AgendaSegment` 里
   *   还是本束独立只读端口，需 phase-01 议程束走自己的签核流程确认（本文件先不替它拍板）。
   * ⚠ 在此之前该字段**不存在**：前端状态条渲染 `＊` 待补契约占位，不发起真实请求
   *   （domain.md 不变量 3）。本操作本轮仅作为**形状草案**登记，`out` 的字段集随时可能因
   *   phase-01 的裁决而改变，不构成已确认的契约。
   */
  getSegmentCountdown: {
    method: "GET",
    path: "/workshops/:workshopId/agenda-segments/:segmentId/countdown",
    in: z.object({ workshopId: z.string(), segmentId: z.string() }).strict(),
    out: z
      .object({
        remainingSeconds: z.number().int().nonnegative(),
        resetAt: z.string(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "SEGMENT_NOT_FOUND"] as const,
  },
} as const;

/**
 * ⚠ 本束刻意**没有**的操作/字段：「第X组需介入」pill 的判据。domain.md 不变量 4 逐字
 * 「无判据来源期间不得渲染，不得基于任何猜测规则自造判据冒充真实告警」——这条不变量在
 * 契约文件里的落点就是**不建对应字段**，与 `viewer-role` 束 `KNOWN_CONTRACT_GAPS.V1` 是
 * 同一个判据缺口的两处消费点（同一事实只在这两处各引用一次，不重新声明）。
 */
export const NO_NEEDS_INTERVENTION_ENDPOINT = true as const;

/**
 * 已知契约缺口（对齐 `materials.ts`/`project.ts` `KNOWN_CONTRACT_GAPS` 惯例，
 * 缺口显式登记而非静默略过）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * `getSegmentCountdown` 的最终落点（phase-01 议程契约 vs 本束独立端口）——架构层面待拍板，
   * 见 design-signoff.md『签核前请重点确认』第二条。
   */
  S1_COUNTDOWN_OWNERSHIP: "见 design-signoff.md『🛑 硬阻断』与『签核前请重点确认』第二条",
  /**
   * 倒计时重置时机（环节推进后立即重置 vs 下一次轮询才反映）靠 WebSocket 推送还是前端轮询未定。
   */
  S2_COUNTDOWN_RESET_MECHANISM: "见 domain.md『[待定] 未决项』第二条",
  /** 「第X组需介入」pill 判据全仓无来源，见 domain.md 不变量 4。 */
  S3_NEEDS_INTERVENTION_BASIS: "见 domain.md 不变量 4；与 viewer-role 束 KNOWN_CONTRACT_GAPS.V1 同一判据",
} as const;
