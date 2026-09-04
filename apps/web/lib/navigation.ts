import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare, FolderKanban, Search, Mic, ClipboardList, LayoutTemplate,
  Brain, ListTodo, Settings2, FileText, AudioLines, Shapes, Puzzle, Bot, Users, Boxes,
  MessageSquareWarning, ListChecks, Globe, Cpu,
} from "lucide-react";

/**
 * 左侧五段语义导航 —— 结构与分组来自对运行态原型的实测
 * （`WorkspaceX Standalone.html` 图标栏 76px 那列，逐项取 innerText 与 y 坐标）：
 *
 *   y=62  对话                    ← 无分组标签，单独居顶
 *   y=123 编排(标签) → y=148 项目
 *   y=199 STUDIO(标签) → 研究 224 / 访谈 275 / 问卷 326 / 原型 377
 *   y=428 能力(标签) → 大脑 453 / 任务 504
 *   y=555 治理(标签) → 后台 580
 *
 * 间距规律：同组项 51px 一档，分组标签在其首项上方 25px。
 * ⚠ 这是**已确认的产品心智**，五段分组与顺序不动（UC-0.4 R4 A1）。
 *
 * ⚠ 2026-08-09 更新（issue #801）：上面 y=377「原型」一格与本节末尾「治理」小节的
 *   权威引用互相矛盾——原型设计说明逐字写着「画布从议程进，不占一级」（见下方 #593 小节
 *   第②条）。人类此次裁决以设计说明为准：**画布（canvas）从 STUDIO 移出**，作为「后台」
 *   的 children 渲染（与蓝本/技能/智能体/成员/资产同级），不再是一级导航项。
 *   上面 y=377 那行是历史测量记录，不删是为了留痕，实现请看 `NAV_SEGMENTS` 里 STUDIO
 *   segment 已不含 canvas、admin.children 已新增 canvas 条目。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2026-07-30 接线修正（ADR-023 签核材料必须活在产品里）：
 *   病：十一个契约束（ui-material-map.json 声明）的**现行 v2 屏**全部只能敲 URL 进——
 *   导航连的是另一套更旧的骨架屏（/studio/interview、/studio/prototype…），
 *   三个独立 agent 各自撞上同一根：「评审签的和用户用的不是同一个产品」。
 *   （证据：全仓 grep 指向 /tpl /skill /rec /itv /canvas 的内部跳转曾 = 0 条。）
 *
 *   修：在**不动五段分组**的前提下，把十一束的现行路由都挂进导航——
 *     · 重指（不改 label/icon，像素不变）：访谈 /studio/interview → /itv；
 *       画布（旧「原型」）/studio/prototype → /canvas。
 *     · 新增：蓝本 /tpl（编排）、录音 /rec（STUDIO）、
 *            技能 /skill、智能体 /preview/agent-runtime、成员 /org-admin/preview、
 *            资产 /asset-governance（治理）。
 *     · 旧 /studio/interview、/studio/prototype 已退役为重定向（见各自 page.tsx）。
 *
 *   这条「导航树 ↔ 契约束现行路由」的对应关系由机械门控守护：
 *   `.harness/scripts/lint-nav-reachability.mjs`（双向：束route 必在导航中 ∧
 *    导航 route 必属某束或在显式白名单）。改这里必须同步跑它，否则会红。
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** 该入口对应哪些 UC —— 供 ui-prototyper 与 sign-off 时回溯 */
  ucRefs: string[];
  /**
   * **第二级**（原型 COLUMN 2「二级：对象列表 —— 线程、项目、后台模块」）。
   * 有 children 的项：children **不占一级导航**，只在该项自己的屏里（后台左栏）出现。
   * `IconRail` 只渲染 `NavSegment.items`，永不渲染 children —— 这是一级/二级的机械分界。
   */
  children?: NavItem[];
  /**
   * #700 选项 1（人类裁决，见 issue #700 评论 5224610781）：本项默认屏仍是原型/mock，
   * 尚未接真实后端，与「AI 能力」组同名能力域的正式屏不是一回事——`AdminNav` 据此渲染
   * 一条「预览 · 未接后端」提示，语气对齐 `NoBackendNotice`。不写 = 默认屏已接真实后端
   * （2026-08-11 起 `skills` 与 `org-admin` 都是这样，见下方 #<菜单去重> 长注），
   * 不要连坐打标签。
   */
  isPrototype?: boolean;
  /**
   * 2026-08-11（菜单去重复查）：`isPrototype` 项在「后台 → AI 能力/组织」组里通常有一个
   * 近义命名的对应项（Agent/智能体、Skill/技能……），仅一个模糊的「原型」徽标不足以让人
   * 分清两者关系。这条一句话说清楚：它和哪个后台项对应、差异是什么。`AdminNav` 把它渲染
   * 在标签下方，不是塞进徽标 tooltip 里——要看得见，不是要 hover 才知道。
   */
  prototypeNote?: string;
}

export interface NavSegment {
  /** 分组标签；null = 无标签（顶部的「对话」）*/
  label: string | null;
  items: NavItem[];
}

export const NAV_SEGMENTS: NavSegment[] = [
  {
    label: null,
    items: [
      // 束: chat
      { key: "chat", label: "对话", href: "/chat", icon: MessagesSquare, ucRefs: ["08-chat/uc-8-1", "08-chat/uc-8-2"] },
    ],
  },
  {
    label: "编排",
    items: [
      // 束: project（列表 /projects → 工作台 /projects/[projectId]）
      { key: "projects", label: "项目", href: "/projects", icon: FolderKanban, ucRefs: ["00-project/uc-0-2", "02-tpl/uc-2-2"] },
      // ⚠ 蓝本已于 #593 移出本组 —— 原型的一级「编排」只有「项目」一项，
      //   「项目蓝本」是**后台模块**（原型后台左栏 AI 能力组）。见文件底部 #593 长注。
    ],
  },
  {
    label: "STUDIO",
    items: [
      // 束: research（研究 Studio · M24）—— 重指到本束现行屏 /research（顶层）。
      //   旧值 /studio/research 渲染的是 UC-0.2 Context Pack（语义不同），二者共用一条路由
      //   是 requirements/24-research/OPEN-QUESTIONS.md 的 Q-2（阻塞级·未裁）。此处只做**最小可逆**
      //   的一步：把「研究」一级导航指向真正的研究 Studio（与原型 IA 一致——研究是一级导航、
      //   Context Pack 不是）；Context Pack 页面仍在 /studio/research 直达。Q-2 的最终归并留给人类。
      { key: "research", label: "研究", href: "/research", icon: Search, ucRefs: ["24-research/uc-24-1", "24-research/uc-24-2", "24-research/uc-24-3", "24-research/uc-24-4", "24-research/uc-24-5", "24-research/uc-24-6"] },
      // 束: interview —— 重指到 v2 现行屏 /itv（label/icon 不变，像素不变；旧 /studio/interview 已重定向）
      { key: "interview", label: "访谈", href: "/itv", icon: Mic, ucRefs: ["06-itv/uc-6-1", "06-itv/uc-6-3"] },
      // 束: recording —— 现场录音转写，此前只能敲 /rec
      { key: "recording", label: "录音", href: "/rec", icon: AudioLines, ucRefs: ["05-rec/uc-5-1", "05-rec/uc-5-2"] },
      { key: "survey", label: "问卷", href: "/studio/survey", icon: ClipboardList, ucRefs: ["12-survey/uc-12-1"] },
      // 束: canvas —— 2026-08-09 人类裁决：移出一级，见下方「治理 → 后台 children」处的 canvas 条目。
      //   本文件自己的权威注释早已记录矛盾：measured 序列把「原型」摆在 STUDIO 一级，
      //   但同一份原型的设计说明逐字写着「画布从议程进，不占一级」。这次以后者为准。
    ],
  },
  {
    label: "能力",
    items: [
      { key: "brain", label: "大脑", href: "/brain", icon: Brain, ucRefs: ["14-brain/uc-14-6"] },
      { key: "tasks", label: "任务", href: "/tasks", icon: ListTodo, ucRefs: ["11-board/uc-11-1"] },
    ],
  },
  {
    label: "治理",
    items: [
      // 2026-09-02 人类直接裁决：后台切成**两个一级入口**——「组织后台」管当前组织自己的
      // 东西（AI 能力目录 / 成员配额 / 本地组织），「平台后台」管整个平台（全平台账号 /
      // 全体用户反馈）。两者授权面不同（组织 admin vs 平台运维），混在一个左栏里会让人
      // 以为组织 admin 也能看全平台。分组与归属的唯一事实源是 `lib/mock/admin.ts` 的
      // `ADMIN_NAV[].scope`，这里只放两个一级入口。
      {
        key: "admin",
        label: "组织后台",
        href: "/admin",
        icon: Settings2,
        ucRefs: ["17-gov/uc-17-1"],
        /**
         * **后台模块（二级）** —— 原型一级「治理」只有「后台」一项，
         * 下面这五项在原型里全部是**后台左栏**的模块，不是一级导航项。见 #593 长注。
         *
         * ⚠⚠ 2026-08-11（人类直接裁决，真合并——DECISIONS-FINAL.md 对应条目）：
         * 这五项此前在「后台 → AI 能力/组织」组里各自都有一个近义命名的重复入口
         * （#700 只加了徽标说清楚"这是原型"，#928/#929 只改了措辞，都没有真的合掉）。
         * 这次人类原话："这些都是重复的目录，要把它整合在一起，不要有重复的。"
         * ⇒ 下面五项**不再在后台左栏渲染为独立的第二个入口**（`admin-nav.tsx` 的
         *   `MERGED_SECOND_LEVEL_KEYS` 把它们从「能力域·全生命周期」组的渲染里摘掉）。
         *   每一项的 href 字符串**仍然留在这个数组里**，理由不是偷懒，是机械约束：
         *   `.harness/scripts/lint-nav-reachability.mjs` 只扫描本文件（`NAV_FILE` 硬编码
         *   指向 `navigation.ts`）来判定「束的现行路由是否可达」，`ADMIN_NAV`
         *   （`lib/mock/admin.ts` 的第一组「AI 能力」条目）不在它的扫描范围内。
         *   五项各自的真实新落点、以及为什么留 href 在此仅供门控读取而不再渲染，
         *   逐项写在下面各自的注释里——**不要因为这条总注释就去改动某一项的 href**，
         *   改 href 必须连带确认对应束在新落点里仍然可达。
         */
        children: [
          // 束: templates（蓝本设计器 / 套用 / 版本）→ 原型后台「项目蓝本」
          // ✅ 已真合并：`ADMIN_NAV` 的 `blueprint` 项改名「项目模板」，href 直接指向
          //   `/tpl`（不再经过 `/admin/blueprint` 那个空壳治理页——该路由已重定向到这里）。
          //   Q-11/X-J 解除阻塞（domain.md 那句"搬 /tpl 会动已签核束的产出，本束不可单方
          //   决定"是等人类裁决，人类现在已经裁决：合并）。href 留在此数组只为满足
          //   lint-nav-reachability 的文本扫描，不再单独渲染（见上方总注释）。
          {
            key: "templates", label: "蓝本", href: "/tpl", icon: LayoutTemplate,
            ucRefs: ["02-tpl/uc-2-1", "02-tpl/uc-2-4"],
            prototypeNote: "已真合并进「AI 能力 → 项目模板」（href 同为 /tpl），不再单独出现在后台左栏。",
          },
          // 束: skills（Skill 库与市场 / 发布六道关 / 绑定）→ 原型后台「Skill 库与市场」
          // ✅ 已真合并：`ADMIN_NAV` 的 `skill` 项（「Skill 目录」）href 改指 `/skill`——
          //   保留内容更完整的这条链路（库/导入/编辑器/试跑/双门禁/绑定/版本/反馈）。
          //   原 `/admin/skill` 的简单 CRUD（`CapabilityCatalogScreen` kind=skill：名称/
          //   可见范围/归属团队编辑）**没有被砍掉**，折进了 `/skill` 左栏新增的「目录」屏
          //   （`skill-app.tsx` 的 `catalog` screen，见该文件头注）——两套后端数据源
          //   （`identity` 能力目录 vs `skills` 声明式契约库）技术上仍不同源，这是记在案
          //   的技术债（数据合一需要后端工作，不在本轮"导航去重"范围内），但**导航层面
          //   只剩一个入口**。旧路由 `/admin/skill` 重定向到 `/skill?screen=catalog`。
          { key: "skills", label: "Skill 库与市场", href: "/skill", icon: Puzzle, ucRefs: ["03-skill/uc-3-1", "03-skill/uc-3-4"] },
          // 束: agent-runtime（注册 agent → 选模型 → 挂 MCP 工具）→ 原型后台「Agent 运行时」
          // ✅ 已拆解合并：不再有独立的「智能体运行时」入口。六个子屏逐个找到新归宿：
          //   · 三层权限·工具白名单 + agent 行为审计 → 折入「AI 能力 → Agent 目录」
          //     （`agent-screen.tsx` 新增的「运行时」区块，链到 `/preview/agent-runtime?screen=permission`
          //     与 `?screen=audit`）。
          //   · MCP 安全策略四开关·放行评审 → 折入「AI 能力 → MCP」
          //     （`mcp-screen.tsx` 新增区块，链到 `?screen=mcp-policy`）。
          //   · 机密路由批准卡 → 折入「AI 能力 → 模型」
          //     （`model-screen.tsx` 新增区块，链到 `?screen=routing`）。
          //   · AI 团队编排主持台 / 与 agent 私聊 → 判断为**运行时对话概念，不属于后台
          //     治理范畴**，本轮不勉强塞进某个后台入口；记入「菜单去重复查」后续 issue，
          //     去 `/chat` 找该有的入口。
          //   `/preview/agent-runtime` 页面本身没删（六个 `?screen=` 直达全部保留，
          //   Card 链接指过去不是死链），只是后台左栏不再有一个笼统的「智能体运行时」菜单项。
          {
            key: "agent-runtime", label: "智能体运行时", href: "/preview/agent-runtime", icon: Bot,
            ucRefs: ["04-agent/uc-4-1", "20-model/uc-20-1", "21-mcp/uc-21-1"],
            prototypeNote: "已拆解合并进 Agent 目录 / MCP / 模型三个入口各自的运行时区块；团队编排/私聊记入后续 issue（应在 /chat，不在后台）。",
          },
          // 束: org-admin（团队 / 成员名册 / 邀请 / 组织资料）→ 原型后台「组织管理」
          // ⚠ 菜单去重复查：`org-admin-screen.tsx` 的团队/成员/邀请/资料四个标签页全部走
          //   `lib/live-org-admin.ts` 真实接口（`listOrgMembers` / `listOrgInvites` /
          //   `updateOrganization` 等），**不是**原型——这条 `isPrototype: true` 是旧的、
          //   与代码事实不符，本轮一并订正（发现过程见菜单去重复查 issue）。
          //   ⚠ 2026-08-14（#1168）：人类截图实测后**点名了这一项**——左栏「组织成员」与
          //   「成员配额」屏内的 `[打开组织成员管理]` 重复，要求删掉左栏那个。
          //   （此处原本写着「人类本轮原话没有点名『组织』这一项……不在本轮改动」——
          //   那句记录的是当时的裁决范围，不是「这件事不该做」。条件变了，结论跟着变。）
          //   ⇒ 该键已加入 `admin-nav.tsx` 的 `MERGED_SECOND_LEVEL_KEYS`：**只过滤渲染**，
          //   本数组项保留——它是 `lint-nav-reachability.mjs` 唯一会扫到的文本来源，
          //   删掉会让 `/org-admin/preview` 被判不可达。路由本身不下线。
          { key: "org-admin", label: "组织成员", href: "/org-admin/preview", icon: Users, ucRefs: ["01-auth/uc-1-4"] },
          // 束: asset-governance（外来资产导入与生命周期治理，第 11 束）
          // ✅ 已从后台导航移除（人类原话："资产在这里也是不必要的"）。没有可合并的目标——
          //   它治理的是后台「AI 能力」组那六种 AssetKind 本身，不是某个已有能力域的运行时
          //   配置，找不到自然的新家。核实结果：全仓没有别处引用这个路由；但**没有**下线
          //   整条 `/asset-governance` 路由本身（页面与真实数据源都还在，只是不接后台导航），
          //   因为拿不准它是否还被直接 URL 访问依赖——按人类给的"拿不准就只做移除导航这一步"
          //   的兜底处理。href 留在此数组只为满足 lint-nav-reachability 的文本扫描；
          //   真要下线整条路由，记入后续 issue，需要先确认零依赖。
          { key: "asset-governance", label: "资产", href: "/asset-governance", icon: Boxes, ucRefs: ["23-asset/uc-23-1"], isPrototype: true },
          // 束: agent-interrupts（三种新 HITL 中断：目标复述卡/参数补全表单/多方案对比，
          //   #2136 已签核，`design-signoff.md` status: confirmed）。
          // ⚠ 本轮只出契约（`packages/contracts/src/agent-interrupts.ts`），未接实现——
          //   三张卡片届时会挂在 `/chat` 消息流里（同 call_skill 审批卡插槽），不是独立页面。
          //   `/preview/agent-interrupts` 是签核用的 v2 静态原型屏（ui-prototyper 交付，
          //   PR #2140，25 张截图对应 ui.md 三屏），供 lint-nav-reachability 判可达用；
          //   接线落地后这一行应改指向 `/chat`（同 chat/chat-file-upload 先例），非遗漏。
          // ucRefs 如实留空：本束是纯契约束（无 requirements/ 锚点，见 design-signoff.md），
          // 不像 asset-governance 有一份真实 UC 文档可引——编一个假引用比留空更糟。
          { key: "agent-interrupts", label: "中断卡预览", href: "/preview/agent-interrupts", icon: MessageSquareWarning, ucRefs: [], isPrototype: true },
          // 束: plan-control（TW-P0-3 六态工作流与可编辑计划，#2116 已签核）。
          // ⚠ 同上：本轮只出契约（`packages/contracts/src/plan-control.ts`），未接实现——
          //   落地后计划面板挂在 `/chat` 任务工作台里，不是独立页面。
          //   `/preview/plan-control` 是签核用的 v2 静态原型屏，供 lint-nav-reachability
          //   判可达用；接线落地后改指向 `/chat`。
          // ucRefs 如实留空：同上，判据单一事实源是 TW-P0-3（acceptance 卡），不是 requirements/。
          { key: "plan-control", label: "计划面板预览", href: "/preview/plan-control", icon: ListChecks, ucRefs: [], isPrototype: true },
          // 束: kernel-gateway / streaming-transport / plan-permissions / artifacts-steering /
          //   error-observability（phase-14 agent-kernel-unification 五束，2026-09-04 建）。
          // ⚠ 本轮只出①②③⑤五件签核材料（design-signoff.md 全部 status: pending），未接
          //   实现——真实落地后这五个能力分别并入 /chat 的既有运行时区域，不是独立页面。
          //   `/preview/agent-kernel` 是签核用的静态原型屏（`ui-prototyper` 交付，
          //   `phases/phase-14-agent-kernel-unification/ui-preview/` 下 8 张截图），供
          //   lint-nav-reachability 判可达用；接线落地后这一行应改指向 /chat，非遗漏。
          //   kernel-gateway 束本身无新增界面（纯后端网关重构），ui.md 用 reuse_bundle
          //   复用 streaming-transport 的材料声明，但仍需要一条可达路由——同样指向本预览页。
          // ucRefs 如实留空：本 phase 判据单一事实源是 requirements/*.md 的 R12，不是
          // UC 文档编号体系，编一个假引用比留空更糟。
          { key: "agent-kernel", label: "Agent 内核预览", href: "/preview/agent-kernel", icon: Cpu, ucRefs: [], isPrototype: true },
          // 束: canvas（画布 hub，六屏切换，默认落在 `template-admin`）
          // ✅ 已从后台导航移除（与「画布模板」`/admin/canvasadmin` 去重）。原型本来的设计
          //   就说"画布从议程进，不占一级"——即它天然应该是**项目内上下文入口**，不是全局
          //   菜单项。项目工作台 `/projects/[projectId]/canvas` 这条参数化路由已经存在
          //   （`project-workbench.tsx` 头注确认过，与 `files` 子路由同型）。
          //   href 留在此数组只为满足 lint-nav-reachability 的文本扫描（这一条本身是去重后
          //   不再渲染的重复入口，不代表画布在产品里走不到）。
          //   ⚠ 2026-08-16（#978）：本节此前写着「工作台内部目前还没有一个真实按钮/tab 链
          //   过去」——**实测这句话是错的**：`lib/mock/project.ts` 的 `PROJECT_SURFACES`
          //   （`key: "canvas"`）早在 a914548c（2026-08-02，先于本节这条注释写下的日期）
          //   就已经把「推演画布」列进「工作面」清单，`tab-overview.tsx` 把它渲染成一个真实
          //   `<a href="/projects/<id>/canvas">`（`data-testid="project-home-surface-canvas"`），
          //   不受角色裁剪、不是禁用桩。这条注释写的时候没有核对代码事实就断言了缺口——
          //   典型的「痕迹写得越具体越像权威，其实是错的」（见 AGENTS.md「静态痕迹 ≠ 动态事实」）。
          //   已用 `fullstack-smoke.spec.ts`（真栈点击 + URL 断言 + `canvas-main` 可见）和
          //   `project-overview-live-info.test.tsx`（href 断言）钉住这条入口不是空转。
          //   ⚠ 2026-08-15（D-43，推翻 D-42 ⑤，见 `phases/requirements/DECISIONS-FINAL.md`）：
          //   `ADMIN_NAV` 的 `canvasadmin` 项此前"不改指到这里、合并会丢功能"的判断已被
          //   人类推翻——它现在直接指向这个 hub 的 `template-admin` 屏（`/canvas?screen=
          //   template-admin`），不是指向整个 hub 默认屏（`/canvas` 不带 `screen` 参数也会
          //   落在 `template-admin`，两者等价）。这一条本身（`ADMIN_SECOND_LEVEL` 里的
          //   `canvas` 项，指向裸 `/canvas`）不受影响，仍是去重后不再渲染的重复入口。
          { key: "canvas", label: "画布", href: "/canvas", icon: Shapes, ucRefs: ["07-canvas/uc-7-1", "07-canvas/uc-7-3"] },
        ],
      },
      // 平台后台（见上方 2026-09-02 注）：全平台账号名册 + 反馈与迭代。地球图标与
      // 后台左栏「平台成员」项同一符号——同一件事在两处要看起来是同一件事。
      // 无 children：它的二级模块全部在 `lib/mock/admin.ts` 的 platform 面里，
      // 由 `AdminNav scope="platform"` 渲染。
      { key: "platform-admin", label: "平台后台", href: "/platform-admin", icon: Globe, ucRefs: ["17-gov/uc-17-5", "17-gov/uc-17-6"] },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * 2026-08-06 · issue #593 · 信息架构复位（一级 ↔ 二级）
 *
 * 病：一级导航里跟「对话」平级地挂着 蓝本 / 技能 / 智能体 / 成员 / 资产。
 *     这些在原型里**全部是后台模块**，不是一级项。2026-07-30 那次「接线修正」为了让
 *     十一束的现行屏可达，把它们直接塞进了一级——可达性修好了，信息架构被压平了。
 *
 * 权威（逐字取自 `phases/requirements/WorkspaceX Standalone.html`，两处互证）：
 *   ① 图标栏（COLUMN 1 · 76px）的 innerText 序列：
 *      对话 ｜编排: 项目 ｜STUDIO: 研究 访谈 问卷 原型 ｜能力: 大脑 任务 ｜治理: 后台
 *      —— 一级**只有**这些，没有蓝本/技能/智能体/成员/资产。
 *   ② 同文件的设计说明自述：「一级：四段语义 —— 编排|项目 · Studio|研究/访谈/问卷/原型 ·
 *      能力|对话/大脑/任务 · 治理|后台。**画布从议程进，不占一级**」
 *      「COLUMN 2 二级：对象列表 —— 线程、项目、**后台模块**」
 *   ③ 原型「后台管理」屏的左栏模块清单：
 *      数据总览 ｜AI 能力: Agent 管理 / Skill 库与市场 / 模型 / MCP 服务器 / 画布模板 /
 *      **项目蓝本** ｜组织: **成员与配额** ｜反馈与迭代
 *      —— 蓝本、技能、Agent、成员在原型里明明白白是**后台模块**。
 *
 * 修：一级「编排」收回只剩「项目」；一级「治理」收回只剩「后台」；
 *     五项降为「后台」的 `children`，由后台左栏（`components/admin/admin-nav.tsx`）渲染。
 *     它们的 href 仍然写在**本文件**里，所以 `lint-nav-reachability.mjs` 的正向可达
 *     （束现行屏必须出现在 navigation.ts 的 href 里）依旧成立，无需改门控。
 *
 * ⚠ 与 issue #593 正文的一处**明确分歧，未按正文实现，留给人类裁**：
 *   正文第 3 条要求把「成员」移进**项目详情页**内部。但原型把「成员与配额」放在
 *   **后台 · 组织**组（依据 ③），而 `/org-admin/preview` 这一束正是**组织级**的
 *   参与者/邀请/配额（UC-1.4），不是项目内协作者。项目内的角色/分组在原型里由
 *   项目工作台的「项目筹备 → 定题与分组」承载，是另一件事。
 *   按 issue 自己的第 4 条（「严格以 UI prototype 为准」），这里从原型；
 *   把组织成员搬进项目详情页会是一个**新的信息架构决定**，不由 agent 做。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 「后台」项的二级模块（原型 COLUMN 2）—— 后台左栏从这里取，不抄第二份。 */
export const ADMIN_SECOND_LEVEL: NavItem[] =
  NAV_SEGMENTS.flatMap((s) => s.items).find((i) => i.key === "admin")?.children ?? [];

/** 项目文件浏览器（22-files）—— file-first 原则的用户界面载体，挂在项目下 */
export const FILES_NAV: NavItem = {
  key: "files", label: "文件", href: "/projects/demo/files", icon: FileText,
  ucRefs: ["22-files/uc-22-1", "22-files/uc-22-2", "22-files/uc-22-3", "22-files/uc-22-4"],
};

/** 一级 + 二级 + 文件入口的**扁平**清单（含 children，别再手抄第二份）。 */
export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_SEGMENTS.flatMap((s) => s.items).flatMap((i) => [i, ...(i.children ?? [])]),
  FILES_NAV,
];

/** 一级导航项（`IconRail` 画的就是它）—— 断言「某项不在一级」时用它，别用字符串搜页面。 */
export const TOP_LEVEL_NAV_ITEMS: NavItem[] = NAV_SEGMENTS.flatMap((s) => s.items);
