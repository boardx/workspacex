/**
 * 契约 ↔ 视图层**取值分歧登记簿** —— 唯一事实源（2026-07-31 收敛）
 *
 * ## 这份文件为什么存在
 *
 * 2026-07-30/31 新建了十一个契约文件。那些类型名此前不存在于契约里，所以
 * `apps/web/lib/mock/**` 里的手写定义一直没有碰撞；**契约一声明，手写副本立刻
 * 成为 `lint-contract-source` 的违规**（31 处）。逐条比对后分三类处置：
 *
 * - **① 真重复**（字段/取值完全相同）⇒ 改为 `z.infer` 从契约派生。
 * - **② 同名不同义**（结构不同，是渲染视图或另一个实体）⇒ **改名而不是合并**。
 * - **③ 同名不同义 _且取值也不一致_** ⇒ 改名 **＋ 登记进本文件，等人裁**。
 *
 * 本文件只装第 ③ 类。**它们是签核动作，agent 不许自己选边**——
 * `closed-api` 与 `hosted-api` 是两个不同的词，谁对不是代码问题。
 *
 * ## 为什么登记簿而不是在每个改名处写对照表
 *
 * 十五条分歧 × 每处一份对照表 = 十五份会各自漂移的副本。本仓已**九次**因
 * 「同一事实声明在两处」漂移（设计 token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA /
 * 估点 …），`AGENTS.md` 的硬约束逐字写着「凡出现第二份副本，一律收敛为单一事实源
 * ＋ 机械门控」。⇒ **对照表只在这里有一份**，改名处只写 `见 CONTRACT_DIVERGENCES.D07`。
 *
 * ## 怎么消费它
 *
 * 人类在对应束的 `design-signoff.md` 上裁决「哪边对」之后：
 * - 判**契约对** ⇒ 视图层删掉 `*View` 类型，改为 `z.infer<typeof C.X>`，本条目删除。
 * - 判**视图对** ⇒ 由**人类**改契约（agent 不许改 `packages/contracts/src/**`），
 *   再走同样的派生化，本条目删除。
 * 登记簿清空之日 = 视图层与契约完全同源之日。**空集不是胜利，是没写**——
 * 每一条被删都必须有对应裁决记录。
 */

/** 一条分歧的形状。`contract` 恒为权威侧的字面取值，`view` 恒为 `apps/web` 侧现状。 */
export interface ContractDivergence {
  /** 契约里的类型名（视图侧已改名，此处仍记原名，方便回查 lint 输出） */
  readonly contractType: string;
  /** 契约文件（`packages/contracts/src/<file>.ts`） */
  readonly contractFile: string;
  /** 归属契约束目录名（`phases/phase-01-run-a-project/contracts/<bundle>/`） */
  readonly bundle: string;
  /** 视图侧改名后的类型名与所在文件 */
  readonly viewType: string;
  readonly viewFiles: readonly string[];
  /** 契约侧取值（权威） */
  readonly contractValues: readonly string[];
  /** 视图侧取值（现状） */
  readonly viewValues: readonly string[];
  /** 分歧到底是什么——一句话，不要写成「不一致」这种同义反复 */
  readonly divergence: string;
  /** 交给人类的那个问题。⚠ 必须是可回答的二选一或多选一，不是「请评估」 */
  readonly question: string;
}

export const CONTRACT_DIVERGENCES = {
  /* ── agent-runtime 束 ───────────────────────────────────────────── */

  D01: {
    contractType: "ModelKind",
    contractFile: "agent-runtime.ts",
    bundle: "agent-runtime",
    viewType: "ModelKindView",
    viewFiles: ["apps/web/lib/mock/admin.ts"],
    contractValues: ["closed-api", "self-hosted"],
    viewValues: ["hosted-api", "self-hosted"],
    divergence:
      "闭源那一档的码不同：契约 `closed-api`（按「源码是否开放」分），视图 `hosted-api`（按「谁托管」分）。两个词切的是不同的刀口，不是拼写差异。",
    question:
      "模型的二分维度按源码开放性（closed-api / self-hosted）还是按托管方（hosted-api / self-hosted）？后者会让「开源但用厂商托管 API」无处安放。",
  },

  D02: {
    contractType: "ModelStatus",
    contractFile: "agent-runtime.ts",
    bundle: "agent-runtime",
    viewType: "ModelStatusView",
    viewFiles: ["apps/web/lib/mock/admin.ts"],
    contractValues: ["待测试", "已启用", "已停用", "依赖失败"],
    viewValues: ["untested", "enabled", "disabled"],
    divergence:
      "视图少一个 `依赖失败`。缺它时「端点挂了」会显示成「已停用」——故障与人为停用在界面上无法区分。",
    question: "模型列表是否呈现 `依赖失败` 第四态？（契约有，原型界面未见对应徽标）",
  },

  D03: {
    contractType: "McpReviewStatus",
    contractFile: "agent-runtime.ts",
    bundle: "agent-runtime",
    viewType: "McpReviewStatusView",
    viewFiles: ["apps/web/lib/mock/admin.ts"],
    contractValues: ["待安全评审", "已放行", "维持隔离", "有条件放行", "已到期待复核"],
    viewValues: ["pending", "cleared"],
    divergence:
      "视图只有二值（待评审 / 已放行），契约五值。缺失的三个都是有独立处置动作的态：`维持隔离` 与 `已放行` 的反面不是同一件事，`已到期待复核` 与 `待安全评审` 混一起会让到期服务器静默无人处理（契约注释 F131 逐字写了这条）。",
    question:
      "MCP 评审状态在后台列表上是五态还是二态？若二态，`维持隔离` / `有条件放行` / `已到期待复核` 在哪个界面处置？",
  },

  D04: {
    contractType: "AgentPresence",
    contractFile: "chat.ts（另 agent-runtime.ts 亦声明同名类型，见 divergence）",
    bundle: "chat",
    viewType: "AgentPresenceView",
    viewFiles: ["apps/web/lib/mock/chat.ts"],
    contractValues: ["present", "away", "off"],
    viewValues: ["present", "batching", "idle"],
    divergence:
      "三值对三值但只有 `present` 重合。视图的 `batching`（跑批中）在契约 chat 束里根本没有落点，而它正是 UC-4.2 R6「编制数 ≠ 在场数」的分母来源。🔴 更严重：`AgentPresence` 在契约里被声明了两次——`chat.ts` 是 3 值枚举，`agent-runtime.ts:607` 是对象且内含 `presence: [在场, 静音, 跑批中, 依赖失败]`（4 值中文）。这是契约侧自己的冲突，不是视图侧造成的。",
    question:
      "① 契约两处同名 `AgentPresence` 先合一（谁保留、谁改名）；② 合一后的取值集合是 3 值英文、4 值中文，还是含 `batching` 的第三种？",
  },

  /* ── chat 束 ────────────────────────────────────────────────────── */

  D05: {
    contractType: "ChatVisibility",
    contractFile: "chat.ts",
    bundle: "chat",
    viewType: "ChatVisibilityView",
    viewFiles: ["apps/web/lib/mock/chat.ts"],
    contractValues: ["member-private", "group-shared", "plenary", "team-visible", "private"],
    viewValues: ["member-private", "group-shared", "all-hands", "team-visible", "private"],
    divergence:
      "五对五、四个逐字相同，只有「全场」那一档码不同：契约 `plenary`，视图 `all-hands`。纯命名分歧，但落到线上就是两个不同的字符串。",
    question: "「全场」的线上码取 `plenary` 还是 `all-hands`？（本条只需选词，无语义争议）",
  },

  D06: {
    contractType: "MessageBadge",
    contractFile: "chat.ts",
    bundle: "chat",
    viewType: "MessageBadgeView",
    viewFiles: ["apps/web/lib/mock/chat.ts"],
    contractValues: ["degraded", "review-pending"],
    viewValues: ["degraded", "review"],
    divergence:
      "契约是裸枚举，视图是带载荷的可辨识联合（`{kind:'degraded', model}` / `{kind:'review', count}`）。载荷差异属正常的视图投影（②类），但 `review` vs `review-pending` 的码不同属取值分歧——而且徽标上要显示的「待复核 3」那个 3，契约里没有字段承载。",
    question:
      "① 码取 `review` 还是 `review-pending`？② 徽标载荷（降级用的 `model`、待复核的 `count`）由服务端给还是前端自算？契约现在两者都不给。",
  },

  D07: {
    contractType: "ApprovalStatus",
    contractFile: "chat.ts",
    bundle: "chat",
    viewType: "ApprovalStatusView",
    viewFiles: ["apps/web/lib/mock/chat.ts"],
    contractValues: ["paused", "approved", "reparamed", "declined", "expired"],
    viewValues: ["paused", "approved", "declined", "expired"],
    divergence:
      "视图是契约的真子集，少 `reparamed`（改参后批准）。契约把「三出口」写成 `ApprovalExit = [approve, reparam, decline]`，改参是一等出口；视图里改参后的卡片没有可落的状态。",
    question:
      "批准卡改参（`reparam`）后停在哪个状态？沿用契约的 `reparamed` 独立态，还是并入 `approved`（则审计里分不出是否改过参）？",
  },

  /* ── skills 束 ──────────────────────────────────────────────────── */

  D08: {
    contractType: "SkillStatus",
    contractFile: "skills.ts",
    bundle: "skills",
    viewType: "SkillStatusView",
    viewFiles: ["apps/web/lib/mock/skill.ts", "apps/web/lib/mock/admin.ts"],
    contractValues: ["草稿", "待审核", "被退回", "已启用", "已停用"],
    viewValues: ["draft", "review", "enabled", "disabled"],
    divergence:
      "🔴 两侧都写了「封闭集合，不得增删」，但数量不同：契约五值（含 `被退回`），视图四值且注释逐字写「O-11：恰四态」「没有『已发布』取值」。缺 `被退回` 时，审核打回的 skill 只能退回 `draft`，于是「从没提交过」与「提交被打回」在列表上一样。中英文取值也不同源。",
    question:
      "Skill 状态机是四态还是五态（`被退回` 是否独立成态）？取值用中文还是英文码？O-11 的「恰四态」与契约五值必须有一方作废。",
  },

  D09: {
    contractType: "SkillSource",
    contractFile: "skills.ts",
    bundle: "skills",
    viewType: "SkillSourceView",
    viewFiles: ["apps/web/lib/mock/skill.ts"],
    contractValues: ["自建", "晋升生成", "CC"],
    viewValues: ["self", "cc", "canvas", "community", "promoted"],
    divergence:
      "视图多两档：`canvas`（画布来源）与 `community`（社区导入）。`community` 视图侧已标 `COMMUNITY_DISABLED = true`（D-06 判 phase-1 不实现，入口置灰）——保留取值但不实现与契约里根本没有这个取值是两种不同的承诺。`canvas` 在契约里则毫无踪迹。",
    question:
      "来源标记是三档还是五档？`community` 既然 phase-1 不实现，取值是先进契约（置灰）还是等实现时再加？`canvas` 来源是否真实存在（原型有无出处）？",
  },

  /* ── asset-governance 束 ────────────────────────────────────────── */

  D10: {
    contractType: "AssetKind",
    contractFile: "asset-governance.ts",
    bundle: "asset-governance",
    viewType: "AssetKindView",
    viewFiles: ["apps/web/lib/mock/asset-governance.ts"],
    contractValues: ["agent", "skill", "model", "mcp", "canvas-template", "blueprint"],
    viewValues: ["agent", "skill", "model", "mcp", "canvas", "blueprint"],
    divergence:
      "六对六，只有第五档码不同：契约 `canvas-template`，视图 `canvas`。⚠ 这条不是纯命名——`canvas` 在本仓另有一个已建成的束（协作画布实例），用裸 `canvas` 当资产类型会与它撞名。",
    question: "画布模板资产的码取 `canvas-template` 还是 `canvas`？（后者与 canvas 束的画布实例同名）",
  },

  /* ── recording 束 ───────────────────────────────────────────────── */

  D11: {
    contractType: "SegmentStatus",
    contractFile: "recording.ts",
    bundle: "recording",
    viewType: "SegmentStatusView",
    viewFiles: ["apps/web/lib/mock/rec.ts"],
    contractValues: ["partial", "final", "pending-manual", "disputed"],
    viewValues: ["final", "partial", "low-confidence", "pending-manual"],
    divergence:
      "🔴 四对四但各有一个对方没有的态：契约有 `disputed`（同一段被多人认领，UC-5.2 E1），视图有 `low-confidence`（识别置信度低待校对，UC-5.1 E7）。两个都有 UC 出处。且 `apps/web/lib/mock/interview.ts` 里的同名类型与契约完全一致（已改为派生）——⇒ 视图层内部原本就有两份互相矛盾的 SegmentStatus。不可引述集合因此也有两份：视图 `UNQUOTABLE_STATUSES = [partial, low-confidence, pending-manual]`，契约侧对应集合无 `low-confidence`、多 `disputed`。",
    question:
      "转写段状态是几态？`low-confidence` 与 `disputed` 是否都要（则五态），还是其中之一并入别处？「不可引述」的判据集合随之定。",
  },

  D12: {
    contractType: "EvidenceNature",
    contractFile: "recording.ts",
    bundle: "recording",
    viewType: "EvidenceNatureView",
    viewFiles: ["apps/web/lib/mock/rec.ts"],
    contractValues: ["个人经历", "二手转述", "观点"],
    viewValues: ["personal", "secondhand", "opinion"],
    divergence:
      "语义 1:1 对应（视图的 `EVIDENCE_NATURE_LABEL` 映射出的正是契约那三个中文字面值），分歧只在线上码用中文还是英文。单看这一条是小事；但契约整体在这件事上不自洽——`SkillStatus` / `GroupStatus` / `McpReviewStatus` 用中文字面值，`ChatVisibility` / `SegmentStatus` / `BlueprintState` 用英文码。",
    question:
      "🔴 建议作为阶段一致性复核的一条通则来裁，而不是逐个枚举裁：契约枚举的线上码统一用英文（中文只做 label），还是允许按域混用？现状是混用且无成文规则。",
  },

  /* ── files 束 ───────────────────────────────────────────────────── */

  D13: {
    contractType: "PreviewKind",
    contractFile: "files.ts",
    bundle: "files",
    viewType: "PreviewKindView",
    viewFiles: ["apps/web/lib/mock/files.ts"],
    contractValues: ["pdf", "image", "audio", "text", "jsonl", "unsupported"],
    viewValues: ["pdf", "image", "audio", "text", "markdown", "jsonl", "csv", "unsupported"],
    divergence:
      "视图多 `markdown` 与 `csv`。这不是装饰：契约下这两类文件会落进 `unsupported`（界面显示「不支持预览」），而视图侧是能预览的——同一个 .md 文件在两套定义下用户看到的东西不同。",
    question:
      "`markdown` / `csv` 是否有独立预览器？有 ⇒ 契约补两个取值；无 ⇒ 视图删掉、它们走 `text` 或 `unsupported`（走哪个也要定）。",
  },

  /* ── templates 束 ───────────────────────────────────────────────── */

  D14: {
    contractType: "BlueprintState",
    contractFile: "templates.ts",
    bundle: "templates",
    viewType: "BlueprintStateView",
    viewFiles: ["apps/web/lib/mock/tpl.ts"],
    contractValues: ["draft", "published", "archived"],
    viewValues: ["draft", "published"],
    divergence:
      "视图少 `archived`。契约对归档有明确不变量（「归档不影响可达性，已套用项目仍可实例化」I-7），视图的蓝本列表则没有归档态可渲染——归档蓝本要么消失、要么显示成 `published`，两种都与 I-7 冲突。⚠ 另注：同仓 `apps/web/lib/mock/canvas.ts` 的 `PublishStatus` 是四段（草稿/试跑/已发布/已归档），与这两者又都不同。",
    question:
      "蓝本列表是否呈现 `archived` 行？若呈现，它与 canvas 侧 `PublishStatus` 的 `试跑` 档是否要对齐成同一状态机？",
  },

  D15: {
    contractType: "DurationTier",
    contractFile: "templates.ts",
    bundle: "templates",
    viewType: "DurationTierView",
    viewFiles: ["apps/web/lib/mock/tpl.ts"],
    contractValues: ["half-day", "one-day", "two-day", "three-day", "custom"],
    viewValues: ["half-day", "one-day", "two-day", "three-day"],
    divergence:
      "视图少 `custom`。契约那边 `custom` 是故意留的拒绝出口：`CUSTOM_TIER_RULE_UNDEFINED`（D-7「宁可拒绝也不猜一个推导式」）。视图层几张按档位索引的表（`AGENDA_COUNT_BY_TIER` 7/11/14/19、`TIER_HALF_SESSIONS`）在 `custom` 下根本没有值可填——这正是契约拒绝它的理由，所以视图的四档不是遗漏，是被动躲开了。",
    question:
      "`custom` 档在界面上是否可选？可选 ⇒ 选中后议程环节数怎么显示（契约当前是拒绝，界面需要一个「待你手动排」的态）；不可选 ⇒ 契约的 `custom` 取值目前无入口，应否删除。",
  },
} as const satisfies Record<string, ContractDivergence>;

export type ContractDivergenceId = keyof typeof CONTRACT_DIVERGENCES;

/** 按契约束分组，供签核时逐束过一遍。 */
export function divergencesByBundle(bundle: string): ContractDivergence[] {
  return Object.values(CONTRACT_DIVERGENCES).filter((d) => d.bundle === bundle);
}

/**
 * 🔴 **契约侧自身的问题**（视图层不能改，登记在此供人类裁决）：
 *
 * 1. `AgentPresence` 在 `chat.ts` 与 `agent-runtime.ts` 各声明一次，形状完全不同
 *    （3 值枚举 vs 含 4 值中文 `presence` 字段的对象）。见 D04。
 * 2. `Quote` 在 `interview.ts:304` 与 `recording.ts:283` 各声明一次，字段不同。
 *    `lint-contract-source` 把契约名收进同一个扁平集合，因此这两处对视图层而言
 *    是**同一个名字**——视图侧无法分别派生。
 * 3. 枚举线上码中英文混用且无成文规则。见 D12。
 *
 * ⚠ 以上三条**必须由人类改 `packages/contracts/src/**`**（ADR-020：签核过的契约只有人能改）。
 */
export const CONTRACT_SIDE_ISSUES = [
  "AgentPresence 在 chat.ts 与 agent-runtime.ts 重复声明且形状不同",
  "Quote 在 interview.ts 与 recording.ts 重复声明且字段不同",
  "枚举线上码中英文混用，无成文规则",
] as const;
