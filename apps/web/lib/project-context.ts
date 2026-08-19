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
 * ── 2026-07-30 接线修正（2026-08-02 更新，issue #317）──
 * `/project`（Layout B 项目工作台，project 束当时的现行屏）此前落 null → 顶栏恒显
 * 「不在项目上下文·项目角色不适用」，**与满屏项目内容 + 工作台自带的四视角切换器直接矛盾**
 * （三个 agent 独立指出）。当时的处置是给 `/project` 补一条隐式项目上下文表项。
 * ⚠ 顶栏因此会出现项目条，但**不会**再出一个视角切换器——工作台自带一个，
 *   顶栏的预览切换器由 `hideRoleSwitcher` 让位（见 `app-shell.tsx` / `top-bar.tsx`）：
 *   **角色切换的唯一来源 = 各域内容区自带的切换器**，顶栏只显示上下文标签。
 * 旧 `/studio/interview` 已退役重定向到 `/itv`，故从本表移除。
 *
 * ── 2026-08-02 再次接线：工作台迁到 `/projects/[projectId]`（issue #317）──
 * 工作台不再挂在静态 `/project`（已退役为 `redirect("/projects")`），改挂
 * `/projects/[projectId]`——那条路由本就被上面第 1 条规则（`/projects/<id>/...`）
 * 覆盖，能拿到真实 `<id>` 而不是写死的 `kickoff`。因此 `/project` 这条隐式表项
 * 现在是死的（该路径永远重定向，从不渲染），一并移除，不留悬空映射。
 *
 * ── 2026-08-19 补 `/chat?projectId=…`（#728 D4 实测）──
 * `/chat` 挂靠项目时，项目标识在**查询串**里，不在路径段——本函数原先只读
 * `pathname`，于是项目对话主屏（`ChatReadScreen`）在真实带项目打开时，顶栏仍判定
 * 「不在项目上下文中」，与满屏的团队编制/线程列表**同屏自相矛盾**（本条与 `/project`
 * 那次是同一种病：满屏项目内容却被判成不在项目里）。修法：`resolveProjectContext`
 * 新增可选第二参 `chatProjectId`（调用方从 `useSearchParams()` 取，只在
 * pathname === "/chat" 时传），命中即判定为项目上下文。
 *
 * ⚠ 这里**只解出 `id`**，`name` 先落 `id` 占位——项目显示名不在本函数的解析范围
 * （聊天场景没有『路径段本身带名字』这回事，`getThread` 也不返回项目名），
 * 需要调用方另外发一次真实查询（`listProjects`）把 `name` 换成人类可读的值，
 * 详见 `top-bar.tsx` 的 `useChatProjectName`。裸 id 占位期间界面仍是诚实的——
 * 「知道在哪个项目、还不知道它叫什么」比「不知道在不在项目里」更接近事实。
 */
const IMPLICIT_PROJECT_ROUTES: Record<string, ProjectContext> = {
  "/studio/survey": { id: "demo", name: "欧洲市场进入" },
};

/** mock 项目名查表；真实实现从服务端取 */
const PROJECT_NAMES: Record<string, string> = {
  demo: "欧洲市场进入",
};

/**
 * 从路径解析项目上下文；不在项目里返回 null。
 * `chatProjectId`：`/chat?projectId=…` 的查询串取值，只有 pathname 是 `/chat`
 * 时才该传非 null（调用方负责判断，本函数不重复解析 pathname 是不是 `/chat`
 * 之外的逻辑——这个参数命名已经把「谁该传」写死在类型语义里）。
 */
export function resolveProjectContext(
  pathname: string,
  chatProjectId?: string | null,
): ProjectContext | null {
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(pathname);
  if (m) {
    const id = m[1]!;
    return { id, name: PROJECT_NAMES[id] ?? id };
  }
  if (chatProjectId) return { id: chatProjectId, name: chatProjectId };
  const implicit = IMPLICIT_PROJECT_ROUTES[pathname];
  if (implicit) return implicit;
  // 隐式路由的子路径也算（如 /studio/survey/xxx）
  const hit = Object.keys(IMPLICIT_PROJECT_ROUTES).find((p) => pathname.startsWith(p + "/"));
  return hit ? IMPLICIT_PROJECT_ROUTES[hit]! : null;
}
