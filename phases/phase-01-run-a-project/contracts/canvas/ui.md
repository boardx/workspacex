# 契约束 `canvas` — 签核①：UI（人看到的界面对不对）

> 🔴 **截图待 ui-prototyper 产出后补。在此之前第 ① 件不具备签核条件。**
>
> `phases/phase-01-run-a-project/ui-preview/` 下**目前只有三份 markdown**
> （`README.md` / `PROTOTYPE-DIGEST.md` / `README-files.md`）和一个 `files/` 目录，
> **没有任何截图**。本文件因此是**骨架**：它列清楚「本束需要哪几块屏、哪些已建成、
> 已建成的真实落点是什么、还缺哪些截图」，但**不能代替看图**。
>
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（权威）。
> 依据 UC：`uc-7-1` R8 · `uc-7-2` R8 · `uc-7-3` R8（画布屏完整抽取）· `uc-7-4` R8

---

## 一、本束需要哪几块屏

| # | 屏 | 期望路由 | 服务哪几个 feature | 现状 |
|---|---|---|---|---|
| **1** | **推演画布**（左栏三区 + 工具条 + 标题区 + 冲突条 + 右栏三区） | `/projects/[projectId]/canvas` | F103 F104 F105 F106 | ✅ **已建成**（⚠ 是 mock 壳，见下） |
| **2** | **Studio · 原型** | `/studio/prototype` | ⚠ 映射存疑，见下 | ✅ 已建成 |
| **3** | **后台 → 画布模板**（模板库列表 + 三段发布流程 + 归档确认框 + 12 类白名单开关区） | `/admin/canvas-templates`（**待定**） | F100 F101 | ❌ **未建**——`/admin` 下 7 个模块无一是它 |
| **4** | **蓝本设计器 · 16 项设计配置的第 9「项目材料」/ 第 10「分组打印素材」/ 第 13「Skill 绑定」** | 未定 | F102 | ❌ **未建**，且原型侧属**未探明**（proto-05/06/08 的未探明清单逐字写着「蓝本 16 项各配置面板」） |
| **5** | **全场图谱 · 事实关系**（节点三态徽标 + `[批量确认]` + 冲突待判定区） | 未定 | F107 | ❌ **未建**（`/brain` 是组织大脑，不是它） |
| **6** | **本组小树**（组级图谱） | 未定 | F107 | ❌ **未建**，且原型侧属**未探明**（档案只探明了全场视图） |
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

## 四、屏 3–6 · 未建的四块（明确的缺口，不是遗漏）

| 屏 | 缺什么 | 为什么它非有不可 |
|---|---|---|
| **后台 → 画布模板** | 模板列表行（名 / 状态 / 结构摘要 / `key vN` / 底层类型 / 可见性 / 被 N 场使用 / 行操作）· 三段发布流程 · **归档确认框的「有 N 个议程环节仍绑定此模板」** · 12 类白名单开关（4 组 × 3） | 归档确认框的 N 是 **O-10 ③ 的显式要求**——没有它，人不知道归档影响谁。⚠ 另：`[＋ 新建画布模板]`（「和 AI 聊出分区结构」）在原型里**只有按钮和一句说明，无对话面板**（原型待补） |
| **蓝本 16 项的第 9/10/13 项配置面板** | 议程环节 ↔ 模板 / 材料 / skill 的**实际配置面** | F102 的入口整个是**推断**的。⚠ 属**未探明**（没点进去），补抽取即可，不是补画 |
| **全场图谱 · 事实关系** | 节点三态徽标 · 来源链（来源组 + 来源模块 + 证据量 + 时间码）· `[批量确认]` 勾选清单 · 「冲突待判定」区与 `[上台讨论]` `[标为不确定]` | **画布 → 图谱的回流动作本身在原型里不存在**——两端都写实，中间没有任何「汇入 / 回流」入口或状态（原型确认缺失） |
| **本组小树**（组级图谱） | 整屏 | 属**未探明**：档案只探明了全场的事实关系与推演流水线 |

⚠ **模板选择面板的分类维度**至今没有依据：原「按阶段浏览：共情/定义/构思/原型/验证」五个词
**全档案 0 命中**，已删除。补画原型前请先裁决（见 `domain.md` [待定 D-c]）。

---

## 五、截图清单（待补 —— ui-prototyper 产出后逐条回填）

| # | 约定文件名 | 内容 | 屏 |
|---|---|---|---|
| 1 | `ui-preview/canvas-main-default.png` | 画布屏默认态（三栏全貌） | 1 |
| 2 | `ui-preview/canvas-left-panel-states.png` | 左栏三区：四组画布四态 + 本项目画布三态 + skill 两种 runMode | 1 |
| 3 | `ui-preview/canvas-conflict-bar.png` | 顶部冲突条 + 三出口 + 两侧改动摘要（`?conflict=on`） | 1 |
| 4 | `ui-preview/canvas-conflict-result.png` | 裁决后：采纳侧生效 + **另一侧已存为版本**的可见证据 | 1 |
| 5 | `ui-preview/canvas-source-view.png` | `[源码]` 视图 + 「有 N 条语法被忽略」提示（**提示条待建**） | 1 |
| 6 | `ui-preview/canvas-ai-panel.png` | 右栏「AI 在这张画布上」+ AVA 角标 + `[看改动]` `[回退]` | 1 |
| 7 | `ui-preview/canvas-ai-rollback-confirm.png` | 回滚二次确认（S-14） | 1 |
| 8 | `ui-preview/canvas-whitespace-hint.png` | **留白提示条 + `[清一格]`**（待建） | 1 |
| 9 | `ui-preview/canvas-no-citation-sticky.png` | **「无来源 · 待补」草稿样式**（待建） | 1 |
| 10 | `ui-preview/canvas-export-rules.png` | 右栏导出规则两条 + `[另存布局快照]` | 1 |
| 11 | `ui-preview/canvas-readonly.png` | 别组画布只读态（写操作全部禁用） | 1 |
| 12 | `ui-preview/canvas-empty.png` | 新建画布只有模板骨架与空分区，**零示例便签** | 1 |
| 13 | `ui-preview/admin-canvas-templates-list.png` | 后台模板库列表（22 个 · 19 已发布 · 2 草稿待审 · 1 已归档） | 3 |
| 14 | `ui-preview/admin-canvas-template-publish.png` | 三段发布流程（草稿 → 试跑 → 发布） | 3 |
| 15 | `ui-preview/admin-canvas-template-archive.png` | **归档确认框 + 「有 N 个议程环节仍绑定此模板」** | 3 |
| 16 | `ui-preview/admin-mermaid-whitelist.png` | 12 类白名单开关（4 组 × 3）+ 常驻说明 | 3 |
| 17 | `ui-preview/blueprint-segment-binding.png` | 议程环节绑定模板与 skill（含两模板上限提示） | 4 |
| 18 | `ui-preview/graph-facts-plenary.png` | 全场图谱事实关系（三态徽标 + 来源链 + `[批量确认]`） | 5 |
| 19 | `ui-preview/graph-conflict-pending.png` | 「冲突待判定」区 + `[上台讨论]` `[标为不确定]`（**不自动择一**） | 5 |
| 20 | `ui-preview/graph-group-tree.png` | 本组小树 | 6 |

> 七态与角色态用已有预览轴取：`?state=loading|empty|invalid|dep-failed|denied|success` ·
> `?as=facilitator|groupLead|member|observer`。⚠ 三个预览开关**在生产构建下不可达**，
> 由 `scripts/verify-prod-gates.sh` 断言——它们不是权限，只是预览手段。

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

- [ ] **截图为零 —— 现在不能签这一件。** 请先让 ui-prototyper 按第五节清单产出，再回来看。
- [ ] **画布屏是 mock 壳**（S-17）：确认「核对的是信息架构对不对」这个前提你接受。
- [ ] **缺一整层「规则的可见形态」**（第二节末表 7 项）：确认它们随 F105/F106 一起交付，
      还是明确降级为「本阶段不做」。**含糊过去 = 规则等于不存在。**
- [ ] **四块屏未建**（后台画布模板 / 蓝本 16 项第 9·10·13 / 全场图谱 / 本组小树）：
      确认它们的归属阶段与承载方，特别是 F101 的**归档确认框**（O-10 ③ 的显式要求）。
- [ ] **`/studio/prototype` ↔ UC-7.1 的映射**：确认它是否成立（本束认为不成立）。
- [ ] **模板选择面板的分类维度**：至今 0 依据，补画原型前需裁决。
