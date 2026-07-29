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
 * 哪些路由处在项目上下文里。
 *
 * 判定规则（按此顺序）：
 *  1. `/projects/<id>/...` —— 明确的项目子路由，`<id>` 即项目标识；
 *  2. 下表列出的「隐式项目路由」—— 它们的内容天然挂在某个项目下
 *     （对话线程属于某项目、访谈现场属于某场次、问卷工作台属于某问卷）。
 *
 * **不在项目上下文里**的：`/`（首页）、`/projects`（列表本身）、`/kitchen-sink`、
 * `/tasks`（跨项目的我的今天）、`/brain`（三层记忆，跨项目）、`/admin/*`（组织治理）、
 * `/studio/prototype`（原型可「不属于任何项目」，见原型档案第五节）、
 * `/studio/research`（Context Pack 视图，可跨项目检索）。
 *
 * ⚠ `/studio/research` 与 `/studio/prototype` 的归属**是有争议的**——
 * 它们既可挂项目也可独立发起。当前按「独立」处理（不显示项目层身份）。
 * 已列入 sign-off 待确认清单，见 `ui-preview/README.md`。
 */
const IMPLICIT_PROJECT_ROUTES: Record<string, ProjectContext> = {
  "/chat": { id: "demo", name: "欧洲市场进入" },
  "/studio/interview": { id: "demo", name: "欧洲市场进入" },
  "/studio/survey": { id: "demo", name: "欧洲市场进入" },
};

/** mock 项目名查表；真实实现从服务端取 */
const PROJECT_NAMES: Record<string, string> = {
  demo: "欧洲市场进入",
};

/** 从路径解析项目上下文；不在项目里返回 null。 */
export function resolveProjectContext(pathname: string): ProjectContext | null {
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  if (m) {
    const id = m[1]!;
    return { id, name: PROJECT_NAMES[id] ?? id };
  }
  const implicit = IMPLICIT_PROJECT_ROUTES[pathname];
  if (implicit) return implicit;
  // 隐式路由的子路径也算（如 /studio/interview/xxx）
  const hit = Object.keys(IMPLICIT_PROJECT_ROUTES).find((p) => pathname.startsWith(p + "/"));
  return hit ? IMPLICIT_PROJECT_ROUTES[hit]! : null;
}
