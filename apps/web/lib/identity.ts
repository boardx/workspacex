/**
 * 两层身份模型的**前端投影**（UC-0.3）
 *
 * ⚠⚠ 这里的一切都只是界面投影。**真实权限在服务端**（NestJS Guard + PostgreSQL RLS）。
 *    视角切换器是**预览手段，不是权限实现**——UC-0.3 R5 明确禁止「前端隐藏即安全」。
 *    切换 `?as=` 只改变本地展示，不改变服务端返回的数据，且生产构建不可达。
 */

/** 组织角色（[原型] 后台「成员与配额」三取值）*/
export type OrgRole = "admin" | "lead" | "consultant";
export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  admin: "管理员",
  lead: "项目负责人",
  consultant: "顾问",
};

/** 项目角色（[设计] UC-0.3 恒为四种；协同引导师 = 引导师多实例，见裁决 O-03）*/
export type ProjectRole = "facilitator" | "groupLead" | "member" | "observer";
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
export type OrgKind = "organization" | "personal-local";

export interface Organization {
  id: string;
  name: string;
  kind: OrgKind;
  /** 团队为单一归属：组织内一人一队（裁决 O-12）。本地组织恒为 null */
  team: string | null;
}

/**
 * 个人本地组织的三条硬隔离（UC-0.5 R7）—— **是产品承诺，不是配置项**
 * ① 模型调用只允许本地 / 自托管端点，云端模型不可选
 * ② 禁止任何 MCP 出网调用
 * ③ 数据不出本地部署（不进共享对象存储、不进跨组织索引）
 * 违反时**拒绝并显式报错，不得静默降级到云端**。
 */
export const LOCAL_ORG_GUARANTEES = [
  "模型调用只走本地 / 自托管端点，云端模型在此不可选",
  "禁止任何 MCP 出网调用",
  "数据不出本地部署，不进共享对象存储与跨组织索引",
] as const;

export function isLocalOrg(org: Organization): boolean {
  return org.kind === "personal-local";
}

export interface Identity {
  displayName: string;
  orgRole: OrgRole;
  org: Organization;
  /** 当前项目中的角色；不在项目上下文里时为 null */
  projectRole: ProjectRole | null;
  projectName: string | null;
  groupName: string | null;
}

/** mock 数据 —— 数量级与字段完整度贴近真实（sign-off 要能看出信息密度问题）*/
export const MOCK_ORGS: Organization[] = [
  { id: "org-yuanyang", name: "远洋新能源", kind: "organization", team: "能源组" },
  { id: "org-hengtai", name: "恒泰供应链", kind: "organization", team: "供应链组" },
  // 注册那一刻自动创建，恒定存在、不可删除 / 退出 / 转让 / 邀请他人（UC-0.5 R7）
  { id: "org-local", name: "林可 的本地", kind: "personal-local", team: null },
];

export function mockIdentity(orgId: string, projectRole: ProjectRole | null): Identity {
  const org = MOCK_ORGS.find((o) => o.id === orgId) ?? MOCK_ORGS[0]!;
  return {
    displayName: "林可",
    // 本地组织里没有「上级」——自己就是唯一成员，无人可管
    orgRole: org.kind === "personal-local" ? "admin" : "consultant",
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
