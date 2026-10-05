/** Static product navigation metadata; no fixtures, counts, credentials or tenant data. */
export type AdminModuleKey =
  // ⚠ B3.6（2026-09-04）：`feedback` 已从这个联合类型移除——旧的「反馈与迭代」后台
  //   两列屏（`feedback-screen.tsx`）已删除，`/platform-admin/feedback` 改成 301 到
  //   `/platform-admin/inbox`（新屏是严格超集，见 backlog uc-17-8 D2）。
  | "overview" | "agent" | "skill" | "model" | "mcp" | "members" | "ops-status"
  // D9（PROP-OPS-INSTANCE-TELEMETRY-001）：实例管理员的「上报设置」
  | "telemetry"
  // UC-17.8 研发闭环（反馈→设计→排期）：反馈草稿 / 运营收件箱 / PM 设计工作台
  | "feedback-drafts" | "inbox" | "design-workbench"
  // F132：画布模板与项目蓝本。它们本来就是 `AssetKind` 六值中的两个，
  // 左栏却只画了四个 —— 人类那句「为什么在管理后台看不到项目蓝本」问的正是这个。
  // ⚠ 键取原型 `AN_META` 的键（`canvasadmin`），**不是**契约码也不是视图码：
  //   这是路由段/testid 命名空间，与 `CONTRACT_DIVERGENCES.D10`（契约 `canvas-template`
  //   vs 视图 `canvas`）**无关，也不构成对它的裁决**。映射见
  //   `components/admin/asset-kind-nav.ts`。
  | "canvasadmin" | "blueprint"
  // F16：本地组织。归在「组织」组里而不是「AI 能力」组——它是一个组织，
  // 只不过是只有一个人、且数据不出本机的那种。
  | "local"
  // org-management-integration（2026-09-03 人类直接反馈：「在组织的菜单点击组织管理，
  // 就是进入到组织后台的菜单，所以需要把他们合并」）：左上角组织菜单的「组织管理」
  // 入口（`components/shell/org-menu.tsx`，href `/org-admin`）此前落到一个**不带组织
  // 后台左栏**的独立页面——点进去感觉不到「进了组织后台」，与人类的心智模型（组织管理＝
  // 组织后台的一部分）不一致。
  // ⇒ 让 `/org-admin/*` 在「组织」组里有名有姓的落点，`org-admin-screen.tsx` 据此把自己
  // 的 `AppShell` 接上 `AdminNav`（同其余 `/admin/*` 屏一样的左栏）。
  //
  // org-admin-restructure（issue #2615，2026-09-03 人类两条原话裁决）：
  //   ①「在后台的组织后台中，将组织管理下面的成员、邀请、组织资料，编程是和总览平级的
  //     功能」——原来单一的 `org-profile`（团队/成员/邀请/组织资料四个标签页塞进一个
  //     入口）被拆平成三个与 `overview` 同层级的左栏项：`org-members`/`org-invites`/
  //     `org-profile`（`org-profile` 键复用给"组织资料"这一项）。
  //   ②「在组织中去掉团队的概念。团队的概念是在项目中的概念，在项目中分为不同的团队」
  //     ——原来的"团队"标签页整体撤除，不再是这三项之一。
  // href 仍各自是 `/org-admin/*`（不是 `/admin/org-members` 等）——这几个屏是 session
  // 驱动的真实数据页，不经过 `app/admin/[module]/page.tsx` 那套 `SCREENS`/`REDIRECTS`
  // 分发，见该文件头注对已合并模块的既有处置（`blueprint`/`skill`/`canvasadmin` 同理）。
  | "org-members" | "org-invites" | "org-profile"
  // 组织首页配置（ad-hoc，Refs #4634）：登录后第一落点（`/home`）的横幅/快捷入口/组织推荐，
  // 由本组织 admin 在这里配置。归在「组织」组、紧跟 `org-profile`——同样是「本组织自己的东西」，
  // 与 `org-profile` 同一个授权面（组织 admin），不是新开一面。
  | "home-config"
  // 工作流权限授予：内置工作流写步骤（保存文档/发通知…）的组织级授权（workflow_capability_grants）。
  // 与 `org-profile` 同一个授权面（组织 admin），归「组织」组。
  | "workflow-grants"
  // member-role-management delta：成员管理的**平台级**（全平台账号名册 + 任一组织里的角色）。
  // 单独一组「平台」而不是塞进「组织」组：它的授权面是平台超管（部署白名单），不是组织角色，
  // 与「组织」组里每一项「本组织 admin 可见」的语义不同——同一组里混两种授权面会让人以为
  // 组织 admin 也能看全平台。
  | "platform" | "organizations" | "model-tests";

/**
 * 「AI 能力」组的组名 —— 单点声明。
 * `asset-kind-nav.ts` 的双向门控要按组名从 `ADMIN_NAV` 里取出资产项集合；
 * 组名写两遍就是「同一事实两处」，改一处会让门控静默地检查一个空组（平凡为真）。
 */
export const AI_CAPABILITY_GROUP = "AI 能力";

/**
 * 后台的**两个面**（2026-09-02 人类直接裁决：「把目前的后台切割为两部分，两个菜单入口，
 * 一个是组织的后台管理，一个是平台的后台管理……组织的管理和平台的管理是不同的」）：
 *   · `org`      —— 组织后台（`/admin/*`）：管的是**当前组织**自己的东西（AI 能力目录、成员配额、
 *                   本地组织），授权面是组织 admin，数据按当前组织走 RLS。
 *   · `platform` —— 平台后台（`/platform-admin/*`）：管的是**整个平台**（全平台账号名册、
 *                   全体用户反馈与迭代），授权面是平台运维/超管，页头不挂组织身份卡。
 * 一级导航（`lib/navigation.ts` 的「治理」段）各有一个入口；`AdminNav` 按 scope 只画自己那一面的组。
 * ⚠ 每个模块**只属于一个面**——同一入口不许在两面都出现（同一功能不许两个入口）。
 */
export type AdminScope = "org" | "platform";

export const ADMIN_SCOPE_META: Record<AdminScope, { title: string; intro: string; rootHref: string }> = {
  org: { title: "组织后台", intro: "当前组织的总览、成员配额与本地组织", rootHref: "/admin" },
  platform: { title: "平台后台", intro: "全平台的 AI 能力、账号与运营管理面", rootHref: "/platform-admin" },
};

export interface AdminModuleMeta {
  key: AdminModuleKey;
  label: string;
  href: string;
  /** 该模块承载哪些 UC —— 供 sign-off 回溯 */
  ucRefs: string[];
}

export interface AdminNavGroup {
  group: string;
  /** 这一组属于哪个后台面（见 `AdminScope`）。 */
  scope: AdminScope;
  items: AdminModuleMeta[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    group: AI_CAPABILITY_GROUP,
    // 2026-09-02 人类第二次裁决（看组织后台截图后原话：「对于 AI 的能力都应该是在平台的
    // 后台管理上，而不是组织上」）：AI 能力六项整体归**平台后台**。Agent / 模型 / MCP 的
    // 路由随之迁到 `/platform-admin/*`（旧 `/admin/*` 重定向）；Skill / 画布模板 / 项目模板
    // 的 href 本来就不在 `/admin` 下，只是左栏归属换了面。
    // ⚠ 数据读取与写权限**没有改**：目录仍按当前登录者所在组织走 RLS、写操作仍要组织 admin
    //   （`canMutate`）。这里改的是信息架构与呈现，不是授权面——授权面若要改是另一件事。
    scope: "platform",
    // ⚠ 这一组的**项集合**受 `asset-kind-nav.ts` 的双向门控约束：它必须与契约
    //   `AssetKind` 的取值集合逐个相等。删一项、多一项、或契约加了值这边没跟，都会红。
    //   顺序与分组细节待 Q-11 裁，门控**不锁顺序**。
    items: [
      // 2026-08-11（人类裁决，真合并——见 phases/requirements/DECISIONS-FINAL.md 对应条目）：
      // 上一轮（#928/#929）只改了措辞、加了跳转链接，没有真的把重复入口合掉。这次人类
      // 直接裁决：Q-11/X-J 解除阻塞，五个重复项收敛掉，不再有第二个指向同一能力域的入口。
      //   · 「项目蓝本」→ 改名「项目模板」，href 直接指向 `/tpl/list`（不再经过 `/admin/blueprint`
      //     那个空壳治理页，`templates` 束的蓝本设计器就是它）。
      //     ⚠ 2026-08-14（人类反馈：生产入口不该带原型切换器）：改指 `/tpl/list` 而不是
      //     裸 `/tpl`——`/tpl` 身兼「list 屏」与「一整套 UI-first 原型屏切换器」两职
      //     （`TplNav` 中间导航列 + `PreviewControls` 顶条），`/tpl/list` 是只渲染
      //     `BlueprintListScreen`、不带那套脚手架的生产入口。见 `app/tpl/list/page.tsx`。
      //   · 「Skill 目录」→ href 直接指向 `/skill`（Skill 库与市场，功能更完整的那条真实链路），
      //     原 `/admin/skill` 的简单 CRUD（名称/可见范围/归属团队编辑，`CapabilityCatalogScreen`）
      //     已折进 `/skill` 左栏的新增「目录」屏（`skill-app.tsx` 的 `catalog` screen），
      //     不是被砍掉——旧路由 `/admin/skill` 重定向过去，不留死链。
      // Agent（工具白名单/越权申请/行为审计已折入本屏下方新增区块，见 `agent-screen.tsx`）与
      // MCP / 模型同理：吸收原「智能体运行时」对应子屏的内容，见各自组件头注。
      //
      // 2026-08-15（人类直接裁决，D-43，推翻 D-42 ⑤——见 phases/requirements/DECISIONS-FINAL.md）：
      // 人类看真实后台截图后原话：「目前的画布模板，有问题，点击后台的画布模板以后，右边的
      // 列表，应该和打开模板和编辑器的界面整合，合并成一个」。「画布模板」href 因此改指
      // 真实的模板库与编辑器（同蓝本/Skill 的做法——href 直接指向合并落点），不再经过
      // `/admin/canvasadmin` 那个只做清单+跳转链接的空壳页（该路由已重定向到这里，见
      // `app/admin/[module]/page.tsx` 的 `REDIRECTS`）。
      // ⚠ 2026-08-30（路由复盘）：href 从历史 `/canvas?screen=template-admin` 改成路径段
      // `/canvas/template-admin`——见 `lib/canvas-screens.ts` 头注；旧 query 形态仍可用
      // （`app/canvas/page.tsx` 兼容重定向），但这里不该再手写它。
      { key: "agent", label: "Agent 目录", href: "/platform-admin/agent", ucRefs: ["04-agent/uc-4-1", "04-agent/uc-4-4"] },
      { key: "skill", label: "Skill 目录", href: "/skill", ucRefs: ["03-skill/uc-3-1", "03-skill/uc-3-4"] },
      { key: "model", label: "模型", href: "/platform-admin/model", ucRefs: ["20-model/uc-20-1", "20-model/uc-20-2"] },
      { key: "mcp", label: "MCP", href: "/platform-admin/mcp", ucRefs: ["21-mcp/uc-21-1", "21-mcp/uc-21-2"] },
      { key: "canvasadmin", label: "画布模板", href: "/canvas/template-admin", ucRefs: ["23-asset/uc-23-8", "07-canvas/uc-7-1"] },
      { key: "blueprint", label: "项目模板", href: "/tpl/list", ucRefs: ["23-asset/uc-23-8", "02-tpl/uc-2-1"] },
    ],
  },
  {
    group: "组织",
    scope: "org",
    items: [
      { key: "overview", label: "总览", href: "/admin", ucRefs: ["17-gov/uc-17-1", "17-gov/uc-17-7"] },
      // 见上方 `AdminModuleKey.org-members`/`org-invites`/`org-profile` 长注：原「组织管理」
      // 单一入口（团队/成员/邀请/组织资料四个标签页）已拆平为三个与 `overview` 同层级的项，
      // 紧跟在总览后面——没有"团队"这一项（issue #2615 裁决②：团队是项目里的概念）。
      { key: "org-members", label: "成员", href: "/org-admin/members", ucRefs: ["01-auth/uc-1-4", "17-gov/uc-17-1"] },
      { key: "org-invites", label: "邀请", href: "/org-admin/invites", ucRefs: ["01-auth/uc-1-4", "17-gov/uc-17-1"] },
      { key: "org-profile", label: "组织资料", href: "/org-admin/profile", ucRefs: ["01-auth/uc-1-4", "17-gov/uc-17-1"] },
      { key: "home-config", label: "首页配置", href: "/org-admin/home-config", ucRefs: ["01-auth/uc-1-4"] },
      { key: "workflow-grants", label: "工作流权限", href: "/org-admin/workflow-grants", ucRefs: ["01-auth/uc-1-4"] },
      { key: "members", label: "成员配额", href: "/admin/members", ucRefs: ["17-gov/uc-17-5", "17-gov/uc-17-7"] },
      { key: "local", label: "我的本地", href: "/admin/local", ucRefs: ["00-core/uc-0-5"] },
    ],
  },
  {
    // 2026-09-02（人类反馈，看真实后台截图后原话：「这个 UI 管理的是整个平台的数据，
    // 而不是当前的这个 boardx 组织，上面这组织是错误的」）：「反馈」从「组织」组挪出来——
    // 它不是某个组织自己的配置项（不像成员配额/我的本地那样，改动只影响这一个组织），
    // 是运营这个产品的人处理全体用户反馈的地方。⚠ 数据读取仍然按当前登录者所在组织
    // 走 RLS（这个仓库今天就一个组织在用，「反馈」本质是运营动作，不是要打破多租户
    // 隔离），只是页头不该再挂一张「组织：boardx」的身份卡，径直导航到「组织管理」
    // 的路径分组更是放错了位置——见 `admin-header.tsx` 的 `hideOrgIdentity`。
    //
    // ⚠ 与下面的「平台」组**不是同一件事**，故意分成两组：「运营」（本组）仍然是
    //   当前登录者所在组织的数据、按 RLS 走，只是呈现上不该像组织配置；「平台」组
    //   （member-role-management delta 新增）授权面是平台超管（部署白名单），能看到
    //   全平台账号名册——两者的授权面不同，混进同一组会让人以为组织 admin 也能看全平台。
    //
    // 2026-09-02 后台切成两面（见 `AdminScope`）：本组与「平台」组一起归入**平台后台**
    // （`/platform-admin/*`），左栏「组织后台」不再画它们；旧路由 `/admin/feedback` 重定向。
    group: "运营",
    scope: "platform",
    items: [
      // B3.6（2026-09-04，旧屏退役）：本项此前指向 `/platform-admin/feedback`（旧的
      // 「反馈与迭代」后台两列屏，`feedback-screen.tsx`）——已删除，不再在左栏出现。
      // 该路由现在是一条 301：`/platform-admin/feedback` → `/platform-admin/inbox`
      // （下面「运营收件箱」项）。理由（backlog uc-17-8 D2）：「运营收件箱」是三类
      // 来源（反馈/系统异常/设计方案）的统一投影，严格超集于旧屏能做的事——两个入口
      // 画同一件事，只留一个。
      // 2026-09-03（人类反馈：「测试邮件的功能不要放在系统异常下面，放到平台后台的一个
      // 新的菜单叫运营状态」）：从「反馈与迭代 → 系统异常」tab 挪出来，单独一个入口——
      // 它不是"反馈"（没有提交人、没有分诊），是运维自查这个部署本身是否健康的工具。
      { key: "ops-status", label: "运营状态", href: "/platform-admin/ops-status", ucRefs: ["17-gov/uc-17-6"] },
      // D9：本实例向我们上报哪几类运行信号——四项独立同意 + 看见传了什么。
      { key: "telemetry", label: "上报设置", href: "/platform-admin/telemetry", ucRefs: ["17-gov/uc-17-6"] },
      // UC-17.8：一条研发流水线的三个面。收件箱是三类来源（反馈/系统异常/设计方案）的统一投影。
      { key: "feedback-drafts", label: "反馈草稿", href: "/platform-admin/feedback-drafts", ucRefs: ["17-gov/uc-17-8"] },
      { key: "inbox", label: "运营收件箱", href: "/platform-admin/inbox", ucRefs: ["17-gov/uc-17-8"] },
      { key: "design-workbench", label: "PM 设计工作台", href: "/platform-admin/design-workbench", ucRefs: ["17-gov/uc-17-8"] },
    ],
  },
  {
    group: "平台",
    scope: "platform",
    items: [
      // 仅平台超管可见内容；非超管点进去看到的是「仅平台运维可见」的说明，不是隐藏入口——
      // 「存在但你看不到」和「不存在」是两件事（UC-0.3 R8），同反馈屏系统异常区的处置。
      // 2026-09-02：路由从 `/admin/platform` 迁到 `/platform-admin/members`（旧路由重定向）。
      { key: "model-tests", label: "模型能力测试", href: "/platform-admin/model-tests", ucRefs: [] },
      { key: "organizations", label: "组织与套餐", href: "/platform-admin/organizations", ucRefs: [] },
      { key: "platform", label: "平台成员", href: "/platform-admin/members", ucRefs: ["17-gov/uc-17-5"] },
    ],
  },
];

/** 某一面的左栏分组——`AdminNav` 按这个画，不在组件里再按组名硬编码过滤。 */
export function adminNavForScope(scope: AdminScope): AdminNavGroup[] {
  return ADMIN_NAV.filter((g) => g.scope === scope);
}

/** 模块键 → 所属后台面（从 `ADMIN_NAV` 派生，不抄第二份）。 */
export const ADMIN_MODULE_SCOPE: Record<AdminModuleKey, AdminScope> = Object.fromEntries(
  ADMIN_NAV.flatMap((g) => g.items.map((m) => [m.key, g.scope])),
) as Record<AdminModuleKey, AdminScope>;

export const ADMIN_MODULE_META: Record<AdminModuleKey, AdminModuleMeta> = Object.fromEntries(
  ADMIN_NAV.flatMap((g) => g.items).map((m) => [m.key, m]),
) as Record<AdminModuleKey, AdminModuleMeta>;

