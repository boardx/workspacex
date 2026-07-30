# `project` 束 · 第 ① 件（UI）签核材料 —— v2

> **截图索引自检**：本文件引用 **92** 张截图，目录 `phases/phase-01-run-a-project/ui-preview/project-v2/`
> 下实际 **92** 张 png —— **N == M == 92，逐张核对全部存在，无漏引、无死链、索引内无重复列**。
> 机械复核：`node .harness/scripts/lint-ui-material.mjs phase-01-run-a-project`（束↔目录映射见 `ui-material-map.json`：`project → ui-preview/project-v2`）。
> ⚠ v1（`ui-preview/project/` 19 张）已被推翻——只有概览拿到七态、无四视角对照、且有一处「默认值反了」的保真度错误。
> 推翻留痕：旧目录不删，推翻理由见 `ui-preview/project-v2/V1-WAS-WRONG.md`。

> **材料位置**：`phases/phase-01-run-a-project/ui-preview/project-v2/` —— **92 张真实截图**
> + `README.md`（五节：截图清单 / 处置与设计决定 / 无法自洽点 / 两版并存裁决 / 待确认清单）
> + `V1-WAS-WRONG.md`（推翻 v1 的四条理由 + JS 数据区核默认值的发现）。
>
> ⚠ **本束现在能否签核**见 [`design-signoff.md`](./design-signoff.md) 顶部；材料齐 ≠ 可签。
> 本文件只做两件事：① 把 92 张截图登记进签核范围；② 把待裁决点提取成第 ① 件的待确认清单（第五节）。

---

## 〇、这一版补了什么（相对 v1 的 19 张）

1. **project 域是两层界面**（人类 2026-07-30）：**项目列表页**（增/删/改/查，主入口）+ **项目空间**（tabs）。
2. **六个标签页各补齐七态** + **四视角对照**（facilitator / groupLead / member / observer），
   **观察者看到的显著更少**——被限内容**消失**（换成 `*-observer-notice`），不是变灰。
3. **三屏缺屏补齐**：新建项目向导 / 全部项目列表 / 组织停用只读。
4. **两处裁决落地**：① 「项目」=工作坊；② 处置了宣称已被否决模型（Q-12 候选 E）的「挂到哪个项目」字段；
   ③ 议程环节 testid `agenda-item-*` → `agenda-segment-*`（Q-3① 改名对齐 D-03a）。
5. **修好一处保真度错误**：设置「客户可见的分享链接」默认**关**（v1 误画成开），对着原型 JS 数据区核过。

---

## 一、92 张截图（文件名已核实，非编造）

截图用 `apps/web` 真实组件跑 `next dev` 抓取（视口 1360×1000、deviceScaleFactor 2、fullPage），**不是设计稿**；
每屏可点、可切标签 / 视角 / 七态 / 组织停用；抓图脚本 `apps/web/scripts/shot-project-v2.mjs`。

### A. 项目列表页 `/projects`（**主入口** · 增删改查）—— 9 张

`uc-00-2-allprojects-default.png` · `uc-00-2-allprojects-loading.png` · `uc-00-2-allprojects-empty.png` ·
`uc-00-2-allprojects-invalid.png` · `uc-00-2-allprojects-dep-failed.png` · `uc-00-2-allprojects-denied.png` ·
`uc-00-2-allprojects-success.png` · `uc-00-2-allprojects-more-menu.png`（⋯菜单：编辑/看大屏/复制邀请/归档，**无删除**）·
`uc-00-2-allprojects-archived.png`（已归档筛选 = 空态；归档是 status 不是 tag，见 U-2）

### B. 新建项目向导 `/project/new`（C-2 缺屏）—— 8 张

`uc-2-2-newproject-default.png`（选蓝本九宫格 + 从空白/复制一场 + 主题与时长）· `uc-2-2-newproject-loading.png` ·
`uc-2-2-newproject-empty.png` · `uc-2-2-newproject-invalid.png` · `uc-2-2-newproject-dep-failed.png` ·
`uc-2-2-newproject-denied.png` · `uc-2-2-newproject-success.png` · `uc-2-2-newproject-scratch.png`（选中「从空白开始」）
> ⚠ 步骤 2 的「关联研究来源」字段就是处置后的「挂到哪个项目」——见第三、四节。

### C. 项目空间 · Layout B 工作台 `/project`（阶段式 tab，原型 wsDetailView 权威布局）—— 70 张

每个 tab：**七态**（facilitator 视角）`-default -loading -empty -invalid -dep-failed -denied -success`
＋**另三视角**（default 态）`-groupLead -member -observer`，共 10 张 × 7 tab。

| tab | 十张（前缀相同，后缀如上） |
|---|---|
| 概览 | `uc-00-2-overview-default.png` `uc-00-2-overview-loading.png` `uc-00-2-overview-empty.png` `uc-00-2-overview-invalid.png` `uc-00-2-overview-dep-failed.png` `uc-00-2-overview-denied.png` `uc-00-2-overview-success.png` `uc-00-2-overview-groupLead.png` `uc-00-2-overview-member.png` `uc-00-2-overview-observer.png` |
| 研究洞察 | `uc-00-2-research-default.png` `uc-00-2-research-loading.png` `uc-00-2-research-empty.png` `uc-00-2-research-invalid.png` `uc-00-2-research-dep-failed.png` `uc-00-2-research-denied.png` `uc-00-2-research-success.png` `uc-00-2-research-groupLead.png` `uc-00-2-research-member.png` `uc-00-2-research-observer.png` |
| 项目筹备 | `uc-2-2-prep-default.png` `uc-2-2-prep-loading.png` `uc-2-2-prep-empty.png` `uc-2-2-prep-invalid.png` `uc-2-2-prep-dep-failed.png` `uc-2-2-prep-denied.png` `uc-2-2-prep-success.png` `uc-2-2-prep-groupLead.png` `uc-2-2-prep-member.png` `uc-2-2-prep-observer.png` |
| 现场协作 | `uc-5-1-live-default.png` `uc-5-1-live-loading.png` `uc-5-1-live-empty.png` `uc-5-1-live-invalid.png` `uc-5-1-live-dep-failed.png` `uc-5-1-live-denied.png` `uc-5-1-live-success.png` `uc-5-1-live-groupLead.png` `uc-5-1-live-member.png` `uc-5-1-live-observer.png` |
| 成果沉淀 | `uc-00-3-results-default.png` `uc-00-3-results-loading.png` `uc-00-3-results-empty.png` `uc-00-3-results-invalid.png` `uc-00-3-results-dep-failed.png` `uc-00-3-results-denied.png` `uc-00-3-results-success.png` `uc-00-3-results-groupLead.png` `uc-00-3-results-member.png` `uc-00-3-results-observer.png` |
| 待办 | `uc-11-1-todo-default.png` `uc-11-1-todo-loading.png` `uc-11-1-todo-empty.png` `uc-11-1-todo-invalid.png` `uc-11-1-todo-dep-failed.png` `uc-11-1-todo-denied.png` `uc-11-1-todo-success.png` `uc-11-1-todo-groupLead.png` `uc-11-1-todo-member.png` `uc-11-1-todo-observer.png` |
| 设置 | `uc-2-2-settings-default.png` `uc-2-2-settings-loading.png` `uc-2-2-settings-empty.png` `uc-2-2-settings-invalid.png` `uc-2-2-settings-dep-failed.png` `uc-2-2-settings-denied.png` `uc-2-2-settings-success.png` `uc-2-2-settings-groupLead.png` `uc-2-2-settings-member.png` `uc-2-2-settings-observer.png` |

### D. 组织停用只读 `/project?orgState=disabled`（C-3 缺屏 · uc-00-1 V12）—— 3 张

`uc-00-1-orgdisabled-overview.png`（顶部只读原因条 + 内容保留 + CTA 消失）·
`uc-00-1-orgdisabled-results.png`（发布区因只读消失）· `uc-00-1-orgdisabled-observer.png`（停用×观察者叠加）

### E. 项目空间 · Layout A 项目主页 `/projects/[projectId]`（**两版并存·待人类裁决**）—— 2 张

`uc-00-2-projecthome-default.png`（「工作面」清单：对话/推演画布/项目文件/访谈现场/问卷与投票/任务/现场大屏(未建)）·
`uc-00-2-projecthome-observer.png`
> ⚠ Layout A 的「工作面」措辞在**静态原型里查无实据**，见第四节。列它是为让人类**当场比对两版**。

**合计 9 + 8 + 70 + 3 + 2 = 92 张。**

### testid（供 requirement-author 锚定）
`project-*` · `project-tab-*` · `project-role-*` · `agenda-segment-*`（**已从 `agenda-item-*` 改名**）·
`project-todo-card-*` · `project-results-sign-*` · `project-*-observer-notice`（观察者裁剪条）·
`project-org-disabled-banner` · `project-new-*`（新建向导）· `project-new-linked-source*`（处置后的关联字段）·
`projects-*` / `projects-card-*-more` / `projects-more-*`（列表增删改查）；七态保留名由共享 `StateShell` 承担。

---

## 二、签核时**重点核对的 3 处**

1. **四视角是不是真的改变了界面**（不是换文案）——对比
   `uc-5-1-live-default.png`（引导师四组原始引述全见 + 全场控制）vs `uc-5-1-live-member.png`
   （只有本组 g2 有引述与「提交本组产出」，别组「仅显示进度聚合」，无全场控制）vs `uc-5-1-live-observer.png`（全脱敏）；
   再看 `uc-11-1-todo-observer.png` / `uc-2-2-settings-observer.png` / `uc-2-2-prep-observer.png`：
   观察者的内部协作视图应**整块消失**（`*-observer-notice`），而非变灰。
2. **处置后的「关联研究来源」字段**（`uc-2-2-newproject-default.png` 步骤 2 的紫色 callout）——
   确认「跨容器只读引用、**不是**父子层级（Q-12 裁 C+D、E 未采纳）」这套话术是否是你要的形状。
3. **两版并存的裁决**（`uc-00-2-projecthome-default.png` Layout A vs C 组全部 Layout B）——
   见第四节：静态原型证据指向 Layout B，人类 devapp 截图是 Layout A。**这需要你拍板**。

---

## 三、原型作者替 UC 做的 `[设计]` 决定（逐条在 `ui-preview/project-v2/README.md` 第二节）

概览/研究/筹备/待办/设置的**观察者裁剪粒度**（各减了什么）· 现场协作的**组长/组员本组 vs 别组**边界 ·
发布结论的二次确认与影响范围文案 · 候选决策签署的可签/不可签二态 ·
「关联研究来源」对被否决字段的**处置方式** · 组织停用只读条的文案 · 新建向导的九宫格与两个非蓝本入口。

---

## 四、**无法自洽 / 两版并存 —— 必须先裁才能签 ①**（详见 `README.md` 三、四节）

- **A-0 🔴 两层界面的第二层用哪套布局**：Layout A（工作面清单，`/projects/[projectId]`）
  与 Layout B（阶段 tab，`/project`）分法完全不同。**静态原型证据**（byte offset，见 README 第四节）：
  项目列表「进入项目」→ `openWs`（byte 15169552 区）→ wsDetailView = **阶段 tab**（isWsOver@15221492 …
  isWsTodo@15530664）；Layout A 的「推演画布/访谈现场/问卷与投票」在原型里 **0 命中** ⇒ Layout B 为原型权威，
  Layout A 是 devapp 直播版 / 前一 agent 的补屏。→ 未自裁，两版都画、标「待人类裁决」。
- **A-1 🔴 「挂到哪个项目」宣称已被否决的模型**：Q-12 裁 C+D、E（父子）未采纳；已处置为「关联研究来源」跨容器引用（第二节 2）。
- **A-2 🟠 `/project` 要不要纳入 `project-context`**：全局顶栏显示「不在项目上下文中」，工作台第二级头又满是项目身份——两处相反。
- **B-1 🟠 观察者能否下载已发布产出**（原型空白）· **B-2 候选决策签署授权矩阵不全** · **B-8 准备度%口径**（概览改用「就绪检查 3/3」）。
- **U-2 归档是 status 还是 tag**：本实现按 status 做（筛选 chip，无卡片 tag）；devapp 截图把「已归档」当卡片 tag，与 U-2 可能冲突，见 README。

---

## 五、待确认清单（人类动作，agent 不改 status）

1. **[待确认] 项目空间的权威布局**（A-0，最高优先，阻塞后续所有 project feature 的形状）。
2. **[待确认] 「关联研究来源」的最终形态**（A-1；确认它替代被否决的父子字段）。
3. **[待确认] 研究项目 / 用户洞察两类容器的界面归属**——本束判为**归 `interview`/`research` 束**（工作坊只四角色；
   两类容器 U-1 只两档拥有者+协作者；证据 `apps/web/lib/mock/itv.ts:95`「访谈属用户洞察、与工作坊平级」）。见 README 第四节。
4. **[待确认] `/project` 纳不纳入 project-context**（A-2）· **观察者能否下载**（B-1）· **签署授权矩阵**（B-2）· **准备度口径**（B-8）· **项目归档语义**（Q-5）。
5. **[已裁决落地] 议程环节字段名 `agenda_segment`**（Q-3①）——testid 已由 `agenda-item-*` 改为 `agenda-segment-*`。
