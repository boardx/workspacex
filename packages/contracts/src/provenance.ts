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

  /* ── phase-01 补齐的成员（ADR-101，需人类追认）────── */
  /**
   * 🔴 以下成员由 **ADR-101** 一次性补齐，覆盖 `design-coherence.md` **XC-10** 记录的同一个根：
   * 本枚举由 identity + artifact **两束**合并而成，而 phase-01 有十个束要写审计事件，
   * 三个束（`files` / `interview` / `project`）各自撞上「已签核的 UC 要求写审计、
   * 枚举里没有可写的类型」，且**三个 feature 用了三种处理方式**。
   *
   * ⚠ **本文件第 18 行写着「新增走 ADR」，所以这些成员的出处就是 ADR-101，
   *   而 ADR-101 的状态是 Proposed —— `provenance` 属已签核的 phase-00 束，需人类追认。**
   *   否决时的回退动作写在 ADR-101 的「后果」一节。
   */

  /**
   * 单个原件下载（F32 / `files`）。
   *
   * 已签核的 `contracts/files/usecases.md` 在 `issueDownloadUrl` 下逐字：
   * 「下载动作写 `provenance_events`（17-gov/UC-17.1 四类事件之一）」；
   * `files.ts` 的 `issueDownloadUrl` 长注与 `requirements/22-files/uc-22-1` 第 98 行同义。
   * ⚠ 最接近的 `local-export` **不是**它：那是「本地组织 → 正式组织的导出（F17）」，
   *   一次组织迁移。拿它兜下载会让「材料出域了吗」在同一个类型里混进两件不相干的事。
   */
  "downloaded",

  /* ── project 束：项目生命周期（`project.ts` P3 / XC-10 逐字四值）── */
  /**
   * ⚠ 这四个是**代 F117 补的**，不是 F32 用的。出处是 `packages/contracts/src/project.ts:767`
   * （`KNOWN_CONTRACT_GAPS.P3`）与 `design-coherence.md` XC-10 的「⚠ 一条必须一起处置的缺口」，
   * 两处逐字列的就是这四个名字。`project` 束四个操作都返回 `provenanceEventId`，
   * 而封闭枚举里没有对应类型 ⇒ 那四条审计写不进去。
   * ⇒ 名字**照抄**那两份文档，不重新发明；F117 落地时应当直接用得上，用不上说明抄错了。
   */
  "project-created",
  "project-archived",
  "project-unarchived",
  "agenda-segment-state-changed",

  /* ── chat 束：线程生命周期（`chat.ts` C_CHAT_5 / F109 报）── */
  /**
   * ⚠ 这三个是**代 F109 补的**。F109 现在把三种线程动作全写成 `human-edited`
   * （常量 `CHAT_LIFECYCLE_AUDIT_TYPE`，源码里标红），因为枚举里没有可写的类型。
   *
   * 🔴 **三个分开，不合并成 `thread-changed` + `detail.op`。**
   *   uc-8-1 R7 逐字要求「任何覆盖、删除、撤销……都必须记录审计事件」，
   *   而把删除混进一个通用 `changed` 里靠 detail 区分，意味着「查所有删除」得先解析 jsonb ——
   *   `queryProvenance` 的筛选面上**没有那个能力**，于是那条查询在契约层根本不存在。
   * ⚠ 命名照现有成员的构词法「对象-过去分词」（`capability-added` / `role-changed`）。
   * ⚠ F109 的第四条（被拒的写尝试）**不在这里**：`unauthorized-attempt` 语义本来就对。
   */
  "thread-created",
  "thread-renamed",
  "thread-deleted",

  /* ── 安全审计（两束共用）──────────────────────────── */
  "unauthorized-attempt", // 越权尝试：被拒的动作也必须留痕
]);

export type ProvenanceEventTypeT = z.infer<typeof ProvenanceEventType>;

/**
 * 事件指向的对象种类 —— **封闭枚举，与 `ProvenanceEventType` 是两件事**。
 *
 * ⚠ 提成常量是 ADR-101 顺手收的一处「同一事实两处」：这份取值原先在
 * `ProvenanceEvent.target.kind` 与 `queryProvenance.in.targetKind` **各写了一遍**，
 * 而 `queryProvenance` 只能按 target 过滤 ⇒ 两处一旦漂移，
 * 表现是「某类事件写得进去、查不出来」，且两边各自看都是自洽的。
 *
 * 🔴 `interview` 由 ADR-101 补入，见 `ProvenanceEvent.target` 的长注（F80 报告的缺口）。
 * ⚠ 新增成员与 `ProvenanceEventType` 同一纪律：**走 ADR**。
 */
export const ProvenanceTargetKind = z.enum([
  "artifact", "artifact-version", "capability", "membership", "project", "organization",
  /** 代 F80 补：没有它，「这一场访谈被谁探过」查不出来。见 `ProvenanceEvent.target` 长注 */
  "interview",
  /**
   * 代 F109 补。规矩来自 `application/provenance/record-audit.ts` 头部：
   * **「target 是验收标准说你按什么去搜的那个东西」**——uc-8-1 R7 的检索面是
   * 「操作者 / 时间 / **对象** / 结果」，这里的对象是线程，不是项目。
   *
   * 🔴 **但改成 `thread` 会暴露一个 `queryProvenance` 本身的洞，见 ADR-101 第二节。**
   *   `chat.queryChatAuditEvents` 是**按项目**列的（`/chat/projects/:projectId/audit-events`），
   *   而 `queryProvenance` 只按 `(targetKind, targetId)` 筛 —— target 一旦是 `thread`，
   *   「列出本项目下的全部对话审计」就没有可筛的列了，projectId 只活在 `detail` 这个
   *   `z.record` 里。⚠ 这条**未裁**：ADR-101 列出三条出路并推荐 A，但不替人选。
   */
  "thread",
]);

export type ProvenanceTargetKindT = z.infer<typeof ProvenanceTargetKind>;

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
  /**
   * 被作用的对象。不同事件类型指向不同东西，故用通用二元组而非 artifactId 单列。
   *
   * 🔴 `interview` 由 **ADR-101** 补入，与上面那批同一个根（XC-10），但**缺的是另一个枚举**——
   * 这是 F80 报上来的：`apps/api/src/application/interview/get-interview.ts` 文件头逐字写着，
   * 非协作者按 ID 直读被拒时那条 `unauthorized-attempt` 只能把 target 记成 `organization`、
   * 把 `interviewId` 塞进 `detail`，于是「**这一场访谈被谁探过**」查不出来，
   * 只能查「这个组织里有谁被拒过」。`queryProvenance` 只能按 target 过滤，所以这不是美观问题。
   * ⚠ F80 当时**没有自行改契约**（跨束、已签核），选择报告；ADR-101 是那份报告的落点。
   */
  target: z.object({ kind: ProvenanceTargetKind, id: z.string() }).strict(),
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
      /** ⚠ 同一份取值，**引用**而不是再抄一遍——见 `ProvenanceTargetKind` 的长注 */
      targetKind: ProvenanceTargetKind.optional(),
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
