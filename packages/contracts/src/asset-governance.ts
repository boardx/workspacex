/**
 * 契约束 `asset-governance` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份。
 * 覆盖 feature：见 `contracts/asset-governance/design-signoff.md` frontmatter `covers:`（权威）。
 * 依据：同目录 `usecases.md` / `domain.md`，需求 `requirements/23-asset/`。
 *
 * ## 范围由 Q-0 裁死，本文件**只写 phase-1 那一半**
 *
 * `requirements/23-asset/DECISION-Q0.md` 已裁 **方案 C（拆）**：
 *   · **phase-1 保留**：资产目录浏览编辑（`uc-23-3`）· 治理与发布（`uc-23-4`）·
 *     复核到期与降级（`uc-23-6`）· 后台外壳与左栏 IA（`uc-23-8`）
 *   · **phase-2 推迟**（随 D-06）：外部社区导入（`uc-23-1` / `uc-23-7`）·
 *     落地检查六道关（`uc-23-2`）· 沙箱试跑（第 05 关 / `uc-23-5`）
 *
 * ⚠ **推迟掉的那一半在本文件里没有操作，这是结论不是遗漏。**
 *   `usecases.md` 第二节把它们逐条列了出来——**列出来是为了让「推迟掉的是什么」可见，
 *   不是为了让它看起来已经定了**。本文件把它们登记进 `DEFERRED_TO_PHASE_2`，
 *   **不写进 `operations`**：写进去就是把未定的范围伪装成已定。
 *
 * ## 核心不变量（domain.md 有断言方式）
 *   · **I-1 / I-2**：`AssetKind` 恰六值，且**左栏「AI 能力」组的项集合 ＝ 该六值**（**双向相等**）。
 *     单向断言在今天的代码上就是绿的（左栏只有 4/6），所以**必须双向 + 反证**。
 *   · **I-10**：治理三项（可见范围 / 谁能改 / 负责人）＋ 复核周期**四个字段齐全**才可发布。
 *     ⚠ **四个字段各造一次缺失**——缺一个就漏一条路径。
 *   · **I-14 / I-15**：降级走**与发布相同的可见性写入路径**（无第二条后门）；
 *     且**零调用的到期资产也会被降级**（这一条专门反证「惰性判定」）。
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *   · `ReviewAsset.conclusion` 的**取值集合** —— `uc-23-6` R7 规则 8 是本束最大空白，
 *     「复核」这个动作具体做什么，原型 0 命中。**本束不发明取值集合**（`AG2`）。
 *   · `PublishAsset(mode: "staged")` 的**行为** —— 语义待 Q-3。
 *     保留参数、不定义行为；**定义它就是替人类裁 Q-3**。
 *   · `WriteAssetFile` 触发 02 关重扫的**副作用** —— I-25 待人类确认。
 *     不做这条，六道关在导入之后即可绕过。**这是一个已知的洞，不是遗漏**（`AG6`）。
 *   · **并发编辑**语义 —— 默认「后写覆盖」会静默丢数据，**不该由实现者定**（`AG5`）。
 */
import { z } from "zod";
import { PermissionReason } from "./identity";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/**
 * **恰六个取值的封闭枚举**（domain I-1）。本束是横切这六类的**公共机制**，
 * 不是第七类资产，也不是任何一类资产的领域模型。
 *
 * ⚠ 断言方式是**成员集合相等**，**不是** `toHaveLength(6)`（coding-standards E-4）：
 *   长度断言会在「删一个、加一个」时全绿。
 * ⚠ 原型侧的键是 `agents/skills/models/mcp/canvasadmin/blueprint`（复数 + `canvasadmin`），
 *   与这里的单数 + `canvas-template` **不同**。domain.md I-1 逐字定的是这一套，
 *   映射属界面层，**不在契约里存第二份**。
 */
export const AssetKind = z.enum(["agent", "skill", "model", "mcp", "canvas-template", "blueprint"]);

/**
 * 可见范围三取值（`uc-23-4` R3 第一项）。
 *
 * 🔴 **它不是 `identity.VisibilityScope`，字面量刻意不同名。**
 *   phase-00 那个是**两值**闭集 `{org-wide, team-only}`（已签核）；这里是**三值**，
 *   多出「仅自己-私有草稿」。若把这里也写成 `org-wide` / `team-only`，
 *   就会出现本仓第 N 次「**同名不同义**」——两个枚举同字面量、成员集合不同、
 *   而任何一处的类型检查都不会红。
 * ⚠ 「六类是否真共用这套字段」**待 Q-1b**：代码侧现状是 3/6
 *   （MCP 走已签核的 `McpAuthScope`，模型与蓝本**根本没有这个字段**）。
 *   本束按「六类统一」定义，**但它能否落地取决于 Q-1b 的裁决**（`AG1`）。
 */
export const AssetVisibility = z.enum(["specified-teams", "whole-org", "private-draft"]);

/**
 * 复核周期三档（`uc-23-4` R3 第三项，原型选中 24 个月）。
 *
 * ⚠ **三档的语义与「30 天无人复核」的语义都不在本文件定义**（I-27）：
 *   `uc-23-6` R7 是它们的**唯一文字定义处**，落点待 **Q-7**。
 *   本束是它的**消费面**。⚠ 这是本仓头号失败模式（同一事实两处，已八次）的
 *   **第九个候选现场**——凡在这里写下「30」这个数字的人，请先读 Q-7。
 */
export const ReviewCycle = z.enum(["6m", "12m", "24m"]);

/**
 * 复核时钟三态（`uc-23-6` R3 状态机）。
 *
 * `active ──到期──▶ pending-review ──30 天无人复核──▶ downgraded`
 *
 * ⚠ `pending-review` **仍可用**——不停用、不移出检索范围，只是**调用时会提示**。
 *   把它实现成「停用」会让规则从「提醒」变成「断供」，而原型逐字写的是「仍可用」。
 * ⚠ `downgraded` **不是删除**：资产仍存在、负责人仍可见（规则 7）。
 */
export const ReviewClockState = z.enum(["active", "pending-review", "downgraded"]);

/** 发布模式。⚠ `staged`（灰度）**语义待 Q-3**——保留参数，不定义行为 */
export const PublishMode = z.enum(["direct", "staged"]);

/** 文件徽标。⚠ 由扩展名派生；**未知扩展名 ⇒ `MD`（fallback 不报错）** */
export const AssetFileBadge = z.enum(["MD", "JSON", "YAML", "JS", "PY", "SH", "CSV", "JSONL"]);

type AssetFileBadgeT2 = z.infer<typeof AssetFileBadge>;

/**
 * 扩展名 → 徽标 的**唯一映射表**（`uc-23-3` R3 步骤 3 / R7 规则 4 逐字：
 * `.py → PY` · `.json/.jsonl → { }`（展示态，取值仍是 `JSON`/`JSONL`）· `.yaml/.yml → YM`
 * · **其余一律 `MD`**）。
 *
 * 单点声明，供 `apps/api`（`domain/asset/asset-file-badge.ts`）与 `apps/web` 共用——
 * 这张表本身就是本仓已经栽过五次的「同一事实两处声明」的候选现场，故不重复写第二份。
 */
const EXTENSION_BADGE: Readonly<Record<string, AssetFileBadgeT2>> = {
  json: "JSON",
  jsonl: "JSONL",
  yaml: "YAML",
  yml: "YAML",
  js: "JS",
  ts: "JS",
  py: "PY",
  sh: "SH",
  csv: "CSV",
};

/**
 * `assetFileBadgeFromPath` —— 由扩展名派生徽标，**未知扩展名 ⇒ `MD`，不报错**（
 * `uc-23-3` R7 规则 4）。空扩展名（无 `.`，或以 `.` 结尾）同样落到 `MD`——
 * 这不是特殊情形，是「未知」的一个普通子集。
 */
export function assetFileBadgeFromPath(path: string): AssetFileBadgeT2 {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "MD";
  const ext = base.slice(dot + 1).toLowerCase();
  return EXTENSION_BADGE[ext] ?? "MD";
}

/**
 * 本束的失败面。分三段：
 *   ① 与 phase-00 `identity` 束**同码同义**（`_sharedWithIdentity` 是编译期门控）
 *   ② **复用 `skills` 束**（已签核）的码——`usecases.md` 第零节「复用（不新建）」表逐条
 *   ③ 本束新增（`usecases.md`「本束新增」表逐条，每条都附过「为什么不能用既有码」）
 *
 * ⚠ **`ASSET_NOT_FOUND` 刻意没有**：不可见资产一律走 `skills` I-14 既有的
 *   「404 非 403」形状，判定函数归 phase-00 `identity`（I-26）。在这里新增一个
 *   同义码，等于给「资产存在性泄露」开第二条判定路径。
 */
export const AssetGovernanceError = z.enum([
  /* ── ① identity 束同码同义 ─────────────────────────────────── */
  "ORG_SCOPE_DENIED",
  "PROJECT_ROLE_INSUFFICIENT",
  "AUTH_SERVICE_UNAVAILABLE",

  /* ── ② skills 束（已签核）同码同义 ──────────────────────────── */
  /** 六道关有阻断却调发布（I-5）。⚠ 六道关本体属 phase-2，此码今天由**导入路径之外**触发 */
  "GATE_NOT_PASSED",
  /** 提交人 ＝ 六道关的裁决人 */
  "SELF_REVIEW_FORBIDDEN",
  /** 组织内无第二名审核人。⚠ 与上一条**必须区分**：这是组织配置问题不是越权 */
  "NO_SECOND_REVIEWER",
  /** 方法论审核人裁 02/03 关，或安全评审人裁 04 关 */
  "REVIEWER_FUNCTION_MISMATCH",
  /** 02 关判 `reject` */
  "SECURITY_SCAN_REJECTED",
  /** 编辑器保存时 frontmatter 不可解析 / 必填缺。⚠ **不入库** */
  "CONTRACT_VALIDATION_FAILED",
  /** 03 关权限越界的一个具名情形 */
  "DATA_SCOPE_EXCEEDS_SUBMITTER",

  /* ── ③ 本束新增 ──────────────────────────────────────────── */
  /**
   * 治理三项 ＋ 周期未齐（I-10）。
   * ⚠ 与 `GATE_NOT_PASSED` 是**两条独立的发布禁用条件**（原型明写两句话）——
   *   合并成一个码会让「配置没填完」与「审核没过」在界面上长成同一句话。
   */
  "GOVERNANCE_INCOMPLETE",
  /** 发布前检查存在红色未完成项。**第三条独立禁用条件** */
  "PREFLIGHT_HAS_BLOCKING_ITEM",
  /** 删 `SKILL.md` / `AGENT.md`（I-7）。目录形态特有 */
  "ROOT_FILE_UNDELETABLE",
  /** 调用方不在 `editableBy` 集合内 ⇒ 只读态（无 `[保存]`）。⚠ 与「不可见」不同 */
  "ASSET_NOT_EDITABLE",
  /**
   * 降级终态但 `ownerId` 已停用。
   * ⚠ **`uc-23-6` E1 的洞**：兜底接管人 `[待确认]`。
   *   本束**只把这个态表达出来**（无主资产提示 + 接管入口），不发明接管规则。
   */
  "ASSET_DOWNGRADED_OWNER_MISSING",
]);

type AssetGovernanceErrorT = z.infer<typeof AssetGovernanceError>;
type PermissionReasonT = z.infer<typeof PermissionReason>;

/**
 * **跨束同码同义的编译期门控**（`pnpm --filter @repo/contracts run typecheck` 会红）。
 *
 * 交集类型只接受**两个枚举都有**的字面量：任何一侧改名，这里立刻不通过类型检查。
 *
 * ⚠ **只覆盖 identity 那一段。** 第 ② 段（`skills` 束的七个码）**今天没有这道门**：
 *   `packages/contracts/src/skills.ts` 在本 worktree 里还不存在（该束由并行的另一位
 *   作者在写）。⇒ 登记为 `KNOWN_CONTRACT_GAPS.AG7`，那里写着 skills.ts 落地后
 *   要补的那一行**逐字长什么样**——不写下来，它就会一直是「以后再说」。
 */
const _sharedWithIdentity = [
  "ORG_SCOPE_DENIED",
  "PROJECT_ROLE_INSUFFICIENT",
  "AUTH_SERVICE_UNAVAILABLE",
] as const satisfies readonly (PermissionReasonT & AssetGovernanceErrorT)[];

/**
 * **随 Q-0 推迟到 phase-2 的端口**（`usecases.md` 第二节逐条）。
 *
 * 写在这里而不是删掉：**让「推迟掉的是什么」保持可见**。
 * ⚠ 这不是 backlog，是**范围裁决的落地形式**——
 *   `operations` 里出现其中任何一个，都表示有人绕过了 Q-0/D-06。
 */
export const DEFERRED_TO_PHASE_2 = [
  { port: "CreateDraftFromSource", uc: "uc-23-1", why: "仓库导入 / .zip 上传 / 外部社区导入" },
  { port: "DetectAssetKind", uc: "uc-23-1", why: "多文件包解析" },
  { port: "RunLandingChecks(01-04,06)", uc: "uc-23-2", why: "只在外来资产上有意义" },
  { port: "RunLandingChecks(05)", uc: "uc-23-2", why: "沙箱试跑 —— D-06 逐字「phase-1 不做沙箱、不执行任意代码」" },
  { port: "ResolveDedupConflict", uc: "uc-23-2", why: "同上" },
  { port: "DisposeHint", uc: "uc-23-2", why: "同上" },
  { port: "RunTrial", uc: "uc-23-5", why: "执行 —— 同 D-06" },
  { port: "SaveRegressionCase / RunAllRegressionCases", uc: "uc-23-5", why: "同上" },
  { port: "List/Add/Sync/RepairMarketSource", uc: "uc-23-7", why: "外部社区源整体" },
  {
    port: "DetectUsageCrystallizationCandidates",
    uc: "uc-23-1 A3",
    why: "⚠ 它不涉外部源也不涉沙箱，Q-0 方案 C 下它的去向**需一条子裁决**（尚未有）",
  },
] as const;

/* ─────────────────────────── 实体 ─────────────────────────── */

/**
 * 「六种资产完全一样」的那三项 + 周期（`uc-23-4` R3 逐字）。
 *
 * ⚠ 对六个 `AssetKind` **逐一**成立，且字段与取值集合**完全相同**（I-10 / I-11）。
 * ⚠ `负责人 ∈ editableBy` 是否为不变量 → **Q-9**。**本契约不擅自强制**：
 *   强制它会让「负责人只审不改」这种合法配置表达不出来，而放开它会让资产可能无人可改。
 *   两边都有代价，所以这是人类的裁决不是实现者的默认值。
 */
export const AssetGovernance = z
  .object({
    visibility: AssetVisibility,
    /** ⚠ `visibility = "specified-teams"` 时**必填非空**；其余情况为 `[]` */
    teamIds: z.array(z.string()),
    /** 角色引用或具体用户 id。⚠ 空集 ⇒ `GOVERNANCE_INCOMPLETE`，不是「谁都能改」 */
    editableBy: z.array(z.string()),
    ownerId: z.string(),
    reviewCycle: ReviewCycle,
  })
  .strict();

/**
 * 复核时钟（`uc-23-6`）。
 *
 * ⚠ `reviewDueAt = publishedAt + reviewCycle` 是**不变量**，不是一个可被单独写入的字段。
 * ⚠ `downgradeDueAt` 只在 `pending-review` 上有意义；它到点即 `downgraded`。
 *   **30 天这个数值不在本文件出现**——见 `ReviewCycle` 的长注（I-27 / Q-7）。
 */
export const ReviewClock = z
  .object({
    assetKind: AssetKind,
    assetId: z.string(),
    state: ReviewClockState,
    publishedAt: z.string().nullable(),
    reviewDueAt: z.string().nullable(),
    /** null ⟺ `state !== "pending-review"` */
    downgradeDueAt: z.string().nullable(),
    lastReviewedAt: z.string().nullable(),
    lastReviewedBy: z.string().nullable(),
  })
  .strict();

/** 资产目录里的一个文件。⚠ `badge` 由扩展名派生，未知 ⇒ `MD`，**不报错** */
export const AssetFile = z
  .object({
    path: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    badge: AssetFileBadge,
    /** 该资产的根文件（`SKILL.md` / `AGENT.md`），**不可删**（I-7） */
    isRoot: z.boolean(),
  })
  .strict();

/** 目录树节点。⚠ 递归形状用 `path` 表达层级，**不做嵌套 children**——嵌套的 out 无法逐层 strict */
export const AssetTreeNode = z
  .object({ path: z.string(), kind: z.enum(["dir", "file"]), depth: z.number().int().nonnegative() })
  .strict();

/** 资产引用。`ScanReviewClocks` 的两段返回都是它 */
export const AssetRef = z.object({ assetKind: AssetKind, assetId: z.string() }).strict();

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /* ══ uc-23-8 · 后台外壳与左栏 IA ═══════════════════════════ */

  /**
   * `ListAdminNav` —— 后台左栏 IA
   *
   * 🔴 **不变量 I-2（双向）**：返回的资产项集合 **＝** `AssetKind` 六值。
   *   ⚠ 单向断言（「左栏每一项都是合法 `AssetKind`」）**在今天的代码上就是绿的**——
   *     `apps/web/components/admin/admin-nav.tsx` 现在只有 4/6
   *     （缺 `canvas-template` 与 `blueprint`，这正是人类「为什么在管理后台看不到项目蓝本」
   *     那条投诉的直接答案）。⇒ 必须**双向集合差为空 + 反证套件**
   *     （照 `lint-ui-material.mjs` 的形状）。
   * ⚠ `count` 为 `"—"` 表示**取不到**（I-24），**不得返回 0 代替**：
   *   0 是一个事实（这类资产一个都没有），取不到是另一个事实（计数查询挂了）。
   *   合并成 0 会让一次故障看起来像一个空目录。
   * ⚠ 某类计数查询失败 ⇒ 该项 `count = "—"`，**其余项照常返回**（不整体失败）。
   * ⚠ 分组与顺序**待 Q-11**；本操作的形状不依赖裁决结果，故可先定。
   */
  listAdminNav: {
    method: "GET",
    path: "/admin/nav",
    in: z.object({}).strict(),
    out: z
      .object({
        org: z
          .object({
            name: z.string(),
            orgId: z.string(),
            quotaPct: z.number(),
            quotaUsedWan: z.number(),
            quotaTotalWan: z.number(),
            daysLeft: z.number().int(),
          })
          .strict(),
        groups: z.array(
          z
            .object({
              group: z.string(),
              items: z.array(
                z
                  .object({
                    key: z.string(),
                    label: z.string(),
                    href: z.string(),
                    /** ⚠ `number` 或字面量 `"—"`；**没有第三种**，且 `null` 不合法 */
                    count: z.union([z.number().int().nonnegative(), z.literal("—")]),
                    statusDot: z.boolean(),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ══ uc-23-4 · 治理与发布 ═════════════════════════════════ */

  /** `GetAssetGovernance` —— null = 尚未配置过（**不是**返回一份默认值） */
  getAssetGovernance: {
    method: "GET",
    path: "/assets/:assetKind/:assetId/governance",
    in: z.object({ assetKind: AssetKind, assetId: z.string() }).strict(),
    out: z.object({ governance: AssetGovernance.nullable() }).strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `SetAssetGovernance` —— 三项治理配置 + 周期
   *
   * 🔴 **六种资产完全一样**（原型逐字）：字段与取值集合对六个 `AssetKind` **完全相同**。
   *   ⇒ 验收要**六类各跑一遍**，不是挑一类跑。
   * ⚠ `visibility = "whole-org"` ⇒ 触发**领域负责人联签**。
   *   联签流程 `[待确认]` ⇒ 本操作只返回 `requiresCosign: true` 这一态，
   *   **不发明审批流**。发明它就是在无出处的地方造一条治理路径。
   * ⚠ 这是**唯一的可见性写入路径**（I-14）——`scanReviewClocks` 的降级必须走它，
   *   不得有第二条后门。断言方式是「同一函数被调用」，不是「结果看起来一样」。
   */
  setAssetGovernance: {
    method: "PUT",
    path: "/assets/:assetKind/:assetId/governance",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), governance: AssetGovernance }).strict(),
    out: z
      .object({
        governance: AssetGovernance,
        /** ⚠ true 时资产**尚未**进入 `whole-org`；联签流程本身不在本束 */
        requiresCosign: z.boolean(),
      })
      .strict(),
    err: [
      "GOVERNANCE_INCOMPLETE",
      "ASSET_NOT_EDITABLE",
      "ORG_SCOPE_DENIED",
      "PROJECT_ROLE_INSUFFICIENT",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * `RunPreflightChecks` —— 发布前检查
   *
   * ⚠ **每一条都带 `sourceRef`，可追回它的来源**（I-22）——
   *   清单是**派生视图**，不是手写的固定清单。手写的清单会在规则变更后继续显示旧项，
   *   而没有任何东西会红。
   * ⚠ 清单内容**按资产类型可变**（原型的「四栏配置完整」是 Agent 专属）→ Q-1b。
   */
  runPreflightChecks: {
    method: "GET",
    path: "/assets/:assetKind/:assetId/preflight",
    in: z.object({ assetKind: AssetKind, assetId: z.string() }).strict(),
    out: z
      .object({
        items: z.array(
          z
            .object({
              label: z.string(),
              detail: z.string(),
              passed: z.boolean(),
              blocking: z.boolean(),
              /** ⚠ 恒非空：追不回来源的检查项等于一句无从核对的断言 */
              sourceRef: z.string().min(1),
            })
            .strict(),
        ),
        blockingCount: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `PublishAsset` —— 发布
   *
   * 🔴 **三条独立的禁用条件，缺一条就漏一条路径**：
   *   `GATE_NOT_PASSED`（I-5）· `GOVERNANCE_INCOMPLETE`（I-10）· `PREFLIGHT_HAS_BLOCKING_ITEM`。
   *   ⚠ 三条要**各造一次反例**；把它们合并成一个「不满足发布条件」的码会让
   *     界面说不出该去处理哪一件。
   * ⚠ **不变量**：`reviewDueAt = publishedAt + reviewCycle`（`ReviewCycle` 三档来自
   *   `uc-23-4` R3，**换算规则的定义处待 Q-7**，本操作只消费）。
   * ⚠ 发布必须写审计（谁 / 什么资产 / 什么可见范围 / 什么时间）。
   * ⚠ `mode: "staged"`（灰度）**语义待 Q-3**：本操作**保留参数但不定义行为**。
   *   定义它就是替人类裁 Q-3。
   */
  publishAsset: {
    method: "POST",
    path: "/assets/:assetKind/:assetId/publish",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), mode: PublishMode }).strict(),
    out: z
      .object({
        publishedAt: z.string(),
        publishedBy: z.string(),
        reviewDueAt: z.string(),
        auditEventId: z.string(),
      })
      .strict(),
    err: [
      "GATE_NOT_PASSED",
      "GOVERNANCE_INCOMPLETE",
      "PREFLIGHT_HAS_BLOCKING_ITEM",
      "SELF_REVIEW_FORBIDDEN",
      "NO_SECOND_REVIEWER",
      "REVIEWER_FUNCTION_MISMATCH",
      "SECURITY_SCAN_REJECTED",
      "DATA_SCOPE_EXCEEDS_SUBMITTER",
      "ORG_SCOPE_DENIED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /* ══ uc-23-6 · 复核到期与降级 ═════════════════════════════ */

  /**
   * `ScanReviewClocks` —— **主动扫描**（I-15）
   *
   * 🔴 **这个命名本身是契约。** 惰性判定（`EvaluateOnRead…`）会让
   *   「30 天无人复核」对**无人调用的资产永不触发**，而那正是最该降级的。
   *   ⇒ 验收必须造一个**从未被调用**的到期资产，跑扫描，断言它被降级。
   * ⚠ 降级必须走与 `setAssetGovernance` **相同的可见性写入路径**（I-14），
   *   断言「无第二条可见性写入路径」。
   * ⚠ **「最近一次扫描时间」必须可观测**——扫描停摆时该指标变旧，而不是静默。
   *   ⇒ `lastScanAt` 在 `out` 里，不是一条日志。
   */
  scanReviewClocks: {
    method: "POST",
    path: "/review-clocks/scan",
    in: z.object({ now: z.string() }).strict(),
    out: z
      .object({
        transitionedToPending: z.array(AssetRef),
        downgraded: z.array(AssetRef),
        /** ⚠ 可观测性字段：扫描停摆时它会变旧。**不要把它挪进日志** */
        lastScanAt: z.string(),
      })
      .strict(),
    err: ["ASSET_DOWNGRADED_OWNER_MISSING", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `ReviewAsset` —— 复核一次，计时重置
   *
   * 🔴 **`conclusion` 的取值集合无依据**（`uc-23-6` R7 规则 8，本束最大空白：
   *   「复核」这个动作具体做什么，原型 0 命中）。
   *   ⇒ 这里把它写成**开放字符串**并登记 `AG2`，**不发明一个枚举**。
   *   ⚠ 一个编出来的枚举读起来像已经想清楚了，而它什么都没定。
   *     没有取值集合，复核只是一个「点一下就重置计时」的按钮。
   */
  reviewAsset: {
    method: "POST",
    path: "/assets/:assetKind/:assetId/review",
    in: z
      .object({
        assetKind: AssetKind,
        assetId: z.string(),
        /** ⚠ **刻意不是 z.enum**：取值集合待裁（`AG2`） */
        conclusion: z.string().min(1),
        at: z.string(),
      })
      .strict(),
    out: z.object({ clock: ReviewClock }).strict(),
    err: [
      "ASSET_NOT_EDITABLE",
      "ASSET_DOWNGRADED_OWNER_MISSING",
      "ORG_SCOPE_DENIED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /** `GetReviewClock` —— 消费面。⚠ 三档周期与 30 天的语义**不在本束定义**（I-27 / Q-7） */
  getReviewClock: {
    method: "GET",
    path: "/assets/:assetKind/:assetId/review-clock",
    in: z.object({ assetKind: AssetKind, assetId: z.string() }).strict(),
    out: z.object({ clock: ReviewClock }).strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `GetAssetOrphanStatus` —— F140 (`uc-23-6` R7 规则 7 + E1 的表达面，domain I-14)。
   *
   * 🔴 **只表达 E1 这个态，不裁决兜底接管人**（E1 `[待确认]`，见 `uc-23-6` 本文）。
   *   `orphaned: true` 且 `code: "ASSET_DOWNGRADED_OWNER_MISSING"` ⟺ 该资产已降级
   *   （`ReviewClock.state = "downgraded"`）且其 `ownerId` 的账号已停用——此时「仅负责人可见」
   *   实质上等于「谁都不可见」（R7 规则 7 的反面）。`takeoverEntryPoint: true` 只是「界面应展示
   *   一个接管入口」这一个布尔事实，**不是**一段可执行的接管流程——接管规则本身待人类裁决。
   * ⚠ `orphaned: false` 覆盖两种情况：资产未降级，或已降级但负责人账号仍在——两者都不需要
   *   界面做任何特殊处理，合并成一个假值不会丢失信息（真正需要区分「降级」与「未降级」的
   *   地方是 `getReviewClock.clock.state`，本操作不重复那份判定）。
   */
  getAssetOrphanStatus: {
    method: "GET",
    path: "/assets/:assetKind/:assetId/orphan-status",
    in: z.object({ assetKind: AssetKind, assetId: z.string() }).strict(),
    out: z
      .object({
        orphaned: z.boolean(),
        code: z.literal("ASSET_DOWNGRADED_OWNER_MISSING").nullable(),
        /** ⚠ 只声明入口应可见，不实现入口背后的接管流程（E1 `[待确认]`） */
        takeoverEntryPoint: z.boolean(),
      })
      .strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* ══ uc-23-3 · 资产目录的浏览与编辑 ═══════════════════════ */

  /**
   * `GetAssetDirectory`
   *
   * 🔴 **不变量 I-6（双向相等）**：发布后**运行时装载的文件集合 ＝ 本操作返回的集合**。
   *   单向（「装载的都在列表里」）在一个「列表多显示了几个文件」的实现上也是绿的，
   *   而那意味着编辑器里改的文件运行时根本不读。
   * ⚠ **本组端口只对 2/6 类资产有依据**（skill / agent）。另外四类是不是目录形态
   *   `[待确认]` ⇒ **适用范围本身是未知的**（`AG4`）。
   */
  getAssetDirectory: {
    method: "GET",
    path: "/assets/:assetKind/:assetId/files",
    in: z.object({ assetKind: AssetKind, assetId: z.string() }).strict(),
    out: z
      .object({
        /** `SKILL.md` / `AGENT.md`……由 `AssetKind` 决定，**不可删**（I-7） */
        rootFile: z.string(),
        tree: z.array(AssetTreeNode),
        files: z.array(AssetFile),
      })
      .strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /** `ReadAssetFile` —— ⚠ 不在 `editableBy` 内**仍可读**（只读态），只是没有写端口 */
  readAssetFile: {
    method: "GET",
    path: "/assets/:assetKind/:assetId/files/content",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), path: z.string() }).strict(),
    out: z
      .object({
        path: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        body: z.string(),
        badge: AssetFileBadge,
      })
      .strict(),
    err: ["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `WriteAssetFile`
   *
   * 🔴 **这里刻意没有「保存后重扫 02 关」的副作用**（I-25，待人类确认）。
   *   不做这条，六道关**在导入之后即可绕过**——在编辑器里加一段提示注入就行。
   *   **这是一个已知的洞，不是遗漏**（`AG6`）。写在契约上，是为了让它在签核时被看见。
   * ⚠ **并发编辑无契约**（`uc-23-3` E5）。留空是刻意的：默认「后写覆盖」会**静默丢数据**，
   *   不该由实现者定（`AG5`）。⇒ 本操作**没有** `expectedVersion` 之类的乐观并发字段，
   *   那个字段一旦加上就等于选了一种并发语义。
   * ⚠ frontmatter 坏了 ⇒ `CONTRACT_VALIDATION_FAILED` 且**不入库**。
   */
  writeAssetFile: {
    method: "PUT",
    path: "/assets/:assetKind/:assetId/files/content",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), path: z.string(), body: z.string() }).strict(),
    out: z.object({ sizeBytes: z.number().int().nonnegative(), dirty: z.literal(true) }).strict(),
    err: ["ASSET_NOT_EDITABLE", "CONTRACT_VALIDATION_FAILED", "ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /** `CreateAssetFile` */
  createAssetFile: {
    method: "POST",
    path: "/assets/:assetKind/:assetId/files",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), path: z.string(), body: z.string() }).strict(),
    out: z.object({ file: AssetFile }).strict(),
    err: ["ASSET_NOT_EDITABLE", "CONTRACT_VALIDATION_FAILED", "ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /** `RenameAssetFile`。⚠ 改根文件名等价于删根文件 ⇒ 同样 `ROOT_FILE_UNDELETABLE` */
  renameAssetFile: {
    method: "POST",
    path: "/assets/:assetKind/:assetId/files/rename",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), from: z.string(), to: z.string() }).strict(),
    out: z.object({ file: AssetFile }).strict(),
    err: ["ROOT_FILE_UNDELETABLE", "ASSET_NOT_EDITABLE", "ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `DeleteAssetFile`
   *
   * ⚠ **不变量 I-7**：`path === rootFile` ⇒ `ROOT_FILE_UNDELETABLE`。
   * ⚠ 路由用 `POST …/files/delete` 而不是 `DELETE …`：与 `org-admin` 同理，
   *   仓库的禁止路由表是**前缀正则**，动词路由避开比放宽禁令便宜。
   */
  deleteAssetFile: {
    method: "POST",
    path: "/assets/:assetKind/:assetId/files/delete",
    in: z.object({ assetKind: AssetKind, assetId: z.string(), path: z.string() }).strict(),
    out: z.object({ deleted: z.string() }).strict(),
    err: ["ROOT_FILE_UNDELETABLE", "ASSET_NOT_EDITABLE", "ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },
} as const;

/**
 * 本束的契约缺口，逐条登记在契约自己身上。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **「六类共用同一套治理字段」在代码侧现状是 3/6，Q-1b 未裁。**
   * MCP 走已签核的 `McpAuthScope`（`lead|team|all`），模型与蓝本**根本没有这个字段**。
   * 本束按「六类统一」定义 `AssetGovernance`——**它能否落地取决于 Q-1b**。
   * 若裁决是「统一」，动的是 `agent-runtime` 束的**已签核字段**（重签）。
   */
  AG1: "Q-1b unruled: governance fields are uniform across all six AssetKinds only in this contract; the code today covers 3/6 (MCP uses the SIGNED McpAuthScope; model and blueprint have no field at all). Unifying amends a signed bundle",
  /**
   * **`ReviewAsset.conclusion` 的取值集合空缺**（`uc-23-6` R7 规则 8）。
   * 「复核」这个动作具体做什么，原型 0 命中。没有它，复核只是一个
   * 「点一下就重置计时」的按钮，这条规则的价值接近零。**本束最大的单点空白。**
   * ⇒ 契约里写成开放字符串，**不发明枚举**。
   */
  AG2: "ReviewAsset.conclusion has no value set (uc-23-6 R7 rule 8, zero prototype hits); typed as an open string here rather than inventing an enum",
  /**
   * **复核计时规则（三档周期 + 30 天）的单一定义处未定 —— Q-7。**
   * `uc-23-6` R7 自称是「唯一文字定义处」，而 `14-brain`（phase-3）的知识条目
   * 到期规则被原型逐字要求「与之一致」⇒ **必须是同一个实现**。
   * 本束是**消费面**，刻意不在代码里写下 `30`；落点定下来之前，
   * 谁先写谁就是本仓第九次「同一事实两处声明」。
   */
  AG3: "Q-7 unruled: the single definition site for the review-clock rule (three cycles + the 30-day downgrade) is undecided and is shared with 14-brain (phase-3); this bundle is the consumer and deliberately does not encode the number",
  /**
   * **`AssetDirectory` 一组端口只对 2/6 类资产有依据**（skill / agent）。
   * 另外四类是不是目录形态 `[待确认]` ⇒ **这组端口的适用范围本身是未知的**。
   * `in.assetKind` 收六值是**形状上的宽松，不是裁决**。
   */
  AG4: "the AssetDirectory port group has evidence for only 2/6 kinds (skill, agent); whether model / mcp / canvas-template / blueprint are directory-shaped is [待确认], so its applicable range is unknown",
  /**
   * **并发编辑无契约**（`uc-23-3` E5）。留空是刻意的——
   * 默认「后写覆盖」会**静默丢数据**，不该由实现者定。
   * ⇒ `writeAssetFile.in` 里**没有**乐观并发字段：加上它就等于替人选了一种语义。
   */
  AG5: "concurrent editing has no contract (uc-23-3 E5); the omission is deliberate because the natural default (last-write-wins) loses data silently",
  /**
   * **I-25（保存后重扫 02 关）尚未成为端口的副作用。**
   * 不做这条，六道关**在导入之后即可绕过**——在编辑器里加一段提示注入就行。
   * **这是一个已知可绕过的洞，不是遗漏。** 需要人类确认后才写进契约。
   * ⚠ 六道关本体随 Q-0 留在 phase-2，所以这个洞在 phase-1 内**无法被关上**，
   *   但它必须在签核时被看见——phase-2 接上六道关那一刻，它立刻是真的。
   */
  AG6: "I-25 (re-run gate 02 after WriteAssetFile) is not a side effect of any port here; the six landing gates can therefore be bypassed post-import via the editor. Known hole, deliberately left open pending human confirmation",
  /**
   * **`skills` 束的七个复用码今天没有编译期门控。**
   * `usecases.md` 第零节要求 `GATE_NOT_PASSED` / `SELF_REVIEW_FORBIDDEN` /
   * `NO_SECOND_REVIEWER` / `REVIEWER_FUNCTION_MISMATCH` / `SECURITY_SCAN_REJECTED` /
   * `CONTRACT_VALIDATION_FAILED` / `DATA_SCOPE_EXCEEDS_SUBMITTER` **同码同义**，
   * 而 `packages/contracts/src/skills.ts` 在本 worktree 里还不存在（并行作者在写）。
   * ⇒ **skills.ts 落地后要补的那一行逐字是**：
   * ```ts
   * type SkillsErrorT = z.infer<typeof import("./skills").SkillsError>;
   * const _sharedWithSkills = [
   *   "GATE_NOT_PASSED", "SELF_REVIEW_FORBIDDEN", "NO_SECOND_REVIEWER",
   *   "REVIEWER_FUNCTION_MISMATCH", "SECURITY_SCAN_REJECTED",
   *   "CONTRACT_VALIDATION_FAILED", "DATA_SCOPE_EXCEEDS_SUBMITTER",
   * ] as const satisfies readonly (SkillsErrorT & AssetGovernanceErrorT)[];
   * ```
   * ⚠ 不写下来，它就会一直是「以后再说」——而在此之前，
   *   `skills` 侧任何一次改名都不会让本束变红。
   */
  AG7: "the seven codes reused from the `skills` bundle have NO compile-time same-code-same-meaning gate because src/skills.ts does not exist in this worktree yet; the exact assertion to add once it lands is written out above",
  /**
   * **`AssetVisibility` 与 `identity.VisibilityScope` 是两套可见性语义**（domain X-C）。
   * 前者三值（含「仅自己-私有草稿」），后者两值且**已签核**。
   * 本束**刻意不同名**以避开「同名不同义」，但两套语义并存本身仍是缺口：
   * 一个资产的可见性到底由哪一套判定，Q-1b 之前没有答案。
   */
  AG8: "AssetVisibility (3 values) and the SIGNED identity.VisibilityScope (2 values) are two coexisting visibility vocabularies (domain X-C); deliberately not same-named, but which one governs an asset is unanswered until Q-1b",
  /**
   * **`uc-23-1` 的三条非外部路径与 `DetectUsageCrystallizationCandidates` 去向未定。**
   * Q-0 方案 C 只裁了「外部导入 / 六道关 / 沙箱试跑」推迟，
   * 而 `DetectUsageCrystallizationCandidates` **既不涉外部源也不涉沙箱**——
   * 它落在裁决的缝里，`DECISION-Q0.md` 自己写着需要一条子裁决。
   * ⇒ 本束**不认领它**，登记在 `DEFERRED_TO_PHASE_2` 的最后一行。
   */
  AG9: "Q-0 needs a sub-ruling: DetectUsageCrystallizationCandidates (uc-23-1 A3) involves neither external sources nor sandboxing, so plan C does not place it; this bundle does not claim it",
} as const;
