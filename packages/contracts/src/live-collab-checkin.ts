/**
 * @repo/contracts — 契约束 `group-checkin`（phase-10-live-collaboration-orchestration，F05/F06）
 *
 * ⚠ **契约草案，尚未实现后端**：本文件随 F05/F06 一并实现前**先行落地**，
 *   供 ADR-023 第 ③ 件存在性门控（`lint-third-artifact.mjs`）与后续 sprint 引用；
 *   当前**无 controller 消费它**，`apps/api` 里没有对应路由实现。
 *   来源是 `phases/phase-10-live-collaboration-orchestration/contracts/group-checkin/usecases.md`
 *   （已签核，`design-signoff.md` status: confirmed，2026-08-20 usamshen）——本文件
 *   逐条转写该文档的 `in`/`out`/`err`，不新增未签核的字段。
 *
 * 文件名 `live-collab-checkin`（不是 `group-checkin`）与束名不同，登记见
 * `.harness/scripts/third-artifact-map.json`——束目录名与契约文件名允许不同，
 * 门控靠该映射表核对，不是靠文件名和束名逐字相等。
 */
import { z } from "zod";

/* ───────────────────────────── 实体 ───────────────────────────── */

/** 分组签到卡片里的一个成员条目。 */
export const CheckinMember = z
  .object({
    name: z.string(),
    roleBadge: z.string(),
    /**
     * ⚠ 单调不回退（domain.md 不变量 1）：一旦为 `true`，不会因为参与者后续断开连接
     *   而被任何定时任务/心跳撤销为 `false`——「点过加入链接即到场」是唯一判据（Q2 候选 A）。
     */
    arrived: z.boolean(),
  })
  .strict();

/** 一个分组的签到聚合卡片。 */
export const CheckinGroup = z
  .object({
    no: z.number().int().positive(),
    name: z.string(),
    joinUrl: z.string(),
    missingCount: z.number().int().nonnegative(),
    members: z.array(CheckinMember),
  })
  .strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /**
   * UC `getGroupCheckinBoard`（F05，读）。
   *
   * ⚠ **到场数据单一事实源**（domain.md 不变量 5）：`viewer-role` 束的「缺N人」状态后缀
   *   必须读取本操作或其派生查询，不得另建一份到场计数。
   */
  getGroupCheckinBoard: {
    method: "GET",
    path: "/workshops/:workshopId/checkin-board",
    in: z.object({ workshopId: z.string() }).strict(),
    out: z.object({ groups: z.array(CheckinGroup) }).strict(),
    /**
     * `GROUP_LEAD_MISSING`——usecases.md 明确标注为**草案**，签核时是否保留待人类确认
     * （原型作者编的示例场景，不是需求原文点名的规则）。列在这里是为了让
     * `stage-checkin-invalid.png`（err-link 态）有一个可断言的落点，不是已裁定的规则。
     */
    err: ["NO_PROJECT_ROLE", "GROUP_LEAD_MISSING"] as const,
  },

  /**
   * UC `recordCheckinEvent`（F06，写）。
   *
   * ⚠ **不做二次链接校验**（domain.md 不变量 2）：`userId` 来自 phase-01 01-auth 的链接
   *   校验结果，本操作不重复实现 token 签名/有效期校验——那部分逻辑只应出现在 01-auth。
   *   ⇒ 见下方 `KNOWN_CONTRACT_GAPS.C1`：01-auth 侧目前尚无可调用的真实分组链接校验接口，
   *   本操作的 `in.userId` 暂时只能是「假设上游已校验」的契约形状，不是已经能接线的实现。
   */
  recordCheckinEvent: {
    method: "POST",
    path: "/workshops/:workshopId/checkin-events",
    in: z
      .object({
        workshopId: z.string(),
        groupId: z.string(),
        userId: z.string(),
      })
      .strict(),
    out: z
      .object({
        arrived: z.literal(true),
        arrivedAt: z.string(),
      })
      .strict(),
    /**
     * ⚠ 「链接校验结果无效」这一失败模式**不在本操作的 err 里**——usecases.md 逐字
     *   「沿用 phase-01 01-auth 已有错误码（需实现时核实具体值）」，具体值尚不存在，
     *   写一个猜的字面量会制造假契约；见 `KNOWN_CONTRACT_GAPS.C1`。
     */
    err: ["GROUP_NOT_FOUND"] as const,
  },

  /**
   * UC `getJoinPreview`（F06，读，Q5 候选 A：站内预览）。
   *
   * ⚠ **不是可跳转的独立 URL**（domain.md 不变量 4）：点击后浏览器 URL 不变、不开新标签页，
   *   预览内容渲染在当前页面内的面板/弹层里。
   * ⚠ 返回形状选**结构化数据交前端渲染**（不是服务端拼好的 HTML 片段）——与本仓其余只读
   *   预览类操作（如 `templates` 束的预览端口）保持同一渲染责任划分：契约只给数据，
   *   渲染留在前端，避免服务端拼 HTML 字符串成为第二套模板系统。
   */
  getJoinPreview: {
    method: "GET",
    path: "/workshops/:workshopId/checkin-groups/:groupId/join-preview",
    in: z.object({ workshopId: z.string(), groupId: z.string() }).strict(),
    out: z
      .object({
        groupName: z.string(),
        welcomeText: z.string(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "GROUP_NOT_FOUND"] as const,
  },
} as const;

/**
 * ⚠ 本束刻意**没有**的操作：二维码生成端口。Q4 已裁候选 A（二维码前端本地生成，不新增
 * 后端接口）——domain.md 不变量 3 逐字要求「审查其中不包含任何『生成二维码图片』的端口定义」，
 * 这条注释就是那条不变量在契约文件里的落点。
 */
export const NO_QR_GENERATION_ENDPOINT = true as const;

/**
 * 已知契约缺口（对齐 `materials.ts`/`project.ts` `KNOWN_CONTRACT_GAPS` 惯例，
 * 缺口显式登记而非静默略过）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * `recordCheckinEvent` 依赖 phase-01 01-auth 的「分组链接免注册进场」校验结果
   * （`uc-1-2-用分组链接免注册进场.md`），但截至本文件落地，该能力域在
   * `packages/contracts/src/auth.ts` 里**没有**对应的分组链接校验操作——
   * 是文档已 spec 但实现/契约均缺失，还是已在别处以其它形态存在，需要 phase-01 团队确认；
   * 在此之前 F06 的「链接校验结果无效」错误码与写入触发时机都只能是本文件当前的占位形状。
   */
  C1_GROUP_LINK_VALIDATION_SOURCE_MISSING:
    "见 design-signoff.md『签核前请重点确认』第一条；phase-01 01-auth uc-1-2 尚无可调用的真实接口，" +
    "auth.ts 里未找到分组链接校验操作，F06 实现前需先确认该能力域的真实落点",
  /**
   * 到场事件写入时机（点开链接瞬间 / 链接页面加载完成后）——domain.md「[待定] 未决项」
   * 逐字未区分，两种口径在网络慢场景下会导致到场数漂移，实现时需先定这一条再写断言。
   */
  C2_ARRIVAL_WRITE_TIMING: "见 domain.md『[待定] 未决项』第二条",
} as const;
