/**
 * 契约束 `agent-runtime` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：**F48–F60 + F129–F131**（16 件 / 67 点）
 * 依据 UC：`contracts/agent-runtime/usecases.md`（A 组模型池 / B 组 MCP / C 组 Agent）
 * 领域模型：同目录 `domain.md`（I-1…I-52 + 🔴 I-28′ / I-29′ / I-30′）
 *
 * ## 本束的三个安全内核（改这三处等于改安全边界）
 *   · `routeModelCall` —— 机密硬路由的**唯一执行点**（I-10…I-13）
 *   · `authorizeToolCall` —— 三层权限求交的**唯一判定点**（I-27 / O-23）
 *   · `checkToolScopeCap` —— 带副作用工具的**授权范围封顶**（🔴 I-28′，纯函数，可脱 HTTP 直测）
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *   · 三个项目级 AI 开关的**默认值** —— `setProjectAiPermissions` 的 in 里没有默认值声明。
 *     出处曾被伪造（F58 的「默认全关为 O-23」已撤），现登记在
 *     `thresholds.ts` 的 `projectAiDefault*` 三项（`known: false`）。**契约里不写死默认值。**
 *   · `平台组` 的身份判据 —— F131 逐字「[待裁] `平台组` 无其它出处」⇒
 *     `quarantineUntil` 的形状落了，**谁算平台组不落**（`KNOWN_CONTRACT_GAPS.AR3`）。
 *   · 隔离期天数 —— 读组织参数，**本文件不抄第二份 14**（domain `quarantineDays` 行逐字）。
 *
 * ⚠ **一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖。**
 *   `AgentRuntimeError` 的每一个成员都在下方某个操作的 `err` 里出现。
 */
import { z } from "zod";
import { ArtifactError } from "./artifact";
import { PermissionReason } from "./identity";

/* ══════════════════════ A 组 · 模型池（F48–F51）══════════════════════ */

/** 二分。⚠ 机密路由的候选集收窄到 `self-hosted` 就靠这一位（I-10） */
export const ModelKind = z.enum(["closed-api", "self-hosted"]);

/** 单模型 / 组合记录。⚠ 组合成员各自已过测试后，**组合本身还要再走一次五项测试** */
export const ModelShape = z.enum(["single", "composite"]);

/**
 * 模型状态。⚠ 成员逐个等于 DB CHECK；`依赖失败` 是**被停用模型的引用方**所处的态（I-16），
 * **不是**「静默换一个模型继续跑」。
 */
export const ModelStatus = z.enum(["待测试", "已启用", "已停用", "依赖失败"]);

/** 准入五项，**恒五项闭集**（domain A 组逐字）。⚠ O-35：不打分、不设分数线 */
export const AdmissionTestItem = z.enum([
  "连通性",
  "结构化输出",
  "工具调用",
  "长上下文",
  "中文表达",
]);

/** ⚠ 三档，`不适用` 不等于 `通过`——`enableModel` 的前置是「五项全部『通过』」（I-1） */
export const AdmissionVerdict = z.enum(["通过", "不通过", "不适用"]);

/**
 * 停用/隔离的两种收尾方式。⚠ **与 skills 束的 `DisableDialog` 是同一事实**
 * （立即中断 / 跑完当前一轮），三束都引用这一份，不各写一遍。
 */
export const DisableMode = z.enum(["interrupt", "drain"]);

/** 可选范围过滤器的三个消费方（**唯一实现，三处复用**） */
export const ModelConsumer = z.enum(["agent", "skill", "blueprint-policy"]);

/** ⚠ `confidential` 与 `routeModelCall` 用**同一条判据**，不是两套 */
export const ModelPurpose = z.enum(["onsite", "post", "confidential"]);

/** 路由结果两态。⚠ **拒绝也要写 `provenance_events`**（判定顺序第 6 步） */
export const RoutingOutcome = z.enum(["routed", "rejected"]);

/* ══════════════════════ B 组 · MCP（F52–F54 + F129–F131）══════════════ */

/**
 * 🔴 **F129 新增域字段**（原型 `16,684,300` 表头第 2 列逐字 `副作用`）。
 *
 * ⚠ 与 `McpServer.involvesCustomerData`（O-19）**正交，不得合并**：
 *   后者答「数据敏不敏感」，本字段答「**这次调用会不会改变外部世界**」。
 * ⚠ 取值来源（握手探测 vs 人工标注）**原型未演示 ⇒ [待裁]**（`KNOWN_CONTRACT_GAPS.AR2`）。
 *   但**不给「默认只读」**：未标注按最严处理——默认只读会让一个未标注的外发工具
 *   被开放给全体成员，正是 I-28′ 要防的那件事。
 */
export const ToolSideEffect = z.enum(["只读", "对外发送", "写入外部"]);

/**
 * 🔴 **F129**：授权挂在**工具**上（原型逐字 `逐工具授权 · 9 个`），五值闭集。
 *
 * ⚠ 比 O-20 的服务器级三值多 `需人工确认每次` 与 `未开放` 两值。
 * ⚠ **与 O-20 冲突，需人类确认**（O-20 的问题陈述通篇未提 `逐工具` / `副作用` /
 *   `需人工确认每次` / `未开放`）——**本文件不代改 O-20**，登记在 `KNOWN_CONTRACT_GAPS.AR1`。
 * ⚠ 全序**不靠字符串比较**，见下方 `TOOL_AUTH_SCOPE_RANK`。
 */
export const ToolAuthScope = z.enum([
  "全体成员",
  "仅某团队",
  "仅项目负责人",
  "需人工确认每次",
  "未开放",
]);

export type ToolSideEffectT = z.infer<typeof ToolSideEffect>;
export type ToolAuthScopeT = z.infer<typeof ToolAuthScope>;

/**
 * **五值的全序，落成显式序数常量**（F129 逐字要求：不靠字符串比较）。
 *
 * ⚠ 序数是**契约的一部分**，不是实现细节：I-28′ 的封顶不变式写作
 *   `rank(authScope) <= maxScopeFor(sideEffect)`，把 `4/3/2/1/0` 换成别的排法
 *   就换了一条安全边界。
 * ⚠ `需人工确认每次`（1）与前三者**不同类**——前三者答「谁可以」，它答「每次都要人点」。
 *   把它排在 `仅项目负责人`(2) 之下是**裁决**（domain 表逐字），不是自然序。
 *
 * ⚠ `satisfies Record<ToolAuthScopeT, number>` 是这张表的**编译期完整性门控**：
 *   `ToolAuthScope` 加一个值而这里忘了排序，`tsc` 立刻红——
 *   而一个「新值 rank 为 undefined」的比较在运行期恒为 false（读起来像「通过」）。
 */
export const TOOL_AUTH_SCOPE_RANK = {
  全体成员: 4,
  仅某团队: 3,
  仅项目负责人: 2,
  需人工确认每次: 1,
  未开放: 0,
} as const satisfies Record<ToolAuthScopeT, number>;

/**
 * 封顶函数（I-28′ 形式化第一行逐字）：
 * `maxScopeFor(sideEffect) = sideEffect === "只读" ? 4(全体成员) : 1(需人工确认每次)`
 *
 * ⚠ 用 `satisfies Record<ToolSideEffectT, number>` 而不是 `sideEffect === "只读" ? … : …`：
 *   三元式在 `ToolSideEffect` 新增第四个值时**静默把它归进「带副作用」**——
 *   方向恰好是安全的，但没有任何东西会提示有人加了一个值。这张表会红。
 */
export const MAX_SCOPE_RANK_FOR_SIDE_EFFECT = {
  只读: TOOL_AUTH_SCOPE_RANK["全体成员"],
  对外发送: TOOL_AUTH_SCOPE_RANK["需人工确认每次"],
  写入外部: TOOL_AUTH_SCOPE_RANK["需人工确认每次"],
} as const satisfies Record<ToolSideEffectT, number>;

/**
 * 🔴 **I-28′ 的判定纯函数**（F130 落地条 ⑴，与 `checkProjectsColumnSet` 同形）。
 *
 * > 原型 `16,688,300` 逐字：带副作用的工具（对外发送、写入外部）永远不能设为
 * > "全体成员自动调用"，最宽只能到"需人工确认每次"。
 *
 * 等价形式：`副作用 ∈ {对外发送, 写入外部} ⟹ 开放给 ∈ {需人工确认每次, 未开放}`。
 *
 * ⚠ **它是安全不变式不是界面校验**：`setToolAuthScope` 的写路径上必须调它
 *   （F130 ⑵），且 `discoverMcpTools` 重新发现导致 `sideEffect` 变化时必须**当场收紧**
 *   （F130 ⑶——只在「设置授权范围」一个入口校验，会留下「从只读那一侧走进来」的绕过路径）。
 * ⚠ 它是**纯函数**，可脱 HTTP 直测；不要在服务里再写一份 `if`。
 */
export function checkToolScopeCap(input: {
  sideEffect: ToolSideEffectT;
  authScope: ToolAuthScopeT;
}): { ok: true } | { ok: false; reason: "TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP"; maxAllowedRank: number; requestedRank: number } {
  const requestedRank = TOOL_AUTH_SCOPE_RANK[input.authScope];
  const maxAllowedRank = MAX_SCOPE_RANK_FOR_SIDE_EFFECT[input.sideEffect];
  if (requestedRank <= maxAllowedRank) return { ok: true };
  return { ok: false, reason: "TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP", maxAllowedRank, requestedRank };
}

/**
 * 🔴 **I-29′ 的判定纯函数**：服务器级 `authScope` 是**上限**，工具级**只能更严**。
 *
 * ⚠ 与 `checkToolScopeCap` 是**两条独立的门**，都要过：
 *   一个工具可以在服务器上限之内、却仍然越了副作用封顶（反之亦然）。
 * ⚠ 反向断言不可省：服务器 `全体成员` + 工具 `全体成员` ⇒ **允许**，
 *   否则一个「一律更严」的实现会让越界那一侧全绿（I-29′ 表末逐字）。
 */
export function checkToolScopeWithinServer(input: {
  serverScope: ToolAuthScopeT;
  toolScope: ToolAuthScopeT;
}): { ok: true } | { ok: false; reason: "TOOL_SCOPE_EXCEEDS_SERVER_SCOPE" } {
  return TOOL_AUTH_SCOPE_RANK[input.toolScope] <= TOOL_AUTH_SCOPE_RANK[input.serverScope]
    ? { ok: true }
    : { ok: false, reason: "TOOL_SCOPE_EXCEEDS_SERVER_SCOPE" };
}

/** 🔴 新发现工具的默认授权范围（原型面板逐字 `默认全关 · 已开 3`）。**有出处的默认值** */
export const NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE = ToolAuthScope.enum["未开放"];

/* ───────────── 🟢 F52：工具命名空间（I-20）的机械落点 ───────────── */

/**
 * 🟢 **F52 追加（纯新增，未改动本文件任何既有声明）。**
 *
 * `McpTool.fullName` 原本是裸 `z.string()`，而它上方的注释逐字写着
 * 「全名恒为 `mcp:<服务器>.<工具>`（I-20），与内建 `graph.` / `brain.` 命名空间可区分」——
 * **一条写在注释里、没有任何东西守的不变量**。下面这几个导出把它变成会红的东西。
 *
 * 为什么非守不可：三层权限的第 ② 层（agent 工具白名单）是**按全名**存的。
 * 全名一旦有第二套拼法，白名单里会出现两条指向同一个工具的记录，其中一条永远命中不了——
 * 于是「我明明授权了」和「它调不到」可以同时为真，而两边的数据都自洽。
 *
 * ⚠ 这里**只加不改**：没有动 `McpTool` 的字段类型（那会改变已签核的形状），
 *   校验以纯函数提供，由 F52 的用例与测试在写入路径上调用。
 *   要不要把 `fullName` 收紧成 `McpToolFullName`，是**人类的裁决**，不是本 feature 自取。
 */
export const MCP_TOOL_NAMESPACE_PREFIX = "mcp:";

/**
 * 被产品**保留**的工具命名空间前缀。声明的是前缀，不是工具清单——
 * 具体有哪些 `graph.*` 工具仍是组织配置（`lint-no-builtin-capabilities` 的红线在那边）。
 */
export const RESERVED_TOOL_NAMESPACE_PREFIXES = ["graph.", "brain."] as const;

/**
 * `mcp:<服务器>.<工具>`。服务器段用短横线、工具段用下划线——**刻意不同**：
 * 分隔符是第一个 `.`，两段都允许 `.` 就无法机械还原是哪台服务器。
 */
export const MCP_TOOL_FULL_NAME_RE = /^mcp:[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9_]*$/;

/** 唯一构造入口。别在别处拼字符串——拼出来的第二份规则不会有人守。 */
export function mcpToolFullName(serverSlug: string, toolName: string): string {
  const full = `${MCP_TOOL_NAMESPACE_PREFIX}${serverSlug}.${toolName}`;
  if (!MCP_TOOL_FULL_NAME_RE.test(full)) throw new Error(`非法的 MCP 工具全名：${full}`);
  return full;
}

/** 唯一解析入口。非法输入返回 `null`，**不抛**——调用方多半在做判定而非构造。 */
export function parseMcpToolFullName(
  full: string,
): { serverSlug: string; toolName: string } | null {
  if (!MCP_TOOL_FULL_NAME_RE.test(full)) return null;
  const rest = full.slice(MCP_TOOL_NAMESPACE_PREFIX.length);
  const dot = rest.indexOf(".");
  return { serverSlug: rest.slice(0, dot), toolName: rest.slice(dot + 1) };
}

export function isMcpToolFullName(full: string): boolean {
  return MCP_TOOL_FULL_NAME_RE.test(full);
}

/** 内建命名空间判定。与上一个函数**互斥**，由 F52 的测试逐串钉住。 */
export function isReservedToolFullName(full: string): boolean {
  return RESERVED_TOOL_NAMESPACE_PREFIXES.some((p) => full.startsWith(p));
}

/**
 * 🟢 **F52 追加**：`McpServerRow` 上三个正交字段的名字，**落成值**。
 *
 * 「它们是三个字段」这句话几乎无法证伪——任何实现都摆得出三个键。
 * 有了这个数组，测试才能断言「登记的正是这三个、一个不多一个不少」，
 * 并对 `authScope × reviewStatus × connectionStatus` 的**全部组合**证明互不可推导。
 */
export const MCP_ORTHOGONAL_FIELDS = ["authScope", "reviewStatus", "connectionStatus"] as const;

/**
 * 评审状态。**O-20：与 `authScope` / `connectionStatus` 三者正交，禁止合并**（I-17）。
 *
 * 🔴 `已到期待复核` 由 **F131** 补入（原型 `16,683,800`「**期满复核后**才对成员开放」）：
 * 缺这个态时，到期的服务器会静默停在 `待安全评审` 里无人处理——
 * 界面上「到期了」和「还没人看」无法区分。
 */
export const McpReviewStatus = z.enum([
  "待安全评审",
  "已放行",
  "维持隔离",
  "有条件放行",
  "已到期待复核",
]);

/** 运行事实。⚠ **`不可达` 不得写成 `已隔离`**（O-20）：隔离是策略，不可达是事实 */
export const McpConnectionStatus = z.enum(["已连接", "限流中", "已隔离", "不可达", "凭据失效"]);

/** 放行评审的三种结论。⚠ `有条件放行`（工具级粒度）**[待定]**，见 domain ⑧ */
export const McpReviewVerdict = z.enum(["放行", "维持隔离", "有条件放行"]);

/**
 * 四开关，**封闭集合**（O-19）。新增或改可关闭性**必须走 ADR**。
 * ⚠ 断言写「成员集合与契约一致 ∧ 未声明的值不能通过」，**不要 `toHaveLength(4)`**。
 */
export const SecurityPolicySwitchNo = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

/** 三层权限的层名。⚠ 拒绝时**必须可解释是哪一层**（I-27），所以它是响应里的一等值 */
export const PermissionLayer = z.enum(["mcp-scope", "whitelist", "task-package"]);

/* ══════════════════════ C 组 · Agent（F55–F60）══════════════════════ */

/** 发布状态机，**封闭枚举**（O-22④）。`已归档` 作为 `已停用` 的终态子类**不单列** */
export const AgentPublishState = z.enum(["草稿", "待审核", "运行中", "已停用"]);

/** ⚠ 五态闭集；`签名已变更需重新确认` 时**确认前不可用**（I-22） */
export const ToolWhitelistEntryState = z.enum([
  "在授权范围内",
  "越权申请待确认",
  "已准",
  "已否",
  "签名已变更需重新确认",
]);

/** 越权申请的裁决。⚠ **两条签名缺一即流程不合规**且条目不生效（I-29 / V22） */
export const ElevationVerdict = z.enum(["准", "否"]);

/** 会签的两种职能。⚠ 方法论审核人**不在此列**——它裁越权申请就是 `WRONG_REVIEW_FUNCTION` */
export const CountersignRole = z.enum(["securityReviewer", "orgAdmin"]);

/** 降级策略三取值（domain `DegradePolicy`） */
export const DegradePolicy = z.enum(["按阈值降级", "不降级", "跟随组织级"]);

/**
 * 任务类型分级，**封闭四档**，优先级**高于** `DegradePolicy`。
 * ⚠ `含客户机密` ⇒ **禁止降级**；`无合格替代` ⇒ **明确失败**（不是静默继续）。
 */
export const TaskKind = z.enum(["普通生成", "研究", "财务", "合规", "决策辅助", "含客户机密"]);

/** 载入求值的触发事件。⚠ **只能引用 `agenda_segment_id`**（I-36 / D-03a） */
export const LoadRuleTriggerEvent = z.enum([
  "agenda_segment.switched",
  "agenda_segment.state_changed",
]);

/** 互调链的审批态。⚠ 未获批准即终止的链**同样留痕**（`已拒绝` / `已取消`） */
export const CallChainApprovalState = z.enum(["已暂停", "人已批准", "已拒绝", "已取消"]);

/** 批准卡的三个出口（[原型] 逐字） */
export const ApprovalAction = z.enum(["批准执行", "改参数再跑", "不用了"]);

/** 审计时间线的四类事件。⚠ **同一条时间线，不可删除**（I-51） */
export const AuditEntryType = z.enum(["角色变更", "版本", "Agent 调用", "决策"]);

/** 异常严重度两档（原型逐字） */
export const AnomalySeverity = z.enum(["高", "中"]);

/* ══════════════════════ 失败面 ══════════════════════ */

/**
 * 本束的统一失败枚举。**每一个成员都在下方某个操作的 `err` 里出现**。
 *
 * ⚠ **同一种失败在 model / mcp / agent 三侧必须是同一个码**——本束跨三模块，
 *   这是「错误语义是否一致」在**束内**就存在的风险（usecases.md 顶部逐字）。
 *
 * 分三段：① 与已签核束同码同义（下方 `_sharedWith*` 是编译期门控）
 *        ② 本束新增（`usecases.md` 三张表逐条列出，**这里不许多一条**）
 *        ③ 🔴 F129–F131 补入的两条
 */
export const AgentRuntimeError = z.enum([
  /* ── ① 与 artifact / identity 束同码同义 ──────────────────────── */
  /** 依赖不可用。⚠ **保留用户当前输入与最后成功状态**，不得呈现为空态 */
  "DEPENDENCY_UNAVAILABLE",
  /** 并发修改。⚠ **不得静默覆盖**——可刷新 / 对比 / 重新提交 */
  "VERSION_CHANGED",

  /* ── ② 通用（三侧共用）───────────────────────────────────────── */
  /** 非组织管理员执行管理动作。判定属 `org-admin` 束，此处透传 */
  "NOT_ORG_ADMIN",
  /** 角色不足（R5 逐角色） */
  "ROLE_INSUFFICIENT",
  /** 提交人 = 审核/评审人。⚠ 组织内无第二人时**明确阻断**，不降级放行（O-21） */
  "SELF_REVIEW_FORBIDDEN",
  /** 用错职能。⚠ 方法论审核人 ≠ 安全评审人，**两职能不合并**（O-21） */
  "WRONG_REVIEW_FUNCTION",
  /** 过程中权限被撤回 ⇒ 终止后续写操作；已完成步骤按审计规则保留 */
  "PERMISSION_REVOKED_MIDWAY",
  /** 超时。⚠ 已保留输入，可安全重试 */
  "REQUEST_TIMEOUT",
  /** 留痕写入失败。⚠ **硬前置**（I-44）：写不进去 ⇒ 该次调用必须失败，不允许「调用成功但没留痕」 */
  "PROVENANCE_WRITE_FAILED",
  /** 改/删审计条目（I-51）。⚠ 一律被拒**并记安全审计** */
  "AUDIT_IMMUTABLE",
  /** 评审结论未填理由。⚠ 结论**不可删除** */
  "REVIEW_REASON_REQUIRED",

  /* ── ③ 模型侧（20-model）──────────────────────────────────────── */
  /** 五项未全过就启用。⚠ detail **必须指出卡在哪一项**（I-1） */
  "ADMISSION_TESTS_INCOMPLETE",
  /** 选了未启用/待测试模型（I-2）。⚠ 前端**不展示**不可选项（不置灰） */
  "MODEL_NOT_SELECTABLE",
  /** 一个 agent 只能配一个模型（I-3 / O-22③）；组合请选组合记录 */
  "MODEL_ID_MUST_BE_SINGLE",
  /** 组合成员被停用（I-5）。⚠ **不降级为单模型静默运行** */
  "COMPOSITE_MEMBER_DISABLED",
  /** 端点不可达 / 凭据失效（E3）。⚠ **绝不静默换模型** */
  "MODEL_DEPENDENCY_FAILED",
  /** 🔴 **I-11。这条错了等于数据泄露**：含机密但无可用自托管 ⇒ 明确失败，**绝不回落闭源** */
  "NO_LOCAL_MODEL_AVAILABLE",
  /** 尝试把机密送闭源（I-10）。⚠ 计入**越权拦截计数** */
  "CONFIDENTIAL_ROUTE_VIOLATION",
  /** 尝试关开关三 / 开开关四（I-14 / O-19）。⚠ 开关三**任何路径都不可关** */
  "POLICY_SWITCH_LOCKED",
  /** 提交了配置外的合规属性（I-8 / O-38） */
  "COMPLIANCE_ATTR_UNKNOWN",
  /** 改凭据/端点后未重测（A2）。⚠ 状态自动回 `待测试`，并从所有下拉中消失 */
  "RETEST_REQUIRED",
  /** 停用最后一个自托管模型。⚠ 二次确认框须逐字说明「含机密任务将确定性失败」；**是否直接阻断 [待定]** */
  "LAST_SELF_HOSTED_MODEL",

  /* ── ④ MCP 侧（21-mcp）───────────────────────────────────────── */
  /** 调用隔离态服务器（I-19）。⚠ 计入越权拦截计数 */
  "MCP_SERVER_ISOLATED",
  /** 端点不可达。⚠ **必须明确告知，不静默跳过工具调用** */
  "MCP_SERVER_UNREACHABLE",
  /** `限流中`（E2）。⚠ **不静默排队、不丢弃** */
  "MCP_RATE_LIMITED",
  /** 三层第 ① 层拒绝。⚠ 计入拦截计数 */
  "AUTH_SCOPE_DENIED",
  /** 放行未设授权范围（I-25）。⚠ 不允许「已连接但范围未定」 */
  "SCOPE_REQUIRED_ON_RELEASE",
  /** 签名变更未确认（I-22）。⚠ **不自动接受新签名** */
  "TOOL_SIGNATURE_CHANGED",
  /** agent 自行发现 MCP（开关四）。⚠ 计入拦截计数**并记安全审计** */
  "AGENT_CANNOT_DISCOVER_MCP",

  /* ── ⑤ Agent 侧（04-agent）──────────────────────────────────── */
  /** 不存在**或可见性范围外**。⚠ I-52：范围外返回 **404 语义而非 403**，与真的不存在不可区分 */
  "AGENT_NOT_FOUND",
  /** [原型] 硬闸门，逐字「还没配工具白名单，不能发布」；直调接口置 `运行中` 亦被拒（I-28） */
  "TOOL_WHITELIST_EMPTY",
  /** 越权申请未逐条裁决 ⇒ 不得批准发布 */
  "ELEVATION_UNDECIDED",
  /** 越权裁决缺会签（I-29）。⚠ 缺签 ⇒ 条目**不生效** + 审计标「流程不合规」 */
  "COUNTERSIGN_MISSING",
  /** 安全扫描未过（双重门禁之一） */
  "SECURITY_SCAN_PENDING",
  /** 方法论审核未过（双重门禁之二） */
  "METHODOLOGY_REVIEW_PENDING",
  /** 三层求交被拒（I-27）。⚠ **必须说明是哪一层**（`detail.layer`） */
  "EFFECTIVE_PERMISSION_DENIED",
  /** 第 ③ 层缺权限。⚠ [原型] 逐字「权限包里没有 `[去授权]`」；**agent 不能自行加** */
  "TASK_PERMISSION_MISSING",
  /** 模型停用 / MCP 隔离或限流（E3/E4）。⚠ **不静默跳过工具调用、不静默换模型** */
  "AGENT_DEPENDENCY_FAILED",
  /** 已停用。⚠ **已锁版本的在跑项目不受影响**（I-32） */
  "AGENT_DISABLED",
  /** 互调深度 > 2（O-36）。⚠ **在第 3 层终止**并留痕（I-46） */
  "CALL_DEPTH_EXCEEDED",
  /** 组员默认不可私聊（O-24）。⚠ 引导师**逐场**开关，不跨场继承 */
  "PRIVATE_CHAT_DISABLED",
  /** 目标线程已归档/只读（E4）。⚠ 私聊内容**已保留** */
  "TRANSFER_TARGET_READONLY",
  /** 转出缺出处（I-42） */
  "TRANSFER_PROVENANCE_INCOMPLETE",
  /** 导出量过大 ⇒ 转后台任务并给下载回执，**不阻塞页面** */
  "EXPORT_TOO_LARGE",
  /** 社区/外部市场导入（D-06）：phase-1 置灰标 later，接口亦拒 */
  "AGENT_MARKET_NOT_AVAILABLE",

  /* ── ⑥ 🔴 F129–F131 补入 ────────────────────────────────────── */
  /**
   * 🔴 **I-28′**：带副作用的工具越过授权范围封顶（F130）。
   * ⚠ 判据在 `checkToolScopeCap`，**服务端强制**——不得只在前端置灰。
   */
  "TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP",
  /**
   * 🔴 **I-29′**：工具级授权范围宽于服务器级上限（F129）。
   * ⚠ 与上一条是**两条独立的门**：一个工具可以在服务器上限内却仍越了副作用封顶。
   */
  "TOOL_SCOPE_EXCEEDS_SERVER_SCOPE",
  /**
   * 🔴 **I-30′**：隔离期内以非平台组身份调用（F131）。
   * ⚠ 期内**平台组可调用**（反向断言不可省），且每一次调用（含被拒的尝试）**全量留痕**，
   *   不受开关二「涉客户数据才留痕」影响。
   * ⚠ `平台组` 的判据 **[待裁]** → `KNOWN_CONTRACT_GAPS.AR3`。
   */
  "MCP_SERVER_IN_QUARANTINE",

  /* ── ⑦ ⚠⚠ 草案（#660，尚未经人类签核）→ `KNOWN_CONTRACT_GAPS.AR11` ─── */
  /**
   * ⚠⚠ **草案码**，只服务 `selfPublishToollessAgent`（见该操作的头注）。
   * 目标 agent 不在 `草稿` 态。自助发布**只**是 `草稿 → 运行中` 的一条边；
   * 已进 `待审核` 的 agent 已经踏上评审路径，**不得**用自助发布抄近道绕过
   * `decideAgentPublish`——那正好就是 I-28/O-21 要防的那件事。
   */
  "AGENT_NOT_DRAFT",
  /**
   * ⚠⚠ **草案码**，只服务 `selfPublishToollessAgent`。
   * agent 已经有工具白名单条目或 skill 挂载 ⇒ **它有可被评审的能力面**，
   * 必须走完整的 `submitAgentForReview` → `decideAgentPublish` 双人路径。
   * ⚠ 这条码存在的唯一意义，是让「无能力面」这个豁免前提**在服务端被强制**，
   *   而不是靠调用方自觉。它红了不是用户做错了事，是这个 agent 不该走这条路。
   */
  "AGENT_NOT_TOOLLESS",
  /**
   * #660 —— agent 还没有**可执行定义**（`agents.instructions` 为 NULL 或全空白）。
   * `agent_versions.instructions` 是 NOT NULL，没有它就铸不出可执行版本；
   * 铸不出版本，发布出去的 agent 发消息仍然 422。
   * ⚠ 明确拒绝，**不用 `role`/`name` 兜底拼一段出来** —— `role` 是角色标签不是系统提示词，
   *   运行时会真的按它执行（`design-deltas/agent-instructions` 逐字禁止这条捷径）。
   */
  "AGENT_NO_EXECUTABLE_DEFINITION",
  /**
   * ⚠⚠ **草案码**，只服务 `selfPublishToollessAgent`。
   * agent 的 `visibility` 是 `仅某组`，而**没有任何地方记录过是哪个组**——
   * `createAgent.in` 收 `visibility` 却不收 team，`capability_listings` 的
   * `capability_listings_team_only_needs_team` 又要求 `team-only` 必须带
   * `owner_team_id`。⇒ 这条边**无法诚实地把它登记进能力目录**。
   * ⚠ 落成一个明确的拒绝，而**不是**"退而求其次写成 `org-wide`"——
   *   后者是把一个本应受限的 agent 悄悄开放给全组织，正是 I-28 一族要防的形状。
   */
  "AGENT_VISIBILITY_UNSUPPORTED",
]);

type AgentRuntimeErrorT = z.infer<typeof AgentRuntimeError>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type PermissionReasonT = z.infer<typeof PermissionReason>;

/**
 * **跨束同码同义的编译期门控**（`pnpm --filter @repo/contracts run typecheck` 会红）。
 *
 * 交集类型 `ArtifactErrorT & AgentRuntimeErrorT` 只接受**两个枚举都有**的字面量：
 * 任何一侧改名、拼错、或有人在本束「另起一份名字」，这里立刻不通过类型检查。
 *
 * ⚠ 为什么不 import 枚举本身：`artifact` 是 phase-00 已签核的更内层束，
 *   直接 import 会让本束的失败面随它变动。这里要的是「同名是刻意的」的**证明**，
 *   不是依赖（同 `project.ts` 对 `DEPENDENCY_UNAVAILABLE` 的处理）。
 */
const _sharedWithArtifact = [
  "DEPENDENCY_UNAVAILABLE",
  "VERSION_CHANGED",
] as const satisfies readonly (ArtifactErrorT & AgentRuntimeErrorT)[];

/**
 * **本束与 `identity.PermissionReason` 的重叠是空的——这是结论，不是遗漏。**
 *
 * 本束的三层权限拒绝走 `EFFECTIVE_PERMISSION_DENIED` + `detail.layer`，
 * 组织/项目层的拒绝由 `identity` 束判定后**透传**（`NOT_ORG_ADMIN` / `ROLE_INSUFFICIENT`
 * 是本束的名字，与 `PermissionReason.ADMIN_NOT_SUPERUSER` / `PROJECT_ROLE_INSUFFICIENT`
 * **不同名**）。
 *
 * ⚠ 这个空交集本身要被钉住：下面这行断言「本束没有任何一个码与 `PermissionReason` 同名」。
 *   若将来有人在本束加一个 `ADMIN_NOT_SUPERUSER`，`never[]` 的 `satisfies` 会红——
 *   那时要做的是**引用**而不是再声明一遍。
 * ⚠ 命名差异本身已登记为 `KNOWN_CONTRACT_GAPS.AR4`（它是真实的跨束不一致，不是本束能单方修的）。
 */
const _noOverlapWithIdentity = [] as const satisfies readonly (PermissionReasonT &
  AgentRuntimeErrorT)[];

/* ══════════════════════ 实体 ══════════════════════ */

/** 组合模型的成员。⚠ 成员必须**各自已通过测试**，组合本身**还要再走一次五项测试** */
export const CompositeMember = z
  .object({
    modelId: z.string(),
    /** 成员被停用 ⇒ 整个组合 `COMPOSITE_MEMBER_DISABLED`，**不降级为单模型静默运行**（I-5） */
    role: z.string(),
  })
  .strict();

/** 可选模型候选。⚠ 每条带 `kind` 徽标与合规属性——**过滤在服务端**，前端不得自行放宽 */
export const ModelCandidate = z
  .object({
    modelId: z.string(),
    displayName: z.string(),
    kind: ModelKind,
    shape: ModelShape,
    /** ⚠ 受控枚举由组织配置（I-8 / O-38），**不是产品内置常量** */
    complianceAttrs: z.array(z.string()),
  })
  .strict();

/**
 * 每次模型调用前的一条判定记录（`RoutingDecision`）。
 * ⚠ **记录中不得包含机密内容原文**（I-13），只记标记与依据 id。
 */
export const RoutingDecision = z
  .object({
    decisionId: z.string(),
    callId: z.string(),
    containsConfidential: z.boolean(),
    /** ⚠ 机密性逐项判自 Context Pack 各 item 的 `artifactVersionId`，**不得自行另查一套库**（I-13 / X-7） */
    evidenceMarks: z.array(z.string()),
    candidateModelIds: z.array(z.string()),
    selectedModelId: z.string().nullable(),
    outcome: RoutingOutcome,
    reason: z.string(),
    at: z.string(),
  })
  .strict();

/** 五项判读记录。⚠ **append-only**（I-7）：改判**产生第二条**，历史不被覆盖 */
export const AdmissionTestRecord = z
  .object({
    recordId: z.string(),
    modelId: z.string(),
    item: AdmissionTestItem,
    verdict: AdmissionVerdict,
    /** ⚠ O-35：**不打分、不设分数线**，本字段**必填** */
    evidence: z.string().min(1),
    judgedBy: z.string(),
    judgedAt: z.string(),
  })
  .strict();

/**
 * MCP 服务器行。⚠ **三字段各自独立返回**，不因界面合并展示而丢失任一维度（I-17）。
 * ⚠ 非管理员的返回体**不含端点与凭据**（I-6）——所以 `endpointHint` 是粗粒度的两值。
 */
export const McpServerRow = z
  .object({
    serverId: z.string(),
    name: z.string(),
    /** ⚠ **必填**——它承载「这台服务器是干什么的、可不可信」的判断依据 */
    description: z.string().min(1),
    /** ⚠ 对非管理员只给粗粒度提示，**不给端点原值**（I-6） */
    endpointHint: z.enum(["内网", "外网"]),
    /** ① 授权范围（服务器级**上限**，工具级只能更严） */
    authScope: ToolAuthScope,
    /** ② 流程状态 */
    reviewStatus: McpReviewStatus,
    /** ③ 运行事实 */
    connectionStatus: McpConnectionStatus,
    /**
     * 🔴 **F131**：隔离期截止时刻。⚠ **是时间戳不是布尔**——
     * 布尔答不了「还剩几天」「到期了没有」，而这两件事界面上都要显示、待办里都要用。
     * `null` = 非第三方源 / 未进入隔离期。
     */
    quarantineUntil: z.string().nullable(),
    involvesCustomerData: z.boolean(),
    isEgress: z.boolean(),
  })
  .strict();

/** MCP 工具。⚠ 全名恒为 `mcp:<服务器>.<工具>`（I-20），与内建 `graph.` / `brain.` 命名空间可区分 */
export const McpTool = z
  .object({
    fullName: z.string(),
    serverId: z.string(),
    signature: z.string(),
    /** 用于 I-22 的签名变更检测 */
    schemaFingerprint: z.string(),
    /** 🔴 F129。⚠ 与 `McpServer.involvesCustomerData` **正交，不得合并** */
    sideEffect: ToolSideEffect,
    /** 🔴 F129。⚠ 新发现的工具恒为 `未开放`（`NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE`） */
    authScope: ToolAuthScope,
  })
  .strict();

/** 放行评审记录。⚠ 理由**必填且不可删除**；`放行` 时 `authScopeSet` **必填**（I-25） */
export const ReviewRecord = z
  .object({
    reviewId: z.string(),
    serverId: z.string(),
    reviewerId: z.string(),
    at: z.string(),
    verdict: McpReviewVerdict,
    reason: z.string().min(1),
    /** 有条件放行时的工具级粒度。⚠ 该模式**[待定]**（domain ⑧） */
    grantedToolIds: z.array(z.string()),
    authScopeSet: ToolAuthScope.nullable(),
  })
  .strict();

/** 四开关。⚠ **封闭集合**；界面文案随「留痕保留期」参数**动态渲染**，不得写死「180 天」（I-24） */
export const SecurityPolicy = z
  .object({
    /** ①「新服务器默认隔离，需人工评审后放行」——允许关，需二次确认并留痕 */
    isolateNewServers: z.boolean(),
    /** ②「涉客户数据的工具调用全量留痕」——允许关，需二次确认并留痕 */
    logCustomerDataCalls: z.boolean(),
    /** ③「客户机密材料仅允许本地模型处理」——⚠ **任何路径都不可关**（只读常开） */
    confidentialLocalOnly: z.literal(true),
    /** ④「允许 agent 自行发现新 MCP 服务器」——⚠ phase-1 **无打开入口，直调 API 亦被拒** */
    agentSelfDiscoversMcp: z.literal(false),
    /** ⚠ 保留期天数**读参数**（17-gov，本束只读），界面据此渲染；**不得在任何一侧写死** */
    provenanceRetentionDays: z.number().int().positive(),
  })
  .strict();

/** 工具白名单条目（三层权限的第 ②）。⚠ 粒度到**工具**而非服务器 */
export const ToolWhitelistEntry = z
  .object({
    toolFullName: z.string(),
    state: ToolWhitelistEntryState,
    /** null = 尚未裁决；⚠ **只有一条签名时该条目不生效**，审计标「流程不合规」 */
    elevationDecision: z
      .object({
        verdict: ElevationVerdict,
        reason: z.string().min(1),
        securityReviewerSig: z.string().nullable(),
        orgAdminSig: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** skill 挂载。⚠ **必须到版本粒度**（X-10 跨 `skills` 束） */
export const SkillMount = z.object({ skillId: z.string(), skillVersion: z.number().int().positive() }).strict();

/** Agent 库行（[原型] 列顺序逐字） */
export const AgentRow = z
  .object({
    agentId: z.string(),
    initials: z.string(),
    name: z.string(),
    role: z.string(),
    visibility: z.enum(["全组织可用", "仅某组"]),
    publishState: AgentPublishState,
    modelId: z.string().nullable(),
    skillCount: z.number().int().nonnegative(),
    /**
     * 「调用次数/月」。⚠ **phase-1 恒为 null**（D-07）——
     * 返回 0 会被读成「这个月没人用」，而真相是「我们还没做这个统计」。
     */
    monthlyCallCount: z.null(),
  })
  .strict();

/** 线程级在场条目 */
export const AgentPresence = z
  .object({
    agentId: z.string(),
    name: z.string(),
    /** ⚠ `跑批中` 的 agent 在议程环节切换时**不被强制换出**（E4） */
    presence: z.enum(["在场", "静音", "跑批中", "依赖失败"]),
    agentVersionId: z.string(),
  })
  .strict();

/** tool-call 四要素记录。⚠ 缺 `agentVersion`/`skillVersion`/`modelId`/`permissionSnapshot` 任一项即审计不完整（I-48） */
export const ToolCallRecord = z
  .object({
    recordId: z.string(),
    callId: z.string(),
    /** ⚠ 内建（`graph.`/`brain.`）与 MCP（`mcp:<服务器>.<工具>`）命名空间**必须可区分**（I-20） */
    signature: z.string(),
    hitCount: z.number().int().nonnegative(),
    /** ⚠ **逐条独立**，不是整体一个状态 */
    runState: z.enum(["成功", "失败", "被拒", "试跑"]),
    durationMs: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    callerAgentId: z.string(),
    agentVersion: z.string(),
    skillVersion: z.string().nullable(),
    modelId: z.string(),
    permissionSnapshot: z.string(),
    grantingLayer: PermissionLayer.nullable(),
  })
  .strict();

/** 异常条目。⚠ 判据 = **24 小时滚动窗口均值的 10 倍**（O-36），**不是绝对阈值** */
export const Anomaly = z
  .object({
    anomalyId: z.string(),
    severity: AnomalySeverity,
    subjectId: z.string(),
    /** ⚠ 限速是**系统动作，不等人** */
    rateLimited: z.boolean(),
    handled: z.boolean(),
    detectedAt: z.string(),
    /** ⚠ 限速与拦截**本身是审计事件，且对当事人可见** */
    visibleToSubject: z.literal(true),
  })
  .strict();

/**
 * **禁止存在的路由**（本束）。
 * 交付物是**一条断言它不存在的测试**，不是一个接口——理由同 N-5：
 * 「『没有』这件事本身没人会去验」。
 */
export const AGENT_RUNTIME_FORBIDDEN_ROUTES = [
  {
    route: "POST /mcp-servers/discover-by-agent",
    why: "开关四：phase-1 **不提供打开能力**（只读常关，O-19）。裁决取「不提供该 API」而非「提供但恒拒」——agent 自行接入 MCP 是权限静默扩大的最短路径（I-21）。",
  },
  {
    route: "PATCH /audit/entries/:entryId",
    why: "I-51：四类事件同一条时间线，**不可删除、不可修改**。任何删除/修改请求一律被拒并记安全审计——但一条恒 403 的路由仍然宣告了一种系统不该提供的能力。",
  },
] as const;

/**
 * #595 A2 —— `setAgentSkillPins.err` 的**独立枚举**（而不是内联 `as const`）。
 *
 * ⚠ 与 `updateAgentDefinition`/`mountSkill` 等本文件里的其它写操作不同，特意导出成
 *   独立 `z.enum`：`all-exceptions.filter.ts` 是**允许列表**，未登记的 `reasonCode`
 *   被静默丢掉——这条教训在 #595 段 2 现场撞过（同一个 bug 第八次），
 *   独立导出是为了让 controller 与过滤器都能 `import` 同一份，不必手抄一遍值。
 */
export const AgentSkillPinsError = z.enum([
  "ROLE_INSUFFICIENT",
  "AGENT_NOT_FOUND",
  "AGENT_NOT_PUBLISHED",
  "VERSION_CHANGED",
  "SKILL_VERSION_NOT_FOUND",
]);

/* ══════════════════════ 操作 ══════════════════════ */

export const operations = {
  /* ───────────── A 组 · 模型池（F48–F51）───────────── */

  /**
   * UC-20.1 R3 步骤 1–3：接入一个模型。落 `待测试`（I-1 的前置）。
   * ⚠ 凭据加密存储、**永不回显**（I-6）；E2：凭据被拒时**不保存半截配置**。
   */
  registerModel: {
    method: "POST",
    path: "/models",
    in: z
      .object({
        kind: ModelKind,
        shape: ModelShape,
        vendor: z.string().min(1),
        displayName: z.string().min(1),
        capabilityTags: z.array(z.string()),
        contextWindow: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
        /** ⚠ 受控枚举来自组织配置（I-8 / O-38）；配置外的值 ⇒ `COMPLIANCE_ATTR_UNKNOWN` */
        complianceAttrs: z.array(z.string()),
        /** ⚠ **只写不读**：任何 out 里都不会再出现它（I-6） */
        credential: z.string().nullable(),
        endpoint: z.string().nullable(),
        members: z.array(CompositeMember),
      })
      .strict(),
    out: z.object({ modelId: z.string(), status: ModelStatus }).strict(),
    err: [
      "NOT_ORG_ADMIN",
      "COMPLIANCE_ATTR_UNKNOWN",
      "DEPENDENCY_UNAVAILABLE",
      "REQUEST_TIMEOUT",
    ] as const,
  },

  /**
   * A2：`[配置]` 修改接入参数。
   * ⚠ **改凭据或端点 ⇒ 状态自动回 `待测试`**（`RETEST_REQUIRED` 语义）并从所有下拉中消失（V6）。
   * ⚠ 合规属性变更**须留痕**（它影响可选范围与机密路由）。
   */
  configureModel: {
    method: "PATCH",
    path: "/models/:modelId",
    in: z
      .object({
        modelId: z.string(),
        patch: z
          .object({
            displayName: z.string().optional(),
            capabilityTags: z.array(z.string()).optional(),
            complianceAttrs: z.array(z.string()).optional(),
            credential: z.string().optional(),
            endpoint: z.string().optional(),
          })
          .strict(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        modelId: z.string(),
        status: ModelStatus,
        /** true ⇒ 本次改动触发了 `RETEST_REQUIRED` 语义，状态已回 `待测试` */
        retestRequired: z.boolean(),
      })
      .strict(),
    err: [
      "NOT_ORG_ADMIN",
      "VERSION_CHANGED",
      "COMPLIANCE_ATTR_UNKNOWN",
      "RETEST_REQUIRED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 五项第 1 项的真实探活。
   * ⚠ E1：失败必须给出**具体原因**，**不得把失败呈现为「待测试」而无说明**。
   * ⚠ **是否纳入 phase-1 [待定]**（domain ⑫）——形状先落，纳入与否是签核人的事。
   */
  probeConnectivity: {
    method: "POST",
    path: "/models/:modelId/probe",
    in: z.object({ modelId: z.string() }).strict(),
    out: z
      .object({
        reachable: z.boolean(),
        latencyMs: z.number().int().nonnegative(),
        /** ⚠ null 仅在 `reachable: true` 时合法——失败必须说清是哪一种 */
        failureKind: z.enum(["credential", "unreachable", "timeout"]).nullable(),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "DEPENDENCY_UNAVAILABLE", "REQUEST_TIMEOUT"] as const,
  },

  /**
   * UC-20.1 R3 步骤 5：五项人工判读记录。
   * ⚠ **append-only**（I-7）：改判**产生第二条**，历史不被覆盖（E4/V5）。
   * ⚠ 测试结论**不可由使用方自填**；O-35：不打分、不设分数线，`evidence` 必填。
   * ⚠ E3：改判为「不通过」时**自动走与停用同一套级联**，退出动作留痕。
   */
  recordAdmissionTest: {
    method: "POST",
    path: "/models/:modelId/admission-tests",
    in: z
      .object({
        modelId: z.string(),
        item: AdmissionTestItem,
        verdict: AdmissionVerdict,
        evidence: z.string().min(1),
      })
      .strict(),
    out: AdmissionTestRecord,
    err: ["NOT_ORG_ADMIN", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * UC-20.2 R3 步骤 1。前置：**五项全部「通过」**（I-1）。
   * ⚠ `ADMISSION_TESTS_INCOMPLETE` 的 detail **必须指出卡在哪一项**——
   *   只说「测试未完成」时，管理员无从下手，这道门就退化成一个谜。
   */
  enableModel: {
    method: "POST",
    path: "/models/:modelId/enable",
    in: z.object({ modelId: z.string(), expectedVersion: z.string() }).strict(),
    out: z.object({ modelId: z.string(), status: ModelStatus }).strict(),
    err: [
      "NOT_ORG_ADMIN",
      "ADMISSION_TESTS_INCOMPLETE",
      "COMPOSITE_MEMBER_DISABLED",
      "VERSION_CHANGED",
    ] as const,
  },

  /**
   * 停用前的引用枚举——**无清单不得停用**。
   * ⚠ 四类引用 + **进行中调用数 N**（D-U5 的确认框要显示它）。
   * ⚠ 引用为空时返回空数组（**真实空态，不造数**）。
   */
  listModelReferences: {
    method: "GET",
    path: "/models/:modelId/references",
    in: z.object({ modelId: z.string() }).strict(),
    out: z
      .object({
        /** 停用后必须携带它调 `disableModel`，否则拒绝——「无清单不得停用」的落点 */
        referenceSnapshotId: z.string(),
        agents: z.array(z.string()),
        skills: z.array(z.string()),
        blueprintPolicies: z.array(z.string()),
        activeProjects: z.array(z.string()),
        inFlightCalls: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "REQUEST_TIMEOUT"] as const,
  },

  /**
   * UC-20.2 R3 步骤 3–4：停用与级联（**均为硬约束**）。
   *   · 新的选择：从所有选择器**消失**（不置灰，直接不出现）
   *   · 已有引用：转 `依赖失败` 并**停止被载入**，**不静默改配**（I-16）
   *   · `interrupt` = 立即中断并返回「该能力已被管理员停用」；`drain` = 跑完当前一轮，新调用即拒
   *   · **绝不静默换模型**
   * ⚠ `LAST_SELF_HOSTED_MODEL`：二次确认框须逐字说明「含机密任务将确定性失败」；
   *   **是否直接阻断 [待定]** → `KNOWN_CONTRACT_GAPS.AR5`。
   */
  disableModel: {
    method: "POST",
    path: "/models/:modelId/disable",
    in: z
      .object({
        modelId: z.string(),
        referenceSnapshotId: z.string(),
        mode: DisableMode,
        reason: z.string().min(1),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        disabled: z.literal(true),
        affectedAgentIds: z.array(z.string()),
        affectedSkillIds: z.array(z.string()),
        affectedProjectIds: z.array(z.string()),
        interruptedCalls: z.number().int().nonnegative(),
      })
      .strict(),
    err: [
      "NOT_ORG_ADMIN",
      "LAST_SELF_HOSTED_MODEL",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * **可选范围过滤器（唯一实现，三处复用）**。
   * ⚠ 候选集 = `已启用` 集合（I-2，**口径② 待裁决** → `KNOWN_CONTRACT_GAPS.AR6`）。
   * ⚠ **过滤在服务端**：即使前端被篡改也选不到未启用模型。
   * ⚠ `purpose = confidential` 时再收窄到 `self-hosted`（与 `routeModelCall` **同一判据**）。
   * ⚠ 候选为空 ⇒ 返回 `[]`，前端显示**真实空态**，**不预置默认值**。
   */
  listSelectableModels: {
    method: "GET",
    path: "/models/selectable",
    in: z.object({ consumer: ModelConsumer, purpose: ModelPurpose.nullable() }).strict(),
    out: z.array(ModelCandidate),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /**
   * 🔴 **机密硬路由的唯一执行点**（UC-20.3，本束安全内核）。
   *
   * 判定顺序（**顺序本身是契约**）：
   *   1. 逐项判机密性 —— 读 Context Pack 各 item 的 `artifactVersionId` 机密标记，
   *      **不得自行另查一套库**（I-13 / X-7）；标记缺失或冲突 ⇒ **从严按含机密**（I-12）
   *   2. 含机密 ⇒ 候选集 = `已启用 ∩ self-hosted`（I-10，⚠ 口径① 待裁 → `AR6`）
   *   3. 不含机密 ⇒ 候选集 = `已启用`
   *   4. 无可用自托管 ⇒ **明确失败**，**绝不回落闭源、绝不静默丢弃机密内容后继续**（I-11）
   *   5. 含机密 ⇒ **禁止降级**（即使阈值已触发）
   *   6. 写 `RoutingDecision`（**含拒绝**），**不记机密原文**（I-13）
   *   7. 任何绕过尝试 ⇒ 拒绝 + **越权拦截计数 +1**
   *
   * ⚠ **两道防线缺一不可**：① 本用例 ② `assembleSystemPrompt` 的 `# 硬约束` 段。
   *   提示可被模型忽略，**不能只有 ②**。
   * ⚠ R5：**无角色豁免**——组织管理员亦不能为某次调用开绿灯（所以 err 里没有任何角色码）。
   * ⚠ E5：标记在调用发起后变更 ⇒ 以**发起时**判定为准并留痕；已完成的调用不追溯。
   * ⚠ R9：结果可在**同一次调用内**缓存，**不得跨调用缓存**。
   */
  routeModelCall: {
    method: "POST",
    path: "/model-calls/route",
    in: z
      .object({
        callId: z.string(),
        /** ⚠ **唯一取数入口**（I-50）：机密判据只能来自它 */
        contextPackId: z.string(),
        requestedModelId: z.string().nullable(),
        taskKind: TaskKind,
      })
      .strict(),
    out: z
      .object({
        selectedModelId: z.string(),
        decisionId: z.string(),
        /**
         * 降级**不是错误**（usecases.md 顶部逐字）：普通生成达阈值时自动降级并**在消息上标注**。
         * ⚠ null = 未降级。含机密时本字段**恒为 null**——含机密禁止降级。
         */
        degradedTo: z.string().nullable(),
      })
      .strict(),
    err: [
      "NO_LOCAL_MODEL_AVAILABLE",
      "CONFIDENTIAL_ROUTE_VIOLATION",
      "MODEL_NOT_SELECTABLE",
      "COMPOSITE_MEMBER_DISABLED",
      "MODEL_DEPENDENCY_FAILED",
      "PROVENANCE_WRITE_FAILED",
    ] as const,
  },

  /**
   * 提示层硬约束注入（**第二道防线**）。
   * ⚠ `# 硬约束` 段**必须逐字包含**「客户机密材料只能由本地模型处理」，
   *   且可在「AI 读到了什么」中被**只读审查**（14-brain 宿主，跨束）。
   */
  assembleSystemPrompt: {
    method: "POST",
    path: "/model-calls/system-prompt",
    in: z.object({ callId: z.string(), contextPackId: z.string() }).strict(),
    out: z
      .object({
        prompt: z.string(),
        /** ⚠ 五段**恒五段且有序**——少一段就是少一道可审查面 */
        sections: z.array(z.enum(["# 角色", "# 客户与项目上下文", "# 方法", "# 证据", "# 硬约束"])),
      })
      .strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 路由决策检索。
   * ⚠ 落 `provenance_events`，与 UC-4.4 / 17-gov **共用同一份数据**（X-4），**不另建查询面**。
   */
  queryRoutingDecisions: {
    method: "GET",
    path: "/routing-decisions",
    in: z
      .object({
        projectId: z.string().nullable(),
        actorId: z.string().nullable(),
        since: z.string().nullable(),
        until: z.string().nullable(),
        outcome: RoutingOutcome.nullable(),
      })
      .strict(),
    out: z.array(RoutingDecision),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /* ───────────── B 组 · MCP（F52–F54 + F129–F131）───────────── */

  /**
   * UC-21.1 R3 步骤 1。
   * ⚠ 开关一为开时初始态恒为「待安全评审 ∧ 已隔离」（I-18）。
   * ⚠ E1：端点不可达或凭据无效 ⇒ **注册失败，不落半截记录**。
   * 🔴 **F131**：第三方源同时进入**隔离期**，`quarantineUntil` 由**组织参数**算出——
   *   本文件**不抄第二份 14**；`14` 是有出处的默认值（原型 `16,683,800`），落在参数侧。
   */
  registerMcpServer: {
    method: "POST",
    path: "/mcp-servers",
    in: z
      .object({
        name: z.string().min(1),
        /** ⚠ **必填**：「第三方·未审计」正是隔离的理由 */
        description: z.string().min(1),
        endpoint: z.string().min(1),
        /** ⚠ 只写不读（I-6） */
        credential: z.string().min(1),
        involvesCustomerData: z.boolean(),
        isEgress: z.boolean(),
        /** 🔴 F131：是否第三方源 —— 决定是否进入隔离期 */
        isThirdParty: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        serverId: z.string(),
        reviewStatus: McpReviewStatus,
        connectionStatus: McpConnectionStatus,
        /** 🔴 F131：`null` = 非第三方源。⚠ 天数来自组织参数，不是常量 */
        quarantineUntil: z.string().nullable(),
      })
      .strict(),
    err: [
      "NOT_ORG_ADMIN",
      "MCP_SERVER_UNREACHABLE",
      "DEPENDENCY_UNAVAILABLE",
      "REQUEST_TIMEOUT",
    ] as const,
  },

  /**
   * 工具发现 / 重新发现。
   * ⚠ **新增工具默认不进任何已有白名单**（I-21，避免权限静默扩大），
   *   且 `authScope` 恒为 `未开放`（`NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE`）。
   * ⚠ 签名变更 ⇒ 引用条目转 `签名已变更需重新确认`，**确认前不可用**（I-22）。
   *
   * 🔴 **F130 落地条 ⑶ 的落点就在这里**：重新发现若使 `sideEffect` 变化，
   *   必须**当场**对该工具重跑 `checkToolScopeCap` 并收紧 `authScope`，
   *   结果进 `tightenedByCapRecheck`。⚠ 这条最容易漏——只在 `setToolAuthScope`
   *   一个入口校验，会留下「从只读那一侧走进来」的绕过路径。
   */
  discoverMcpTools: {
    method: "POST",
    path: "/mcp-servers/:serverId/discover",
    in: z.object({ serverId: z.string() }).strict(),
    out: z
      .object({
        tools: z.array(McpTool),
        added: z.array(z.string()),
        /** ⚠ 删除的工具在引用它的 agent 上标为「工具已不存在」，**不静默消失** */
        removed: z.array(z.string()),
        signatureChanged: z.array(z.string()),
        /** 🔴 F130 ⑶：本次因 `sideEffect` 变化而被**当场收紧**的工具 */
        tightenedByCapRecheck: z.array(
          z
            .object({
              toolFullName: z.string(),
              fromAuthScope: ToolAuthScope,
              toAuthScope: ToolAuthScope,
              newSideEffect: ToolSideEffect,
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "MCP_SERVER_UNREACHABLE", "REQUEST_TIMEOUT"] as const,
  },

  /**
   * 三层权限第 ① 层（**服务器级上限**）。
   * ⚠ 变更前**列出受影响的 agent 与进行中任务**；**收紧立即生效（含进行中任务）**；放宽亦留痕。
   * 🔴 I-29′：本值是**上限**，工具级只能更严；收紧服务器级时越界的工具级值必须一并被夹到上限。
   */
  setAuthScope: {
    method: "PUT",
    path: "/mcp-servers/:serverId/auth-scope",
    in: z
      .object({
        serverId: z.string(),
        authScope: ToolAuthScope,
        teamId: z.string().nullable(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        serverId: z.string(),
        authScope: ToolAuthScope,
        affectedAgentIds: z.array(z.string()),
        affectedTaskIds: z.array(z.string()),
        /** 🔴 I-29′：因服务器级收紧而被夹到上限的工具级值 */
        clampedTools: z.array(
          z.object({ toolFullName: z.string(), toAuthScope: ToolAuthScope }).strict(),
        ),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "VERSION_CHANGED"] as const,
  },

  /**
   * 🔴 **F129 / F130：逐工具授权范围**（原型 `16,684,300` 逐字 `逐工具授权 · 9 个`）。
   *
   * ⚠ 写路径上**必须**调用 `checkToolScopeCap`（I-28′）与 `checkToolScopeWithinServer`（I-29′）
   *   **两条门**，任一不过即拒。**不得只在前端置灰**——置灰挡不住直接打 API。
   * ⚠ 越界的失败码是**两个不同的码**：封顶越界 `TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP`，
   *   服务器上限越界 `TOOL_SCOPE_EXCEEDS_SERVER_SCOPE`。合并成一个码会让界面无法说清
   *   「是这个工具太危险，还是这台服务器本来就没开这么宽」。
   * ⚠ `需人工确认每次` 必然带一条**逐次确认记录**（谁 / 何时 / 批的是哪一次调用），
   *   否则「确认过」无法证明，I-27 的第三层就没有落点 —— 见 `authorizeToolCall.out.confirmationId`。
   */
  setToolAuthScope: {
    method: "PUT",
    path: "/mcp-tools/:toolFullName/auth-scope",
    in: z
      .object({
        toolFullName: z.string(),
        authScope: ToolAuthScope,
        expectedVersion: z.string(),
      })
      .strict(),
    out: McpTool,
    err: [
      "NOT_ORG_ADMIN",
      "TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP",
      "TOOL_SCOPE_EXCEEDS_SERVER_SCOPE",
      "MCP_SERVER_ISOLATED",
      "VERSION_CHANGED",
    ] as const,
  },

  /**
   * UC-21.2 放行评审。
   * ⚠ `放行` **必须同时设定 `authScope`**（I-25，不允许「已连接但范围未定」）。
   * ⚠ **已放行 ≠ 自动进白名单**——仍需能力维护者显式添加。
   * ⚠ A1：可**退回补充材料**，退回理由留痕。
   * 🔴 **F131：期满不自动开放** —— 到期只是让 `reviewStatus` 转 `已到期待复核` 并进待办；
   *   放行仍要人点，且放行时仍须设授权范围。断言要写它**没有**转成 `已放行`，
   *   不是只断言它「还是隔离」。
   */
  reviewMcpServer: {
    method: "POST",
    path: "/mcp-servers/:serverId/review",
    in: z
      .object({
        serverId: z.string(),
        verdict: McpReviewVerdict,
        reason: z.string().min(1),
        authScope: ToolAuthScope.nullable(),
        grantedToolIds: z.array(z.string()),
      })
      .strict(),
    out: ReviewRecord,
    err: [
      "WRONG_REVIEW_FUNCTION",
      "SELF_REVIEW_FORBIDDEN",
      "REVIEW_REASON_REQUIRED",
      "SCOPE_REQUIRED_ON_RELEASE",
      "AUDIT_IMMUTABLE",
    ] as const,
  },

  /** 重新隔离。立即生效；进行中的调用被终止并**明确失败**（不静默） */
  reIsolateMcpServer: {
    method: "POST",
    path: "/mcp-servers/:serverId/isolate",
    in: z
      .object({ serverId: z.string(), mode: DisableMode, reason: z.string().min(1) })
      .strict(),
    out: z
      .object({
        serverId: z.string(),
        connectionStatus: McpConnectionStatus,
        affectedAgentIds: z.array(z.string()),
        interruptedCalls: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "REVIEW_REASON_REQUIRED"] as const,
  },

  /**
   * 四开关读。
   * ⚠ R9：策略服务不可用时按**最严**处理（视为全部隔离、全部需留痕），**不放行**——
   *   所以本操作的 err 里有 `DEPENDENCY_UNAVAILABLE`，而不是「读不到就给默认值」。
   */
  getSecurityPolicy: {
    method: "GET",
    path: "/security-policy",
    in: z.object({}).strict(),
    out: SecurityPolicy,
    err: ["NOT_ORG_ADMIN", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 四开关写。
   * ⚠ O-19：开关 3 **任何路径都不可关**；开关 4 **phase-1 无打开入口，直调 API 亦被拒**
   *   —— 两者都返回 `POLICY_SWITCH_LOCKED`，这是 `SecurityPolicy` 里两个 `z.literal` 的运行期投影。
   * ⚠ 开关必须是**真控制而非展示**：每条都要有服务端执行点与**可验证的拒绝行为**。
   */
  setSecurityPolicy: {
    method: "PUT",
    path: "/security-policy",
    in: z
      .object({
        switchNo: SecurityPolicySwitchNo,
        enabled: z.boolean(),
        /** ⚠ 开关 1/2 需**二次确认**；缺 token 即拒 */
        confirmToken: z.string().nullable(),
      })
      .strict(),
    out: SecurityPolicy,
    err: ["NOT_ORG_ADMIN", "POLICY_SWITCH_LOCKED"] as const,
  },

  /**
   * 🔴 **三层权限求交的服务端判定点**（本束权限内核）。
   *
   * ⚠ `有效权限 = ① ∩ ② ∩ ③`，任一层收紧即生效，**下层不得放宽上层**（I-27 / O-23）。
   * ⚠ 拒绝时**必须可解释是哪一层**（`EFFECTIVE_PERMISSION_DENIED.detail.layer`）。
   * ⚠ **被调 agent 独立求交，不继承主调方**（I-47）。
   * ⚠ 拒绝一律计入**越权拦截计数**并进后台数据总览。
   * 🔴 **F130**：`需人工确认每次` 的工具，每次调用产生一条 `confirmationId`
   *   （谁 / 何时 / 批的是哪一次调用）——没有它，「确认过」无法证明。
   * 🔴 **F131**：隔离期内非平台组调用 ⇒ `MCP_SERVER_IN_QUARANTINE`；
   *   平台组调用**通过**且**全量留痕**（含被拒的尝试），不受开关二影响。
   */
  authorizeToolCall: {
    method: "POST",
    path: "/tool-calls/authorize",
    in: z
      .object({
        agentId: z.string(),
        agentVersion: z.string(),
        toolFullName: z.string(),
        taskId: z.string().nullable(),
        actorId: z.string(),
      })
      .strict(),
    out: z
      .object({
        allowed: z.literal(true),
        /** ⚠ 三层各自的授予事实都要出现——只回一个 boolean 时「凭什么能用」无法回答 */
        grantingLayers: z.array(PermissionLayer),
        /** 🔴 F130：`需人工确认每次` 时非空，其余为 null */
        confirmationId: z.string().nullable(),
      })
      .strict(),
    err: [
      "AUTH_SCOPE_DENIED",
      "MCP_SERVER_ISOLATED",
      "MCP_SERVER_IN_QUARANTINE",
      "MCP_SERVER_UNREACHABLE",
      "MCP_RATE_LIMITED",
      "TOOL_SIGNATURE_CHANGED",
      "EFFECTIVE_PERMISSION_DENIED",
      "TASK_PERMISSION_MISSING",
      "AGENT_CANNOT_DISCOVER_MCP",
      "PERMISSION_REVOKED_MIDWAY",
    ] as const,
  },

  /**
   * 第 ③ 层的**申请**接口。
   * ⚠ **授权动作由人在任务侧完成（`[去授权]`），agent 不能自行加。**
   * ⚠ 权限包的**实现**属 00-core / 11-board（X-1），本束只暴露申请接口。
   */
  requestTaskPermissionGrant: {
    method: "POST",
    path: "/task-permission-grants",
    in: z
      .object({
        taskId: z.string(),
        toolFullName: z.string(),
        requestedByAgentId: z.string(),
        reason: z.string().min(1),
      })
      .strict(),
    out: z.object({ requestId: z.string(), state: z.literal("pending-human") }).strict(),
    err: ["TASK_PERMISSION_MISSING", "ROLE_INSUFFICIENT"] as const,
  },

  /**
   * MCP 服务器清单。
   * ⚠ 三字段各自独立返回，**不因界面合并展示而丢失任一维度**（I-17）。
   * ⚠ 清单为空 ⇒ 真实空态，**不预置示例服务器**。
   * ⚠ 工具调用量区块 phase-1 留空（D-07），**不得造数** —— 所以这里根本没有该字段。
   */
  listMcpServers: {
    method: "GET",
    path: "/mcp-servers",
    in: z
      .object({
        connectionStatus: McpConnectionStatus.nullable(),
        authScope: ToolAuthScope.nullable(),
        reviewStatus: McpReviewStatus.nullable(),
      })
      .strict(),
    out: z.array(McpServerRow),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /** 工具清单。⚠ 全名恒为 `mcp:<服务器>.<工具>`（I-20） */
  listMcpTools: {
    method: "GET",
    path: "/mcp-tools",
    in: z
      .object({ serverId: z.string().nullable(), sideEffect: ToolSideEffect.nullable() })
      .strict(),
    out: z.array(McpTool),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /* ───────────── C 组 · Agent（F55–F60）───────────── */

  /**
   * UC-4.1 R3 步骤 1 / A1：新建与复制。
   * ⚠ **复制不继承权限**（I-30 / O-22①）：工具白名单**恒为空**，必须重新配；
   *   因此新建出来就处于 `TOOL_WHITELIST_EMPTY` 硬闸门下。
   * ⚠ 社区导入 phase-1 **不实现**——只保留 `source=community` 取值，接口拒（`AGENT_MARKET_NOT_AVAILABLE`）。
   */
  createAgent: {
    method: "POST",
    path: "/agents",
    in: z
      .object({
        name: z.string().min(1),
        initials: z.string().min(1),
        role: z.string().min(1),
        visibility: z.enum(["全组织可用", "仅某组"]),
        /** null = 从零新建；非 null = 复制（`cloneAgent` 的入口合并在这里，同一条落库路径） */
        cloneFrom: z.string().nullable(),
        source: z.enum(["self", "community"]),
      })
      .strict(),
    out: z
      .object({
        agentId: z.string(),
        publishState: AgentPublishState,
        /** ⚠ **恒为空数组**——复制不继承权限（I-30） */
        toolWhitelist: z.array(ToolWhitelistEntry),
        cloneFrom: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "AGENT_NOT_FOUND", "AGENT_MARKET_NOT_AVAILABLE"] as const,
  },

  /**
   * 身份 / 行为 / 可见性 / 并发 / 降级。
   * ⚠ `modelId` **恒为单个**（I-3）；候选来自 `listSelectableModels`（I-2）。
   * ⚠ E7：并发修改**不得静默覆盖** ⇒ `VERSION_CHANGED`。
   * ⚠ E5：并发配置超配额上限时提交被拒并**给出可用上限**（`ROLE_INSUFFICIENT` 之外的业务拒绝，
   *   走 `VERSION_CHANGED` 之外的 detail —— 见 `KNOWN_CONTRACT_GAPS.AR7`：这个失败**没有码**）。
   */
  updateAgentDefinition: {
    method: "PATCH",
    path: "/agents/:agentId",
    in: z
      .object({
        agentId: z.string(),
        patch: z
          .object({
            role: z.string().optional(),
            visibility: z.enum(["全组织可用", "仅某组"]).optional(),
            proactiveSpeaking: z.boolean().optional(),
            requiresApproval: z.boolean().optional(),
            /** ⚠ 单个，不是数组——数组形状本身就会诱发 `MODEL_ID_MUST_BE_SINGLE` */
            modelId: z.string().optional(),
            /**
             * #660 —— 用户自建 agent 的**可执行定义**（系统提示词）。
             * 出处：`design-deltas/agent-instructions/design-signoff.md`，人类 2026-08-11
             * 选定**候选 A**。在它之前，浏览器里建出来的 agent 没有任何字段能承载
             * 「这个 agent 到底执行什么」，于是 `agent_versions.instructions`（NOT NULL）
             * 拼不出来 ⇒ 发布门全过也依然 422（#856 实测结论）。
             *
             * ⚠ **不是 `role`**。`role` 是「职责一句话」这种角色标签，给人看的；
             *   `instructions` 是运行时**真的会照着执行**的那段文本。delta 逐字禁止过
             *   用 `role`/`name` 硬凑 instructions —— 两个字段语义不同，不得互相顶替。
             * ⚠ 上限 8000 字符，与 DB 的 `agents_instructions_length` CHECK 同一个数
             *   （单一事实源在迁移里，这里是它的入口侧镜像）。
             * ⚠ **不在 `out` 里回显**：正文可能很长，每次编辑都带一份是纯浪费。
             */
            instructions: z.string().min(1).max(8000).optional(),
            concurrencyLimit: z.number().int().positive().optional(),
            degradePolicy: DegradePolicy.optional(),
          })
          .strict(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        agentId: z.string(),
        name: z.string(),
        role: z.string(),
        visibility: z.enum(["全组织可用", "仅某组"]),
        publishState: AgentPublishState,
        modelId: z.string().nullable(),
        concurrencyLimit: z.number().int().positive(),
        degradePolicy: DegradePolicy,
      })
      .strict(),
    err: [
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "MODEL_NOT_SELECTABLE",
      "MODEL_ID_MUST_BE_SINGLE",
      "COMPOSITE_MEMBER_DISABLED",
      "AGENT_NOT_FOUND",
    ] as const,
  },

  /**
   * #595 A2 —— **⚠⚠ 草案，尚未经人类签核**（ADR-023，登记在 issue #595）。
   *
   * ## 为什么不是 `mountSkill`
   *
   * 上面那条 `mountSkill` 名字和用途看起来撞了，**但形状对不上**：
   * `SkillMount.skillVersion: z.number()` 对应的是 `skill_contract_versions.version_number`
   * ——**模型 B**（声明式契约），而 #595 的产物全部落**模型 A**
   * （`skills`/`skill_versions`，`semantic_label` 是 text，没有整数版本号）。
   * `mountSkill` 本身也是**零实现**的契约（`agents/:agentId/skill-mounts` 路由
   * 全仓无 controller）。⇒ 复用它意味着把模型 A 的产物硬塞进一个为模型 B 设计的
   * 形状，或者反过来给模型 A 生造一个它没有的整数版本号——两条都是在**制造**
   * A/B 收敛，而 #598 明令本轮不做。⇒ 新开一条，全程留在模型 A。
   *
   * ## 为什么是「整体替换」而不是「追加一个」
   *
   * `skillVersionIds` 在 `agent_versions` 上是**有序数组**（顺序即 system prompt
   * 拼接顺序，见 `execute-run.ts` 的 `buildSystemPrompt`）。「追加」需要读出旧数组
   * 再拼接，「整体替换」把这个决定交给调用方、契约本身不做隐式合并——
   * 与 `mountSkillToThread` 的 `skillIds: string[]`（同样整体替换）同型。
   *
   * ## 为什么产出**新版本**而不是原地改
   *
   * `agent_versions` 上有 `agent_versions_immutable_trg`（DB 级，UPDATE/DELETE 一律拒），
   * 与 `skill_versions` 的不可变触发器同一形状。⇒ pin 一次 = 发布一个新版本，
   * 旧版本原样留存（审计可回看「这次调用当时挂的是哪个 skill 版本」）。
   *
   * ## 并发：`expectedVersion` 打 `agents.published_version_id`
   *
   * 与 `mountSkillToThread.expectedVersion` 同型：调用方带着自己看到的
   * `published_version_id` 提交，服务端发现已经变了就拒（`VERSION_CHANGED`），
   * ⛔ 不静默覆盖别人并发做的修改。
   */
  setAgentSkillPins: {
    method: "POST",
    path: "/admin/agents/:agentId/skill-pins",
    in: z
      .object({
        agentId: z.string(),
        /** 整体替换，非追加；见上方说明。⚠ 顺序即 system prompt 拼接顺序。 */
        skillVersionIds: z.array(z.string()).min(1),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        agentId: z.string(),
        /** 新产出的 agent 版本 id（原地改不存在，见上方说明） */
        versionId: z.string(),
        skillVersionIds: z.array(z.string()),
      })
      .strict(),
    /**
     * 取自 `AgentSkillPinsError.options`，不重复罗列——单一事实源同时喂
     * controller 的分支判断与 `all-exceptions.filter.ts` 的白名单登记。
     * （逐码含义：`ROLE_INSUFFICIENT` 同 #595 URL 导入/`mountSkill` 的 admin 门槛；
     * `AGENT_NOT_PUBLISHED` = agent 存在但 `published_version_id IS NULL`；
     * `VERSION_CHANGED` = `expectedVersion` 与当前 `published_version_id` 不一致；
     * `SKILL_VERSION_NOT_FOUND` = `skillVersionIds` 里有条目在本组织不存在或未发布。）
     */
    err: AgentSkillPinsError.options,
  },

  /** skill 挂载（**必须到版本粒度**）。⚠ 前置：skill `已启用` 且可见性范围覆盖本 agent */
  mountSkill: {
    method: "POST",
    path: "/agents/:agentId/skill-mounts",
    in: z
      .object({
        agentId: z.string(),
        skillId: z.string(),
        skillVersion: z.number().int().positive(),
      })
      .strict(),
    out: z.object({ mounts: z.array(SkillMount) }).strict(),
    err: ["ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE", "VERSION_CHANGED"] as const,
  },

  /**
   * 三层权限第 ②（本束权限内核）。
   * ⚠ 候选池 = `已连接`（或 `限流中`）∩ 授权范围覆盖该 agent 使用者的服务器的工具。
   * ⚠ **超出授权范围的条目不被静默丢弃，也不被静默批准**——保留为 `越权申请待确认`，
   *   由**安全评审人 + 组织管理员会签**逐条裁决。
   * ⚠ 粒度到**工具**而非服务器。
   * ⚠ 读原始转写、读客户资料**要单独授权**——即使在白名单里，仍需第 ③ 层批准。
   */
  setToolWhitelist: {
    method: "PUT",
    path: "/agents/:agentId/tool-whitelist",
    in: z
      .object({
        agentId: z.string(),
        entries: z.array(
          z.object({ toolFullName: z.string(), requested: z.literal(true) }).strict(),
        ),
      })
      .strict(),
    out: z
      .object({
        entries: z.array(ToolWhitelistEntry),
        /** ⚠ 计数不是装饰：`submitForReview` 与 `approvePublish` 都要看它是否已裁决完 */
        elevationRequests: z.number().int().nonnegative(),
      })
      .strict(),
    err: [
      "ROLE_INSUFFICIENT",
      "MCP_SERVER_ISOLATED",
      "TOOL_SIGNATURE_CHANGED",
      "AGENT_NOT_FOUND",
    ] as const,
  },

  /**
   * 「为什么被拒」可解释。
   * ⚠ 这是 I-27 的**可观测面**：三层各自的结果与最终交集都必须能读出来，
   *   否则「服务端可解释」是空话。
   */
  explainEffectivePermission: {
    method: "GET",
    path: "/agents/:agentId/effective-permission",
    in: z
      .object({
        agentId: z.string(),
        toolFullName: z.string(),
        actorId: z.string(),
        taskId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        layer1: z.object({ granted: z.boolean(), authScope: ToolAuthScope }).strict(),
        layer2: z.object({ granted: z.boolean(), state: ToolWhitelistEntryState }).strict(),
        layer3: z.object({ granted: z.boolean(), taskId: z.string().nullable() }).strict(),
        effective: z.array(z.string()),
        /** null = 未被拒 */
        deniedBy: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
      })
      .strict(),
    err: ["AGENT_NOT_FOUND", "ROLE_INSUFFICIENT"] as const,
  },

  /**
   * UC-4.1 R3 步骤 9：提交发布。
   * ⚠ `TOOL_WHITELIST_EMPTY` 的界面文案逐字为「**还没配工具白名单，不能发布**」（[原型]）。
   * ⚠ 服务端在提交时即阻断；**直接调接口置为 `运行中` 亦被拒并记审计**（I-28）。
   */
  submitAgentForReview: {
    method: "POST",
    path: "/agents/:agentId/submit",
    in: z.object({ agentId: z.string() }).strict(),
    out: z
      .object({
        publishState: AgentPublishState,
        securityScanPassed: z.boolean(),
        elevationRequests: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["TOOL_WHITELIST_EMPTY", "ROLE_INSUFFICIENT", "MODEL_NOT_SELECTABLE"] as const,
  },

  /**
   * 越权申请逐条裁决（O-21 会签）。
   * ⚠ **方法论审核人尝试裁决越权申请 ⇒ `WRONG_REVIEW_FUNCTION`。**
   * ⚠ 只有一条签名时该白名单条目**不生效**，审计视图标为**流程不合规**（I-29 / V22）——
   *   所以 `COUNTERSIGN_MISSING` 是一个**会被抛出的码**，不是提示文案。
   * ⚠ 理由：越权申请实际在**扩大 MCP 授权范围（第 ① 层）**，所以要管理员会签。
   */
  decideElevationRequest: {
    method: "POST",
    path: "/agents/:agentId/elevation-requests/decide",
    in: z
      .object({
        agentId: z.string(),
        toolFullName: z.string(),
        verdict: ElevationVerdict,
        reason: z.string().min(1),
        signature: z.object({ role: CountersignRole, actorId: z.string() }).strict(),
      })
      .strict(),
    out: z
      .object({
        toolFullName: z.string(),
        verdict: ElevationVerdict,
        securityReviewerSig: z.string().nullable(),
        orgAdminSig: z.string().nullable(),
        /** ⚠ 两签齐全前恒为 false —— 条目**不生效**，而不是「生效但标记一下」 */
        effective: z.boolean(),
      })
      .strict(),
    err: [
      "WRONG_REVIEW_FUNCTION",
      "SELF_REVIEW_FORBIDDEN",
      "COUNTERSIGN_MISSING",
      "REVIEW_REASON_REQUIRED",
    ] as const,
  },

  /**
   * UC-4.1 R3 步骤 10：批准发布 / 退回。
   * ⚠ **安全评审人尝试 `[批准发布]` ⇒ `WRONG_REVIEW_FUNCTION`**（两职能不合并）。
   * ⚠ 批准即生成**不可变 `AgentVersion` 快照**（I-31 / O-22⑤）——
   *   没有它，UC-4.4 的「当时跑的是哪一版」无法回答。
   */
  decideAgentPublish: {
    method: "POST",
    path: "/agents/:agentId/publish-decision",
    in: z
      .object({
        agentId: z.string(),
        decision: z.enum(["批准发布", "退回"]),
        reason: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        publishState: AgentPublishState,
        /** ⚠ 仅 `批准发布` 时非空 */
        agentVersionId: z.string().nullable(),
      })
      .strict(),
    err: [
      "WRONG_REVIEW_FUNCTION",
      "SELF_REVIEW_FORBIDDEN",
      "SECURITY_SCAN_PENDING",
      "METHODOLOGY_REVIEW_PENDING",
      "ELEVATION_UNDECIDED",
      "TOOL_WHITELIST_EMPTY",
    ] as const,
  },

  /**
   * #660 ——「**无能力面自助发布**」。
   * 人类 2026-08-11 已签核（`design-deltas/agent-instructions/design-signoff.md`
   * 随候选 A 一并确认）；遗留的真缺口另记在 `KNOWN_CONTRACT_GAPS.AR12`。
   *
   * ## 它补的洞
   *
   * `createAgent` 落 `草稿`，而 `草稿 → 运行中` 的唯一出口是
   * `submitAgentForReview` → `decideAgentPublish`。那条路径要求
   * ① 工具白名单非空（I-28）② 审核人是**另一个**方法论审核人（O-21）。
   * 于是**一个刚注册的独人组织，其自建 agent 结构性地永远发不出去**——
   * 实测就是 chat 里选中它发消息恒 **422**（`create-agent-publish-path.test.ts`）。
   *
   * ## 豁免的**唯一**理由，以及它为什么不是「降级放行」
   *
   * 双人评审审的是**这个 agent 被授予了什么能力**：工具白名单（第 ② 层）与
   * skill 挂载。一个 `toolWhitelist = []` **且** `skillMounts = []` 的 agent
   * 没有任何可被授予的能力面——它只能用与系统预置 `通用助手` 完全相同的执行
   * 路径说话。**没有能力面 ⇒ 评审没有对象**，这与 `SELF_REVIEW_FORBIDDEN` 头注
   * 逐字禁止的「组织内无第二人时降级放行」是两件事：那条禁的是**有东西要审、
   * 却因为凑不齐人而放行**；这条说的是**压根没有东西要审**。
   *
   * ⚠ 因此本操作**不碰** `submitAgentForReview` / `decideAgentPublish` 的任何一道门，
   *   也不引入 `NO_SECOND_REVIEWER` 之类的"独人组织特例"。有能力面的 agent
   *   仍然只有双人路径一条路（`AGENT_NOT_TOOLLESS`）。
   *
   * ⚠ **单向性**：本操作是 `草稿 → 运行中` 的一条边，不是「发布态」的旁路开关。
   *   一个已自助发布的 agent 事后要加工具/skill，仍须走完整评审——
   *   这一条由 `setToolWhitelist` / `mountSkill` 各自的门负责，不在这里第二次声明。
   *
   * ⚠ **审计可分辨**：这样发布出来的版本必须能与走完双人评审发布的版本区分开，
   *   否则「这一版当时是怎么发出去的」在 UC-4.4 里答不出来。
   *
   * ⚠ **与 #856 的双人评审路径是互补关系，不是二选一**：
   *   有能力面（有工具 / 有 skill 挂载）⇒ 只能走 `submitAgentForReview` →
   *   `decideAgentPublish`；无能力面 ⇒ 走本操作。两条路径各自有仓储与前提测试。
   *
   * ⚠ **前置：agent 必须已有可执行定义**（`agents.instructions` 非空白）。
   *   否则 `AGENT_NO_EXECUTABLE_DEFINITION` —— 发布一个没有指令的 agent，
   *   拿到的是一条铸不出版本、发消息照样 422 的"已发布"，比拒绝更糟。
   */
  selfPublishToollessAgent: {
    method: "POST",
    path: "/agents/:agentId/self-publish",
    in: z.object({ agentId: z.string() }).strict(),
    out: z
      .object({
        agentId: z.string(),
        publishState: AgentPublishState,
        /** 新铸的不可变版本快照（I-31 / O-22⑤）——`resolvePublished` 就靠它。 */
        agentVersionId: z.string(),
        /** ⚠ 恒为 `自助发布`：审计里这一版与双人评审发出的版本必须可分辨。 */
        publishRoute: z.literal("自助发布"),
      })
      .strict(),
    err: [
      "ROLE_INSUFFICIENT",
      "AGENT_NOT_FOUND",
      "AGENT_NOT_DRAFT",
      "AGENT_NOT_TOOLLESS",
      "AGENT_VISIBILITY_UNSUPPORTED",
      "AGENT_NO_EXECUTABLE_DEFINITION",
    ] as const,
  },

  /**
   * UC-4.1 R3 步骤 8：`[试跑]`。
   * ⚠ 试跑**不写入正式记录**，产生的调用**单独标记为 `试跑`**、不计入项目审计的正式事件流，
   *   **但仍需留痕**（A5）——所以 `ToolCallRecord.runState` 有 `试跑` 这一档。
   * ⚠ 试跑 ≠ 私聊：两者的上下文、留痕与转出能力都不同，
   *   **不得复用同一实现而混淆审计归属**。
   */
  trialRunAgent: {
    method: "POST",
    path: "/agents/:agentId/trial-run",
    in: z.object({ agentId: z.string(), scenario: z.string().min(1) }).strict(),
    out: z
      .object({
        steps: z.array(z.object({ ordinal: z.number().int(), text: z.string() }).strict()),
        toolCalls: z.array(ToolCallRecord),
        dataRead: z.array(z.string()),
        durationMs: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        /** ⚠ R9：超过 10 秒转异步并保留结果；非 null 时前四项为本次已完成的部分 */
        asyncTaskId: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "AGENT_DEPENDENCY_FAILED", "REQUEST_TIMEOUT"] as const,
  },

  /** O-22④。⚠ 停用后不再被载入、不出现在编排与私聊入口；**已锁版本的在跑项目不受影响**（I-32） */
  disableAgent: {
    method: "POST",
    path: "/agents/:agentId/disable",
    in: z
      .object({ agentId: z.string(), mode: DisableMode, reason: z.string().min(1) })
      .strict(),
    out: z
      .object({
        publishState: AgentPublishState,
        interruptedTasks: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "REVIEW_REASON_REQUIRED"] as const,
  },

  /** D-30：项目开工锁版本。⚠ 运行期内不因 agent 被改动而漂移（I-31）；审计中可读出该版本号 */
  lockAgentVersionForProject: {
    method: "POST",
    path: "/projects/:projectId/agent-version-locks",
    in: z.object({ projectId: z.string(), agentIds: z.array(z.string()) }).strict(),
    out: z
      .object({
        locks: z.array(
          z.object({ agentId: z.string(), agentVersionId: z.string() }).strict(),
        ),
      })
      .strict(),
    err: ["AGENT_NOT_FOUND", "AGENT_DISABLED"] as const,
  },

  /**
   * Agent 库。
   * ⚠ 可见性范围外的 agent **不出现，且接口不返回其存在性**（I-52）。
   * ⚠ 库为空 ⇒ 真实空态，**不生成示例 agent**。
   */
  listAgents: {
    method: "GET",
    path: "/agents",
    in: z
      .object({
        tag: z.string().nullable(),
        publishState: AgentPublishState.nullable(),
        visibility: z.enum(["全组织可用", "仅某组"]).nullable(),
      })
      .strict(),
    out: z.array(AgentRow),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /**
   * UC-4.2 阶段三：状态事件 → 载入求值。
   * ⚠ **幂等**（I-35）：同一事件重复投递不重复载入、计数不翻倍。
   * ⚠ 命中多条时**取前 4 个**，被裁剪的进 `prunedByPriority` **可查**（I-37，不得静默丢弃）。
   * ⚠ 触发条件**只能引用 `agendaSegmentId`**（I-36 / D-03a）——
   *   写 `designFacetId` 或 `methodStageId` 是 D-03a 明令禁止的。
   * ⚠ E2：规则引用的 agent 已不在 `运行中` ⇒ **跳过并明确提示**，**不静默降级为别的 agent**。
   */
  evaluateLoadRules: {
    method: "POST",
    path: "/threads/:threadId/load-rules/evaluate",
    in: z
      .object({
        threadId: z.string(),
        event: LoadRuleTriggerEvent,
        agendaSegmentId: z.string(),
        idempotencyKey: z.string(),
      })
      .strict(),
    out: z
      .object({
        roster: z.array(AgentPresence),
        loadedBecause: z.array(
          z
            .object({
              agentId: z.string(),
              triggerEvent: LoadRuleTriggerEvent,
              matchedRuleId: z.string(),
            })
            .strict(),
        ),
        /** ⚠ 被裁剪的**必须可查**，不得静默丢弃（I-37） */
        prunedByPriority: z.array(
          z.object({ agentId: z.string(), ruleId: z.string() }).strict(),
        ),
        nextSegmentPreview: z.array(z.string()),
        /** ⚠ E2：被跳过的规则要**明确提示**，不静默换人 */
        skippedNotRunning: z.array(z.string()),
      })
      .strict(),
    err: ["AGENT_DEPENDENCY_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 线程级 AI 团队投影。
   * ⚠ **`rosterCount` 与 `presentCount` 是两个字段，接口不得混用同一个键**（I-34）。
   * ⚠ E8：实时通道不可用 ⇒ 降级为轮询并返回 `stale`，前端**必须显示「非实时」与最后更新时间**，
   *   **不得让引导师以为团队已切换**。
   */
  getThreadAiTeam: {
    method: "GET",
    path: "/threads/:threadId/ai-team",
    in: z.object({ threadId: z.string() }).strict(),
    out: z
      .object({
        roster: z.array(AgentPresence),
        rosterCount: z.number().int().nonnegative(),
        presentCount: z.number().int().nonnegative(),
        /** null = 实时。非 null ⇒ 前端**必须**显示「非实时」与该时刻 */
        staleSince: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /**
   * `[编制]` / 加入 / 静音 / 复位。
   * ⚠ 手工编制**覆盖**本轮规则求值结果，直到下一次状态变化或引导师复位。
   * ⚠ **冲突优先级与失效时机 [待定]**（domain ⑫）→ `KNOWN_CONTRACT_GAPS.AR8`。
   */
  composeThreadTeam: {
    method: "POST",
    path: "/threads/:threadId/ai-team",
    in: z
      .object({
        threadId: z.string(),
        add: z.array(z.string()),
        remove: z.array(z.string()),
        muteAllProactive: z.boolean(),
        reset: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        roster: z.array(AgentPresence),
        rosterCount: z.number().int().nonnegative(),
        presentCount: z.number().int().nonnegative(),
      })
      .strict(),
    err: [
      "ROLE_INSUFFICIENT",
      "AGENT_NOT_FOUND",
      "AGENT_DISABLED",
      "AGENT_MARKET_NOT_AVAILABLE",
    ] as const,
  },

  /**
   * 项目级三开关（读）。
   * ⚠ `有效值 = 组织/agent ∩ 项目 ∩ 画布/线程`，**下层只能更严**（O-23），**服务端求交**。
   * ⚠ **默认值不在本契约里**——三项的默认值出处曾被伪造（F58），现登记在
   *   `thresholds.ts` 的 `projectAiDefault*`（`known: false`）。取值抛错，而不是给一个
   *   从未被裁决的 `false`。
   */
  getProjectAiPermissions: {
    method: "GET",
    path: "/projects/:projectId/ai-permissions",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        /** 项目层的显式设置。null = **本层未设置**，取上层值——与「设置为关」是两件事 */
        facilitatorProposesConvergence: z.boolean().nullable(),
        liveTranscription: z.boolean().nullable(),
        aiWritesOnCanvas: z.boolean().nullable(),
        /** 三粒度求交后的**有效值**（服务端算）。⚠ 前端不得自行合成 */
        effective: z
          .object({
            facilitatorProposesConvergence: z.boolean(),
            liveTranscription: z.boolean(),
            aiWritesOnCanvas: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /**
   * 项目级三开关（写）。
   * ⚠ 协同引导师变更须由**主持人确认**（它改变全场 AI 行为边界）。
   * ⚠ 变更须留痕且**对项目成员可见**（谁在何时关了什么）。
   * ⚠ A5：某项被关闭时，依赖它的 agent/skill 在编制列表里标为「本场已关闭」并说明去哪里开，
   *   **不静默不工作**。
   */
  setProjectAiPermissions: {
    method: "PATCH",
    path: "/projects/:projectId/ai-permissions",
    in: z
      .object({
        projectId: z.string(),
        patch: z
          .object({
            facilitatorProposesConvergence: z.boolean().optional(),
            liveTranscription: z.boolean().optional(),
            aiWritesOnCanvas: z.boolean().optional(),
          })
          .strict(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        effective: z
          .object({
            facilitatorProposesConvergence: z.boolean(),
            liveTranscription: z.boolean(),
            aiWritesOnCanvas: z.boolean(),
          })
          .strict(),
        /** A5：因本次关闭而受限的能力，界面据此标「本场已关闭」 */
        disabledCapabilities: z.array(z.string()),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "VERSION_CHANGED"] as const,
  },

  /**
   * 改派路由 —— **建议**。
   * ⚠ 判据是**三层权限求交后的授权集**比对（不是模糊匹配）。
   * ⚠ 理由**必须写出具体授权名**，不得只说「更合适」。
   * ⚠ R9：建议的生成**不得泄露当前用户无权知晓的授权信息**——
   *   只说「它有行业数据库授权」，不列出具体工具与凭据。
   * ⚠ 行业数据库 MCP 置为已隔离后，该建议**不再出现**（所以它读的是活的授权集，不是缓存）。
   * ⚠ **组员是否能看到改派提示 [待定]** → `KNOWN_CONTRACT_GAPS.AR8`。
   */
  suggestRedispatch: {
    method: "GET",
    path: "/threads/:threadId/messages/:messageId/redispatch-suggestion",
    in: z.object({ threadId: z.string(), messageId: z.string() }).strict(),
    out: z
      .object({
        /** null = 无建议（**正常空态**，不是失败） */
        suggestedAgentId: z.string().nullable(),
        /** ⚠ 具体授权名，例如「行业数据库授权」；null 当且仅当无建议 */
        reasonAuthorityName: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "AGENT_NOT_FOUND"] as const,
  },

  /** ⚠ **改派是建议，必须人点 `[改派]`**；`[×]` 可忽略——所以 `accept` 是入参不是推断 */
  applyRedispatch: {
    method: "POST",
    path: "/threads/:threadId/messages/:messageId/redispatch",
    in: z
      .object({ threadId: z.string(), messageId: z.string(), accept: z.boolean() })
      .strict(),
    out: z.object({ applied: z.boolean(), newAgentId: z.string().nullable() }).strict(),
    err: ["ROLE_INSUFFICIENT", "AGENT_NOT_FOUND"] as const,
  },

  /**
   * UC-4.3 开私聊。
   * ⚠ **私聊不构成提权**（I-40）：三层权限 + 项目级 AI 权限同样生效；高风险动作照样弹批准卡。
   * ⚠ **对话不进主线程**（I-39）：不进消息流、转录、洞察、产物，也不计入线程消息数与在场编制。
   * ⚠ **归项目层**（O-24），入口/面板**必须明示**「本对话属于本项目，可被审计」（I-41）。
   * ⚠ 观察者**无私聊入口且接口拒绝**；组员需引导师**逐场**开启。
   */
  openPrivateChat: {
    method: "POST",
    path: "/threads/:threadId/private-chats",
    in: z.object({ threadId: z.string(), agentId: z.string() }).strict(),
    out: z
      .object({
        chatId: z.string(),
        agentVersion: z.string(),
        skillMounts: z.array(SkillMount),
        presence: z.enum(["在场", "静音", "跑批中", "依赖失败"]),
        modelId: z.string(),
        /** 非 null ⇒ 界面必须标注「降级运行 · <模型>」，**不静默** */
        degradedBadge: z.string().nullable(),
        /** ⚠ 逐字文案，**入口/面板必须明示**（I-41 的义务侧） */
        auditNotice: z.literal("本对话属于本项目，可被审计"),
      })
      .strict(),
    err: [
      "AGENT_NOT_FOUND",
      "PRIVATE_CHAT_DISABLED",
      "ROLE_INSUFFICIENT",
      "AGENT_DEPENDENCY_FAILED",
      "EFFECTIVE_PERMISSION_DENIED",
      "NO_LOCAL_MODEL_AVAILABLE",
    ] as const,
  },

  /**
   * 私聊发言。
   * ⚠ E1：agent 在私聊中被换出编制 ⇒ **私聊不中断**，但提示「它已不在本线程在场名单里」。
   * ⚠ E2：依赖失败 ⇒ **明确失败或明确降级并标注**，**不静默换模型、不静默跳过工具调用**。
   */
  postPrivateMessage: {
    method: "POST",
    path: "/private-chats/:chatId/messages",
    in: z.object({ chatId: z.string(), text: z.string().min(1) }).strict(),
    out: z
      .object({
        messageId: z.string(),
        toolCalls: z.array(ToolCallRecord),
        /** E1：非 null 时界面显示该提示，**但对话不中断** */
        notice: z.string().nullable(),
      })
      .strict(),
    err: [
      "AGENT_DEPENDENCY_FAILED",
      "EFFECTIVE_PERMISSION_DENIED",
      "PRIVATE_CHAT_DISABLED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 转出结论到主线程。
   * ⚠ 转出内容在主线程中仍标识为**机器产出**，并可点回私聊原文（受权限约束）。
   * ⚠ **转出后是否允许撤回 [待定]** → `KNOWN_CONTRACT_GAPS.AR8`。
   */
  transferConclusionToThread: {
    method: "POST",
    path: "/private-chats/:chatId/transfer",
    in: z
      .object({ chatId: z.string(), messageId: z.string(), targetThreadId: z.string() })
      .strict(),
    out: z
      .object({
        threadMessageId: z.string(),
        /** ⚠ 六项**缺一即 `TRANSFER_PROVENANCE_INCOMPLETE`**（I-42），不是「尽量带上」 */
        provenance: z
          .object({
            agentId: z.string(),
            agentVersion: z.string(),
            skillId: z.string().nullable(),
            skillVersion: z.number().int().positive().nullable(),
            at: z.string(),
            dataSources: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    err: [
      "TRANSFER_TARGET_READONLY",
      "TRANSFER_PROVENANCE_INCOMPLETE",
      "ROLE_INSUFFICIENT",
    ] as const,
  },

  /** 组员私聊逐场开关（O-24）。⚠ **逐场生效，不跨场继承** */
  setMemberPrivateChatSwitch: {
    method: "PUT",
    path: "/projects/:projectId/member-private-chat",
    in: z.object({ projectId: z.string(), enabled: z.boolean() }).strict(),
    out: z
      .object({ enabled: z.boolean(), scope: z.literal("this-session-only") })
      .strict(),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /**
   * UC-4.4 阶段一：**tool-call 四要素写入**。
   * ⚠ **硬前置：写入失败 ⇒ 该次工具调用必须失败**（I-44）。
   *   **不允许「调用成功但没留痕」**——审计是硬前置，不是旁路。
   * ⚠ 落 `provenance_events`（**append-only**，I-45）；写入属**持久任务系统**侧
   *   （不可丢、可重放），**不得挂在 LangGraph 图上**。
   * ⚠ 缺 `agentVersion`/`skillVersion`/`modelId`/`permissionSnapshot` 任一项即审计不完整（I-48）——
   *   **校验拒绝写入，而非静默补空**（所以这些字段在 in 里不是 optional）。
   */
  recordToolCall: {
    method: "POST",
    path: "/tool-calls",
    in: z
      .object({
        callId: z.string(),
        signature: z.string(),
        params: z.string(),
        hitCount: z.number().int().nonnegative(),
        runState: z.enum(["成功", "失败", "被拒", "试跑"]),
        durationMs: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        callerAgentId: z.string(),
        agentVersion: z.string(),
        skillVersion: z.string().nullable(),
        modelId: z.string(),
        permissionSnapshot: z.string(),
        grantingLayer: PermissionLayer.nullable(),
        messageId: z.string(),
        threadId: z.string(),
        projectId: z.string(),
      })
      .strict(),
    out: z.object({ recordId: z.string() }).strict(),
    err: ["PROVENANCE_WRITE_FAILED"] as const,
  },

  /**
   * 消息级摘要（[原型]「思考了 8.2 秒 · 4 步」「工具调用 · 3 ｜ 读了 64 条 · 12.4k token」）。
   * ⚠ R9：tool-call 记录数比审计条目**高一到两个数量级**，必须分页/增量加载，
   *   **禁止一次加载整个项目历史**——所以 `calls` 带游标。
   */
  getMessageToolSummary: {
    method: "GET",
    path: "/messages/:messageId/tool-summary",
    in: z.object({ messageId: z.string(), cursor: z.string().nullable() }).strict(),
    out: z
      .object({
        thinkSeconds: z.number().nonnegative(),
        steps: z.number().int().nonnegative(),
        toolCallCount: z.number().int().nonnegative(),
        readItems: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        calls: z.array(ToolCallRecord),
        nextCursor: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT"] as const,
  },

  /**
   * agent 互调。
   * ⚠ **深度上限 2**（O-36）；深度 3 **在第 3 层被终止**并留痕（I-46）。
   * ⚠ **被调方不继承主调方权限**——独立按三层权限求交（I-47）。
   * ⚠ E4：被调 agent 已不在 `运行中` 或权限不覆盖 ⇒ 调用被拒并留痕，
   *   主调方**明确失败，不静默换 agent**。
   * ⚠ 未获批准即终止的调用链**同样留痕**（`已拒绝` / `已取消`）。
   */
  recordCallChainHop: {
    method: "POST",
    path: "/call-chains/hops",
    in: z
      .object({
        callerAgentId: z.string(),
        calleeAgentId: z.string(),
        taskName: z.string(),
        depth: z.number().int().positive(),
        tokens: z.number().int().nonnegative(),
      })
      .strict(),
    out: z
      .object({ chainId: z.string(), approvalState: CallChainApprovalState })
      .strict(),
    err: [
      "CALL_DEPTH_EXCEEDED",
      "EFFECTIVE_PERMISSION_DENIED",
      "AGENT_DISABLED",
      "PROVENANCE_WRITE_FAILED",
    ] as const,
  },

  /**
   * 批准卡三个出口。
   * ⚠ **`[改]` 面板在含机密时只列自托管候选**；提交闭源模型 ⇒ `CONFIDENTIAL_ROUTE_VIOLATION`。
   * ⚠ 批准人**不能改变路由结果**，只能批准或取消（R5）——`patch` 里因此**没有** `selectedModelId`
   *   这种能覆盖路由的字段，`modelId` 只在候选集内取值且仍要过 `routeModelCall`。
   * ⚠ 高影响操作的 HITL 用 LangGraph 动态 `interrupt()`，**checkpoint 必须落库，
   *   节点恢复时副作用必须幂等**。
   */
  decideApproval: {
    method: "POST",
    path: "/call-chains/:chainId/approval",
    in: z
      .object({
        chainId: z.string(),
        action: ApprovalAction,
        patch: z
          .object({
            modelId: z.string().optional(),
            tokenBudget: z.number().int().positive().optional(),
          })
          .strict(),
      })
      .strict(),
    out: z
      .object({
        state: CallChainApprovalState,
        /** 批准后转后台任务（[原型]「约 6 分钟回到本线程」`[看任务队列]`） */
        backgroundTaskId: z.string().nullable(),
      })
      .strict(),
    err: [
      "CONFIDENTIAL_ROUTE_VIOLATION",
      "NO_LOCAL_MODEL_AVAILABLE",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
    ] as const,
  },

  /**
   * 项目级审计时间线（**已存在的屏，别搬走**）。
   * ⚠ **四类事件同一条时间线，不可删除**（I-51）。任何删除/修改请求一律被拒并记安全审计。
   * ⚠ 无数据 ⇒ 真实空态与原因，**不生成示例条目**。
   */
  queryAuditTimeline: {
    method: "GET",
    path: "/projects/:projectId/audit",
    in: z
      .object({
        projectId: z.string(),
        types: z.array(AuditEntryType),
        agentId: z.string().nullable(),
        elevated: z.boolean().nullable(),
        approved: z.boolean().nullable(),
        since: z.string().nullable(),
        until: z.string().nullable(),
        cursor: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        entries: z.array(
          z
            .object({
              entryId: z.string(),
              type: AuditEntryType,
              at: z.string(),
              actorId: z.string(),
              summary: z.string(),
              elevated: z.boolean(),
            })
            .strict(),
        ),
        counts: z
          .object({
            all: z.number().int().nonnegative(),
            roleChange: z.number().int().nonnegative(),
            version: z.number().int().nonnegative(),
            agentCall: z.number().int().nonnegative(),
            decision: z.number().int().nonnegative(),
          })
          .strict(),
        nextCursor: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "AUDIT_IMMUTABLE"] as const,
  },

  /** ⚠ 导出内容**与界面一致、可复现**；大批量转异步并给回执，**不阻塞页面** */
  exportAudit: {
    method: "POST",
    path: "/projects/:projectId/audit/export",
    in: z.object({ projectId: z.string(), format: z.enum(["csv", "json"]) }).strict(),
    out: z
      .object({
        /** 二选一：小批量直接给下载地址，大批量给异步任务号 */
        downloadUrl: z.string().nullable(),
        asyncTaskId: z.string().nullable(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "EXPORT_TOO_LARGE"] as const,
  },

  /**
   * 审计条目下钻。
   * ⚠ A3：**参数含敏感值时默认脱敏展示**，有权者展开原值，**展开动作本身留痕**（D-16）。
   * ⚠ A4：私聊中的工具调用同样进本时间线，但审计**只暴露调用元数据，不暴露私聊正文**。
   * ⚠ **「被采纳 / 被忽略」的判定方式 [待定]** → `KNOWN_CONTRACT_GAPS.AR9`；
   *   本文件仍返回两个数组，因为空数组与「这个问题没答案」是两件事——
   *   判据定下来之前它们恒为 `[]`，而不是被悄悄用相似度填满。
   */
  drillDownAuditEntry: {
    method: "GET",
    path: "/audit/entries/:entryId",
    in: z.object({ entryId: z.string() }).strict(),
    out: z
      .object({
        input: z.string(),
        contextPackId: z.string(),
        injectedSkills: z.array(SkillMount),
        toolCalls: z.array(ToolCallRecord),
        callChain: z.array(
          z
            .object({ chainId: z.string(), depth: z.number().int(), calleeAgentId: z.string() })
            .strict(),
        ),
        approvals: z.array(
          z.object({ chainId: z.string(), state: CallChainApprovalState }).strict(),
        ),
        adopted: z.array(z.string()),
        ignored: z.array(z.string()),
        /** A3：true ⇒ 当前返回的是脱敏值，展开需另一次带审计的请求 */
        redacted: z.boolean(),
      })
      .strict(),
    err: ["ROLE_INSUFFICIENT", "AGENT_NOT_FOUND"] as const,
  },

  /**
   * 组织级跨项目检索（D-34，**屏尚未建**）。
   * ⚠ **D-18：管理员读项目内容须写审计日志且对项目负责人可见**——
   *   管理员的**每次审计访问本身也是审计事件**（所以 out 带 `accessAuditId`）。
   * ⚠ 个人层只见计数（管理员权力边界在本束**不放宽**）。
   */
  queryOrgAudit: {
    method: "GET",
    path: "/org-audit",
    in: z
      .object({
        projectId: z.string().nullable(),
        actorId: z.string().nullable(),
        since: z.string().nullable(),
        until: z.string().nullable(),
        cursor: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        entries: z.array(
          z
            .object({
              entryId: z.string(),
              projectId: z.string(),
              type: AuditEntryType,
              at: z.string(),
              actorId: z.string(),
            })
            .strict(),
        ),
        nextCursor: z.string().nullable(),
        /** ⚠ D-18：本次访问自身的审计事件 id，**对项目负责人可见** */
        accessAuditId: z.string(),
      })
      .strict(),
    err: ["NOT_ORG_ADMIN", "EXPORT_TOO_LARGE"] as const,
  },

  /**
   * 异常检测清单。
   * ⚠ **额度异常判据 = 24 小时滚动窗口均值的 10 倍**（O-36），**不是绝对阈值**；
   *   命中即**自动限速**（系统动作，**不等人**）。
   * ⚠ **越权调用必须拦截并计数**，不是仅记录。
   * ⚠ D-07 边界：**异常检测所需实时用量判据保留**，面向展示的统计报表不做。
   */
  listAnomalies: {
    method: "GET",
    path: "/anomalies",
    in: z
      .object({ severity: AnomalySeverity.nullable(), handled: z.boolean().nullable() })
      .strict(),
    out: z.array(Anomaly),
    err: ["NOT_ORG_ADMIN"] as const,
  },

  /**
   * `[标记为正常]`。
   * ⚠ 须**填理由**，解除限速，观察期内同类行为不再重复告警。
   * ⚠ 限速与拦截**本身是审计事件，且对当事人可见**（被审计对象本人应能看到针对自己的告警与理由）。
   */
  markAnomalyNormal: {
    method: "POST",
    path: "/anomalies/:anomalyId/mark-normal",
    in: z.object({ anomalyId: z.string(), reason: z.string().min(1) }).strict(),
    out: z.object({ rateLimitReleased: z.literal(true) }).strict(),
    err: ["NOT_ORG_ADMIN", "REVIEW_REASON_REQUIRED"] as const,
  },

  /**
   * 架构 P4：agent run 四件套可重放。
   * ⚠ AC1「**当时的输入**」就是那次 run 的 Context Pack，**必须可重放**（I-49，跨 phase-00）。
   * ⚠ `retrievalReasons` / `omissions` / `permissionDecisionId` 使
   *   「为什么读到这条」「少读了什么」「凭什么能看」三问可回答。
   *   ⚠ 三者**引用 `context-pack` 束的形状**，本束不抄一份（所以这里只带 id 与计数，
   *   完整结构从 `contextPack.getContextPack` 取）。
   */
  replayAgentRun: {
    method: "GET",
    path: "/agent-runs/:runId/replay",
    in: z.object({ runId: z.string() }).strict(),
    out: z
      .object({
        plan: z.string(),
        steps: z.array(z.object({ ordinal: z.number().int(), text: z.string() }).strict()),
        checkpoints: z.array(z.string()),
        contextPack: z
          .object({
            contextPackId: z.string(),
            itemCount: z.number().int().nonnegative(),
            anchorCount: z.number().int().nonnegative(),
            /** ⚠ 「少读了什么」必须可读；0 与「没记录」是两件事，故为计数不是布尔 */
            omissionCount: z.number().int().nonnegative(),
            permissionDecisionId: z.string(),
          })
          .strict(),
      })
      .strict(),
    err: ["AGENT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

/**
 * 本束落地时撞到的契约缺口，逐条登记在契约自己身上。
 *
 * 放在这里而不是某个 report 里：report 会随会话结束消失，
 * 而下一个动这份契约的人一定会打开这个文件。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西
 * （`design-signoff.md` 的 `status` 只能由人类改，agent 不许动）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * 🔴 **`ToolAuthScope` 五值与 O-20 的服务器级三值冲突，未裁。**
   * `domain.md` 逐字：「⚠ 与 O-20 冲突，需人类确认（O-20 的问题陈述通篇未提 `逐工具` /
   * `副作用` / `需人工确认每次` / `未开放`，很可能是没看过这张表时把模型收窄成三值的）
   * ——**不代改 O-20**」。本文件按原型（权威）落五值 + 服务器级为上限，
   * 但**裁定前不得按任一侧写死断言**。
   */
  AR1: "ToolAuthScope has 5 values from the prototype's per-tool table (16,684,300) while ruling O-20 declares 3 server-level values; the conflict is filed, O-20 is NOT amended here",
  /**
   * **`ToolSideEffect` 的取值来源未裁**（握手探测 vs 人工标注，原型未演示）。
   * ⇒ 本文件**没有**「标注工具副作用」这个操作——发明它会造出一个只在夹具里存在的入口。
   * 变更路径（F130 ⑶）因此挂在 `discoverMcpTools` 上（重新探测），
   * 若裁决为人工标注，需新增操作并**重新签核**。
   * ⚠ 未标注时**按最严处理**（等同带副作用），不给「默认只读」。
   */
  AR2: "how ToolSideEffect is obtained (handshake probe vs human annotation) is unruled; no annotation operation is invented, the re-check path hangs off discoverMcpTools",
  /**
   * 🔴 **`平台组` 无其它出处**（F131 逐字 [待裁]）。
   * 它在本阶段仅此一处出现：是 `uc-0-3` 角色本体里的哪个角色？新的团队类型？
   * 还是「组织管理员 + 安全评审人」的合称？**不发明，不代答**——
   * ⇒ `MCP_SERVER_IN_QUARANTINE` 的码落了、`quarantineUntil` 的形状落了，
   * **但「谁算平台组」这个判据在契约里没有落点**，裁定前不得写死。
   */
  AR3: "F131's 平台组 (platform group) identity has no other source in this phase; the quarantine error code and timestamp exist but the subject predicate is deliberately absent",
  /**
   * **本束的角色码与 `identity.PermissionReason` 不同名，且这是既成事实不是本束能修的。**
   * 本束 `NOT_ORG_ADMIN` / `ROLE_INSUFFICIENT` ↔ identity `ADMIN_NOT_SUPERUSER` /
   * `PROJECT_ROLE_INSUFFICIENT` —— 语义相近、字面量不同。
   * `_noOverlapWithIdentity` 把「本束与 identity 零重叠」钉成编译期事实，
   * 于是**将来任何一次「顺手统一命名」都会被 `tsc` 拦下来先走签核**。
   * ⚠ 统一命名属**修订已签核束**（phase-00 identity 已合入 main），不是本束能做的。
   */
  AR4: "this bundle's role-denial codes (NOT_ORG_ADMIN / ROLE_INSUFFICIENT) differ in spelling from identity.PermissionReason's (ADMIN_NOT_SUPERUSER / PROJECT_ROLE_INSUFFICIENT); unifying them amends a SIGNED phase-00 bundle",
  /**
   * **`LAST_SELF_HOSTED_MODEL` 是「阻断」还是「二次确认后放行」未定**（E1 逐字 [待定]）。
   * 本文件把它落成一个**错误码**（即阻断那一侧），因为另一侧需要一个
   * 「确认令牌」入参，而那个入参的形状没有出处。若裁为放行，`disableModel.in`
   * 要加 `confirmToken` —— 那是签核后新增。
   */
  AR5: "whether disabling the last self-hosted model is hard-blocked or confirm-and-proceed is unruled; modelled as a hard block because the confirm-token shape has no source",
  /**
   * **可选范围口径①②未裁**（I-2 / I-10 的两个「待裁决」）：
   * ① 含机密时是否**整轮**闭源不可用（还是仅该次调用）；
   * ② 候选集是否就等于 `已启用` 集合（还是另有收窄）。
   * ⇒ `listSelectableModels` 与 `routeModelCall` **共用同一条判据**这件事是确定的，
   * 但那条判据的边界有两处空白。**两处都不在本文件替人填。**
   */
  AR6: "two open questions on the selectable-model set (whether closed-source is barred for the whole round, and whether the candidate set is exactly the enabled set) remain unruled",
  /**
   * **「并发配置超过组织/团队配额上限」这个失败没有码。**
   * E5 逐字要求「提交被拒并**给出可用上限**」，而 `usecases.md` 的三张错误码表里
   * 没有对应成员。⇒ `updateAgentDefinition.err` **表达不了这个已写明的失败**。
   * 本文件**不发明它**（发明一个码等于替签核人做决定）。
   */
  AR7: "E5 requires rejecting over-quota concurrency settings with the available ceiling, but no error code exists for it in usecases.md; updateAgentDefinition.err cannot express it",
  /**
   * **四处 [待定] 汇总**（domain ⑫）：手工编制与规则求值的冲突优先级 / 失效时机；
   * 组员能否看到改派提示；私聊转出后能否撤回；`probeConnectivity` 是否纳入 phase-1。
   * 四处的**形状**都已落（否则前端要猜），**语义边界未定**。
   */
  AR8: "four items remain [待定] per domain.md section 12: manual-roster vs rule-eval precedence/expiry, whether members see redispatch hints, whether a transferred conclusion can be retracted, and whether probeConnectivity is in phase-1",
  /**
   * **「被采纳 / 被忽略」的判定方式未定**（A4 逐字 [待定]）。
   * 建议按 O-35 用**结构性断言**（「是否被转成待办卡或写入产出」＝ 被采纳），
   * 避免不可复现的推断。⇒ `drillDownAuditEntry` 的 `adopted` / `ignored` 在判据定下来之前
   * **恒为 `[]`**——空数组是「还没有判据」的诚实表达，用相似度填满它不是。
   */
  AR9: "the predicate for adopted/ignored is unruled; the two arrays exist but must stay empty until a structural criterion (O-35) is chosen, rather than being filled by similarity scoring",
  /**
   * **三个项目级 AI 开关的默认值不在本契约里。**
   * 出处曾被伪造（F58 的「默认全关为 O-23」已撤，原型两项为**开**）。
   * 现登记在 `thresholds.ts` 的 `projectAiDefault*` 三项（`known: false`，取值即抛错）。
   * ⇒ `getProjectAiPermissions.out` 的三项是 `boolean | null`，
   * `null` 意为「本层未设置」，**不是** `false`。
   */
  AR10: "the three project-level AI switch defaults are deliberately absent; they live in thresholds.ts as known:false after the F58 fabricated-source retraction",
  /**
   * **「前驱状态不对」这个失败没有码**（#660 接线时实测发现）。
   * `submitAgentForReview` 只能从 `草稿` 出发、`decideAgentPublish` 只能从 `待审核` 出发——
   * 重复提交、或直接批准一个还没提交的草稿，**都必须拦**（否则 `草稿 → 运行中` 就出现了
   * 一条绕过评审的边）。但两个操作的 `err` 数组里都没有能表达它的成员。
   * ⇒ 服务端目前只能用 HTTP 409 表达，响应体**不带** `reasonCode`
   *   （`all-exceptions.filter.ts` 只放行契约闭集枚举，自造的码会被丢弃——这是对的）。
   * 本文件**不发明这个码**（发明一个码等于替签核人做决定，同 AR7 的理由）。
   */
  AR11: "neither submitAgentForReview.err nor decideAgentPublish.err can express a wrong-precedent-state refusal (duplicate submit, or approving a 草稿); the server can only answer HTTP 409 with no reasonCode until a code is signed off",
  /**
   * **`selfPublishToollessAgent` —— 已按候选 A 签核，本条只记「它为什么存在」。**
   *
   * 已签核的双人发布路径（I-28 + O-21）对一个**刚注册的独人组织**是**结构性不可通过**的：
   * 白名单要非空（而 `setToolWhitelist` 至今零实现）、审核人要是另一个人（而组织里只有他
   * 一个，且指派评审职能没有任何契约操作）。实测后果不是"体验差"，是自建 agent 发消息恒 422
   * ——即 CLR track R 的 **R9 恒为 0**。
   *
   * 本条边按「无能力面 ⇒ 无评审对象」放行，并**不改动** I-28 / O-21 的任何一道门：
   * 有工具或有 skill 挂载的 agent 仍然只有 `submitAgentForReview` → `decideAgentPublish`
   * 一条路（`AGENT_NOT_TOOLLESS`）。
   *
   * ⚠ 仍然留在本登记表里的**真缺口**：`agent_versions` 没有「发布路径」这一列，
   *   「这一版当时是怎么发出去的」目前靠 `semantic_label` 前缀承载（权宜，见
   *   `pg-self-publish-agent-repository.ts` 头注）。正式化需要加一列显式的 `publish_route`。
   */
  AR12: "agent_versions has no explicit publish_route column, so 'how was this version published' (two-person review vs selfPublishToollessAgent) is carried by a semantic_label prefix as a stopgap; formalising it needs a real column",
} as const;
