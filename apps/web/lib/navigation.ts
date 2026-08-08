import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare, FolderKanban, Search, Mic, ClipboardList, LayoutTemplate,
  Brain, ListTodo, Settings2, FileText, AudioLines, Shapes, Puzzle, Bot, Users, Boxes,
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
   * 「原型 · 待归并」标签，语气对齐 `NoBackendNotice`。不写 = 默认屏已接真实后端
   * （目前只有 `skills` 是这样），不要连坐打标签。
   */
  isPrototype?: boolean;
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
      { key: "research", label: "研究", href: "/research", icon: Search, ucRefs: ["24-research/uc-24-1", "24-research/uc-24-2", "24-research/uc-24-3", "24-research/uc-24-4", "24-research/uc-24-5"] },
      // 束: interview —— 重指到 v2 现行屏 /itv（label/icon 不变，像素不变；旧 /studio/interview 已重定向）
      { key: "interview", label: "访谈", href: "/itv", icon: Mic, ucRefs: ["06-itv/uc-6-1", "06-itv/uc-6-3"] },
      // 束: recording —— 现场录音转写，此前只能敲 /rec
      { key: "recording", label: "录音", href: "/rec", icon: AudioLines, ucRefs: ["05-rec/uc-5-1", "05-rec/uc-5-2"] },
      { key: "survey", label: "问卷", href: "/studio/survey", icon: ClipboardList, ucRefs: ["12-survey/uc-12-1"] },
      // 束: canvas —— 旧「原型」骨架屏（单栏 825px）退役，重指到三栏推演画布 /canvas
      { key: "canvas", label: "画布", href: "/canvas", icon: Shapes, ucRefs: ["07-canvas/uc-7-1", "07-canvas/uc-7-3"] },
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
      {
        key: "admin",
        label: "后台",
        href: "/admin",
        icon: Settings2,
        ucRefs: ["17-gov/uc-17-1"],
        /**
         * **后台模块（二级）** —— 原型一级「治理」只有「后台」一项，
         * 下面这五项在原型里全部是**后台左栏**的模块，不是一级导航项。见 #593 长注。
         */
        children: [
          // 束: templates（蓝本设计器 / 套用 / 版本）→ 原型后台「项目蓝本」
          { key: "templates", label: "蓝本", href: "/tpl", icon: LayoutTemplate, ucRefs: ["02-tpl/uc-2-1", "02-tpl/uc-2-4"], isPrototype: true },
          // 束: skills（Skill 库与市场 / 发布六道关 / 绑定）→ 原型后台「Skill 库与市场」
          // ⚠ 唯一默认屏已接真实后端的一项——不带 isPrototype，不与其余四项连坐。
          { key: "skills", label: "技能", href: "/skill", icon: Puzzle, ucRefs: ["03-skill/uc-3-1", "03-skill/uc-3-4"] },
          // 束: agent-runtime（注册 agent → 选模型 → 挂 MCP 工具）→ 原型后台「Agent 管理」
          { key: "agent-runtime", label: "智能体", href: "/preview/agent-runtime", icon: Bot, ucRefs: ["04-agent/uc-4-1", "20-model/uc-20-1", "21-mcp/uc-21-1"], isPrototype: true },
          // 束: org-admin（参与者 / 邀请 / 配额）→ 原型后台「组织 · 成员与配额」
          { key: "org-admin", label: "成员", href: "/org-admin/preview", icon: Users, ucRefs: ["01-auth/uc-1-4"], isPrototype: true },
          // 束: asset-governance（外来资产导入与生命周期治理，第 11 束）
          // ⚠ 原型左栏与后台左栏**都没有**这一项（它是原型之后立的第 11 束）。
          //   放这里的依据是**排除法**：原型一级「治理」只有「后台」，所以它不能是一级项；
          //   它治理的正是后台「AI 能力」组那六种 AssetKind。若人类另有归属，改这一行即可。
          { key: "asset-governance", label: "资产", href: "/asset-governance", icon: Boxes, ucRefs: ["23-asset/uc-23-1"], isPrototype: true },
        ],
      },
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
