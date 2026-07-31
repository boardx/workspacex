/**
 * `provenance_events` —— **跨束共享契约**（一致性复核 B-1 / X-2）
 *
 * ## 为什么它不属于任何单束
 * `identity` 与 `artifact` **都要写**这张表：
 *   · identity：能力清单增删、角色/团队变更、管理员项目访问、本地→正式组织导出
 *   · artifact：回流、定版、绑定升级、证据撤回、越权尝试
 * 但两束都只返回 `provenanceEventId`，**谁都没定「怎么查」**。
 *
 * artifact 束自己建了一份 `queryProvenance`，并在注释里写着
 * 「⚠ 跨束：identity 的 mutateCapability 也写 provenance_events，
 *   这应是**统一的**查询面，不要每束各造一个」——它自己就指出了问题。
 *
 * ⇒ 查询面提取到这里。两束只负责**写入时声明自己的事件类型**，不各造查询接口。
 * 不这么做的后果：两个 `queryProvenance` 各有各的过滤参数与返回形状，
 * 之后合并是返工，而在合并之前「查审计」这件事对使用者是分裂的。
 *
 * ## 事件类型是封闭枚举，新增走 ADR
 * 理由同丢弃原因（D-U4）：它是「谁在什么时候动了什么」的**可审查性**，不是日志。
 * 开放结构必然长出几十种说法，到时「这个动作有没有留痕」又变成不可回答的问题。
 */
import { z } from "zod";

/**
 * 全部事件类型 —— **两束合并后的封闭枚举**。
 * 分组只是可读性，运行时是一个平坦枚举（查询时按前缀过滤即可）。
 */
export const ProvenanceEventType = z.enum([
  /* ── artifact 束：血缘 ────────────────────────────── */
  "ingested", // 摄取
  "transformed", // 转换（OCR/ASR/摘要/embedding）
  "generated", // AI 生成
  "human-edited", // 人工编辑草稿
  "pinned", // 定版（生成不可变版本）
  "bound", // 绑定到项目环节
  "unbound", // 解绑
  "superseded", // 被新版本替代（纠错只能新增版本 + 标注被替代）
  "evidence-withdrawn", // 上游证据撤回（不改快照，标注引用处）

  /* ── identity 束：治理 ────────────────────────────── */
  "capability-added", // 能力清单新增（agent/skill/model/mcp/模板/蓝本）
  "capability-updated", // 能力配置变更
  "capability-disabled", // 能力停用（含 interrupt / drain 模式，见 D-U5）
  "role-changed", // 组织角色或项目角色变更
  "team-changed", // 团队归属变更
  "admin-project-access", // 管理员以审计目的读取项目内容（D-18：必留痕且对负责人可见）
  "local-export", // 本地组织 → 正式组织的导出（F17，隐私承诺的唯一豁口）

  /* ── files 束：交付 ────────────────────────────────── */
  /**
   * 🔴 单个原件下载（F32）。**这条是本文件「新增走 ADR」那条纪律的一次欠账，需人类追认。**
   *
   * 为什么必须补：本枚举是 identity + artifact **两束**合并而成，而 files 束成文在后。
   * 已签核的 `contracts/files/usecases.md` 在 `issueDownloadUrl` 下逐字写着
   * 「下载动作写 `provenance_events`（17-gov/UC-17.1 四类事件之一）」，
   * `packages/contracts/src/files.ts` 的 `issueDownloadUrl` 长注同义，
   * `requirements/22-files/uc-22-1-项目文件浏览器.md` 第 98 行同义——
   * 三处都要求下载留痕，而**枚举里没有任何一个成员表示下载**。
   *
   * ⚠ 最接近的 `local-export` 不是它：那是「本地组织 → 正式组织的导出（F17）」，
   *   一个组织迁移动作。拿它兜下载，会让「材料出域了吗」这个问题在同一个类型里
   *   混进两种毫不相干的事件，而这正是本文件开头说的「封闭枚举」要防的东西。
   *
   * ⇒ 这不是「两套方案待裁」，是一个**漏项**：规范齐全、类型缺席。补上它 F32 的
   *   「写审计」才落得了地；不补的话那条 feature 的三条安全性质少一条。
   *   但补的动作本身违反了本文件第 18 行的流程要求，所以它**大声记在这里**，
   *   请求 ADR 追认，而不是安静地混进列表。
   */
  "downloaded",

  /* ── 安全审计（两束共用）──────────────────────────── */
  "unauthorized-attempt", // 越权尝试：被拒的动作也必须留痕
]);

export type ProvenanceEventTypeT = z.infer<typeof ProvenanceEventType>;

/**
 * 一条血缘/审计事件。
 *
 * ⚠ **append-only：无 UPDATE、无 DELETE。** 越权尝试也写这里——
 * 「被拒绝的动作没有留痕」等于攻击者可以无成本地反复试探。
 */
export const ProvenanceEvent = z.object({
  id: z.string(),
  type: ProvenanceEventType,
  actorId: z.string(),
  /** ISO 8601 */
  at: z.string(),
  /** 事件归属的组织；查询必按它做租户隔离（RLS 层强制） */
  orgId: z.string(),
  /** 被作用的对象。不同事件类型指向不同东西，故用通用二元组而非 artifactId 单列 */
  target: z.object({
    kind: z.enum(["artifact", "artifact-version", "capability", "membership", "project", "organization"]),
    id: z.string(),
  }).strict(),
  /** 动作的影响范围 / 前后值等，按 `type` 解释；越权尝试记录目标与被拒原因 */
  detail: z.record(z.unknown()),
}).strict();

export const operations = {
  /**
   * queryProvenance —— **唯一的**审计检索面（两束共用）。
   *
   * ⚠ 权限：查询本身受两层交集鉴权约束，且**管理员查询他人个人层只返回计数**
   * （D-18 / identity 的 I-8）——本操作不绕过那条边界。
   */
  queryProvenance: {
    method: "GET",
    path: "/provenance",
    in: z.object({
      orgId: z.string(),
      /** 不传则查全部类型；传了则按类型过滤（如只看安全审计） */
      types: z.array(ProvenanceEventType).optional(),
      actorId: z.string().optional(),
      targetKind: z.enum(["artifact", "artifact-version", "capability", "membership", "project", "organization"]).optional(),
      targetId: z.string().optional(),
      /** ISO 8601 区间 */
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
      cursor: z.string().optional(),
    }).strict(),
    out: z.object({
      events: z.array(ProvenanceEvent),
      nextCursor: z.string().nullable(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },
} as const;
