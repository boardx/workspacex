/**
 * 身份的**前端投影** —— 类型一律从 `@repo/contracts` 派生，此处不定义第二份。
 *
 * ⚠ ADR-020：API 契约是唯一事实源。这里曾经手写过 `OrgRole` / `ProjectRole` /
 *   `OrgKind` / `ModelPolicy` 四个联合类型，与契约构成第二份副本——
 *   `lint-contract-source` 抓到后已收敛为 `z.infer`。
 *   同一事实声明在两处必然漂移，本项目已踩过五次。
 */
import type { z } from "zod";
import * as C from "@repo/contracts/identity";

/**
 * 两层身份模型的**前端投影**（UC-0.3）
 *
 * ⚠⚠ 这里的一切都只是界面投影。**真实权限在服务端**（NestJS Guard + PostgreSQL RLS）。
 *    视角切换器是**预览手段，不是权限实现**——UC-0.3 R5 明确禁止「前端隐藏即安全」。
 *    切换 `?as=` 只改变本地展示，不改变服务端返回的数据，且生产构建不可达。
 */

/**
 * 组织角色（[原型] 后台「成员与配额」三取值 + 裁决 D-U3 新增第四种）
 *
 * ⚠ 裁决 D-U3（2026-07-28）：**合规负责人归组织角色，不新增第三层「场景角色」**。
 * 理由：合规是**组织级职能**（对整个组织的合规负责），本来就该在这一层；
 * 而受访者已有一次性令牌身份（UC-6.3）、研究员/参与者只是引导师/组员在访谈场景下的
 * **展示别名**（不落库）。加第三层会让权限矩阵从 4×3 变成 4×3×N，测试成本不成比例。
 * ⇒ **O-03「项目角色恒为四种」得以保住。**
 */
export type OrgRole = z.infer<typeof C.OrgRole>;
export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  admin: "管理员",
  lead: "项目负责人",
  consultant: "顾问",
  compliance: "合规负责人",
};

/**
 * 场景别名（裁决 D-U3）—— **只是展示名，落库仍是项目角色**。
 * 界面上凡出现这些称呼的地方都要能说清它对应哪个项目角色，否则用户会以为是不同角色。
 */
export const SCENE_ALIAS: Record<string, { alias: string; actual: ProjectRole; note: string }> = {
  researcher: { alias: "研究员", actual: "facilitator", note: "引导师在访谈场景下的称呼" },
  participant: { alias: "参与者", actual: "member", note: "组员在问卷/投票场景下的称呼" },
};

/** 项目角色（[设计] UC-0.3 恒为四种；协同引导师 = 引导师多实例，见裁决 O-03）*/
export type ProjectRole = z.infer<typeof C.ProjectRole>;
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  facilitator: "引导师",
  groupLead: "组长",
  member: "组员",
  observer: "观察者",
};
export const PROJECT_ROLES = Object.keys(PROJECT_ROLE_LABEL) as ProjectRole[];

/**
 * 组织类型（UC-0.5 R7）—— **一等字段，不是特例分支**
 *
 * `personal-local` 与 `organization` **共用同一张表与同一套 ACL / RLS 机制**。
 * 这样做是为了避免出现「本地模式」的第二套代码路径——那种分支必然长期失修。
 */
export type OrgKind = z.infer<typeof C.OrgKind>;

/**
 * 组织级模型策略（UC-0.5 R7，2026-07-28 裁决）
 *
 * ⚠ **与个人本地组织的硬隔离①性质不同、不可抹平**：
 *   · 正式组织的 `modelPolicy` 是**可配置策略**——管理员可改，改动留痕；
 *   · 本地组织的「只走本地模型」是**不可关闭的产品承诺**——任何接口都改不动。
 *   用同一个开关表示会让「承诺」退化成「默认值」，所以本字段**只对正式组织有意义**，
 *   本地组织的约束由 `kind === "personal-local"` 直接推出，不读这个字段。
 */
export type ModelPolicy = z.infer<typeof C.ModelPolicy>;

/**
 * ⚠ 与契约 `@repo/contracts/identity` 的 `Organization` **字段完全相同**——
 * 这是真重复（不是视图模型），故直接从契约派生，不在此处另写一份结构。
 */
export type Organization = z.infer<typeof C.Organization>;

/**
 * 个人本地组织的三条硬隔离（UC-0.5 R7）—— **是产品承诺，不是配置项**
 * ① 模型调用只允许本地 / 自托管端点，云端模型不可选
 * ② 禁止任何 MCP 出网调用
 * ③ 数据不出本地部署（不进共享对象存储、不进跨组织索引）
 * 违反时**拒绝并显式报错，不得静默降级到云端**。
 */
export const LOCAL_ORG_GUARANTEES = C.LOCAL_ORG_GUARANTEES;

/**
 * ⚠ **2026-07-29（F16）收敛**：这两样以前是本文件自己声明的第二份事实——
 * 三条承诺是手写的字符串数组，判定是 `org.kind === "personal-local"` 的字面量比较。
 * 后端也各有一份（`domain/identity/model-constraint.ts`）。
 *
 * 前五次「同一事实两处声明」的代价是界面上一个数字不对；这一条决定的是
 * **数据出不出本机**，所以它被搬进契约（`isLocalOrgKind` / `LOCAL_ORG_GUARANTEES`），
 * 前后端都从那里取，`tests/single-source-of-truth.test.ts` 钉住前端这一半。
 */
export function isLocalOrg(org: Organization): boolean {
  return C.isLocalOrgKind(org.kind);
}

/** 云端条目在本地组织里被禁用的原因——同样是契约文案，不在界面里另写一句。 */
export const localOrgCloudDisabledReason = C.localOrgCloudDisabledReason;

/** 本地运行时的启动指引。界面直接渲染它，不自己编「稍后重试」。 */
export const LOCAL_RUNTIME_STARTUP_HINT = C.LOCAL_RUNTIME_STARTUP_HINT;

/** 端点是否在本机——与出网守卫、数据库触发器同一条规则。 */
export const isLocalModelEndpoint = C.isLocalModelEndpoint;

/**
 * 导出豁口（F17）——**这三样都不许在界面里另写一份**。
 *
 * ⚠ `localExportUnvettedNote` 尤其危险：同一句话有三个消费者（目标侧 `artifacts` 行、
 *   两侧 provenance 事件、这一屏的文案）。界面自己拼一句的后果不是「文案不一致」，
 *   而是「这条材料到底审没审过」在库里和屏幕上有两个答案。
 */
export const localExportUnvettedNote = C.localExportUnvettedNote;
export const LOCAL_EXPORT_PREVIEW_TTL_MS = C.LOCAL_EXPORT_PREVIEW_TTL_MS;
export type LocalExportReason = z.infer<typeof C.LocalExportReason>;

/**
 * 本组织是否只允许自托管模型，以及**它是承诺还是策略**。
 * 界面必须能分辨这两者——这正是 UC-0.5 V12 断言的东西。
 */
export function selfHostedOnly(org: Organization): {
  on: boolean;
  /** promise = 不可关闭的产品承诺；policy = 管理员可改的策略；none = 不限制 */
  source: z.infer<typeof C.ConstraintSource>;
} {
  if (isLocalOrg(org)) return { on: true, source: "promise" };
  if (org.modelPolicy === "self-hosted-only") return { on: true, source: "policy" };
  return { on: false, source: "none" };
}

export const SELF_HOSTED_SOURCE_LABEL: Record<"promise" | "policy", string> = {
  promise: "产品承诺 · 不可关闭",
  policy: "组织策略 · 管理员可改",
};

export interface Identity {
  displayName: string;
  /** Addendum B（#638 delta，迭代 2）—— 同 `displayName` 的读路径处置，未设置头像时为 null。 */
  avatarUrl: string | null;
  orgRole: OrgRole;
  org: Organization;
  /** 当前项目中的角色；不在项目上下文里时为 null */
  projectRole: ProjectRole | null;
  projectName: string | null;
  groupName: string | null;
}

/** mock 数据 —— 数量级与字段完整度贴近真实（sign-off 要能看出信息密度问题）*/
export const MOCK_ORGS: Organization[] = [
  { id: "org-yuanyang", name: "远洋新能源", kind: "organization", team: "能源组", modelPolicy: "any", avatarUrl: null },
  // 强合规客户：整组织只用自托管模型（2026-07-28 裁决新增的组织级策略）
  { id: "org-hengtai", name: "恒泰供应链", kind: "organization", team: "供应链组", modelPolicy: "self-hosted-only", avatarUrl: null },
  // 注册那一刻自动创建，恒定存在、不可删除 / 退出 / 转让 / 邀请他人（UC-0.5 R7）
  // 取值也从契约常量来，不写字面量：这条 mock 是「本地组织长什么样」的唯一前端样本，
  // 它写错了，界面会拿一个不是本地组织的东西演示本地模式，而且一路绿。
  { id: "org-local", name: "林可 的本地", kind: C.LOCAL_ORG_KIND, team: null, avatarUrl: null },
];

export function mockIdentity(orgId: string, projectRole: ProjectRole | null): Identity {
  const org = MOCK_ORGS.find((o) => o.id === orgId) ?? MOCK_ORGS[0]!;
  return {
    displayName: "林可",
    avatarUrl: null,
    // 本地组织里没有「上级」——自己就是唯一成员，无人可管
    orgRole: isLocalOrg(org) ? "admin" : "consultant",
    org,
    projectRole,
    projectName: projectRole ? "欧洲市场进入" : null,
    groupName: projectRole === "groupLead" || projectRole === "member" ? "第 2 组" : null,
  };
}

/**
 * 顶部角色说明条的两层文案（UC-0.3 R8：在项目里必须同时显示两层身份）
 *
 * ⚠ 项目层**可以缺席**——这是正常状态而非缺省值：UC-0.3 R4 E1 明写
 * 「用户有组织角色但无项目角色时，项目内资源一律不可见」。
 * 在后台/任务/大脑这类非项目页面上显示「本项目：X」，等于把一个不存在的判定画到界面上。
 * 调用方用 `lib/project-context.ts` 判断是否在项目里，不在就只传组织层。
 */
export function describeOrgLayer(id: Identity): string {
  return [ORG_ROLE_LABEL[id.orgRole], id.org.team].filter(Boolean).join(" · ");
}

export function describeProjectLayer(id: Identity): string | null {
  if (!id.projectRole) return null;
  return [PROJECT_ROLE_LABEL[id.projectRole], id.groupName].filter(Boolean).join(" · ");
}

/** 兼容旧调用：两层都在时拼成一行 */
export function describeIdentity(id: Identity): string {
  const left = describeOrgLayer(id);
  const right = describeProjectLayer(id);
  return right ? `${left} ｜ 本项目：${right}` : left;
}

/** 从 URL query 读预览视角。⚠ 生产环境恒为 null（预览开关不可达，R12 V8）*/
export function resolvePreviewRole(raw: string | string[] | undefined): ProjectRole | null {
  if (process.env.NODE_ENV === "production") return "facilitator";
  const v = Array.isArray(raw) ? raw[0] : raw;
  return PROJECT_ROLES.includes(v as ProjectRole) ? (v as ProjectRole) : "facilitator";
}
