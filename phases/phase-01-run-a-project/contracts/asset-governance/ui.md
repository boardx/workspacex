# 契约束 `asset-governance` — 签核①：UI（界面落点）

> **自检：本文件引用 64 张截图，`ui-preview/asset-governance/` 目录下实际 64 张（N == M == 64，无死链、无漏引、无重复引用）。**
>
> ## 🔴 自检（可机械核对）：**本文件引用 0 张截图，目录尚未产出。**
>
> 目录：`phases/phase-01-run-a-project/ui-preview/asset-governance/`
> **该目录现在不存在** —— ui-prototyper 正在产出中（另一个 agent 的任务）。
>
> ⇒ **`lint-ui-material.mjs` 会对本束报红**，报的是判定④「目录不存在 / 目录里 0 张 png」。
> **这条红是本束的正确状态，不是待修的故障。**
> 已在 `.harness/scripts/ui-material-map.json` 补上本束的映射行——
> 不补的话门控报的是判定③「未声明截图目录」，那是**报错的理由不对**：
> 真实情况是「已声明、材料还没产出」，不是「有人忘了声明」。两者在后果上不同。
>
> ⚠ **本文刻意不写任何**设想的**文件名（占位式文件名）。** 上游 `skills` 束栽过一次同形的坑：
> 它的旧版 ui.md 按约定写了 14 个**设想的**文件名，那 14 条**一张都不存在**、全部是死链
> （留痕在 `contracts/skills/ui.md` 顶部）。
> 本文用**文字**描述该有哪些屏，等 ui-prototyper 产出后再由它或后续 agent 填真实索引。
>
> ## 签核条件的现状
>
> **第 ① 件材料（UI）现在完全不具备签核条件。** 且这不是唯一的阻塞——
> `design-signoff.md` 里另有两条（Q-0 未裁、feature 未生成）。
> **三条必须都解除，才谈得上逐屏评审。**
> **`design-signoff.md` 的 `status` 只能由人类改，agent 不许动。**

> 覆盖 feature 与依据 UC 见 `design-signoff.md`（权威）。
> ⚠ 本文提到的**已建成**路由与文件路径**均已在仓库中核实**（下面每处都给了路径），不是推测。
> 原型出处一律给字符偏移（`[原型 @x.xxM]`，指 `phases/requirements/WorkspaceX Standalone.html`，
> 17MB，**按偏移取证，勿整份读**）。

---

## 一、读本文前必须先分清三个平面

> 不分清，下面每一条「已建成 / 未建 / 原型有」都会被误读。

| 平面 | 在哪 | 是什么 |
|---|---|---|
| **生产屏** | `apps/web/app/admin/`、`app/admin/[module]/`、`app/tpl/`、`app/skill/` … | 本仓**已有**的实现。「已建成 / 未建」说的是**这一平面** |
| **原型屏** | `phases/requirements/WorkspaceX Standalone.html` 的 JS 数据区 | 人类给的设计原型。**它有的，生产平面未必有** |
| **签核材料屏** | `ui-preview/asset-governance/`（**尚未产出**） | ui-prototyper 用 `apps/web` 真实组件 + mock 产出的截图。**签核第 ① 件评审的是这一平面** |

⚠ 本束的特殊之处：**它横切六类资产，而六类资产各自的屏分散在四个已签核束的材料里**
（`ui-preview/skill-v2/` 59 张、`ui-preview/agent-runtime-v2/`、`ui-preview/canvas-v2/`、
`ui-preview/tpl-v2/`）。
**本束的截图目录只应包含「公共机制」的屏，不应重复截六类资产各自的管理屏**
——重复截 = 让人类为同一张图签两次名，且两份会漂移。
判据同 `domain.md` 第零节：**换一类资产还成立的屏，才属于本束。**

---

## 二、本束需要哪几块屏（八份 UC → 屏清单）

> 每一屏都注明：原型出处 · 生产平面现状 · 该由 ui-prototyper 画什么。
> **⚠ 未产出的条目一律写成文字，不写成 `.png`**（写了会被门控当死链报出来）。

### 屏 1 · 后台外壳与左栏 IA（`uc-23-8`）—— **优先级最高**

| | |
|---|---|
| 原型 | `AD_META` 九项 `[原型 @16.6703M]`；组织头部与额度条 `[人类截图 2026-07-30]` |
| 生产平面 | **部分已建成**：`apps/web/app/admin/page.tsx`（总览）· `app/admin/[module]/page.tsx`（壳）· `lib/mock/admin.ts` 的 `ADMIN_NAV` / `ORG_HEADER` · `AdminNav` 组件 |
| ❌ 缺陷 | 左栏「AI 能力」组**只有 4 项**（agent/skill/model/mcp），**缺画布模板、缺项目蓝本**；`/admin/blueprint` **是 404**（蓝本设计器在独立路由 `/tpl`） |
| 该画 | ① **补齐后的六项左栏**（分组按 **Q-11** 裁决，未裁前请画出**三个候选各一张**供人类比选）；② 某类计数为 0 的态；③ 某类计数取不到显「—」的态；④ 无权限态 |

⚠ **这一屏是人类原始投诉（「为什么在管理后台看不到项目蓝本」）的正面回应**，
也是本束存在的理由。它应当是 ui-prototyper 的第一件产出。

### 屏 2 · 三步向导第 1 步「来源」（`uc-23-1`）

| | |
|---|---|
| 原型 | `[原型 @16.549–16.559M]`：向导壳（`1 来源 / 2 配置 / 3 治理与发布` + `草稿自动保存 · 14:52` + `[存为草稿]`）、**四条来源路径**、上传/地址区、社区源目录表 |
| 另一入口 | 「新建 Skill」页的**三条路径**版本 `[原型 @15.688–15.692M]` —— ⚠ 与向导第 1 步**不一致**（三条 vs 四条、市场三源 vs 源目录四源），哪个是最终形态 → `[待确认]` |
| 生产平面 | **未建** |
| 该画 | 四条来源卡（含角标 `最慢 · 最可控` / `需过落地检查六道关` / `继承原有权限与负责人` / `检测到 3 个候选`）· 每条路径展开后的输入区 · 类型识别失败态（E1）· 类型不匹配态（E2）· 源不可用态（E4） |

⚠ **「从实际用法沉淀」这条路径在人类给的截图里没有**，是从原型里挖出来的
（`[原型 @16.553M]`，带三条具名候选：`14×` 提示被复制到 14 个线程 / `6×` 手搓相同画布 /
`9×` Scout 被临时授予同一组 MCP 工具）。**画的时候不要漏掉它。**

### 屏 3 · 三步向导第 2 步「落地检查六道关」（`uc-23-2`）

| | |
|---|---|
| 原型 | `[原型 @16.559–16.566M]`：六关列表 + 进度 `4 / 6` + 三级结论 + 查重分歧并排面板 + 原文/改写 diff |
| 生产平面 | **未建** |
| 该画 | 六关列表（状态图标 `✓`/`!`/`×`/`·`）· 第 04 关并排裁决面板（三出口）· 第 03 关 diff 面板 |
| ❌ 原型缺态，**必须补** | 01/02 关的**失败态** · 05 关的**失败与超时态** · 第 04 关的**多对重合**（原型只画 1v1）· 06 关的**锁定态**（**Q-4**：原型图标 `✓` 标签「通过」，正文却写「待第 3、4 关处理完后开放」，且 `4/6` 与之相加对不上）· `提示` 级的「标为可接受」出口（原型只画了 `[采纳改写]`） |

### 屏 4 · 三步向导第 3 步「治理与发布」（`uc-23-4`）—— **本束的核心屏**

| | |
|---|---|
| 原型 | `[原型 @16.611–16.616M]`：五块（可见范围 / 谁能改 / 责任与复核 / 发布前检查 / 发布方式） |
| 生产平面 | **未建** |
| 该画 | 五块完整态 · **三项未填态**（原型三项全已填，没画未填）· 有红色项时「发布」禁用态 · 「全组织」触发领域负责人联签的态 |
| 🔴 **必须画六份** | 「这一步**六种资产完全一样**」是本束的核心断言。**只画 Agent 那一版无法验证它。** 请对六类资产**各出一张第 3 步**，让人类直接看出哪些一样、哪些不一样（**Q-1b**：原型的「发布前检查」第一条「四栏配置完整（人格 · 能力 · 模型 · 边界）」是 **Agent 专属**；代码侧 `VisibilityScope` 只覆盖 3/6，MCP 走另一套 `McpAuthScope`，模型与蓝本连字段都没有） |

### 屏 5 · 资产目录编辑器（`uc-23-3`）

| | |
|---|---|
| 原型 | `[原型 @15.704–15.712M]`（编辑器界面）· `[原型 @16.653M]`（`AG_FILES`/`AG_TREE`）· `[原型 @16.668M]`（`SK_FILES`/`SK_TREE`）· `[原型 @16.6512M]`（`FILE_BADGE`/`fileNode`） |
| 生产平面 | **未建**（`app/skill/` 是 `skills` 束的原型平面，不含文件树编辑器） |
| 该画 | Skill 编辑器（树 5 文件 3 目录）· Agent 编辑器（树 5 文件 3 目录）· 编辑/预览双模 · 未保存指示 |
| ❌ 原型缺态，**必须补** | **只读态**（不在 `editableBy` 内）· 新建文件/文件夹入口（文案说「随时新建」但**界面上没有入口**）· 右键菜单 · 非 Markdown 文件的预览 · 未保存离开拦截 · frontmatter 报错态 |
| ⚠ 适用范围 | 原型**只对 skill / agent** 给了目录形态；**其余四类是不是目录 `[待确认]`**。画之前先确认，别替人类决定 |

### 屏 6 · 试跑台（`uc-23-5`）

| | |
|---|---|
| 原型 | `[原型 @15.660–15.673M]`（Agent 版）· `[原型 @15.694–15.705M]`（Skill 版）· `[原型 @16.581M]`（Agent 组装页内嵌的沙箱小结，`!` 级发现的来源） |
| 生产平面 | **未建** |
| 该画 | 左栏三块（测试场景三选 / 输入材料 / 运行参数）· 右栏四块（成本条 / 执行轨迹 / 输出 / 自动校验）· 底部回归用例区 |
| ❌ 原型缺态，**必须补** | 自动校验 **FAIL** 态（原型四条全 PASS）· 试跑失败/超时 · `[跑全部用例]` 的结果聚合视图 · `[存为回归用例]` 的「期望怎么填」表单 · **其余四类资产的试跑台**（原型只有 Agent 与 Skill） |
| ⚠ | 整屏依赖 **Q-0**（D-06 逐字「phase-1 不做沙箱、不执行任意代码」） |

### 屏 7 · 复核到期与降级（`uc-23-6`）—— **原型 0 命中，需从零设计**

| | |
|---|---|
| 原型 | **只有规则文案**（`[原型 @16.613M]`，在第 3 步「责任与复核」块下方）。**没有任何运行态界面** |
| 旁证（**知识条目**侧的同形界面，可参考但不可直接搬） | 过期洞察卡 `[原型 @15.270M]` · 后台指标 `过期滞留 >30 天 · 14 · 上限 10 · 需派复核` `[原型 @16.226M]` · 消息头标记 `待复核 3` `[原型 @16.310M]` |
| 生产平面 | **未建** |
| 该画（**全新**） | `待复核` 资产列表/筛选 · **调用时的提示**（出现在哪、给谁看——原型 0 命中）· 复核表单 · 降级后负责人视角 · **无主资产视图**（`uc-23-6` E1：负责人离职 ⇒ 降级终态「仅负责人可见」变成「谁都不可见」） |

### 屏 8 · 社区源目录（`uc-23-7`）

| | |
|---|---|
| 原型 | `[原型 @16.555–16.556M]`：源目录表（表头 `来源 / 类型 / 可用 / 上次同步`，四行，含 `Codex 社区 · 失败 · 凭据过期 · [修复]`）· `[＋ 添加源]` |
| 生产平面 | **未建** |
| 该画 | 源目录表 · 失败行与 `[修复]` · `[＋ 添加源]` 表单（**原型 0 命中，需设计**）· 源的停用/删除（同样 0 命中） |
| 🔴 **不存在的屏** | **市场目录浏览屏**。六处 `[浏览]` 按钮**全部没有 click handler**（`[原型 @15.691–15.692M · 16.556–16.558M]`），且 `1,842 个` 只是一个计数、**没有任何条目结构**。⇒ 人类需求「导入市场上主流使用的 agents 和 skills」最直接的那一屏**从来没有被设计过** → **Q-5** |

---

## 三、截图索引

**（空 —— 目录尚未产出。）**

ui-prototyper 产出后，此处填**真实**索引（文件名逐字、可点开、与目录里的 png 集合**双向相等**）。
在那之前**这里必须是空的**——填设想的文件名就是 `skills` 束栽过的那 14 条死链。

---

## 四、第 ① 件材料的缺口（签核时须连同裁决）

> 分三类。签核时对每一条给出：**接受 / 要求补画 / 明确移出 phase-1**。

### A 类 · 原型有、但**自相矛盾**，必须先裁再画

| # | 缺口 | 待裁 |
|---|---|---|
| A-1 | 六道关第 06 关：图标 `✓` + 标签「通过」，正文却写「待第 3、4 关处理完后开放」；顶部 `4/6` 与之相加对不上 | **Q-4** |
| A-2 | 「新建 Skill」页三条路径 vs 向导第 1 步四条路径；市场三源 vs 源目录四源 | Q-2 / Q-5 |
| A-3 | Codex 社区在市场三源里显示正常（`已同步 12`），在源目录表里显示 `失败 · 凭据过期` | `uc-23-7` R3 待确认 |
| A-4 | 后台左栏 IA 三方不一致（原型/截图 · 已建成 `ADMIN_NAV` · F16「我的本地」原型 0 命中） | **Q-11** |

### B 类 · 原型有 happy path、**缺全部异常态**（本束最大的一类）

八份 UC 的 R4 共 **60 余条**异常流程，**原型上一条都没有**：
六道关没有一关是失败态、试跑台四条自动校验全 PASS、第 3 步三项治理配置全已填。
⇒ **屏 3 / 4 / 5 / 6 各自的「❌ 原型缺态」行**（第二节），逐条要求补画。

⚠ 上游 `skills` 束的 `usecases.md` 顶部已经为同一件事留了警告：
「已建成的 `/admin/skill` 是 happy path 演示……六份 UC 里 41 条异常流程在界面上一条都没有。
**别继承这个缺陷。**」本束是第二次撞到同一个形状。

### C 类 · **完全没有屏**，需从零设计

| # | 缺口 | 影响 |
|---|---|---|
| C-1 | **市场目录浏览屏**（六处 `[浏览]` 无 handler、无条目结构） | 🔴 **人类需求的正题**。Q-5 风险条：一旦要画会连带出排序/筛选/评分/许可证/作者信誉一整套，规模可能超过本束其余所有屏之和 |
| C-2 | **复核到期与降级的全部运行态**（屏 7） | 🔴 `uc-23-6` 整份 UC 无界面依据 |
| C-3 | `[＋ 添加源]` 表单、`[修复]` 认证流程、源的停用/删除 | `uc-23-7` |
| C-4 | 六类资产**各自的第 3 步**（原型只有 Agent 一版） | 🔴 无法验证「六种资产完全一样」这条核心断言 |
| C-5 | 目录形态对**另外四类资产**是否适用 | `uc-23-3` 整组端口的适用范围未知 |

### D 类 · 原型上**存在但点了没反应**（Q-5，共六处）

`[浏览]` ×6 · `[＋ 添加源]` · `[修复]` · 第 04 关三个出口 · `[采纳改写]` ·
`[存为回归用例]` / `[重跑]`。

⚠ 其中**只有 C-1（市场目录屏）是真缺设计**；其余五处的**结果**在原型里都有明确文案
（三个出口各自写清了后果、diff 有前后文），补的是**接线不是设计**。
签核时请区分这两者——Q-5 推荐方案 B 正是基于这个区分。

---

## 五、给 ui-prototyper 的优先级（**产出顺序建议**）

1. **屏 1（后台左栏 IA）** —— 人类原始投诉的正面回应；且 Q-11 未裁，请画**三个候选各一张**。
2. **屏 4（第 3 步治理与发布）× 六类资产** —— 唯一能验证「六种资产完全一样」的材料（C-4）。
3. **屏 5（编辑器）** —— 人类原话的另一半「项目文件的浏览和编辑」；且 Q-0 方案 C 下它留在 phase-1。
4. **屏 7（复核到期与降级）** —— 完全无依据，画出来才知道缺什么（C-2）。
5. 屏 2 / 3 / 6 / 8 —— **依赖 Q-0**，未裁前不必投入。

⚠ **不要重复截六类资产各自的管理屏**（那些在 `skill-v2` / `agent-runtime-v2` /
`canvas-v2` / `tpl-v2` 四个已签核束的材料里）。判据见第一节末。

## 截图索引（机械生成，与目录逐张相等）

> 本文件引用 **64** 张，`ui-preview/asset-governance/` 实存 **64** 张。
> 复核：`node .harness/scripts/lint-ui-material.mjs`（双向集合相等，死链与孤图都会红）。

### agent-editor（7 张）

- `ui-preview/asset-governance/uc-ag-agent-editor-default.png`
- `ui-preview/asset-governance/uc-ag-agent-editor-denied.png`
- `ui-preview/asset-governance/uc-ag-agent-editor-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-agent-editor-empty.png`
- `ui-preview/asset-governance/uc-ag-agent-editor-invalid.png`
- `ui-preview/asset-governance/uc-ag-agent-editor-loading.png`
- `ui-preview/asset-governance/uc-ag-agent-editor-success.png`

### blueprint（7 张）

- `ui-preview/asset-governance/uc-ag-blueprint-default.png`
- `ui-preview/asset-governance/uc-ag-blueprint-denied.png`
- `ui-preview/asset-governance/uc-ag-blueprint-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-blueprint-empty.png`
- `ui-preview/asset-governance/uc-ag-blueprint-invalid.png`
- `ui-preview/asset-governance/uc-ag-blueprint-loading.png`
- `ui-preview/asset-governance/uc-ag-blueprint-success.png`

### dashboard（11 张）

- `ui-preview/asset-governance/uc-ag-dashboard-default.png`
- `ui-preview/asset-governance/uc-ag-dashboard-denied.png`
- `ui-preview/asset-governance/uc-ag-dashboard-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-dashboard-empty.png`
- `ui-preview/asset-governance/uc-ag-dashboard-invalid.png`
- `ui-preview/asset-governance/uc-ag-dashboard-loading.png`
- `ui-preview/asset-governance/uc-ag-dashboard-success.png`
- `ui-preview/asset-governance/uc-ag-dashboard-view-maintainer.png`
- `ui-preview/asset-governance/uc-ag-dashboard-view-member.png`
- `ui-preview/asset-governance/uc-ag-dashboard-view-owner.png`
- `ui-preview/asset-governance/uc-ag-dashboard-view-reviewer.png`

### gates（7 张）

- `ui-preview/asset-governance/uc-ag-gates-default.png`
- `ui-preview/asset-governance/uc-ag-gates-denied.png`
- `ui-preview/asset-governance/uc-ag-gates-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-gates-empty.png`
- `ui-preview/asset-governance/uc-ag-gates-invalid.png`
- `ui-preview/asset-governance/uc-ag-gates-loading.png`
- `ui-preview/asset-governance/uc-ag-gates-success.png`

### governance（11 张）

- `ui-preview/asset-governance/uc-ag-governance-default.png`
- `ui-preview/asset-governance/uc-ag-governance-denied.png`
- `ui-preview/asset-governance/uc-ag-governance-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-governance-empty.png`
- `ui-preview/asset-governance/uc-ag-governance-invalid.png`
- `ui-preview/asset-governance/uc-ag-governance-loading.png`
- `ui-preview/asset-governance/uc-ag-governance-success.png`
- `ui-preview/asset-governance/uc-ag-governance-view-maintainer.png`
- `ui-preview/asset-governance/uc-ag-governance-view-member.png`
- `ui-preview/asset-governance/uc-ag-governance-view-owner.png`
- `ui-preview/asset-governance/uc-ag-governance-view-reviewer.png`

### newskill（7 张）

- `ui-preview/asset-governance/uc-ag-newskill-default.png`
- `ui-preview/asset-governance/uc-ag-newskill-denied.png`
- `ui-preview/asset-governance/uc-ag-newskill-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-newskill-empty.png`
- `ui-preview/asset-governance/uc-ag-newskill-invalid.png`
- `ui-preview/asset-governance/uc-ag-newskill-loading.png`
- `ui-preview/asset-governance/uc-ag-newskill-success.png`

### skill-editor（7 张）

- `ui-preview/asset-governance/uc-ag-skill-editor-default.png`
- `ui-preview/asset-governance/uc-ag-skill-editor-denied.png`
- `ui-preview/asset-governance/uc-ag-skill-editor-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-skill-editor-empty.png`
- `ui-preview/asset-governance/uc-ag-skill-editor-invalid.png`
- `ui-preview/asset-governance/uc-ag-skill-editor-loading.png`
- `ui-preview/asset-governance/uc-ag-skill-editor-success.png`

### tryrun（7 张）

- `ui-preview/asset-governance/uc-ag-tryrun-default.png`
- `ui-preview/asset-governance/uc-ag-tryrun-denied.png`
- `ui-preview/asset-governance/uc-ag-tryrun-dep-failed.png`
- `ui-preview/asset-governance/uc-ag-tryrun-empty.png`
- `ui-preview/asset-governance/uc-ag-tryrun-invalid.png`
- `ui-preview/asset-governance/uc-ag-tryrun-loading.png`
- `ui-preview/asset-governance/uc-ag-tryrun-success.png`

