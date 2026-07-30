# 契约束 `canvas` — 签核①：UI（人看到的界面对不对）

> **自检：本文件引用 40 张截图，目录下实际 40 张（N == M == 40，无死链、无漏引、无重复引用）。**
> 核对命令：`ls phases/phase-01-run-a-project/ui-preview/canvas/*.png | wc -l`
> 与本文件第五节表格行数比对。
>
> ✅ **截图已产出**：`phases/phase-01-run-a-project/ui-preview/canvas/`
> —— **40 张 png ＋ 一份 `README.md`**（ui-prototyper 的 sign-off 说明，含它替 UC 做的判断）。
> 原型跑在顶层路由 `/canvas`，一页切**五屏**（`?screen=`）×**四视角**（`?as=`）×**七态**（`?state=`），
> 真实组件 + mock，非设计稿。第五节是这 40 张的完整索引。
>
> 🔴 **但材料不完整**：原设想的 20 条截图里 **9 条没有对应产出**（多为特写/对话框开态），
> 逐条列在**第五节之后的「第 ① 件材料缺口」**一节。**签核时请先看那一节**——
> 本文件不为了好看而隐瞒缺口。
>
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（权威）。
> 依据 UC：`uc-7-1` R8 · `uc-7-2` R8 · `uc-7-3` R8（画布屏完整抽取）· `uc-7-4` R8

---

## 一、本束需要哪几块屏

| # | 屏 | 期望路由 | 服务哪几个 feature | 现状 |
|---|---|---|---|---|
| **1** | **推演画布**（左栏三区 + 工具条 + 标题区 + 冲突条 + 右栏三区） | `/projects/[projectId]/canvas` | F103 F104 F105 F106 | ✅ **已建成**（⚠ 是 mock 壳，见下） |
| **2** | **Studio · 原型** | `/studio/prototype` | ⚠ 映射存疑，见下 | ✅ 已建成 |
| **3** | **后台 → 画布模板**（模板库列表 + 三段发布流程 + 归档确认框 + 12 类白名单开关区） | `/admin/canvas-templates`（**待定**） | F100 F101 | ⚠ 原判「未建」**已过时**：本轮已由 `/canvas?screen=template-admin` 原创补画（8 张图，第五节） |
| **4** | **蓝本设计器 · 16 项设计配置的第 9「项目材料」/ 第 10「分组打印素材」/ 第 13「Skill 绑定」** | 未定 | F102 | ⚠ 原判「未建」**已过时**：已由 `/canvas?screen=segment-binding` 原创补画（8 张图）。但**档案侧仍属未探明**（proto-05/06/08 逐字写着「蓝本 16 项各配置面板」未点进去）——画出来的是设计提案，不是抽取结果 |
| **5** | **全场图谱 · 事实关系**（节点三态徽标 + `[批量确认]` + 冲突待判定区） | 未定 | F107 | ⚠ 原判「未建」**已过时**：已由 `/canvas?screen=backflow` 原创补画（8 张图）。（`/brain` 仍是组织大脑，不是它） |
| **6** | **本组小树**（组级图谱） | 未定 | F107 | ⚠ 原判「未建」**已过时**：已由 `backflow` 屏的 `member` 视角补画（`uc-7-4-backflow-member.png`）。**档案侧仍属未探明**（只探明全场视图）——原创设计，签核重点 |
| — | 项目文件浏览器（画布的源码 `.md` 与布局快照在此可见可下载） | `/projects/[projectId]/files` | 消费方，**属 artifact / 22-files 束** | ✅ 已建成（本束只引用，不重复签核） |

---

## 二、屏 1 · 推演画布 —— 已建成，落点与真实 `data-testid`

**路由**：`apps/web/app/projects/[projectId]/canvas/page.tsx`
**组件**：`apps/web/components/canvas/` 下 6 个文件 ——
`canvas-main.tsx` · `canvas-left-panel.tsx` · `canvas-toolbar.tsx` · `canvas-stage.tsx` ·
`canvas-right-panel.tsx` · `conflict-bar.tsx`

> ⚠ 下表全部 `data-testid` 由 `grep -rn "data-testid" apps/web/components/canvas` **实测得到**，
> 不是从 UC 反推的。带 `<id>` 的是模板字面量拼出来的动态 testid。

| 区域 | 真实 `data-testid` | 对应 UC 线索 |
|---|---|---|
| 容器 | `canvas-main` `canvas-left-panel` `canvas-right-panel` | uc-7-3 R8 三栏结构 |
| 左栏 · 本环节各组画布 | `canvas-group-<id>` | uc-7-3 R8 ①（四态：进行中 / 你在这组 / 只读 / 落后） |
| 左栏 · 本项目画布 | `canvas-project-canvas-<id>` | uc-7-3 R8 ②（同步三态） |
| 左栏 · 本环节绑定的 skill | `canvas-skill-<id>` `canvas-skill-<id>-run` `canvas-skill-<id>-on` `canvas-skill-<id>-ran` | uc-7-4 R8（`[运行]` 与 `[已开]` **不可混用**） |
| 工具条 | `canvas-toolbar` `canvas-active-tool` `canvas-tool-source` `canvas-tool-hint` | uc-7-3 R8 工具条七件 |
| 缩放 | `canvas-zoom-in` `canvas-zoom-out` `canvas-zoom-fit` `canvas-zoom-level` | 滚轮缩放 · alt 拖拽平移 |
| 画布区 | `canvas-stage` `canvas-surface` | ⚠ **静态占位**，见 S-17 |
| 源码视图 | `canvas-source-view` | uc-7-3 R3 步骤 4（`[源码]` 可直接手改） |
| 同步状态 | `canvas-sync-status` | uc-7-3 R7 同步三态 |
| 只读 | `canvas-readonly-notice` | uc-7-3 A2（别组画布只读） |
| 选中对象 | `canvas-selected` | uc-7-3 R8 右栏 ① |
| 导出规则 | `canvas-rule-geometry` `canvas-rule-nocoord` | uc-7-3 R7 ①②（右栏常驻说明） |
| 布局快照 | `canvas-save-layout` `canvas-layout-snapshots` | uc-7-3 A3（⚠ 按钮字面在，**行为未渲染**） |
| AI 在这张画布上 | `canvas-ai-changes` `canvas-ai-change-list` `canvas-ai-view` `canvas-ai-mode-toggle` | uc-7-2 R8 右栏 ③ + D-10 |
| AI 回滚 | `canvas-ai-rollback` `canvas-ai-rollback-confirm` `canvas-ai-rollback-cancel` `canvas-ai-rollback-submit` | D-10 一键回滚（S-14：已补二次确认） |
| 冲突条 | `canvas-conflict-bar` `canvas-conflict-toggle` `canvas-conflict-compare` `canvas-conflict-keep-doc` `canvas-conflict-keep-canvas` `canvas-conflict-result` `canvas-conflict-dismiss` | D-09 三出口（`?conflict=on` 显式触发，S-18） |

### ⚠ 这块屏的三个已知性质（签核时必须知道）

1. **画布是壳不是引擎**（S-17）：`canvas-stage` 是静态占位，便签 / 节点 / 连线是 mock，
   **不要期待真实 mermaid 布局**。核对的是信息架构对不对。真实渲染由 **F103** 交付并替换该壳。
2. **冲突条是「可显式触发的一态」**（S-18）：靠 `?conflict=on` 打开；
   原型侧此条属**确认缺失**（画布屏与源码视图均已探明，未见冲突条）。
   ⇒ 三出口的**交互形态是实现者替 UC 做的决定**，请重点确认。
3. **右栏「坐标不写回」用了 warning 边框 + 禁止图标 + 「重开后位置变了不是 bug」**（S-17）——
   这是刻意加重的，因为这条最容易被实现者误解为可存坐标。

### ⚠ 这块屏**缺一整层**：规则的可见形态

以下在 UC 里写了、在代码里 `grep` 不到任何 testid、界面上**不存在**：

| 缺的东西 | 出处 | 后果 |
|---|---|---|
| 留白提示条 + `[清一格]` 一键留白入口 | uc-7-2 R8（非阻断的画布内提示条，不用 modal） | D-11 两条留白规则**没有可见形态** |
| 「无来源 · 待补」草稿样式 | uc-7-2 R8 | 规则②在界面上不可辨 |
| 完成度（已填 N/M） | uc-7-3 R3 步骤 3 · O-32 | 完成度判定看不见 |
| 「停滞」徽标 | O-32（默认 5 分钟可配） | 同上 |
| 「有 N 条语法被忽略」顶部提示 | uc-7-1 R7 · AC3 | 白名单语义看不见 |
| 便签归区的**可撤销提示** | uc-7-3 E2d | 框外归最近框时人不知道发生了什么 |
| 匿名成员的**临时身份标记** | uc-7-3 E1 · V12 | 谁贴的看不见 |

> 这不是装饰缺失。**规则写在 UC 里、断言写在 Node 单测里、界面上没有形态 ⇒ 现场的人不会知道规则存在。**
> 见 `coverage.md` 缺口 4。

---

## 三、屏 2 · Studio 原型 —— 已建成，但**映射存疑**

**路由**：`apps/web/app/studio/prototype/page.tsx` → `apps/web/components/studio/prototype-screen.tsx`
**真实 `data-testid`**（实测）：`studio-prototype-new` `studio-prototype-search` `studio-prototype-filters`
`studio-prototype-filter-<key>` `studio-prototype-card-<id>` `studio-prototype-open-<id>`
`studio-prototype-status-<id>` `studio-prototype-steps-<id>` `studio-prototype-blockers-<id>`
`studio-prototype-audit-<id>` `studio-prototype-undo-<id>` `studio-prototype-undone-note-<id>`
`studio-prototype-attach` `studio-prototype-attach-panel` `studio-prototype-attach-pick-<id>`
`studio-prototype-attach-done` `studio-prototype-start` `studio-prototype-start-chat`
`studio-prototype-autosave` `studio-prototype-versioning-rule`

> ⚠ **`ui-preview/README.md` 的对照表把 `/studio/prototype` 挂在 UC-7.1 上，但它的内容
> （PROTOTYPE-DIGEST 第五节）是「原型交付物的版本管理」——新建原型、五步进度、
> 「只保留最新版本、不做并排比较」、挂到项目环节，**与画布模板库没有关系**。**
>
> 本束的看法：**它不服务本束任何 feature**，UC-7.1 需要的是屏 3（后台 → 画布模板）。
> 这是**本束替人类做的一个判断**，签核时请确认；若确认，建议同时更正 `ui-preview/README.md`
> 的对照表（那是另一处「同一事实声明在两处」的苗头）。

---

## 四、屏 3–6 · 原判「未建」的四块（本轮已补画原型，缺口分析保留）

> ⚠ **本节写于截图产出之前**：当时这四块屏一张都没有。本轮 ui-prototyper 已在 `/canvas`
> 下把四块全部原创补画并出图（见第五节）。**下表逐条「缺什么 / 为什么非有不可」的分析仍然有效**——
> 它现在的读法是「补画的这四屏，请对着这张表核对它有没有把该有的东西画出来」，
> 而不是「这些东西不存在」。未被补画覆盖的条目见「第 ① 件材料缺口」一节。

| 屏 | 缺什么 | 为什么它非有不可 |
|---|---|---|
| **后台 → 画布模板** | 模板列表行（名 / 状态 / 结构摘要 / `key vN` / 底层类型 / 可见性 / 被 N 场使用 / 行操作）· 三段发布流程 · **归档确认框的「有 N 个议程环节仍绑定此模板」** · 12 类白名单开关（4 组 × 3） | 归档确认框的 N 是 **O-10 ③ 的显式要求**——没有它，人不知道归档影响谁。⚠ 另：`[＋ 新建画布模板]`（「和 AI 聊出分区结构」）在原型里**只有按钮和一句说明，无对话面板**（原型待补） |
| **蓝本 16 项的第 9/10/13 项配置面板** | 议程环节 ↔ 模板 / 材料 / skill 的**实际配置面** | F102 的入口整个是**推断**的。⚠ 属**未探明**（没点进去），补抽取即可，不是补画 |
| **全场图谱 · 事实关系** | 节点三态徽标 · 来源链（来源组 + 来源模块 + 证据量 + 时间码）· `[批量确认]` 勾选清单 · 「冲突待判定」区与 `[上台讨论]` `[标为不确定]` | **画布 → 图谱的回流动作本身在原型里不存在**——两端都写实，中间没有任何「汇入 / 回流」入口或状态（原型确认缺失） |
| **本组小树**（组级图谱） | 整屏 | 属**未探明**：档案只探明了全场的事实关系与推演流水线 |

⚠ **模板选择面板的分类维度**至今没有依据：原「按阶段浏览：共情/定义/构思/原型/验证」五个词
**全档案 0 命中**，已删除。补画原型前请先裁决（见 `domain.md` [待定 D-c]）。

---

## 五、截图清单 —— 真实产出的 40 张，逐张索引

> 全部路径相对 phase 根，即 `phases/phase-01-run-a-project/` 下的 `ui-preview/canvas/*.png`。
> 五屏 × 八张：七态（`default / loading / empty / invalid / dep-failed / denied / success`）
> 各一张，第八张是该屏的**关键视角或冲突态**（每屏至少一张非 happy-path）。
> 视角未标注处为默认 `facilitator`（引导师）。
> 每张图对应的屏／UC／feature 归属，与 `ui-preview/canvas/README.md` 第一节对照表一致。

### 5.1 `template-admin` 屏 —— 后台画布模板库（UC-7.1 R3 主线 A / R7 / R8 · F101，辅 F100）

对应本文第一节的**屏 3**。F100 无独立屏，其界面落点是模板库的 `key vN` 列
（`persona v3` / `empathy v4 显示: empathy-map` 等五处 `key≠display_name`），在 `-default` 图里。

| # | 截图 | 状态 / 视角 | 内容 |
|---|---|---|---|
| 1 | `ui-preview/canvas/uc-7-1-template-admin-default.png` | default · facilitator | 模板库列表全貌 + `key vN` 双列对照 + 三段发布流程说明条 + 底部 12 类 mermaid 白名单开关区 |
| 2 | `ui-preview/canvas/uc-7-1-template-admin-loading.png` | loading | 列表骨架态 |
| 3 | `ui-preview/canvas/uc-7-1-template-admin-empty.png` | empty | 一个模板都没有 |
| 4 | `ui-preview/canvas/uc-7-1-template-admin-invalid.png` | invalid | 校验失败（`err-*`） |
| 5 | `ui-preview/canvas/uc-7-1-template-admin-dep-failed.png` | dep-failed | 上游依赖不可用 |
| 6 | `ui-preview/canvas/uc-7-1-template-admin-denied.png` | denied | 无后台权限 |
| 7 | `ui-preview/canvas/uc-7-1-template-admin-success.png` | success | 发布成功后的落地态（`saved`） |
| 8 | `ui-preview/canvas/uc-7-1-template-admin-observer.png` | default · **observer** | 观察者只读投影：新建 / 发布 / 归档 / 白名单开关**均不渲染** |

### 5.2 `segment-binding` 屏 —— 议程环节绑定模板与 skill（UC-7.1 R3 主线 B / R4·E1 / R8 · F102）

对应本文第一节的**屏 4**（蓝本 16 项第 9/10/13）。⚠ 档案侧属**未探明**，此屏是原创设计提案。

| # | 截图 | 状态 / 视角 | 内容 |
|---|---|---|---|
| 9 | `ui-preview/canvas/uc-7-1-segment-binding-default.png` | default · facilitator | 环节 ↔ 模板 / skill 绑定面 + 两模板上限计数 `1/2` + 顶部橙色告警条（「议程环节」四名并存，裁决指向 OPEN-QUESTIONS） |
| 10 | `ui-preview/canvas/uc-7-1-segment-binding-loading.png` | loading | — |
| 11 | `ui-preview/canvas/uc-7-1-segment-binding-empty.png` | empty | 该环节尚未绑定任何模板 / skill |
| 12 | `ui-preview/canvas/uc-7-1-segment-binding-invalid.png` | invalid | **绑第三个模板被拒**（两模板上限的拒绝形态） |
| 13 | `ui-preview/canvas/uc-7-1-segment-binding-dep-failed.png` | dep-failed | — |
| 14 | `ui-preview/canvas/uc-7-1-segment-binding-denied.png` | denied | — |
| 15 | `ui-preview/canvas/uc-7-1-segment-binding-success.png` | success | 绑定已保存 |
| 16 | `ui-preview/canvas/uc-7-1-segment-binding-member.png` | default · **member** | 组员只读——只有引导师能配置绑定 |

### 5.3 `ai-draft` 屏 —— AI 起草留白（UC-7.2 R3 / R7 / R8 · F106）

**本束头号签核对象**：「AI 故意没写完」的表达形态（虚线空位卡「留给现场 · AI 故意没填」+ 分区头 `已填 2/4 · 留 2 格`）。
原设想的第 8 条（留白提示条 + `[清一格]`）与第 9 条（「无来源 · 待补」草稿样式）**都落在这一屏的 `-default` 图里**，
不是两张独立特写——这是本文替原清单做的合并判断。

| # | 截图 | 状态 / 视角 | 内容 |
|---|---|---|---|
| 17 | `ui-preview/canvas/uc-7-2-ai-draft-default.png` | default · facilitator | 虚线空位卡 + `已填 N/M · 留 K 格` + **留白提示条与 `[清一格]`** + **「无来源 · 待补」灰色虚线草稿样式** + AVA 角标 + `[一键回滚本轮]` |
| 18 | `ui-preview/canvas/uc-7-2-ai-draft-loading.png` | loading | 起草中 |
| 19 | `ui-preview/canvas/uc-7-2-ai-draft-empty.png` | empty | 尚未起草 / 回滚后的空态 + `[重新起草]` |
| 20 | `ui-preview/canvas/uc-7-2-ai-draft-invalid.png` | invalid | — |
| 21 | `ui-preview/canvas/uc-7-2-ai-draft-dep-failed.png` | dep-failed | Context Pack 取不到（上游 `context-pack` 束不可用） |
| 22 | `ui-preview/canvas/uc-7-2-ai-draft-denied.png` | denied | — |
| 23 | `ui-preview/canvas/uc-7-2-ai-draft-success.png` | success | 起草完成、完成度落地 |
| 24 | `ui-preview/canvas/uc-7-2-ai-draft-observer.png` | default · **observer** | 观察者**看不到原始引述原文** |

### 5.4 `editor` 屏 —— 组内协作画布编辑器（UC-7.3 R3 / R7 / R8 · F103 F104 F105）

对应本文第一节的**屏 1**，复用第二节实测的 `canvas-*` 既有组件（未重画，只接进屏切换）。
⚠ 该屏画布本体是**静态占位壳**（S-17），核对的是信息架构。

| # | 截图 | 状态 / 视角 | 内容 |
|---|---|---|---|
| 25 | `ui-preview/canvas/uc-7-3-editor-default.png` | default · facilitator | **三栏全貌**：左栏三区（各组画布 / 本项目画布 / 环节 skill）+ 工具条 + 画布区 + 右栏（选中对象 / 导出规则两条 / `[另存布局快照]` / 「AI 在这张画布上」+ `[看改动]` `[回退]`） |
| 26 | `ui-preview/canvas/uc-7-3-editor-loading.png` | loading | — |
| 27 | `ui-preview/canvas/uc-7-3-editor-empty.png` | empty | **新建画布只有模板骨架与空分区，零示例便签** |
| 28 | `ui-preview/canvas/uc-7-3-editor-invalid.png` | invalid | — |
| 29 | `ui-preview/canvas/uc-7-3-editor-dep-failed.png` | dep-failed | — |
| 30 | `ui-preview/canvas/uc-7-3-editor-denied.png` | denied | 无写权限投影——**兼作原设想第 11 条「别组画布只读、写操作全部禁用」的呈现**（见缺口一节的取舍说明） |
| 31 | `ui-preview/canvas/uc-7-3-editor-success.png` | success | 已同步 / 已保存（`saved`） |
| 32 | `ui-preview/canvas/uc-7-3-editor-conflict.png` | **conflict**（`?conflict=on`） | 结构性冲突条常驻横条 + 三出口（`保留文档` / `保留画布` / `并排比较`）+ 两侧改动摘要 |

### 5.5 `backflow` 屏 —— 回流知识图谱（UC-7.4 R3 / R7 / R8 · F107）

对应本文第一节的**屏 5 与屏 6**（全场事实关系 + 本组小树）。

| # | 截图 | 状态 / 视角 | 内容 |
|---|---|---|---|
| 33 | `ui-preview/canvas/uc-7-4-backflow-default.png` | default · facilitator | 全场事实关系（节点三态徽标 + 每节点一条来源链「第 3 组 · 研究模块 9 来源 · 12:05 · seg-3#0142」+ **来源链断的 `gn5` 节点「来源链断 · 不得写回」**）+ `[批量确认]` 勾选清单 + 「冲突待判定」红条与 `[上台讨论]` `[标为不确定]` + 推演流水线 `12/36 · 4 场景 × 9 环节` 及底部 `[设计·待确认]` 映射注脚 |
| 34 | `ui-preview/canvas/uc-7-4-backflow-loading.png` | loading | — |
| 35 | `ui-preview/canvas/uc-7-4-backflow-empty.png` | empty | 尚无可回流的事实 |
| 36 | `ui-preview/canvas/uc-7-4-backflow-invalid.png` | invalid | — |
| 37 | `ui-preview/canvas/uc-7-4-backflow-dep-failed.png` | dep-failed | — |
| 38 | `ui-preview/canvas/uc-7-4-backflow-denied.png` | denied | **观察者态直接走 denied**（脱敏粒度 UC 未给，见待确认 Q-4） |
| 39 | `ui-preview/canvas/uc-7-4-backflow-success.png` | success | 组长确认后写回成功 |
| 40 | `ui-preview/canvas/uc-7-4-backflow-member.png` | default · **member** | **本组小树**：组员只见本组，看不到全场各组来源。⚠ 原创设计（档案只探明全场），签核重点 |

> 七态与角色态由预览轴驱动：`?state=loading|empty|invalid|dep-failed|denied|success` ·
> `?as=facilitator|groupLead|member|observer` · `?screen=` 五屏 · `?conflict=on`。
> ⚠ 这些预览开关**在生产构建下不可达**，由 `scripts/verify-prod-gates.sh` 断言——
> 它们不是权限，只是预览手段；真实权限在服务端 RLS。
>
> ⚠ **`groupLead`（组长）视角一张图都没有。** 四视角轴里只截了 facilitator / member / observer。
> 而本束「只有组长确认才写回大脑」（F107 的价值核心）恰恰是组长视角的事——见缺口一节 G-10。

---

## 五之二、第 ① 件材料缺口（**签核必看**）

> 骨架期原清单列了 20 条约定截图。上一节的 40 张真实图覆盖了其中 11 条；
> **剩下 9 条没有对应产出**，外加 1 条视角缺口。缺口一律显式列出，不合并、不淡化。
> 判据：只要「原设想要求的是一张独立特写 / 一个开态对话框」而实际只是被某张全景图**包含**，
> 就仍记为未产出（全景图上看不清的东西，签核时等于没看见）。

| 缺口 | 原设想条目 | 状态 | 影响 |
|---|---|---|---|
| **G-1** | 左栏三区特写：四组画布**四态** + 本项目画布**同步三态** + skill **两种 `runMode`** 同屏陈列 | ⚠ 未产出：`canvas-left-panel-states` 左栏状态陈列特写 —— 该屏尚未画（仅在 `uc-7-3-editor-default.png` 全景里出现单一状态） | 四态 / 三态 / `[运行]` 与 `[已开]` **不可混用**（uc-7-4 R8）这三组枚举的**可辨识性无法核对** |
| **G-2** | 冲突裁决**之后**：采纳侧生效 + **另一侧已存为版本**的可见证据 | ⚠ 未产出：`canvas-conflict-result` 裁决后态 —— 该屏尚未画（只有裁决**前**的 `uc-7-3-editor-conflict.png`） | `preservedVersionId` 永不为空是 D-09 的价值核心（见 `design-signoff.md` ②）。**「另一侧被存下来了」这件事在界面上目前无证据**，人无法确认自己没丢东西 |
| **G-3** | `[源码]` 视图特写 + **「有 N 条语法被忽略」**顶部提示 | ⚠ 未产出：`canvas-source-view` 源码视图与白名单忽略提示 —— 该屏尚未画 | uc-7-1 R7 · AC3 的白名单语义（**只关渲染、不关书写、源码原样保留**）**在图上不可核对**；这正是第二节末表「缺一整层规则可见形态」里的一项 |
| **G-4** | 右栏「AI 在这张画布上」特写：AVA 角标 + 改动列表 + `[看改动]` `[回退]` | ⚠ 未产出：`canvas-ai-panel` 右栏 AI 面板特写 —— 该屏尚未画（仅含于 `uc-7-3-editor-default.png` 全景） | D-10「AI 默认落笔 + 角标 + 可回滚」在**编辑器屏内**的形态看不清（`ai-draft` 屏是另一条路径的形态，不等价） |
| **G-5** | AI 回滚**二次确认对话框开态**（S-14） | ⚠ 未产出：`canvas-ai-rollback-confirm` 回滚二次确认 —— 该屏尚未画 | S-14 与 D-10「一键回滚」的口径之争（**「一键」是否允许一次二次确认**）**没有图可指**。本束契约按「允许」写，但这是签核要拍的一条 |
| **G-6** | 右栏导出规则两条 + `[另存布局快照]` 特写 | ⚠ 未产出：`canvas-export-rules` 导出规则特写 —— 该屏尚未画（仅含于 `uc-7-3-editor-default.png` 全景） | D-08 三条硬规则里最易做反的「**坐标不写回**」（warning 边框 + 禁止图标 + 「重开后位置变了不是 bug」）**加重强调的效果无法核对** |
| **G-7** | **归档确认框开态** + 「有 N 个议程环节仍绑定此模板」 | ⚠ 未产出：`admin-canvas-template-archive` 归档确认对话框 —— 该屏尚未画（`tpladmin-archive-dialog` 组件已实现，但没截开态图） | **O-10 ③ 的显式要求**。这是第四节点名「非有不可」的那一条，也是 `design-signoff.md` ① 单独列出的一条。**当前没有图能证明它长什么样** |
| **G-8** | 12 类 mermaid 白名单开关（4 组 × 3）+ 常驻说明特写 | ⚠ 未产出：`admin-mermaid-whitelist` 白名单开关区特写 —— 该屏尚未画（开关区含于 `uc-7-1-template-admin-default.png` 底部全景） | 12 类枚举的封闭性、以及「关掉后仍可书写」的说明文案**在全景图上读不清** |
| **G-9** | 「冲突待判定」区特写 + `[上台讨论]` `[标为不确定]`（**不自动择一**） | ⚠ 未产出：`graph-conflict-pending` 冲突待判定特写 —— 该屏尚未画（红条含于 `uc-7-4-backflow-default.png` 全景） | 「两侧边并存、不自动择一」对应 `claims.status = contested` 下**不得删除任一侧边**（跨束约束，见交叉约束表 09-kg 行）。这条**只能从全景图远看** |
| **G-10** | （原清单未列，本文补记）**`groupLead` 视角** 任一屏 | ⚠ 未产出：组长视角截图 —— 四视角轴只截了 facilitator / member / observer | F107「**只有组长确认才写回大脑**」是本束价值核心，而**组长自己看到的界面一张都没有**。`backflow` 屏的「组长已确认 · 可写回 / 待组长确认」只在引导师视角下被观察到 |

**不构成缺口、但需说明的两条：**

- 原清单第 8、9 条（留白提示条 + `[清一格]` / 「无来源 · 待补」草稿样式）**已产出**，
  但不是两张独立特写，而是并入 `uc-7-2-ai-draft-default.png`。该屏以留白为主体、
  两者是画面主角而非角落细节，故**判定为已覆盖**。这是本文替原清单做的取舍。
- 第一节的**屏 2 `/studio/prototype` 无截图**。本束认为它**不服务本束任何 feature**（第三节），
  因此**不列为缺口**；若签核时判定该映射成立，它将立刻变成第 11 条缺口。

> ⚠ 缺口 **G-2 / G-5 / G-7** 三条各自对应一个**已在契约里写死的判断**
> （`preservedVersionId` 永不为空 / 二次确认是否算「一键」/ 归档影响面 N）。
> 三者都是「界面上没有图 ⇒ 人只能按文字签」。签核时若不接受这种签法，
> 请把它们退回 ui-prototyper 补图，而不是在文字上确认。

---

## 六、`ui-preview` 三份 markdown 里与本束相关的已知缺口

> 这些是 **「UC 没写、由实现者替 UC 做了的决定」**，签核时逐条确认。

| 条目 | 内容 | 本束的影响 |
|---|---|---|
| **S-17 画布的三件事** | ① **画布是壳不是引擎**（`canvas-stage` 静态占位，便签/节点/连线是 mock）② 「坐标不写回」用 warning 边框 + 禁止图标 + 「重开后位置变了不是 bug」加重强调 ③ `[另存布局快照]` 与「坐标不写回」并存，界面明写「不参与 Markdown 往返」 | ①是 **F103 的全部工作量**；②③正是 D-08 的三条硬规则之二，界面口径与 `domain.md` I-9 / I-12 一致 ✅ |
| **S-14**（危险动作补二次确认） | 「画布 AI 改动 `回退`：二次确认」—— **UC 只给了一个按钮** | 与 D-10「一键回滚」的口径需确认：**「一键」是否允许一次二次确认**。本束契约按「允许」写（`canvas-ai-rollback-confirm` 已建） |
| **S-18**（较轻项之一） | 「冲突条做成可显式触发的一态（`?conflict=on`）；**原型此条确认缺失**」 | 冲突条的**触发条件与呈现形态**是实现者补的。D-09 只定了「顶部常驻横条、未裁决不消失」 |
| **S-18**（较轻项之二） | 「后台无右栏（两栏），与对话/画布的三栏不同」 | 屏 3 建起来时沿用两栏 |
| **对照表** | `/studio/prototype` → UC-7.1 | ⚠ 本束认为该映射不成立，见第三节 |

> ⚠ 另有一条与本束**间接相关但影响大**：**S-12 丢弃清单的 7 类原因是实现者发明的**，
> 且它会成为 Context Pack 的 `omissions[].reason` 枚举。本束的 AI 起草经 Context API 取 Pack（I-27），
> 被截断项进 `omissions`（O-36）——**那套枚举是本束的上游**，请在 `context-pack` 束一并确认。

---

## 七、签核前请重点确认（第 ① 件）

- [ ] **先过「第 ① 件材料缺口」一节（五之二）的 10 条 G-x**，再决定这一件签不签。
      40 张图已在 `ui-preview/canvas/`，覆盖原清单 20 条中的 11 条；
      **G-2（冲突裁决后另一侧已存为版本）/ G-5（回滚二次确认）/ G-7（归档影响面 N）
      三条无图可看**，而它们各自锁着一个已写进契约的判断。
      要么接受「按文字签这三条」，要么退回补图——**不要含糊过去**。
- [ ] **`groupLead` 视角零截图**（G-10）：F107「只有组长确认才写回大脑」是本束价值核心，
      而组长看到的界面一张都没有。确认这是否可接受。
- [ ] **补画的四屏是设计提案，不是档案抽取**：`segment-binding`（蓝本 16 项第 9/10/13）与
      `backflow-member`（本组小树）在原型档案里属**未探明**——ui-prototyper 是**原创**画的。
      签它等于签一套新设计，不是确认既有事实。
- [ ] **画布屏是 mock 壳**（S-17）：确认「核对的是信息架构对不对」这个前提你接受。
- [ ] **缺一整层「规则的可见形态」**（第二节末表 7 项）：确认它们随 F105/F106 一起交付，
      还是明确降级为「本阶段不做」。**含糊过去 = 规则等于不存在。**
- [ ] **原「四块屏未建」已补画**（后台画布模板 / 蓝本 16 项第 9·10·13 / 全场图谱 / 本组小树）：
      改为对着第四节的表核对「补画的这四屏有没有把该有的东西画出来」。
      ⚠ 其中 F101 的**归档确认框**（O-10 ③ 的显式要求）**组件已实现但无开态截图**（G-7）。
      另请确认这四屏的最终归属路由——原型跑在临时的顶层 `/canvas?screen=`，不是产品路由。
- [ ] **`/studio/prototype` ↔ UC-7.1 的映射**：确认它是否成立（本束认为不成立）。
- [ ] **模板选择面板的分类维度**：至今 0 依据，补画原型前需裁决。
