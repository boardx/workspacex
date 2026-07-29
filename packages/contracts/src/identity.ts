/**
 * 契约束 `identity` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据          ←── 这条是关键
 *
 * 为什么 mock 必须从这里生成：本项目已**五次**因「同一事实声明在两处」而漂移
 * （设计 token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA / 估点）。手写 mock 是第六次。
 * 从契约生成后，**前端自动成为契约的第一个消费者：契约错了，界面当场就崩**。
 *
 * 覆盖 feature：F01 F02 F03 F15 F16 F17
 * 领域模型见 `phases/phase-00-shared-kernel/contracts/identity/domain.md`
 * 用例接口见 同目录 `usecases.md`
 */
import { z } from "zod";

/* ─────────────────────── 枚举（与 domain.md 一一对应）─────────────────────── */

/** 组织类型是**一等字段**，不是特例分支——两者共用同一张表与同一套 ACL/RLS（domain I-2/I-3） */
export const OrgKind = z.enum(["organization", "personal-local"]);

/**
 * ⚠ 仅**正式组织**有意义。本地组织的「只走本地」是不可关闭的产品承诺，
 * 由 `kind === "personal-local"` 直接推出，**不读此字段**（domain I-10）。
 * 用同一个可写字段表示会让「承诺」退化成「默认值」。
 */
export const ModelPolicy = z.enum(["any", "self-hosted-only"]);

/** 四种。`compliance` 由 D-U3 新增——合规是**组织级职能**，不是第三层「场景角色」 */
export const OrgRole = z.enum(["admin", "lead", "consultant", "compliance"]);

/**
 * **恒为四种**（O-03）。
 * 协同引导师/联合主持 = facilitator 的多实例；研究员/参与者 = 展示别名不落库；
 * 受访者不持项目角色，走一次性令牌（UC-6.3）。
 */
export const ProjectRole = z.enum(["facilitator", "groupLead", "member", "observer"]);

/** 资源可见性范围。⚠ 与 MCP 的「授权范围」「安全评审状态」是**三个独立字段**，禁止合并 */
export const VisibilityScope = z.enum(["org-wide", "team-only"]);

/** 六类能力清单——**是组织配置，不是产品内置**（F15） */
export const CapabilityKind = z.enum([
  "agent", "skill", "model", "mcp", "canvas-template", "blueprint",
]);

/**
 * 鉴权失败的分层原因。前端据此渲染**分层的**无权限态——
 * UC-0.3 R8 明确：不能只显示「无权限」，要说清是组织层还是项目层限制。
 */
export const PermissionReason = z.enum([
  "NO_ORG_MEMBERSHIP",
  "ORG_SCOPE_DENIED",
  "NO_PROJECT_ROLE",          // ⚠ 这是**正常状态**不是异常（domain I-11）
  "PROJECT_ROLE_INSUFFICIENT",
  "ADMIN_NOT_SUPERUSER",      // D-18：管理员不是超级用户
  "PERSONAL_LAYER_CLOSED",    // I-8：个人层只见计数
  "LOCAL_ORG_ISOLATED",       // I-9/I-10
  "AUTH_SERVICE_UNAVAILABLE", // ⚠ 一律拒绝，**不得降级放行**
]);

/**
 * 内容所在的**层**。这是「我的大脑」整层能否成立的前提（UC-0.3 R7 第 2 条）。
 *
 * ⚠ 两层不是同一张表的两个筛选条件那么简单：**个人层对任何人封闭**（含管理员），
 * 拿到某人私有内容**只有一条路径——本人显式升到项目层**。
 * 所以它是一等字段，不是「可见性范围」的一个取值：可见性范围是组织层的资源准入，
 * 合并进去会让「管理员看不到个人层」退化成一条可被配置改掉的策略。
 */
export const ContentLayer = z.enum(["personal", "project"]);

/**
 * 草稿态是**权限事实**不是展示状态（uc-0-1 R5 / V4）：
 * 草稿模式产出**仅创建者可见**，项目管理员与组织管理员均不可见，
 * 且对其余角色返回 **404 而非 403**——403 会泄露「这里有一份你看不到的草稿」。
 */
export const ContentStatus = z.enum(["draft", "published"]);

/**
 * 读取意图。`audit` 是 UC-0.3 R4 A1 给管理员开的**唯一**豁口：
 * 允许读，但**每次访问必写审计日志且对项目负责人可见**。
 *
 * ⚠ 它必须是**入参**而不是服务端推断出来的：留痕的对象是「你自称为什么要看」，
 * 服务端替调用方猜意图，等于审计记录里没有任何人做过声明。
 */
export const ReadPurpose = z.enum(["work", "audit"]);

/** 机密约束的来源——**三者必须可分辨**（domain I-10 的界面投影） */
export const ConstraintSource = z.enum([
  "promise", // 本地组织：不可关闭的产品承诺
  "policy",  // 正式组织：管理员可改的策略
  "none",
]);

/* ─────────────────────────────── 实体 ─────────────────────────────── */

export const Organization = z.object({
  id: z.string(),
  name: z.string(),
  kind: OrgKind,
  team: z.string().nullable(),
  modelPolicy: ModelPolicy.optional(),
}).strict();

export const PermissionDecision = z.object({
  allowed: z.boolean(),
  /**
   * ⚠ `role` 可为 null —— **2026-07-29 修订，F01 实现时发现的契约缺陷**。
   *
   * 原定义写的是 `role: OrgRole`（非空）。但本对象的失败枚举里第一条就是
   * `NO_ORG_MEMBERSHIP`：**「不是这个组织的成员」的判定结果里没有组织角色可填**。
   * 即：契约表达不了它自己声明的拒绝状态。
   *
   * 实现时只有三条路：编一个假角色、把 layer 整个置空（丢掉「组织层没过」这个信息）、
   * 或者把 role 放开为可空。前两条都会让「为什么被拒」这件事失真，而那正是本对象存在的理由。
   */
  orgLayer: z.object({
    role: OrgRole.nullable(), teamId: z.string().nullable(), passed: z.boolean(),
  }).strict(),
  /**
   * ⚠ **两层可空，含义不同，不能合并**：
   * · `projectLayer === null` —— 本次请求**没有项目上下文**（domain I-11）。
   * · `projectLayer.role === null` —— 有项目上下文，但此人在该项目**无角色**。
   *   usecases.md 对 `NO_PROJECT_ROLE` 明写「**这是正常状态不是异常**」——
   *   所以它必须能被表达出来，而原定义（role 非空）表达不了。
   *
   * 把两者合并成一个 null 会让前端分不清「不是项目页」与「是项目页但你没角色」，
   * 而这两种要渲染的东西完全不同（后者是无权限态，前者什么都不该出现）。
   */
  projectLayer: z.object({
    role: ProjectRole.nullable(), groupId: z.string().nullable(), passed: z.boolean(),
  }).strict().nullable(),
  scopeLayer: z.object({ scope: VisibilityScope, passed: z.boolean() }).strict(),
  reasonCode: PermissionReason.nullable(),
  /** 写进 Context Pack 的 items[]，使「为什么这条能给你看」可回溯（UC-0.2） */
  decisionId: z.string(),
}).strict();

export const CapabilityListing = z.object({
  id: z.string(),
  orgId: z.string(),
  kind: CapabilityKind,
  name: z.string(),
  scope: VisibilityScope,
  enabled: z.boolean(),
}).strict();

/**
 * `mutateCapability` 的三种 payload —— **2026-07-29 修订，F15 实现时发现的契约缺陷**。
 *
 * 原定义写的是 `payload: z.record(z.unknown())`,一个开放口袋。但服务端必须知道
 * 「新增一条能力要给什么」才能实现 `op: "add"`,于是这份形状**一定会存在**——
 * 问题只是它写在契约里,还是被实现者写在后端。
 *
 * 后者正是 ADR-020 要防的那种漂移:后端的 DTO 长得像契约,于是被手抄一份,
 * 之后两边各自自洽,直到联调才炸。本仓已因此漂移两次(`"org"|"team"` vs
 * `"org-wide"|"team-only"`;`IngestionRun.status` vs `.state`),
 * 并且 `contract-single-source.test.ts` 会直接拦下后端里的任何 `z.object(`——
 * 那条门控是对的,所以形状收敛到这里。
 *
 * ⚠ 仍然表达不了的:`op` 与 payload 的**对应关系**。`op` 是 payload 的兄弟字段而不是
 * 判别式,所以这里只能写成 union,校验管道拦不住「op=add 却发了 update 的 payload」;
 * 服务端按 op 再解析一次(用的仍是本文件的 schema,不是第二份声明)。
 * 彻底的修法是把 `op` + `payload` 合并成一个判别联合,那是结构性改动,留给契约的主人。
 */
export const CapabilityAddPayload = z
  .object({
    name: z.string().min(1),
    scope: VisibilityScope,
    /** `scope: "team-only"` 时必填。哪个团队拥有它——缺了它,可见性规则无法回答 */
    ownerTeamId: z.string().nullable().optional(),
  })
  /**
   * 与 `acl_bindings_team_only_needs_team` 同一条规则,同一个理由:
   * 「仅某团队可见」却没说是哪个团队,不是更严的规则,是**无法回答**的规则——
   * 而无法回答的规则会被下游实现者判成「放行」。
   * ⚠ 数据库的 CHECK 才是保证(它挡住所有写入者);这里是**给人看的那道**,
   * 让管理员拿到字段级 400 而不是一个 500。
   */
  .refine((v) => v.scope !== "team-only" || (v.ownerTeamId ?? null) !== null, {
    path: ["ownerTeamId"],
    message: "team-only capability needs an owning team",
  });

/**
 * ⚠ **不含 `enabled`**,这是刻意的。
 * 通过 update 关掉一条能力,会绕过 D-U5 的全部保护——中断模式、受影响调用数、
 * 确认弹窗、留痕里的 `disableMode`。同一个动作,少了让它安全的每一样东西。
 * 停用只有一条路:`op: "disable"`。
 */
export const CapabilityUpdatePayload = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  scope: VisibilityScope.optional(),
  ownerTeamId: z.string().nullable().optional(),
}).strict();

export const CapabilityDisablePayload = z.object({ id: z.string().min(1) }).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

/**
 * 每个操作 = { method, path, in, out, err }。
 * `err` 穷举失败模式——**「失败长什么样」是契约的一半**，界面的异常态全靠它。
 * 已有原型是 happy path 演示、零异常态，不要继承这个缺陷。
 */
export const operations = {
  authorize: {
    method: "POST", path: "/identity/authorize",
    in: z.object({
      orgId: z.string(),
      projectId: z.string().optional(),
      object: z.object({ kind: z.enum(["project", "artifact", "segment"]), id: z.string() }).strict(),
      action: z.string(),
    }).strict(),
    // ⚠ 鉴权结果是**可解释的数据不是异常**，任何情况都返回 200 + decision
    out: PermissionDecision,
    err: [] as const,
  },

  /**
   * authorizeBatch —— **批量两层交集鉴权**（一致性复核 B-2 / X-1）
   *
   * ## 为什么必须有它
   * UC-0.3 R7「权限沿数据链路传播」要求**六条路径共用同一个判定**：
   * 检索 / Context Pack / embedding 相似度 / 图节点遍历 / 文件浏览器 / 缓存。
   * 而召回层一次要判几十上百个 Segment——**只有逐条 `authorize` 的话，
   * 性能瓶颈会诱导实现者绕过它**（自己写个粗糙的过滤，或者干脆先取后滤）。
   *
   * **那正是 R7 被架空的典型路径**：不是有人故意违规，是正确做法太慢。
   * 所以批量判定不是优化，是**让正确做法成为最省事的做法**的必要条件。
   *
   * ⚠ 返回顺序与入参 `objects` 一一对应，调用方不需要再按 id 匹配。
   * ⚠ 推论不变：交集生成内容取所有来源中**最严格**的一档（不是最宽松，也不是并集）。
   */
  authorizeBatch: {
    method: "POST", path: "/identity/authorize-batch",
    in: z.object({
      orgId: z.string(),
      projectId: z.string().optional(),
      objects: z.array(z.object({
        kind: z.enum(["project", "artifact", "segment"]),
        id: z.string(),
      }).strict()).min(1).max(500),
      action: z.string(),
    }).strict(),
    /** 与入参 objects 等长、同序 */
    out: z.array(PermissionDecision),
    err: [] as const,
  },

  /**
   * readContent —— **真实的内容读取面**（F03，2026-07-29 修订 C）
   *
   * ## 为什么非加不可
   * 覆盖矩阵把 V1/V2 都记在 `authorize` 名下，但 `authorize` **只返回判定，不返回内容**。
   * 于是「管理员不是超级用户」这条只被证明在判定函数里成立，
   * **没有任何一条真实读取路径被证明会去问它**——而 D-18 说的正是读取路径。
   * 判定函数绿着、读取路径绕过它，是本项目最想防住的那种绿。
   *
   * ## 为什么是 POST 而不是 GET
   * 它**有副作用**：审计目的读取必写 `provenance_events`。
   * 一个会写库的 GET 比一个语义不纯的 POST 危险得多（被缓存、被预取、被重放）。
   *
   * ## 为什么个人层也走这道门
   * 个人层内容**没有**自己的读取接口——它和项目内容共用这一个入口，
   * 由服务端按 `layer` 分流。另开一个 `/personal-layer/read` 意味着
   * I-8 要在两处各写一遍，而漏掉的那一处不会有任何东西报警。
   *
   * ⚠ `provenanceEventId` 非 null ⇔ 本次是审计目的读取且**留痕已落库**。
   *   留痕写失败时本操作必须失败——「内容给了、痕没留下」是 A1 的反面。
   */
  readContent: {
    method: "POST", path: "/identity/content/read",
    in: z.object({
      orgId: z.string(),
      projectId: z.string(),
      itemId: z.string(),
      purpose: ReadPurpose,
    }).strict(),
    out: z.object({
      itemId: z.string(),
      layer: ContentLayer,
      status: ContentStatus,
      body: z.string(),
      /** 非 null ⇔ 这次读取以审计名义发生，痕已落库 */
      provenanceEventId: z.string().nullable(),
    }).strict(),
    /**
     * ⚠ 草稿与「不存在」在**协议层不可区分**（uc-0-1 V4）：两者都是 404，
     * 所以这里没有 `DRAFT_*` 码——有这么一个码，等于把「这儿有份草稿」写进了响应。
     */
    err: [
      "NO_ORG_MEMBERSHIP", "ORG_SCOPE_DENIED", "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT", "ADMIN_NOT_SUPERUSER", "PERSONAL_LAYER_CLOSED",
    ] as const,
  },

  /**
   * getPersonalLayerSummary —— **管理员对他人个人层唯一能拿到的东西：计数**（I-8 / V2）
   *
   * ## 为什么必须有这个操作
   * I-8 的断言是「响应体中**不存在**内容字段」。`authorize` 返回的是判定对象，
   * 里面本来就没有内容字段——**拿它去断言 I-8 是空转**。
   * 要让这条断言有意义，必须有一个**真的返回了点什么**的响应，
   * 而它返回的恰好只有计数。
   *
   * ⚠ `out` 里**永远不得**出现 content / body / text / excerpt / preview / snippet
   *   任何一种。「内容为空串」与「没有内容字段」是两种不同的失败，
   *   只有后者是安全的：空串会随实现变化被填上，缺字段不会。
   */
  getPersonalLayerSummary: {
    method: "GET", path: "/identity/personal-layer/summary",
    in: z.object({ orgId: z.string(), userId: z.string() }).strict(),
    out: z.object({
      userId: z.string(),
      itemCount: z.number().int().nonnegative(),
      /**
       * 查他人时恒为 `PERSONAL_LAYER_CLOSED`；查自己为 null。
       * 界面据此说清「这里为什么只有数字」——只显示一个数字而不解释，
       * 用户的第一反应是「加载失败了」。
       */
      reasonCode: PermissionReason.nullable(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  resolveIdentity: {
    method: "GET", path: "/identity/me",
    in: z.object({ orgId: z.string(), projectId: z.string().optional() }).strict(),
    out: z.object({
      org: Organization,
      orgRole: OrgRole,
      teamId: z.string().nullable(),
      projectRole: ProjectRole.nullable(),
      groupId: z.string().nullable(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  switchOrganization: {
    method: "POST", path: "/identity/switch-org",
    in: z.object({ toOrgId: z.string() }).strict(),
    out: z.object({ org: Organization, capabilities: z.array(CapabilityListing) }).strict(),
    err: ["NO_ORG_MEMBERSHIP"] as const,
    /**
     * ⚠ 副作用是**契约的一部分**，不是实现细节（O-12 + F15）：
     * ① 清空全部项目级上下文（当前项目/环节/Context Pack/鉴权缓存/未提交草稿）
     * ② 清空全部组织级能力解析——上一组织的 agent/skill/model/mcp 一个都不带过去
     * ③ 权限按新组织**重新求值**，不复用切换前的任何判定
     */
  },

  listCapabilities: {
    method: "GET", path: "/capabilities",
    in: z.object({ orgId: z.string(), kind: CapabilityKind }).strict(),
    // ⚠ 组织配置为空时返回 []，**不返回任何内置默认值**（F15 验收面 V1）
    out: z.array(CapabilityListing),
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  mutateCapability: {
    method: "POST", path: "/capabilities/mutate",
    in: z.object({
      orgId: z.string(),
      kind: CapabilityKind,
      op: z.enum(["add", "update", "disable"]),
      /**
       * ⚠ 仍是开放口袋,**这是权衡后的结论不是遗漏**。见上方三个 payload 的修订说明。
       *
       * 试过写成 `z.union([Add, Update, Disable])`:管道确实会拦下垃圾,但错误退化成
       * `payload: invalid_union`——**字段级错误没了**。而「哪个字段错了」正是
       * UC-0.3 R8 那条纪律在校验面上的同一个要求:笼统的失败等于没有失败信息。
       * 由于服务端本来就要按 `op` 再解析一次(`op` 是 payload 的兄弟而非判别式),
       * union 不多挡任何东西,只是把错误说糊。
       *
       * ⇒ 形状归契约(上方三个 schema),按 `op` 选用归服务端。
       * 彻底的修法是把 `op` + `payload` 合并成判别联合,那是结构性改动,留给契约的主人。
       */
      payload: z.record(z.unknown()),
      /** D-U5：停用时必填。默认 interrupt（安全事件）；drain = 允许跑完当前一轮（版本下线） */
      disableMode: z.enum(["interrupt", "drain"]).optional(),
    }).strict(),
    out: z.object({
      listing: CapabilityListing,
      provenanceEventId: z.string(),
      /** ⚠ 契约的一部分：确认弹窗要显示「当前有 N 个进行中的调用会被中断」 */
      affectedInFlightCalls: z.number().int().nonnegative(),
    }).strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "ORG_SCOPE_DENIED"] as const,
  },

  /**
   * resolveModelConstraint —— **机密数据的模型约束，唯一判定处**（一致性复核 B-3 / X-5）
   *
   * ⚠ `context-pack.resolvePackModelConstraint` **不重新判定**，它只是
   * 「按本 Pack 的 dataScope 调用本操作」的一层包装——两处返回的 `source`
   * （promise / policy / none）**必须来自这一个函数**。
   * 否则会出现「一处说是产品承诺、一处说是组织策略」，
   * 而这两者的**可否关闭性质完全不同**（承诺不可关，策略管理员可改）。
   *
   * 判定归 identity 的理由：只有它持有 `OrgKind` 与 `modelPolicy`。
   */
  resolveModelConstraint: {
    method: "POST", path: "/identity/model-constraint",
    in: z.object({
      orgId: z.string(),
      dataScope: z.array(z.object({ itemId: z.string(), confidential: z.boolean() }).strict()),
    }).strict(),
    /**
     * ⚠ D-U1「全程本地，不分流」：`dataScope` 含**任何** confidential
     * ⇒ localOnly=true ⇒ 本轮**所有**模型调用走本地，云端整轮不可用。
     * **不是**「机密走本地、云端承接非机密部分」——分流的安全性取决于片段级机密判定的
     * 准确率，那是没人能保证 100% 的分类问题，一次误判即不可逆泄漏。
     */
    out: z.object({
      localOnly: z.boolean(),
      source: ConstraintSource,
      reason: z.string(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  previewExport: {
    method: "POST", path: "/identity/export/preview",
    in: z.object({
      fromLocalOrgId: z.string(), toOrgId: z.string(), artifactIds: z.array(z.string()),
    }).strict(),
    /** 逐项列出将离开本机的内容**及其在目标组织的可见性**（按目标 acl_bindings 预演） */
    out: z.object({
      items: z.array(z.object({
        artifactId: z.string(), title: z.string(),
        willBeVisibleTo: z.array(z.object({ kind: z.string(), id: z.string(), name: z.string() }).strict()),
      }).strict()),
      token: z.string(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "EXPORT_DIRECTION_FORBIDDEN"] as const,
  },

  exportToOrganization: {
    method: "POST", path: "/identity/export",
    in: z.object({
      fromLocalOrgId: z.string(), toOrgId: z.string(),
      artifactIds: z.array(z.string()),
      /** ⚠ 必须先 previewExport 并由人确认——**禁止任何自动同步/后台上传/定时推送** */
      confirmedPreviewToken: z.string(),
    }).strict(),
    out: z.object({
      /** ⚠ 复制而非迁移：本地副本保留 */
      copiedArtifactIds: z.array(z.string()),
      /** ⚠ **两侧**都写；目标侧条目标注「来自本地组织，未经本组织入库审核」 */
      localProvenanceEventId: z.string(),
      targetProvenanceEventId: z.string(),
    }).strict(),
    /** ⚠ 单向：正式组织 → 本地组织的导入一律 EXPORT_DIRECTION_FORBIDDEN */
    err: ["EXPORT_PREVIEW_REQUIRED", "NO_ORG_MEMBERSHIP", "EXPORT_DIRECTION_FORBIDDEN"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;
