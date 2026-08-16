---
bundle: project
phase: "01"
# ⚠ 2026-07-30：feature 已生成，`covers:` 不再是空列表。
#   原估 8–10 个 / 32–40 点，实测 **13 个 / 56 点**——正文顶部已注明「三类子表已定，估点可能偏低」，
#   偏低的来源是可归因的：U-9 A 的判别列 + 三张 1:1 子类型表（F116 单件就 6 点）、
#   U-1 B 的两张新成员表 + U-7 A 的两张既有表加列回填（F128 5 点）、
#   以及 Q-3 ① 的改名对齐要回头改 phase-00 已合入 main 的代码（F121 3 点）。
#   这三件在写「8–10 个」那天都还没裁。
# ⚠ 2026-08-12（PJ-01 / issue #976）：追加 **F158**，由 agent `dev-project` 追加，**待 coord-main 复核**。
#   追加的理由，以及为什么这不等于替人类签一次新的核：
#     · F158 **不引入任何新的设计面**。它做的是把**本束已签核的那一屏**（新建项目向导，
#       第 ① 件材料 `ui-preview/project-v2/` 里的 `uc-2-2-newproject-*`）接到**本束已签核的
#       那一条契约**（`createProject`，第 ③ 件，F117 已 passing）上。UI 没有新增，
#       契约没有新增，失败面沿用 `ProjectReason` 既有的码。
#     · 它没有绕开任何一件的评审：三件在 2026-07-30 都由人类签过，F158 落在它们的交集里。
#   ⚠ 本行**只动 `covers:`**，`status` / `confirmed_by` / `confirmed_at` 一字未改——
#     那三个字段是人的动作，agent 不许动（ADR-023）。
#   ⚠ 若 coord-main 或人类认为「已签核束追加 feature 编号」这件事本身需要人类再签一次，
#     把 F158 从本行删掉即可，代码与测试不受影响（它们不依赖这一行）。
# ⚠ 2026-08-12（PJ-03 / F164）：追加 **F164**，由 agent `dev-project` 追加，**待 coord-main 复核**。
#   理由与 F158 同构——它**不引入任何新的设计面**：
#     · UI 早已在第 ① 件材料里签过：`ui-preview/project-v2/uc-00-2-allprojects-more-menu.png`
#       （⋯ 菜单四项）与 `uc-00-2-allprojects-archived.png`（已归档态）；`contracts/project/ui.md`
#       第 39 行逐字写明菜单内容「编辑/看大屏/复制邀请/归档，无删除」，第 81 行给出
#       `projects-card-*-more` / `projects-more-*` 这组 testid，第 40/117 行写明「归档是 status 不是 tag」。
#     · 契约早已在第 ③ 件里签过：`archiveProject` / `unarchiveProject`，其后端 F124 已 passing 并在本 covers 里。
#     · 失败面沿用既有码（ORG_ROLE_INSUFFICIENT / PROJECT_ARCHIVED / AUTH_SERVICE_UNAVAILABLE），
#       **没有新增任何错误码**——U-2⑵ 那条无码的裸 400（KNOWN_CONTRACT_GAPS.P7）本版按
#       coord-main 2026-08-12 裁决 (a) 显示通用失败文案、不编原因，缺口另记 issue #999，
#       将来补码要走 delta 重签，不在本次追加的范围内。
#   ⚠ 本行**只动 `covers:`**，`status` / `confirmed_by` / `confirmed_at` 一字未改——
#     那三个字段是人的动作，agent 不许动（ADR-023）。
#   ⚠ 若 coord-main 或人类认为「已签核束追加 feature 编号」本身需要人类再签一次，
#     把 F164 从本行删掉即可，代码与测试不受影响（它们不依赖这一行）。
# ⚠ 2026-08-12（PJ-04 / F172）：追加 **F172**，由 agent `dev-project` 追加，**coord-main 已批**
#   （第三次追加；coord-main 要求「第三次前先问」，已问已批。人类定规前不再有第四次自行追加）。
#   本次与前两次的差别：**它是减法**。F172 不接任何新数据、不加任何端点——
#   它删掉的是概览 tab 上**没有契约出处的编造展示**（假倒计时 / 假环节标题 / 编造的角色分工
#   与待办动态），并把有出处的两项接到 `getProjectOverview`。
#   三条件依旧满足：
#     · UI 已签：`ui-preview/project-v2/` 的概览屏；
#     · 契约已签：`getProjectOverview`（F123 已 passing 且在本 covers 里），白名单四件封闭；
#     · **零新增面**：没有新端点、没有新错误码、没有新字段——净行数为负。
#   ⚠ 本行**只动 `covers:`**，`status` / `confirmed_by` / `confirmed_at` 一字未改（ADR-023）。
# ⚠ 2026-08-16：追加 **F185**，由 agent `dev-project` 追加。**与上面几次追加性质不同，
#   如实标注，不套用「不引入新设计面」那套理由**：
#   · F185 **确实推翻了一处已签设计**——`listProjects` 两段式返回（Q-6① 原裁 B）
#     改为扁平数组 + `tags` 字段（Q-6① 新裁 D）。这不是「已签核范围内的接线」。
#   · 授权来源：人类（`confirmed_by` 同一位 yanbin shen）在本会话里直接下达指令
#     「不要保留分组」「你来做」——裁决记录见 `requirements/00-project/OPEN-QUESTIONS.md`
#     「🔁 2026-08-16 delta：Q-6① 推翻重裁」一节，签名与本文件 frontmatter 的
#     `confirmed_by` 同名同人，只是没有走表单打勾那套流程（对话记录即留痕）。
#   · `contracts/project/ui.md` A 节 9 张截图因此**过期**，本次不重拍（见 ui.md 同日 delta 提示）；
#     不影响本行追加，因为本行只声明「F185 落在 project 束范围内」，不重新断言那 9 张图仍然有效。
#   ⚠ 本行**只动 `covers:`**，`status` / `confirmed_by` / `confirmed_at` 一字未改（ADR-023 纪律不变，
#     即便这次是 delta 也不通过改这三个字段来表达——它们记的是 2026-07-30 那次原始签核事实）。
#   ⚠ 若 coord-main 认为「delta 需要人类走一次正式的重签表单」而不是对话记录留痕即可，
#     把 F185 从本行删掉，代码与测试不受影响。
covers: [F116, F117, F118, F119, F120, F121, F122, F123, F124, F125, F126, F127, F128, F158, F164, F172, F185]
status: confirmed          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: "yanbin shen"
confirmed_at: "2026-07-30T16:50:06+08:00"
---


# 契约束 `project` 设计签核（第 10 个束）

> ## 🔴 本束**现在仍不可签核**。请不要把 `status` 改成 `confirmed`。
>
> **✅ 2026-07-31 更正**：以下 🔴 块描述的是 `status` 签核当时（2026-07-30T16:50:06+08:00）
> 的状态，**本文正文一字未改**，留痕原文。逐条对账见
> `phases/phase-01-run-a-project/SIGNOFF-RECONCILIATION-2026-07-31.md`：
> 下述两条阻塞——① feature 未生成 ② 第 ① 件材料不完整——**均已解除**
> （`covers:` 现有 13 个编号；`ui-preview/project-v2/` 现有 92 张，`lint-ui-material` 双向集合相等绿）。
> 签核继续有效（frontmatter 的 `status: confirmed` 不变）。
> —— yanbin shen，经会话记录，2026-07-31T14:56:11+08:00
>
> **✅ 2026-07-30：12 条裁决已全部完成**（`requirements/00-project/OPEN-QUESTIONS.md`，
> 逐条勾选 + 署名 `yanbin shen` + ISO 时间戳）。**它们不再是阻塞项。**
> `domain.md` / `usecases.md` / `coverage.md` 已按裁决重写，
> 另出一份 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md) 登记「裁决会回头改哪些已合入 `main` 的东西」。
>
> ### 现在阻塞的是另外**两条**（互相独立，解决其一不能签）
>
> **① `feature` 尚未生成。**
> `phases/phase-01-run-a-project/feature_list.json` 里仍**没有任何属于本域的 feature**，
> 因此 frontmatter 的 `covers:` 仍是 `[]`。
> 裁决完成后的下一步是 **requirement-author** 据裁决生成 feature——**这一步还没做**。
>
> **② 第 ① 件材料（UI）不完整：六个标签页缺七态与四视角。**
> 19 张截图里 **10 张是「概览」一个标签页**；其余六个标签页各 1–2 张，
> **没有七态、没有四视角对照**。而本束第 ① 件最要紧的性质恰恰是
> 「**四视角是否真的改变界面**」。另有三屏完全未画（新建流程 / 全部项目 / 组织停用只读）。
> 逐条见 [`ui.md`](./ui.md) 第四节 C 类。
>
> ⇒ **即便 feature 生成完了，第 ① 件也不具备完整签核条件。** 两条必须都解决。
>
> **`covers: []` 会让 `pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 01` 报红**，
> 报错逐字为「声明了 `covers: []`（空）—— 一个不覆盖任何 feature 的束不成立，**因此它不可签核**」。
> **这条红是本束的正确状态**，不是待修的故障。
>
> ### 为什么宁可红，不肯不建这个束
>
> 不建束 = 本域的设计**不在任何签核范围内**，将来它的 feature 生成出来时会落进
> 「不属于任何契约束」，`assertDesignSignedOff` 直接拒绝——那时才发现要补束，
> 而那时 UI 与 API 形状已经被别人顺手创造出来了（ADR-020 的立论）。
> 建束 + 报红 = **缺口是可见的、有名字的、会在每次 `doctor` 里出现的**。
>
> ### 解除这条红的路径（顺序不可颠倒）
>
> 1. ~~人类裁决 12 条~~ **✅ 2026-07-30 完成**。
> 2. **requirement-author** 读 `00-project/uc-00-1/2/3` + 裁决结果 → 生成本域 feature
>    并写进 `feature_list.json`（它是唯一有权改清单的角色）。
> 3. 有人把生成出来的 feature 编号填进本文件 frontmatter 的 `covers:`。
> 4. **ui-prototyper 补齐六个标签页的七态 + 四视角 + 三屏缺屏**（`ui.md` 第四节 C 类）。
> 5. **然后**人类才逐节核对下面三件并签核。
>
> ⚠ **不要为了消红而随手填一个 feature 编号。** 那是把「还没有 feature」谎报成
> 「已经评审过这些 feature」，比现在这条红糟得多。
>
> ### ⚠ 裁决落地时浮出来的**九条新待裁**（U-1…U-9）
>
> 12 条答完不等于全定了。落到不变量上时又浮出九条，逐条在
> [`domain.md`](./domain.md) 第八节。其中三条是**本束新提出的**（U-7 / U-8 / U-9），
> **按纪律应回流进 `OPEN-QUESTIONS.md`——那是人类或 requirement-author 的动作，
> 本束的材料无权改那份文件。**

覆盖 feature：**（无 —— 待生成，估 8–10 个 / 32–40 点；⚠ 三类容器已定为三张子类型表，估点可能偏低）**
依据 UC：`00-project/uc-00-1 项目与议程环节的领域模型` · `uc-00-2 项目列表与项目主页` ·
`uc-00-3 项目成员与两层角色交互`
支撑考证：`requirements/00-project/DERIVED-FROM-CONTRACTS.md`（已签核契约定死了什么，**权威在那份文件**）
裁决清单：`requirements/00-project/OPEN-QUESTIONS.md`（12 条，**2026-07-30 已全部裁决**，**裁决原文是权威**）
迁移影响：本束 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md)（裁决会回头改哪些已合入 `main` 的东西）
UI 材料：`ui-preview/project/`（19 张截图）+ `ui-preview/project/PROTOTYPE-ANSWERS.md`；
访谈侧的推翻留痕见 `ui-preview/itv-v2/V1-WAS-WRONG.md`（错误 5 与本束的角色裁决同源）

## 这个束为什么现在才出现

九束的切分是在 `project` 域**被发现缺失之前**定的。缺失本身是这样发现的：

阶段名叫「能跑完一场项目」，而 `requirements/` 下 11 个模块 49 份 UC 里
**没有任何一份以「项目本身」为主题**；与此同时 phase-00 内核已经落地了一批项目形状的东西
（`projects` 表已存在、项目角色已是闭集、Artifact 已能绑到「项目环节」上、
`/projects/:projectId/backflow` 是真实路由）。
即：**内核已经把产出绑到「项目环节」上，而系统里没有任何东西定义
「环节是什么、项目怎么创建、谁在里面、它怎么结束」。**

⇒ 本束的存在理由不是「再切一块能力」，是**把一个已经在被引用、但从未被定义的实体收进签核范围**。

## 这个束为什么这样切

按**能力域**切，边界是「**项目实体与议程环节实体本身**」，而不是「项目里发生的事」：

- **在本束内**：项目的创建与身份（Q-1 / Q-12）、议程环节实体与状态机（Q-2 / Q-3 / Q-8）、
  项目成员名单的形成与两层角色交叉（Q-4）、项目生命周期（Q-5 / Q-9）、
  项目列表与项目主页的读取面（Q-6 / Q-10 / Q-11 / Q-7）。
- **不在本束内**：项目里各能力域自己的事——套蓝本的六类初始化在 `templates`、
  现场转录在 `recording`、分组画布在 `canvas`、访谈在 `interview`……
  本束只提供它们共同依赖的**挂载点**。

⚠ **这是一个「被六个束依赖、自己却是空的」束。** 六个束已经把议程环节当既有挂载点用：
`agent-runtime`（载入触发源）、`canvas`（白名单）、`files`（N-4 有 information_schema 断言）、
`templates`、`skills`、`interview`。它们的 feature（F05 F16 F19 F26 F27 F31 F63 F64 F81 F102）
已经在环节上排工，而**环节实体本身没有任何 feature**。
⇒ **本束不签，那六个束的挂载点就是悬空的**；本束一签，它们才有地基。
这也是本束应当**优先**被解锁的原因。

---

## ① UI —— 人看到的界面对不对

材料：本束 [`ui.md`](./ui.md) → `ui-preview/project/` 的 **19 张真实截图**
（`next dev`、视口 1360×900、deviceScaleFactor 2 抓的真实组件，不是设计稿；抓图时 0 条控制台报错）。

**⚠ 第 ① 件的材料是十个域里偏薄的一档，且分布严重偏斜。签核前请先看这张表。**

（原文此处写的是「本域是九个域里 UI 材料**最完整**的之一」。**核实为假**，2026-07-29 更正——
一句夸大的完备性声明出现在签核文档里，性质比措辞不准严重得多：它正是会让人**不看截图就签字**的那种话。）

| 域 | 截图 | | 域 | 截图 |
|---|---:|---|---|---:|
| `skill` | 59 | | `rec` | 32 |
| `org-admin` | 48 | | `tpl` | 24 |
| `agent-runtime` | 48 | | **`project`** | **19** |
| `itv` | 44 | | `chat` | 18 |
| `canvas` | 40 | | `files` | 15 |

`project` 排第八/十。且 **19 张里有 10 张是「概览」一个标签页**：

```
概览 10 · 现场协作 2 · 成果沉淀 2 · 待办 2 · 研究洞察 1 · 项目筹备 1 · 设置 1
```

⇒ **只有「概览」拿到了七态；其余六个标签页各 1–2 张，没有七态、没有四视角对照。**
而本束第 ① 件最要紧的性质恰恰是「**四视角是否真的改变界面**」（UC-1.4 与 phase-00 一致性复核 X-1
的可见面），它现在**只在概览与两个标签上各有一张 observer 图可比**。

⇒ 第 ① 件在补齐**六个标签页的七态 + 四视角**之前**不具备完整签核条件**，
即便 feature 生成完了也一样。这条与顶部醒目块（无 feature 可覆盖）是**两个独立的阻塞**，
不要以为解决了其中一个就能签。

第 ① 件的待确认项**全部**来自 `ui-preview/project/PROTOTYPE-ANSWERS.md` 与
`ui-preview/project/README.md` 第三、五节自报的「原型未覆盖 / 无法自洽」，逐条列在
[`ui.md`](./ui.md) 第四节。**签核时请以 `ui.md` 第四节为清单**，不要在这里再抄一遍
（同一事实两处声明是本仓头号失败模式）。

### 签核前请重点确认（**按 12 条裁决重写**）

- [x] ~~**Q-12 的第五种形状**（项目挂父项目）~~ —— **已裁决，且裁的是别的**：
      Q-12 取 **C，且是三类独立实体**（工作坊 / 研究项目 / 用户洞察），
      落地形状取 **D（`projects` 降为容器超类型 + 三张 1:1 子类型表）**。
      **候选 E（父子项目）未被采纳** ⇒ 原型那句「挂到哪个项目（决定能读哪些洞察与图谱）」
      **不是数据模型**。⚠ **但 UI 里那个字段仍然画着**——
      **签核 ① 件时必须确认它在界面上的处置**（删除？改成「所属研究项目」？保留为遗留？），
      否则界面会继续宣称一个已被否决的模型。
- [ ] 🔴 **本域 UI 现在是「工作坊」的 UI，而不是「项目」的 UI。**
      裁决把「项目」收窄为工作坊（模板 + 会前/现场/会后三段 AI 增强）。
      ⇒ 19 张截图里的议程环节、四组分工、现场协作、四视角**全部只适用于工作坊**。
      **研究项目与用户洞察这两类容器，本域一张截图都没有。**
      签 ① 件时请明确：这两类的界面是**本束的第 ① 件材料缺口**，还是**由别的束（`itv` 等）承担**。
- [ ] 🔴 **访谈的四视角必须撤掉。** 人类原话逐字「在访谈里是没有这几种角色的，
      引导师、组长什么的是不必要的」。⚠ 本域 `ui.md` 第二节仍把「四视角是不是真的改变界面」
      列为重点核对项——**那条在工作坊内成立，在访谈上不成立**。
      推翻留痕见 `ui-preview/itv-v2/V1-WAS-WRONG.md` 错误 5。
- [ ] **`/project` 要不要纳入 `project-context`**：全局顶栏说「不在项目上下文中 · 项目角色不适用」，
      而工作台顶头又显示满满的项目身份——**两处对「我在不在项目里」给了相反答案**。
      ⚠ **12 条裁决没有覆盖这一条**（`ui.md` A-2），**它仍是 ① 件的阻塞项**。
- [ ] **议程环节 testid 是否随字段名改名**：UI 显示中文、testid 用中性名 `agenda-item-*`；
      字段名已由 D-03a 定为 `agenda_segment`，且 **Q-3 ① 裁「改名对齐」** ⇒
      此处只需确认「testid 是否一并改成 `agenda-segment-*`」。
- [ ] **六个标签页的七态与四视角** —— 见本节上方的表与顶部醒目块 ②。**这是 ① 件的硬门槛。**

---

## ② 用例 —— 用例接口与失败模式穷举对不对

材料：本束 [`usecases.md`](./usecases.md)（**2026-07-30 已从骨架填成可评审的用例**）。
支撑：本束 [`domain.md`](./domain.md)（不变量，每条都指回 `DERIVED-FROM-CONTRACTS.md` 的 D-N 或某条裁决）。

✅ **用例的输入形状现在有了**：`createProject` 的入参已由 **Q-1 C**（一条创建路径 +
`blueprintVersionId?`）与 **Q-12 C/D**（`kind` 三值）定死；**没有** `parentProjectId`
（候选 E 未被采纳）；`advanceAgendaSegment` 操作的是**一张真表**（Q-2① A）。

⚠ 仍未定稿的是**九条新待裁**（U-1…U-9）对应的部分——它们在 `usecases.md` 里**留空并标注**，
**不是遗漏**。其中 **U-1（研究项目 / 用户洞察的成员模型）** 使这两类容器的用例**整体缺席**。

### 签核前请重点确认（**按 12 条裁决重写**）

- [ ] 🔴 **三类是三类，不是一类加一个开关。** 裁决原话逐字：「他们的**过程和目的完全不同**」。
      ⇒ `projects` 只承担「容器身份 + 组织归属 + 状态」；
      **任何把工作坊专属字段（议程环节、分组）加进 `projects` 的改动都违反裁决**。
      本束把这条写成 **I-P33** 并配了**机械门控 + 三条反证**（`domain.md` §一之三）——
      请确认那份门控设计足够（尤其：它是**白名单等值**，不是黑名单；
      黑名单挡得住 `agenda_segment_id`，挡不住下一个没被想到的名字）。
- [ ] 🔴 **`projects.kind` 判别列是本束替你做的判断，不在裁决原文里。**
      裁决说「三类各建 1:1 子类型表」，**没有说 1:1 怎么保证**；
      而「子表 PK = FK 到 `projects.id`」只能保证**每张表至多一行**，
      保不了**三张表合计至多一行**。本束用「判别列 + 复合外键」把它降成一行的 `kind` 值。
      ⇒ **请明确接受或否决**（否决则 1:1 只能靠测试层断言，与「约束下沉到数据库」的纪律相反，
      本仓已因此栽过两次：F04 的级联删除、F08 的 append-only 被 `ON DELETE CASCADE` 绕过）。
      → `domain.md` I-P34 与 §一之三第 2 小节，登记为 **U-9**。
- [ ] 🔴 **四种项目角色只属于工作坊**（裁决逐字：「在访谈里是没有这几种角色的」）。
      ⇒ 研究项目与用户洞察的成员模型**仍未裁**（**U-1**），本束**没有为它们写任何用例**。
      请确认「不写」是对的，而不是漏了。
- [ ] **`acl_bindings.object_kind` 在 D 下加不加值**：Q-12 **连带 1** 说加 2 个值，
      而**连带 4 的 D** 使它不必要（三类都是 `projects` 行）。两条同日写就，先后未写明。
      本束按「D 覆盖连带 1」处理（**不加值**）——**这是本束的判断，请确认**。→ **U-8**
- [ ] **本束不得重新讨论「环节要不要有状态」这个前提**——它已经签核过了
      （`stage.advance` 在已实现的闭集动作词表里，源自 UC-0.3 R5）。
      本束只讨论**状态机长什么样**（Q-2② 已裁：四态 + `mergedInto`）。见 `domain.md` I-P10 / I-P43。
- [ ] **两个失败码的反证是硬要求**。`STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE` 在已签契约里，
      而迁移注释逐字记着它们今天「not evaluable by anything in this repository today」，
      并拒绝用「一个永远说 open 的可空查表」假装覆盖：
      > a check that cannot fail is worse than an absent one, because it reads as coverage.

      ⇒ 本束交付它们时**必须同时交双向断言**（closed 环节拒绝 **且** open 环节通过）。
      单向断言会让「永远返回 STEP_CLOSED」的实现全绿。见 `usecases.md` 的 V4 / V5。
- [ ] **「无项目角色」是正常状态，且必须与「无项目上下文」可分辨**——两者禁止合并成一个值
      （合并会让前端分不清「不是项目页」与「是项目页但你没权限」）。见 `domain.md` I-P6 / I-P7。
- [ ] **管理员不是超级用户，但 `purpose: "audit"` 是放行 + 留痕，不是 403**。
      ⚠ 这个断言方向被 **O-04** 反转过一次；照旧稿写 `expect(403)` 会写出一个
      **断言错误方向的绿灯**。见 `usecases.md` V4/V5 与 `uc-00-3` R12。
- [ ] **项目级审计通道已存在，本束不许另造一套**（`provenance` 的 `kind` 已含 `project`，
      且有专门事件类型 `admin-project-access`）。见 `domain.md` I-P3。

---

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面。** 第 ③ 件的落点将是：

```
packages/contracts/src/project.ts        ← 尚未创建（形状已由裁决定死，但仍等 feature 生成）
apps/api/migrations/0018-project-*.sql   ← 尚未创建。⚠ 序号取 0018：0016/0017 已被 F13/F17 占用
```

✅ **此前挡着 `project.ts` 第一行的六个分叉，2026-07-30 全部有答案了：**

| 原分叉 | 裁决结果 → `project.ts` 里长什么样 |
|---|---|
| **Q-12** | **C + 连带 4 的 D**：`Project = { id, orgId, name, status, kind }`，`kind` 三值闭枚举；**没有** `parentProjectId`；权限投影**只有一套**（三类都是 `projects` 行，走同一套 `acl_bindings` 与 RLS） |
| **Q-1** | **C**：`createProject.in` **有** `blueprintVersionId?: string \| null`；创建事务**一处**（但必须原子写两行：容器 + 子类型） |
| **Q-2①** | **A**：**有** `AgendaSegment` 实体与 `agenda_segments` 表；两个失败码**由此可判** |
| **Q-5** | **B**：`Project` 上**有** `status ∈ {active, archived}`；**有** `archiveProject`；`unarchiveProject` **未定**（U-2⑴） |
| **Q-6①** | **B**：`listProjects.out` 是**两段** `{ member[], managed[] }`，**不是**混合数组加 `canManage` |
| **Q-10** | **A**：把 phase-00 `readContent.in.projectId` 放开为 `nullable`——⚠ **改已签核束**，且**作为契约缺陷报告提给签核人**，不由实现者顺手改 |

⚠ **但仍不该现在就写 `project.ts`**，理由变了：不再是「形状未知」，而是
**本束还没有任何 feature**——一份没有 feature 承接的单源一落地就会被别的束当权威引用，
而没有任何 `verification` 命令守着它。

### 签核前请重点确认（**按 12 条裁决重写**）

- [ ] 🔴 **`projects` 的语义变了：从「工作坊」变为「容器超类型」。**
      这是**修订 phase-00 已签核的 `identity` 束**（`status: confirmed`，
      `confirmed_at: 2026-07-29T07:35:09+08:00`，覆盖 F01 F02 F03 F15 F16 F17）。
      **这是签核动作，不是实现细节** —— 逐条影响面见 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md) 第一节。
      好消息：`projects(id)` 现有 **7 条外键一条不改**（这正是 D 被选中的首要理由）。
- [ ] 🔴 **`stepId` / `stage.*` 改名对齐**（Q-3 B 裁 ①）。
      这是**修订 phase-00 已签核的 `artifact` + `identity` 两束**，
      波及 **21 个文件 / 109 处** `step_id`·`stepId` 与 **14 处** `stage.*`，
      直接触及已 passing 的 **F01 / F06 / F07 / F08 / F13** 的验收命令。
      **这是签核动作，不是实现细节** —— 逐条清单见 `MIGRATION-IMPACT.md` 第二节。
      ⚠ 两个失败码的**字面量**（`STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE`）**改不改，裁决没说**，本束不改。
- [ ] 🔴 **最危险的三条改动不会让任何门控变红** —— `MIGRATION-IMPACT.md` 第三节 3.2：
      ⑴ F22 的组织冻结策略是**逐表写死**的，三张新子表**不会自动进去**（`verify-rls.sh` 查的是租户隔离，不是冻结）；
      ⑵ `projects.kind` 若带 `DEFAULT 'workshop'`，一切全绿且把历史数据静默归类；
      ⑶ 前端 5 处「命名待裁决」的注释会变成事实错误，其中 `skill-app.tsx:126` **把它画在界面上**。
      请确认三条各自的处置。

- [ ] **本束必须复用、不得新造的四样东西**（每样都已签核并已实现）：
      ⑴ `acl_bindings` 三种 object 粒度闭集（`project` / `artifact` / `segment`）；
      ⑵ 项目角色四种枚举与 `project_role` CHECK；
      ⑶ `provenance` 的项目审计通道；
      ⑷ 项目角色的 15 条闭集动作词矩阵（`project-role-matrix.ts`，且该文件自己声明
      「将来要**移进** `packages/contracts` 而不是复制一份」——本束若需要它，**必须引用不得抄**）。
      见 `domain.md` I-P2 / I-P5 / I-P3 / I-P9。
- [ ] **错误码跨束同码同义**：`NO_PROJECT_ROLE` / `ADMIN_NOT_SUPERUSER` /
      `PROJECT_ROLE_INSUFFICIENT` / `STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE`
      必须与 phase-00 `identity` / `artifact` 束**同码同义**，不得在 `project.ts` 里另起一份名字。
- [ ] **响应体也要被契约校验**。本束的观察者投影与「个人层只出计数」都是**减字段**——
      若只校验请求体，服务端多下发一个字段**不会有任何门控变红**（前端类型也从同一份契约生成）。
      需要 `out.safeParse()` 的**反向断言**。
- [ ] **`GET /projects` 目前在契约里不存在**（`packages/contracts` 里 `/projects` 只出现于
      backflow 一处）。它是本束要**新造**的第一个路由；形状已由 **Q-6① B** 定死为
      **两段式** `{ member[], managed[] }`。⚠ 出现在 `managed` 里 **≠** 能进去看内容（D-18 边界）。
- [ ] **`DELETE /projects/*` 已裁决「不提供」**（Q-9）⇒ 交付物是**一条断言它不存在的测试**，
      不是一个接口。照抄 N-5（「『没有』这件事本身没人会去验」）。
      ⚠ 反证：同时断言该禁止清单**非空且含既有条目**，否则一个被清空的清单也全绿。
- [ ] **不存在的东西也要确认「确实不做」**：`parentProjectId`（候选 E 未采纳）·
      `unarchiveProject`（**U-2⑴ 未裁**）· 父子相关的失败码 · 研究项目 / 用户洞察的成员接口
      （**U-1 未裁**）。⚠ 这四样**现在写任何一样都是发明**。见 `coverage.md` 第四节。

---

## 本束与哪些束有交叉约束（留给阶段一致性复核）

| # | 交叉点 | 对方 | 为什么必须在复核时看 |
|---|---|---|---|
| **X-6** | **议程环节（`agenda_segment`）是谁的**：绑定挂载点 / 三视角首屏切换驱动源 / 临时提权失效锚点 | `templates` · `canvas` · `skills` · `org-admin` · `agent-runtime` · `files` · `interview` | 阶段 `design-coherence.md` 的 X-6 已记「它既不在 `org-admin` 也还不存在」。**本束就是它的归属答案。**⚠ 六个束的 feature 已在环节上排工——本束不定，它们的挂载点悬空 |
| **X-3'** | **字段名单源**：`agenda_segment` 已由 **D-03a** 定稿并有机械门控（`files` 束 N-4），但 `templates` 束仍成片写旧名。**残留量不写死数字**——它随 Q-3 ① 改名推进而变，写死必然过期（本条已因此错过一次）。复核时**现场跑**：<br>`grep -rniE 'agenda_?stage' phases/phase-01-run-a-project/contracts/templates/`<br>**判据 = 输出为空**。（2026-07-30 实测：**19 行 / 21 处**，分布在 `domain.md` `usecases.md` `coverage.md` 三个文件） | `templates` · `files` · phase-00 `artifact`（`stepId`） | 这是**第七次「同一事实两处」已经开始的样子**。<br>⚠ **2026-07-30 更正**：本条此前写「仍有 **2 处**（`domain.md:25`、`ui.md:123`）」——**两处都错**：`templates/ui.md` **只有 111 行**（`:123` 指向文件尾之外）且**已无该词**；真实残留是上面那条 grep 的输出。错误计数曾被 `OPEN-QUESTIONS.md` 复制三份，一并已改成同一条命令。<br>⚠ 复核时还要处置 phase-00 的 `stepId` / `stage.*` 改不改（**修订已签核束**）→ `OPEN-QUESTIONS.md` Q-3 第三节 |
| **X-15** | ~~父子项目与 I-7 / I-13 的方向冲突~~ **已消解**：Q-12 裁 **C/D 而非 E** ⇒ **父子边不存在**，且必裁三件之 1 逐字答「**不传播**」 | phase-00 `identity` · `artifact` · phase-01 `interview` | 保留此行只为留痕：原型那句「挂到哪个项目（决定能读哪些洞察与图谱）」**未被采纳为数据模型**。⚠ 但**界面上那个字段还画着** —— 处置是第 ① 件的确认项 |
| **X-21** 🔴 **新** | **修订已签核的 phase-00 `identity` 束**：`projects` 的语义从「工作坊」变为**容器超类型**（Q-12 C + 连带 4 D） | phase-00 `identity`（`status: confirmed`，覆盖 F01 F02 F03 F15 F16 F17） | **这是签核动作，不是实现细节。** 表结构上 `projects(id)` 的 7 条外键一条不改，所以**没有任何门控会因语义变更变红**——正因如此它必须走签核，否则一个已签核束的语义会在无人点头的情况下改掉。⚠ 连带三条：`acl_bindings.object_kind` 加不加值（**U-8**）· `projects.kind` 判别列可不可接受（**U-9**）· `admin_project_access` 的审计语义是否按 kind 区分（无出处）。逐条影响面见 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md) 第一节 |
| **X-22** 🔴 **新** | **`stepId` / `stage.*` 改名对齐**（Q-3 B 裁 ①）：`step_id`→`agenda_segment_id`、`stage.*`→`agendaSegment.*` | phase-00 `artifact`（覆盖 F04 F05 F06 F07 F08）· phase-00 `identity`（动作词表在 `project-role-matrix.ts`） | **这是签核动作，不是实现细节** —— 它动的是**两个已签核束**与**五个已 passing feature 的验收命令**（F01 / F06 / F07 / F08 / F13）。真实规模：**21 个文件 / 109 处** `step_id`·`stepId`，**14 处** `stage.*`。⚠ 三处特别注意：⑴ 新增迁移序号是 **`0018-*`**（`0016`/`0017` 已占用，Q-8 推荐里写的 `0016` 已过期）；⑵ `rbac-two-layer.test.ts` 里那条**故意不存在**的 `"stage.selfDestruct"` 反证必须一起改，否则它会变成永远通过的空转断言；⑶ 前端 5 处旧名**全在注释/文案里，`typecheck` 一处都不会红** → grep 门控范围必须包含 `apps/web`。逐条清单见 `MIGRATION-IMPACT.md` 第二节 |
| **X-16** | **项目归档（Q-5 **已裁 B**）与 X-4 豁口边界**。⚠ 归档的**四个连带行为全部未裁**（**U-2**） | phase-00 `artifact`（I-11 / X-4） | 「归档不删除任何内容」这句话本身就是 X-4 豁口的正确一侧——豁口只留给**合规撤回**，不该被「项目结束」借道。⚠ 且 X-4 依赖 **O-39 法定留存清单**，那份清单**不存在** |
| **X-17** | **`readContent.in.projectId` 非空 vs `Artifact.projectId` 可空** | phase-00 `identity` · `artifact` · `context-pack` | 一条**已签核契约内部的紧张关系**：按字面，`projectId = null` 的 artifact 没有合法读取路径。→ Q-10 / Q-11 连带 1，**两条是同一个洞** |
| **X-18** | **`QueryContext.projectIds` 不按项目状态过滤** | phase-00 `context-pack` | ⚠ **归档既已裁定成立（Q-5 B），这条就从「假设」变成了「真缺口」**：现在没有任何地方说 Context Pack 要按状态过滤，而**它不会让任何门控变红** → **U-2⑷** |
| **X-19** | **`groups` 挂哪一级 / `projects` 的级联路径** | phase-00 `identity`（`0003-identity.sql`） | Q-9 已裁「不提供删除」⇒ 级联静默清行的风险由 `no-forbidden-routes` 断言守住。⚠ **新问题**：`groups.project_id` 指向**超类型**，而分组是**工作坊机件** ⇒ 研究项目 / 用户洞察下可以插分组，**外键层不可表达为禁止** → **U-7**。⚠ 另：三张新子表**不在 F22 冻结策略的写死表清单里**（`0014:165-184`），组织停用后子类型行仍可写 —— 见 `MIGRATION-IMPACT.md` 3.2① |
| **X-20** | **保留 testid 清单是单源，本域 19 屏必须进那张表** | phase-00 `web-kernel` | `web-kernel` 的屏清单是手维护的，已被登记为漂移候选并注明「phase-01 屏数增长后风险放大」。本域一次加 7 个标签页 |

---

## 确认动作

⚠ **本束现在没有「确认动作」可做。** 见顶部醒目块：签核对象（feature）还不存在。

将来可签时的动作与其它束相同——人类逐节核对上面三节后，把 frontmatter 的 `status`
改为 `confirmed`，并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳，该字段受 CODEOWNERS + CI 保护
（ADR-023 决策五）。

⚠ 另需注意：本束是**第 10 个束**，它的加入意味着
`phases/phase-01-run-a-project/design-coherence.md` 的 `covers_bundles` 必须包含 `project`，
且**那份一致性复核要重做**（新增一个从没被复核看过的束，正是 ADR-023 背景 1 记录的爆点）。
`covers_bundles` 已补为十束，但复核本身仍是 `pending` —— **不要只改 `covers_bundles` 就当复核过了**。
