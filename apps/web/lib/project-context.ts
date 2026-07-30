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
 *     （对话线程属于某项目、问卷工作台属于某问卷、项目工作台就是某个项目）。
 *
 * **不在项目上下文里**的：`/`（首页）、`/projects`（列表本身）、`/kitchen-sink`、
 * `/tasks`（跨项目的我的今天）、`/brain`（三层记忆，跨项目）、`/admin/*`（组织治理）、
 * `/studio/research`（Context Pack 视图，可跨项目检索）。
 *
 * ⚠ **组织级能力域**（`/tpl` 蓝本、`/skill` 技能、`/org-admin/preview` 成员、
 *   `/preview/agent-runtime` 智能体、`/asset-governance` 资产）**刻意不在此表**：
 *   它们是组织治理，不属于某个具体项目，顶栏显示「不在项目上下文·项目角色不适用」是**对的**
 *   （UC-0.3 R4 E1：有组织角色而无项目角色是正常状态）。
 *
 * ⚠ `/studio/research` 的归属是有争议的（可挂项目也可独立发起），当前按「独立」处理。
 *   已列入 sign-off 待确认清单，见 `ui-preview/README.md`。
 *
 * ── 2026-07-30 接线修正 ──
 * `/project`（Layout B 项目工作台，project 束现行屏）此前落 null → 顶栏恒显
 * 「不在项目上下文·项目角色不适用」，**与满屏项目内容 + 工作台自带的四视角切换器直接矛盾**
 * （三个 agent 独立指出）。这里补上它的项目上下文，矛盾消除。
 * ⚠ 顶栏因此会出现项目条，但**不会**再出一个视角切换器——工作台自带一个，
 *   顶栏的预览切换器由 `hideRoleSwitcher` 让位（见 `app-shell.tsx` / `top-bar.tsx`）：
 *   **角色切换的唯一来源 = 各域内容区自带的切换器**，顶栏只显示上下文标签。
 * 旧 `/studio/interview` 已退役重定向到 `/itv`，故从本表移除。
 */
const IMPLICIT_PROJECT_ROUTES: Record<string, ProjectContext> = {
  "/chat": { id: "demo", name: "欧洲市场进入" },
  "/studio/survey": { id: "demo", name: "欧洲市场进入" },
  // project 束 · Layout B 工作台（顶层路由 /project）。名称对齐工作台二级头显示的项目。
  "/project": { id: "kickoff", name: "欧洲进入策略 Kickoff" },
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
  // 隐式路由的子路径也算（如 /studio/survey/xxx）
  const hit = Object.keys(IMPLICIT_PROJECT_ROUTES).find((p) => pathname.startsWith(p + "/"));
  return hit ? IMPLICIT_PROJECT_ROUTES[hit]! : null;
}
