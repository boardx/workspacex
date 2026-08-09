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

/**
 * 与 `auth.ts` 的 `PasswordPolicy`（`z.string().min(AUTH_POLICY.passwordMinLen)`）
 * 是**同一条规则**，但这里不 `import { PasswordPolicy } from "./auth"`——`auth.ts`
 * 反过来 `import { Organization } from "./identity"`，两边互相 import 会成环：
 * `gen-mock.ts`（`tsx` 直接执行 ESM，不像 `tsc --noEmit` 只做类型检查）踩到的是
 * `ReferenceError: Cannot access 'PasswordPolicy' before initialization`——循环引用下
 * 两个模块谁先执行到一半就会读到对方还没初始化完的绑定。
 *
 * 12 这个数字本身仍然只有一处**运行时事实源**：`auth.ts` 的 `AUTH_POLICY.passwordMinLen`。
 * `changeOwnPassword` 的强度判定发生在服务端 `domain/auth/password-policy.ts` 的
 * `checkPassword()`，那份代码读的正是 `AUTH_POLICY.passwordMinLen`——这里的 zod schema
 * 只是请求体的**形状**校验（"至少要有内容"），真正的强度规则不会因为这份拷贝而漂移。
 */
const MIN_PASSWORD_LEN = 12;

/* ─────────────────────── 枚举（与 domain.md 一一对应）─────────────────────── */

/** 组织类型是**一等字段**，不是特例分支——两者共用同一张表与同一套 ACL/RLS（domain I-2/I-3） */
export const OrgKind = z.enum(["organization", "personal-local"]);

/**
 * 「本地组织」这件事的**判定规则单源**（F16，2026-07-29 新增）
 *
 * ## 为什么必须收敛到契约里
 * 在此之前，同一条判定至少存在两份实现：
 *   · `apps/web/lib/identity.ts` 的 `isLocalOrg()` / `selfHostedOnly()`
 *   · `apps/api/src/domain/identity/model-constraint.ts` 的 `orgKind === "personal-local"`
 * 两份都自洽，直到有人只改其中一份——本项目已**五次**因此漂移。
 * 而这一条的漂移代价与前五次不同：它决定的是**数据出不出本机**。
 *
 * ⚠ 字面量 `"personal-local"` 在本文件之外**不得再出现**；
 *   `apps/web/tests/single-source-of-truth.test.ts` 与
 *   `apps/api/tests/kernel/local-org-invisible-to-admin.test.ts` 分别钉住前后端。
 */
export const LOCAL_ORG_KIND = OrgKind.enum["personal-local"];

/** 唯一判定入口。传 `Organization`、传裸 kind 都走这里，不许自己比字符串。 */
export function isLocalOrgKind(kind: string | null | undefined): boolean {
  return kind === LOCAL_ORG_KIND;
}

/**
 * 本地组织的三条硬隔离 —— **产品承诺，不是配置项**（uc-0-5 R7）
 *
 * 结构化而不是三句散文：界面要逐条列（顶栏说明条 / 本地组织屏），
 * 后端要按 `id` 报出「是哪一条被触犯了」。散文做不到后者，于是后端会另编一套码，
 * 那就是第二份副本。
 */
export const LOCAL_ORG_GUARANTEES = [
  // ⚠ 字段名是 `statement` 而不是 `text`。理由不是风格：mock 生成器会为 `text: z.string()`
  // 产出样例值 `"text-1"`，而 `apps/web/scripts/lint-design.sh` 的字号档位规则扫的正是
  // `text-<数字>`——于是一条完全正确的契约会让前端的设计门控变红。
  // 改门控是错的（它扫的东西没错，只是撞名），改字段名是对的。
  {
    id: "local-model-only",
    statement: "模型调用只走本地 / 自托管端点，云端模型在此不可选",
  },
  {
    id: "no-mcp-egress",
    statement: "禁止任何 MCP 出网调用",
  },
  {
    id: "no-shared-storage",
    statement: "数据不出本地部署，不进共享对象存储与跨组织索引",
  },
] as const;

export const LocalOrgGuaranteeId = z.enum([
  "local-model-only", "no-mcp-egress", "no-shared-storage",
]);

/**
 * 本地组织路径的失败码 —— **闭集**，与 `PermissionReason` / `AuthReason` 同一性质（F16）。
 *
 * ## 为什么不塞进 `PermissionReason`
 * 那个枚举回答的是「谁被拒绝了、卡在哪一层」。这四条回答的是**别的问题**：
 * 依赖没起来、端点不在本机、这条路由只服务本地组织、这个组织没配这条能力。
 * 混进去会让前端拿「无权限态」去渲染一个「依赖失败态」——两者要用户做的事完全不同。
 *
 * ⚠ 错误响应体里**只有码**，没有 startupHint 文案。
 *   指引本身是契约常量（`LOCAL_RUNTIME_STARTUP_HINT`），前端直接读，
 *   不靠服务端把这句话搬运一趟——搬运就意味着同一句话在两处存在。
 *   （`getLocalRuntimeStatus` 的 200 响应里带 hint，那是契约描述过的字段，不是异常通道。）
 */
export const LocalOrgReason = z.enum([
  "LOCAL_ORG_ONLY",
  "CAPABILITY_NOT_FOUND",
  "CLOUD_MODEL_FORBIDDEN",
  "LOCAL_RUNTIME_UNAVAILABLE",
]);

/**
 * 导出豁口的失败码 —— **闭集**，与 `LocalOrgReason` 同一性质（F17，2026-07-30 新增）。
 *
 * ## 为什么这个枚举必须存在
 *
 * 这两条码**本来就写在契约里**（`previewExport.err` / `exportToOrganization.err`），
 * 但错误边界（`all-exceptions.filter.ts`）只放行**闭枚举**的成员——
 * 那条限制是对的：异常消息不该因为凑巧被塞进 `reasonCode` 就变成对外契约。
 * 代价是：不属于任何枚举的码会被**静默丢弃**，客户端收到一个光秃秃的 `conflict`。
 *
 * ⚠ 这不是推测。F17 实现时第一次跑门控，`EXPORT_PREVIEW_REQUIRED` 就是这样消失的：
 *   状态码 409 是对的，`reasonCode` 没了，而界面靠它区分「你还没预览」与
 *   「这次请求和你确认过的清单对不上」——两者要用户做的事不同。
 *   F19 在 `AuthReason` 上踩过同一个坑，注释就写在那道过滤器里。
 *
 * ## 为什么不并进 `LocalOrgReason`
 *
 * 那个枚举回答的是「本地组织这条路走不通，因为依赖/端点/组织类型」。
 * 这两条回答的是**导出这一次动作**的状态：确认过没有、方向对不对。
 * 合并会让前端拿「依赖失败态」去渲染一个「请再确认一次」的流程。
 *
 * ⚠ **成员集合与两个操作的 `err` 必须一致**，由
 *   `apps/api/tests/kernel/local-import-rejected.test.ts` 机械核对——
 *   否则这里就成了第二份失败面声明。
 */
export const LocalExportReason = z.enum([
  "EXPORT_PREVIEW_REQUIRED",
  "EXPORT_DIRECTION_FORBIDDEN",
]);

/**
 * 自助资料（#638 delta，迭代 2）三个新操作的失败面：`uploadOwnAvatar` /
 * `updateOwnProfile`（迭代 2 新增的头像分支）/ `changeOwnPassword` 各自的 `err`。
 *
 * ⚠ 加它的理由与 `LocalExportReason`/`InterviewError`/`FilesError` 等历次**逐字相同**——
 *   `all-exceptions.filter.ts` 是**允许列表**，没登记的 `reasonCode` 会被静默丢弃，
 *   调用方只收到一个光秃秃的 `{"error":"forbidden"}` / `{"error":"bad_request"}`，状态码对、
 *   原因没了。本轮真实 HTTP 实测踩到了这个坑（改密码故意传错密码，界面上只显示
 *   "HTTP 403"，没有"当前密码不正确"那句话）——记录在这里而不是让下一个人再踩一次。
 *
 * `INVALID_INPUT` 是 `updateOwnProfile` 迭代 1 就有的码，之前也从未真正到达过响应体
 * （同一个 bug，只是迭代 1 没有真实 HTTP 层测试戳穿它）；`AVATAR_ARTIFACT_NOT_OWNED` 同理。
 */
export const SelfServiceProfileError = z.enum([
  "INVALID_INPUT",
  "AVATAR_ARTIFACT_NOT_OWNED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "CURRENT_PASSWORD_INVALID",
  "PASSWORD_POLICY_VIOLATION",
]);

/**
 * 本地组织的对象存储键前缀（硬隔离③的**可断言形式**）
 *
 * 「数据不进共享对象存储」若只写成一句承诺，是查不了的。写成键前缀之后它有了两道门控：
 * 迁移 0012 的触发器（数据库层，挡住所有写入者）与 `local-org-zero-egress` 的断言。
 *
 * ⚠ 前缀本身不是隔离，**部署把这个前缀映射到本机卷**才是。
 *   契约能保证的是「本地组织的对象一定落在这个前缀下、且这个前缀下只有本地组织的对象」，
 *   于是「哪些字节不许出本机」变成一个可以指着说的集合，而不是一句形容词。
 */
export const LOCAL_ORG_STORAGE_PREFIX = "local/";

export function localObjectKeyPrefix(orgId: string): string {
  return `${LOCAL_ORG_STORAGE_PREFIX}${orgId}/`;
}

/**
 * 一个模型 / MCP 端点算不算「没出本机」—— **判定单源**。
 *
 * 后端的出网守卫、能力清单的云端置灰、界面的文案，三处用的必须是同一个函数。
 * 这条如果各写各的，会出现「守卫认为是本地、界面标成云端」（或者更糟，反过来）。
 *
 * ⚠ 只认回环与 unix socket。局域网地址（10./192.168.）**刻意不算本地**：
 *   「另一台机器上的自托管模型」对隐私承诺来说已经是出本机了——
 *   承诺的字面是「不出本机」，不是「不出内网」。
 *   有多机自托管需求的客户走正式组织 + `modelPolicy: "self-hosted-only"`（F15），
 *   那是**策略**，可以按部署放宽；承诺不行。
 */
export function isLocalModelEndpoint(endpoint: string | null | undefined): boolean {
  if (!endpoint) return false;
  if (endpoint.startsWith("unix:")) return true;
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  // URL 会把 IPv6 主机名裹在方括号里
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h === "127.0.0.1" || /^127\./.test(h);
}

/**
 * 云端能力在本地组织里被禁用的原因文案 —— **整行禁用并注明原因，不是隐藏**（uc-0-5 R8）。
 *
 * 藏起来读作「产品做不到这件事」，而真相是「这个组织不允许」。两者会把用户带去完全不同的地方。
 */
export function localOrgCloudDisabledReason(endpoint: string | null): string {
  return (
    `本地组织的产品承诺：${LOCAL_ORG_GUARANTEES[0].statement}。` +
    `该条目的端点${endpoint ? `（${endpoint}）` : ""}不在本机，故整行禁用。` +
    `这不是管理员配置，任何接口都改不动它。`
  );
}

/**
 * 本地运行时起不来时给用户的启动指引 —— **单源**。
 *
 * 后端在 `LOCAL_RUNTIME_UNAVAILABLE` 里带上它，界面直接渲染。
 * 界面另写一份的后果不是「文案不一致」这么轻：真正的失效模式是**界面替用户猜原因**，
 * 然后猜出一句「稍后重试」，而正确动作是去把本地运行时起起来。
 */
export const LOCAL_RUNTIME_STARTUP_HINT =
  "本地推理运行时未就绪。请在本机启动它（默认端点 http://127.0.0.1:11434），" +
  "确认后重试。⚠ 系统不会替你改用云端模型——那会违反本地组织的产品承诺。";

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
  /**
   * 端点 —— **2026-07-29 修订，F16 实现时被迫补上的契约缺陷**。
   *
   * F15 的实现记录里写着：「**没有任何字段能区分云端模型与自建模型**，于是
   * modelPolicy=self-hosted-only 时服务端根本无从判断该把哪些模型行置灰」，
   * 并且**刻意没有自行发明字段**。F16 的 user_visible_behavior 第三句
   * （「本地组织内云端模型整行禁用并注明原因」）撞上同一个洞，绕不过去了。
   *
   * ⚠ 补的是 `endpoint`（端点本身）而**不是** `endpointKind: "cloud" | "self-hosted"`。
   *   后者是一个可以与事实不符的标签：一条写着 `self-hosted` 却指向 api.example.com
   *   的记录会让承诺静默失效，而没有任何东西能发现——分类字段的正确性无人守。
   *   端点是事实，云端与否由 `isLocalModelEndpoint()` **推导**，判定只有一处。
   *
   * `null` 表示这类能力没有端点（skill / canvas-template / blueprint）。
   */
  endpoint: z.string().nullable(),
  /**
   * #619 —— **agent 目录第三次收敛的落点**。同 `endpoint` 一样的修订理由：
   * 缺了它，一件此前假设已完成的事（"能不能把这个 agent 挂进某个 thread 的编制"）
   * 无法回答。
   *
   * ## 为什么在 `capability_listings` 而不是 `org_agents`
   *
   * `org_agents`/`chat_thread_agents` 那套（0032-f110-ai-team-panel.sql）文件头
   * 逐字写着自己是"占位目录"，等的是"phase-00 F15"——F15 就是 `capability_listings`
   * 本身。它早就落地了，只是没人接上去（issue #619 的勘探结论）。这两个字段就是
   * 那次"接上去"：**收敛 = agent 目录只剩一份，不是新造一份**。
   *
   * `abbr`/`duty` **只对 `kind === "agent"` 有意义**——`null` 表示这条能力
   * 不是 agent（同 `endpoint` 的 null 语义），或者是 agent 但尚未补全
   * （数据库 CHECK `capability_listings_agent_needs_abbr_duty` 挡住后一种情况，
   * 见迁移 `20260807000000_i619_agent_roster_capability_convergence.sql`）。
   *
   * ⚠ **为什么补字段，不是读端降级**：`domain/chat/agent-presence.ts` 的
   * `assertAgentPanelInvariants` 明文写着"抛错而不是静默补一个占位字符串——
   * 数据本不该长成这样，让它安静地变成'（无职责）'只会把这个问题从
   * '看得见的 500'变成'看不见的界面缺陷'"。在 write 端就要求这两个字段，
   * 比在 read 端编一个假 duty 更符合这条已经写明的纪律。
   */
  abbr: z.string().nullable(),
  duty: z.string().nullable(),
  /**
   * 为什么这一行是灰的 —— F15 记录的缺陷②，同样在 F16 变成阻塞。
   *
   * ⚠ **派生值，不落库**：它是 `enabled=false` 或本地组织承诺的**后果**，
   *   不是管理员填的字段。落库会立刻产生第二份事实（库里写着一个原因、
   *   规则推出另一个原因），且没人能保证两者一致。
   */
  disabledReason: z.string().nullable(),
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
    /**
     * 端点（model / mcp 才有）。见 `CapabilityListing.endpoint` 的修订说明。
     * 本地组织里只接受 `isLocalModelEndpoint()` 为真的端点——由迁移 0012 的触发器强制，
     * 应用层无从绕过。
     */
    endpoint: z.string().nullable().optional(),
    /**
     * #619：`kind === "agent"` 时必填（非空）。见 `CapabilityListing.abbr`/`.duty`
     * 的注释——为什么在这里要求，不在读端降级。
     *
     * ⚠ 这两个字段**不在这份 schema 里对 `kind` 做条件校验**：`kind` 是
     * `mutateCapability.in` 的兄弟字段，不在 `payload` 里，这份 schema 看不见它
     * （与上面 `ownerTeamId` 依赖 `scope` 不同——`scope` 就在这份 payload 里）。
     * ⇒ "kind==='agent' 时必填" 的校验放在应用层（`mutate-capability.ts`），
     * 那里 `input.kind` 是可见的。这里只声明字段存在、类型是什么。
     */
    abbr: z.string().min(1).nullable().optional(),
    duty: z.string().min(1).nullable().optional(),
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

  /**
   * ⚠ Addendum A（#638 迭代 1 独立 UIUX 复核后追加，2026-08-08 单独签核——见
   *   `phases/phase-01-run-a-project/design-deltas/self-service-profile/contract.md`
   *   「Addendum A」一节 + `design-signoff.md` 的 `addendum_a_status: confirmed`）：
   *   `out.displayName` 是本次新增字段，来自 `credentials.display_name`。
   *   在此之前 `updateOwnProfile` 只有写路径、没有配套读路径——改名后 `saved` 提示
   *   出现了，但产品里所有读「显示名」的地方（session、侧栏头像首字母等）都读不到新值，
   *   是假反馈。这条字段就是补那条读路径。
   */
  resolveIdentity: {
    method: "GET", path: "/identity/me",
    in: z.object({ orgId: z.string(), projectId: z.string().optional() }).strict(),
    out: z.object({
      org: Organization,
      orgRole: OrgRole,
      teamId: z.string().nullable(),
      projectRole: ProjectRole.nullable(),
      groupId: z.string().nullable(),
      /** 来自 credentials.display_name；这一列早就存在，只是从未被读出来过（Addendum A）。 */
      displayName: z.string(),
      /**
       * Addendum B（#638 delta，迭代 2，与 Addendum A 同一处置、同一理由）：
       * `updateOwnProfile` 迭代 2 补了头像的真实写路径（`credentials.avatar_url`），
       * 若不在这里补配套的读路径，会重演 Addendum A 修的同一类缺陷——刷新页面后
       * 头像块读不到刚上传的新值。这条字段就是补那条读路径，未设置头像时为 null。
       */
      avatarUrl: z.string().nullable(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  /**
   * uploadOwnAvatar —— 头像上传（#638 delta，迭代 2）
   *
   * ⚠ 这条 `in` 只是**元数据**——文件名/大小/哈希/内容类型，跟 `uploadArtifact` 同一处置
   *   （那条契约的 `files` 数组也不带字节）。真正的字节走同一个 HTTP 请求的
   *   `multipart/form-data`：一个 `meta` 字段（JSON，须与这份 zod 校验一致）+ 一个
   *   `file` 字段（二进制）。controller 层用 multer 解析，`meta` 字段照样过 zod，
   *   不因为走了 multipart 就绕开契约校验。
   * ⚠ 5MB 上限、三种 content-type 都在 zod 里，但服务端**必须对实际字节重新校验**
   *   （体积、magic-byte 与声明的 contentType 一致）——声明的 `sizeBytes`/`contentType`
   *   只是客户端的说法，不是真相来源，这与 `uploadArtifact` 头部「前端预检只是体验优化，
   *   服务端必须完整重做全部校验」同一条纪律。
   * ⚠ 对象存储先写、PG 元数据后写，失败不留幽灵对象——`materializeArtifact`/`FsObjectStore`
   *   已经证明过这条顺序，这里复用同一个 `ObjectStore` 端口而不是另起一套。
   */
  uploadOwnAvatar: {
    method: "POST", path: "/identity/me/avatar",
    in: z.object({
      filename: z.string().min(1),
      sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
      sha256: z.string(),
      contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    }).strict(),
    out: z.object({ avatarArtifactId: z.string(), avatarUrl: z.string() }).strict(),
    err: ["FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE"] as const,
  },

  /**
   * updateOwnProfile —— 自助改个人资料（#638 delta；迭代 1 落 `displayName`，
   * 迭代 2 补 `avatarArtifactId` 真实路径）
   *
   * 迭代 2：`avatarArtifactId` 非 null 时，服务端校验它是 `uploadOwnAvatar` 刚为
   *   **当前用户**签发的那个 id（`user_avatars.user_id = 会话主体`），验过写
   *   `credentials.avatar_artifact_id` + `avatar_url`；不属于当前用户 ⇒
   *   `AVATAR_ARTIFACT_NOT_OWNED`。`null` 清空头像回默认。
   *
   * 不接受修改邮箱——邮箱是登录凭据的一部分，改邮箱是另一个更敏感的操作。
   */
  updateOwnProfile: {
    method: "PATCH", path: "/identity/me",
    in: z.object({
      displayName: z.string().min(1).optional(),
      /** null = 清空头像回默认；非 null 必须是 uploadOwnAvatar 刚返回的 avatarArtifactId。 */
      avatarArtifactId: z.string().nullable().optional(),
    }).strict(),
    out: z.object({ displayName: z.string(), avatarUrl: z.string().nullable() }).strict(),
    err: ["INVALID_INPUT", "AVATAR_ARTIFACT_NOT_OWNED"] as const,
  },

  /**
   * changeOwnPassword —— 已登录用户主动改密码（#638 delta，迭代 2）
   *
   * ⚠ 与未登录邮箱令牌那条 `completePasswordReset`（auth.ts）是**不同威胁模型**，
   *   不共用实现：这里必须先验 `currentPassword` 才允许写新哈希——即使是已认证会话，
   *   这是防会话劫持后静默改密的最后一道（delta §2）。
   * ⚠ 成功后**必须**吊销除当前会话外的全部会话，`revokedSessionCount` 如实回传
   *   （哪怕是 0）。这与 `completePasswordReset` 的"全部吊销含当前"是另一条不同的路径
   *   （`SessionTokenStore.revokeAllForUserExcept`，不是 `revokeAllForUser`）。
   */
  changeOwnPassword: {
    method: "POST", path: "/identity/me/password",
    in: z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(MIN_PASSWORD_LEN),
    }).strict(),
    out: z.object({ changed: z.literal(true), revokedSessionCount: z.number().int().nonnegative() }).strict(),
    err: ["CURRENT_PASSWORD_INVALID", "PASSWORD_POLICY_VIOLATION"] as const,
  },

  /**
   * listOwnActivity —— 自助活动记录列表（#638 delta，迭代 2）
   *
   * 复用 `provenance_events`（索引 `provenance_events_actor_idx (org_id, actor_id, at DESC)`
   * 已覆盖这个查询模式），按 `actor_id = 会话主体` 过滤，cursor 分页。
   */
  listOwnActivity: {
    method: "GET", path: "/identity/me/activity",
    in: z.object({ cursor: z.string().nullable(), limit: z.number().int().min(1).max(100) }).strict(),
    out: z.object({
      events: z.array(z.object({
        eventId: z.string(), kind: z.string(), occurredAt: z.string(), summary: z.string(),
      }).strict()),
      nextCursor: z.string().nullable(),
    }).strict(),
    err: [] as const,
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

  /**
   * getLocalOrg —— 「每个人有一个本地组织」的**读取面**（F16 / I-2 / I-3）
   *
   * ## 为什么不是 `/identity/me?orgId=<本地组织>`
   * `resolveIdentity` 回答的是「我在这个组织里是谁」，它的 out 里没有地方放
   * 三条承诺、成员数、以及「这里没有邀请入口」。而这三样正是本地组织**与众不同**的全部内容，
   * 塞进 `/identity/me` 会让每个正式组织的响应都带上一组恒为 null 的字段。
   *
   * ## 注册即有：这条路由**不创建**任何东西
   * 创建发生在注册事务里（`EnsurePersonalLocalOrg`，与凭据/正式组织同一个事务）。
   * 若这里也能创建，那就有了两条创建路径，而 I-2（每人恰好一个）要靠两处各自不出错。
   */
  getLocalOrg: {
    method: "GET", path: "/identity/local-org",
    in: z.object({}).strict(),
    out: z.object({
      org: Organization,
      /** 逐条列出，界面直接渲染；后端报错时按 id 指名是哪一条 */
      guarantees: z.array(z.object({
        id: LocalOrgGuaranteeId, statement: z.string(),
      }).strict()),
      /**
       * ⚠ `z.literal(1)`，不是 `z.number()` —— I-3「本地组织成员数恒为 1」。
       * 写成 number，一个成员数为 2 的本地组织就是一个**契约描述得出来**的状态，
       * 于是它只是个 bug；写成 literal，它连表达都表达不出来，
       * `contract-response.test.ts` 当场红。构建期失败是发现它的正确位置。
       */
      memberCount: z.literal(1),
      /** 恒 false（2026-07-28 裁决：本地组织恒为单人）。界面据此**不渲染邀请入口** */
      canInvite: z.literal(false),
      /** 本地组织的对象都落在这个前缀下——「哪些字节不许出本机」的可指认集合 */
      storagePrefix: z.string(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  /**
   * getLocalRuntimeStatus —— 本地运行时起没起来（F16 的依赖失败态）
   *
   * ⚠ 它的存在本身就是「绝不偷偷改用云端」的一半：**失败必须是用户能看见的一个状态**。
   *   没有这条路由，界面唯一能表达的失败就是「AI 调用出错了」，
   *   而那种笼统的错误正是让人去点「换个模型试试」的东西。
   */
  getLocalRuntimeStatus: {
    method: "GET", path: "/identity/local-org/runtime",
    in: z.object({ orgId: z.string() }).strict(),
    out: z.object({
      available: z.boolean(),
      endpoint: z.string(),
      /** 不可用时非 null。`startupHint` 来自 `LOCAL_RUNTIME_STARTUP_HINT`，前端不另写一份 */
      failure: z.object({
        code: z.literal("LOCAL_RUNTIME_UNAVAILABLE"),
        detail: z.string(),
        startupHint: z.string(),
      }).strict().nullable(),
    }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "LOCAL_ORG_ONLY"] as const,
  },

  /**
   * invokeLocalModel —— 本地组织里发起一次模型调用（F16 的 V3 / V5 所断言的那条真实路径）
   *
   * ## 为什么 F16 需要一条真的调用路径
   * 「发起 AI 调用时出网流量为零」这句话，只有存在**一次真实调用**时才能被断言。
   * 用 `resolveModelConstraint` 去证明它是空转：那个函数返回一个判定对象，
   * 它当然不出网——F03 已经踩过同型的坑（判定函数绿着、读取路径绕过它）。
   *
   * ## 失败模式穷举，且每一条都**不得降级**
   *   LOCAL_RUNTIME_UNAVAILABLE  本地运行时不可达 → 报错 + 启动指引，**不改用云端**
   *   CLOUD_MODEL_FORBIDDEN      指名的模型端点不在本机 → 拒绝，**不静默换一个本地模型**
   *   CAPABILITY_NOT_FOUND       本组织没有配置这个模型（F15：没有内置兜底清单）
   *   LOCAL_ORG_ONLY             这条路由只服务本地组织；正式组织走各自的模型网关
   */
  invokeLocalModel: {
    method: "POST", path: "/identity/local-org/model-call",
    in: z.object({
      orgId: z.string(),
      /** 指 `CapabilityListing.id`，不是模型名——名字会重、会改 */
      capabilityId: z.string(),
      prompt: z.string().min(1),
    }).strict(),
    out: z.object({
      capabilityId: z.string(),
      /** 实际把请求发去了哪里。⚠ 断言它 `isLocalModelEndpoint()` 为真的是测试，不是自述 */
      endpoint: z.string(),
      output: z.string(),
    }).strict(),
    err: [
      "NO_ORG_MEMBERSHIP", "LOCAL_ORG_ONLY", "CAPABILITY_NOT_FOUND",
      "CLOUD_MODEL_FORBIDDEN", "LOCAL_RUNTIME_UNAVAILABLE",
    ] as const,
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

/* ═══════════════════ F17：导出豁口的常量（单一事实源）═══════════════════ */

/**
 * 目标侧条目的来源标注 —— **一句话，一个地方**。
 *
 * user_visible_behavior 的原话是「目标侧的条目明确标注『来自某成员的本地组织，
 * 未经本组织入库审核』」。这句话有三个消费者：目标侧 `artifacts` 行的标注、
 * 两侧 `provenance_events` 的 detail、以及界面上那一行文案。
 *
 * ⚠ 它必须在这里而不是在后端或界面里：这是本项目第六次「同一事实两处声明」的
 *   现成候选，而漂移的形式会特别难看——库里标着一句、界面显示另一句，
 *   于是「这条东西到底审没审过」变成两个互相矛盾的答案。
 *
 * ⚠ 是**函数**而不是常量字符串：标注必须说清是**谁**的本地组织。
 *   一句不带人的「来自某个本地组织」在目标组织里是不可追责的。
 */
export function localExportUnvettedNote(ownerDisplayId: string): string {
  return (
    `来自成员 ${ownerDisplayId} 的本地组织，未经本组织入库审核。` +
    `它是该成员显式发起的一次性导出，不是本组织的入库流程产物。`
  );
}

/**
 * 预览令牌的有效期。**预览与确认之间隔了多久仍算「同一次人工动作」**。
 *
 * ⚠ 存在的理由不是安全余量，是 V11①「禁止任何自动同步/后台上传/定时推送」：
 *   一个永不过期的令牌就是一把可以放进定时任务里的钥匙——攒一个 token，
 *   之后每晚推一次，每一次都能出示「人确认过」的证据。有效期把
 *   「人刚刚看过这份清单」变成一个可验证的事实而不是一个历史声明。
 *
 * 一次性由数据库的条件 UPDATE 保证（迁移 0016），这里只管新鲜度。
 */
export const LOCAL_EXPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;

/**
 * 已知契约缺陷（F17 实现时发现，**如实登记而不是自行发明**）。
 *
 * 与 `auth.KNOWN_CONTRACT_GAPS` 同一约定：写下来的洞是可以被下一个人看见的洞，
 * 被顺手补上的洞会变成没人评审过的第二份契约。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **`previewExport` / `exportToOrganization` 没有「这件成果不存在 / 不属于该本地组织」的失败码。**
   *
   * 两个操作的 `err` 合计只有三条：NO_ORG_MEMBERSHIP、EXPORT_DIRECTION_FORBIDDEN、
   * EXPORT_PREVIEW_REQUIRED。而 `artifactIds` 是调用方给的，里面完全可能有一个
   * 本地组织里没有的 id。
   *
   * F17 的处理（**没有发明新码**）：预览只列出**真实存在**的条目，令牌绑定的正是
   * 这一组 id；随后 `exportToOrganization` 要求请求的 id 集合与令牌完全相等，
   * 于是带着一个不存在的 id 去导出会得到 `EXPORT_PREVIEW_REQUIRED`
   * （「你确认过的那份预览不覆盖这次请求」），语义是准确的。
   *
   * 代价照实说：**用户在预览里看到的是「少了一条」而不是「这一条为什么不能导」**。
   * 补法需要人类重新签核（要么加失败码，要么给 preview 的 out 加一个不可导条目清单）。
   */
  C_F17_1: "no failure code for an artifactId that does not exist in the local org; preview silently omits it",
  /**
   * **`exportToOrganization.out.copiedArtifactIds` 回答不了「副本在目标组织的 id 是什么」。**
   *
   * 字段名只说「被复制的那些」。而 `artifacts.id` 是**全局唯一**的，所以目标侧的副本
   * 必然是一个**新 id**——响应里那组 id 只能是源 id（本实现即如此），
   * 于是「导出成功了，去目标组织看看」这个动作在协议层无路可走。
   *
   * F17 的处理：源→目标的映射写进**两侧 provenance 事件的 `detail.copies`**，
   * 审计查得到；响应体不动，因为改它是契约形状变更，要人类签核。
   */
  C_F17_2: "copiedArtifactIds cannot express the source->target id mapping; the mapping lives only in provenance detail",
  /**
   * **`previewExport.out.items[].willBeVisibleTo[].kind` 是 `z.string()` 而不是枚举。**
   *
   * 主体只有三种（user / team / group，见 `acl_bindings.subject_kind`），
   * 而这里是一个开放字符串——界面无法据此分派图标或文案，只能把它当标签打印。
   * 一个开放的 kind 也意味着服务端写错了没人发现（`.strict()` 只挡多余字段，不挡取值）。
   */
  C_F17_3: "willBeVisibleTo[].kind is an open string, not the closed user|team|group set acl_bindings enforces",
  /**
   * **没有任何操作能读回「目标组织里哪些条目是本地导入来的」。**
   *
   * user_visible_behavior 要求目标侧条目带标注，标注也确实落了库（迁移 0016 的
   * `artifacts.imported_from_org_id` + `imported_from_note`），但 identity 束里
   * 没有列举 artifact 的操作，artifact 束的操作也不返回这两个字段。
   * ⇒ 标注**存在且可审计（provenance）**，但**不在任何响应体里**。
   */
  C_F17_4: "the target-side 'unvetted, came from a local org' mark is stored and audited but no operation returns it",
} as const;
