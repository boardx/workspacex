/**
 * 项目上下文作用域 —— **项目角色只在项目里才存在**（UC-0.3 两层正交模型）
 *
 * 背景（2026-07-28 人类指出的模型错误）：
 * 顶栏原先**无条件**渲染「本项目：引导师」与四视角切换器，等于宣称项目角色是全局属性。
 * 这与 UC-0.3 直接冲突——
 *   · **组织角色**（管理员 / 项目负责人 / 顾问）+ 团队归属：**全局**，决定你能用什么资源；
 *   · **项目角色**（引导师 / 组长 / 组员 / 观察者）：**只在某个目标项目内**成立，
 *     决定你在那场项目里能看什么、做什么。
 * UC-0.3 R4 E1 更明写「用户有组织角色但**无项目角色**时，项目内资源一律不可见」——
 * 说明「无项目角色」是正常状态，不是缺省值。在后台、任务、大脑这些**非项目**页面上
 * 显示「本项目：引导师」，是在把一个不存在的判定画到界面上。
 *
 * 因此：项目层身份与视角切换器**只在项目上下文内渲染**。
 *
 * ⚠ 这里是**界面投影的作用域**，不是权限。真实鉴权是两层交集，在服务端
 * （NestJS Guard + PostgreSQL RLS）执行，见 UC-0.3 R7。
 */

export interface ProjectContext {
  /** 项目标识；列表页等非项目上下文为 null */
  id: string;
  name: string;
}

/**
 * 路由只解析候选项目 ID，不证明成员身份或项目角色。
 * 显式 /projects/:id 路径优先；项目对话及 Studio 内容页可携带 projectId。
 * 不带 projectId 的工具页保持独立；组织治理等其他路由忽略该查询参数。
 * 顶栏复用 listProjects 确认 Studio 候选项目及名称，查询期间不显示内部 ID，
 * 也不把 identity 中别的项目角色带入 Studio 页面。
 */
export function resolveProjectContext(
  pathname: string,
  queryProjectId?: string | null,
): ProjectContext | null {
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  if (m) {
    const id = m[1]!;
    return { id, name: id };
  }
  if (supportsProjectQuery(pathname) && queryProjectId) return { id: queryProjectId, name: queryProjectId };
  return null;
}

/** Query-scoped content routes. The query selects a candidate; it grants no membership or role. */
export function supportsProjectQuery(pathname: string): boolean {
  return /^\/(?:chat|rec|itv|research|studio\/(?:survey|research|design-workbench))(?:\/|$)/.test(pathname);
}
