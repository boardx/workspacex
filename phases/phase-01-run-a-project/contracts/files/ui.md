# 契约束 `files` — ① UI（人看到的界面对不对）

> **自检（2026-07-30 机械核对）：本文件引用 15 张截图，目录 `ui-preview/files/` 下实际 15 张。N == M == 15，逐张核对全部真实存在，无死链。**
> 索引表（第三·一节）内**每张恰好一行、不重复**；正文另有两处**交叉引用**（`uc-22-1-browser-default.png`、`uc-22-4-trash-compliance.png`）指向索引里已有的图，不是第二条索引项。
> 另有 **1 条未产出条目**（`uc-22-3` 物化失败态），它**不计入 N**——它没有文件名可引，见第三·三节「第 ① 件材料缺口」。
> 复核命令（**唯一实现**，别再手写 grep —— 手写的那版正则不认中文文件名，会假绿）：
> ```bash
> node .harness/scripts/lint-ui-material.mjs
> ```

> phase-01 是 `has_ui: true` 阶段，本文件由 `requiredBundleFiles()` 强制存在，缺则门控红。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（**权威**）。

## 零、签核条件现状（**先读这一段**）

⚠ **本模块原型确认缺失**（不是「未探明」）。四份 UC 的 R8 判定一致：
项目工作台的 **7 个标签**与项目设置的 **6 个子标签**均已完整抽取
（`proto-05-deep-layer.md` / `proto-08-project-settings.md`），
其中**没有任何**文件浏览 / 目录树 / 批量下载 / 版本列表 / 删除确认 / 待删除队列的界面。
原型只给了四处**计数钩子**（材料准备「9 已入库材料」/ 蓝本第 9 项「项目材料 9 件」/
第 10 项「分组打印素材 4 件」/ 对话右栏「材料 12」），**都只有数字，都没有下钻目标**。

⇒ **本束界面的每一处都是原创设计**，没有「原型就长这样」可以援引。

**截图现状（2026-07-30 更新，并行 ui-prototyper 已 commit `8e8282a`）**：
`ui-preview/files/` 下**实有 15 张 PNG + 一份 `README.md`**，
用真实组件跑 dev server（视口 1360×900，2×）抓取，**不是设计稿**，抓图时 0 条真实控制台报错。
**删除确认与待删除队列（含合规视角的部分失败、组员视角的无权限投影）的截图已补齐。**

⚠ **数字更正（本次核对）**：此处曾写「14 张」、第三节表头曾写「已有（14 张）」，
而该表实际列了 15 行、目录里也实有 15 个文件——**是计数写错，不是少了一张**。
`design-signoff.md` ① 节曾写「12 张」，同属过时数字。三处已收敛为**一处**：
截图索引只在本文件第三节声明，`design-signoff.md` 只指向本文件、不再复述数目。

⚠ **1 个态未产出截图**：`uc-22-3` 的「物化失败」行态——**因为该态尚未实现**（缺口 G-3），
补图前须先补实现。它没有文件可引，故不在索引里占行，见第三·三节。
⚠ 另需注意原型 agent 自陈的「没做/做不到」（本文件第七节）：
截图里的九态是**静态陈列九个例子，不是真的状态机流转**；预览器是占位、搜索筛选不真过滤。
**看图确认的是信息架构与文案，不是功能已实现。**

---

## 一、本束需要哪几块屏

路由入口：**`/projects/[projectId]/files`**（dev: `http://localhost:3100/projects/demo/files`）
代码：`apps/web/app/projects/[projectId]/files/page.tsx` + `apps/web/components/files/*` + `apps/web/lib/mock/files.ts`
屏切换：`?screen=`（`files-screen-switch`）；视角 `?as=`；七态 `?state=`。
⚠ 三个预览开关在生产构建下不可达（`scripts/verify-prod-gates.sh` 已断言）——**它们是预览手段，不是权限**。

| # | 屏 | `?screen=` | 组件 | 服务哪些 feature | 现状 |
|---|---|---|---|---|---|
| ① | 浏览器主屏（树 + 列表 + 预览三栏） | `browser` | `files-tree.tsx` `files-list.tsx` `file-preview.tsx` `files-app.tsx` | F31 F32 F33 F34 F41 F42 F43 | **已建成** |
| ② | 上传弹层 | `upload` | `upload-modal.tsx` | F35 F37 F39 | **已建成** |
| ③ | 摄取进度抽屉（九态） | `ingestion` | `ingestion-drawer.tsx` | F36 F37 F39 F40 | **已建成** |
| ④ | 人工复核（`REVIEW_PENDING`） | `review` | `review-panel.tsx` `use-review-state.ts` | F39 F42 F43 | **已建成** |
| ⑤ | 版本列表 + 派生物下钻 | `versions` | `version-drawer.tsx` | F44 | **已建成** |
| ⑥ | 删除确认 + 影响面预览 | `delete` | `delete-dialog.tsx` | F45 F47 | **已建成**（截图已补，见三·一③） |
| ⑦ | 待删除队列（合规） | `trash` | `trash-queue.tsx` | F45 F46 F47 | **已建成**（截图已补，见三·一③） |
| ⑧ | 物化的落点（**无独立屏**） | — | 树的七类系统来源节点 + `synthesized` 角标 | F40 F41 F42 F43 | 落在 ① 内；⚠ **「物化失败」行态未建**，见缺口 G-3 |
| ⑨ | 恶意文件留痕的处置视图 | — | — | F35 | ⚠ **未建**，见缺口 G-4 |
| ⑩ | 改名入口 | — | — | F34（V11 契约态） | ⚠ **未建**，见缺口 G-5 |

状态外壳：`StateShell` 的七态（默认/加载/空/校验失败/依赖失败/无权限/成功）作用在主屏中列表区，
按 D-36 统一实现，签核时豁免逐屏设计。
⚠ **唯一例外**：UC-22.4 R8 明写「**部分失败**」态不在七种必现态里，**必须逐屏设计**——
它已实现为 `files-trash-partial`，**截图见 `ui-preview/files/uc-22-4-trash-compliance.png`**（该图内含部分失败区）。

---

## 二、真实 `data-testid`（从 `apps/web/components/files/` 逐文件核对，非杜撰）

### ① 浏览器主屏
- 壳与工具条（`files-app.tsx`）：`files-screen-switch` `files-role-switch` `files-search`
  `files-filters` `files-filter` `files-filter-clear` `files-view-toggle` `files-view-tree`
  `files-view-list` `files-tree-view` `files-upload` `files-export-zip` `files-open-ingestion`
  `files-preview-controls` `files-toast` `files-toast-close`
- 批量操作条：`files-batch-bar` `files-batch-clear` `files-batch-download` `files-batch-zip`
  `files-batch-delete` `files-batch-confidential` `files-batch-segment`
  `files-batch-segment-menu` `files-batch-segment-option`
- 树（`files-tree.tsx`）：`files-tree` `files-tree-all` `files-tree-source` `files-tree-segment`
  `files-tree-node` `files-tree-toggle` `files-tree-empty-source` `files-tree-upload`
- 列表（`files-list.tsx`）：`files-list` `files-row` `files-row-check` `files-row-version` `files-row-agent`
- 角标（`status.tsx`）：`files-origin-badge` `files-synthesized-badge` `files-confidential-badge`
  `files-ingest-badge` `files-integrity-badge`
- 预览（`file-preview.tsx`）：`files-preview` `files-preview-name` `files-preview-pdf`
  `files-preview-image` `files-preview-audio` `files-preview-text` `files-preview-jsonl`
  `files-preview-csv` `files-preview-none` `files-preview-download` `files-preview-versions`
  `files-preview-delete` `files-preview-sourceref` `files-preview-synth-banner`

### ② 上传弹层（`upload-modal.tsx`）
`files-upload-dropzone` `files-upload-precheck-row` `files-upload-confidential`
`files-upload-visibility` `files-upload-visibility-option` `files-upload-duplicate`
`files-upload-duplicate-choice` `files-upload-use-existing` `files-upload-as-new`
`files-upload-submit` `files-upload-cancel`

### ③ 摄取抽屉（`ingestion-drawer.tsx`）
`files-ingestion-run` `files-ingestion-ladder` `files-ingestion-legend-row`
`files-ingestion-detail` `files-ingestion-detail-panel` `files-ingestion-failure`
`files-ingestion-retry` `files-ingestion-retry-status` `files-ingestion-manual`
`files-ingestion-manual-status` `files-ingestion-duplicate` `files-ingestion-review`
`files-ingestion-review-status` `files-ingestion-accept` `files-ingestion-reject`

### ④ 人工复核（`review-panel.tsx`）
`files-review-panel` `files-review-queue-item` `files-review-detail` `files-review-pii`
`files-review-synth` `files-review-reason` `files-review-note` `files-review-note-required`
`files-review-batch-note` `files-review-accept` `files-review-reject` `files-review-resolved`

### ⑤ 版本与派生物（`version-drawer.tsx`）
`files-version-row` `files-version-current` `files-version-download` `files-version-copy-sha`
`files-version-upload-new` `files-version-upload-dropzone` `files-derived-row` `files-derived-download`

### ⑥ 删除确认（`delete-dialog.tsx`）
`files-delete-stats` `files-delete-cascade-row` `files-delete-claim` `files-delete-report`
`files-delete-exported` `files-delete-legalhold` `files-delete-reason`
`files-delete-confirm` `files-delete-cancel`

### ⑦ 待删除队列（`trash-queue.tsx`）
`files-trash-queue` `files-trash-task` `files-trash-steps` `files-trash-step`
`files-trash-partial` `files-trash-partial-badge` `files-trash-retry` `files-trash-overdue`
`files-trash-legalhold` `files-trash-release-hold` `files-trash-hold-released`
`files-trash-receipt` `files-trash-receipt-body` `files-trash-receipt-resend`
`files-trash-revoke` `files-trash-revoked` `files-trash-denied`

⚠ `files-trash-revoke` / `files-trash-revoked` 对应的是 **[待定 T-5]**「宽限期内能否撤销删除」——
**界面已经把它做出来了，而这条尚未裁决**。若人类裁定不提供撤销，这两个 testid 与
`revokeDeletion` 用例须一并删除（见 `coverage.md` 反向检查）。

---

## 三、截图清单

### 三·一 已产出（**15 张，= 目录实存数**）

路径写法**统一为 `ui-preview/files/<文件名>.png`**（相对本 phase 目录，即
`phases/phase-01-run-a-project/` 之下）。此前混用绝对/相对两种写法，已收敛为一种。
「视角」= `?as=` 取值；「态」= `?state=` 取值。

**① 浏览器主屏 · UC-22.1（8 张，覆盖七态 + 观察者投影）**

| 文件 | 态 | 视角 | 服务 feature |
|---|---|---|---|
| `ui-preview/files/uc-22-1-browser-default.png` | `default` — 三栏：来源树 / 列表 / 预览 | facilitator | F31 F32 F44 |
| `ui-preview/files/uc-22-1-browser-loading.png` | `loading` — skeleton | facilitator | F34 |
| `ui-preview/files/uc-22-1-browser-empty.png` | `empty` — 八来源节点 count:0（V5·22-1 / A5） | facilitator | F34 |
| `ui-preview/files/uc-22-1-browser-invalid.png` | `invalid` — 导出 1,240 > 上限 1,000（E2） | facilitator | F33 F34 |
| `ui-preview/files/uc-22-1-browser-dep-failed.png` | `dep-failed` — 对象存储不可用，预览/下载置灰（V7·22-1） | facilitator | F34 |
| `ui-preview/files/uc-22-1-browser-denied.png` | `denied` — 只见已发布已脱敏（V6·22-1 / V11·22-3） | observer | F31 F34 |
| `ui-preview/files/uc-22-1-browser-success.png` | `success` — 导出包已生成 | facilitator | F33 |
| `ui-preview/files/uc-22-1-browser-observer.png` | `default`（**不是** `denied`）— 视角投影而非拒绝（A2·22-1） | observer | F31 |

**② 上传与摄取 · UC-22.2（3 张）**

| 文件 | 屏 / 态 | 视角 | 服务 feature |
|---|---|---|---|
| `ui-preview/files/uc-22-2-upload.png` | 上传弹层 `default` — 白名单预检 / 机密勾选 / 可见性 / 幂等二选一 | facilitator | F35 F37 |
| `ui-preview/files/uc-22-2-ingestion-ladder.png` | 摄取抽屉 `default` — 九态阶梯 + 每态出口 + 失败三段式 | facilitator | F36 F37 F40 |
| `ui-preview/files/uc-22-2-review-pending.png` | 人工复核 `default` — `REVIEW_PENDING` 接受/拒绝 | facilitator | F39 F42 |

**③ 版本、派生物与删除 · UC-22.4（4 张）**

| 文件 | 屏 / 态 | 视角 | 服务 feature |
|---|---|---|---|
| `ui-preview/files/uc-22-4-versions.png` | 版本抽屉 `default` — 版本列表 + 派生物（各带 `derived_from`） | facilitator | F44 |
| `ui-preview/files/uc-22-4-delete-impact.png` | 删除确认 `default` — 六类级联 + 已出域警示 + 二次确认 | facilitator | F45 F47 |
| `ui-preview/files/uc-22-4-trash-compliance.png` | 待删除队列 — 五步 + SLA + legal hold + **部分失败**（R8 唯一要求逐屏设计的态） | compliance（⚠ 临时投影，S-02） | F46 |
| `ui-preview/files/uc-22-4-trash-denied.png` | 待删除队列 `denied` — 无权限投影 | member | F46 |

**④ UC-22.3（0 张，且是设计意图而非遗漏）**
UC-22.3 **没有独立屏**（R8：界面就是 UC-22.1 的浏览器）。它的落点在
`ui-preview/files/uc-22-1-browser-default.png` 的左树七类系统节点 + 列表的 `物化器 · xxx`
上传者标记 + `synthesized` 角标。对应 F41 F42 F43。
⚠ 但**「物化失败」态不在其中**，见三·三。

小计：8 + 3 + 4 + 0 = **15 张，与目录实存 15 个 `.png` 一一对应，无遗漏、无重复、无死链。**

### 三·二 目录里那份 `README.md`

`ui-preview/files/README.md` 是原型 agent 的 sign-off 说明（六节）。它**不是截图**，不计入 15。
本文件第四节的 S-xx / README-files 条目、第五节缺口、下面的「没做/做不到」都从它摘录。
⚠ 它对同一批截图另有一份表（第一节，含 UC 节次列）——**那是溯源视图，不是第二份索引**：
新增/删除截图只改本文件三·一，README 是原型 agent 当时的产出记录，不随后续修订。

### 三·三 **第 ① 件材料缺口（未产出截图，K = 1）**

⚠ 与第五节的 G-x 是**两类不同性质的东西**：这里是**没画图**，第五节是**没实现**。
本节只收「设想过、但目录里没有对应文件」的条目，**不写假路径**——曾被引用的
`uc-22-3-materialize-failed` **从未存在**，现改写为缺口条目：

| # | 缺口条目 | 关联 |
|---|---|---|
| **K-1** | ⚠ **未产出：UC-22.3「物化失败」行态（业务对象存在但没变成文件）—— 该屏尚未画** | 根因是 **G-3 🔴 该态尚未实现**，补图前须先补实现。UC-22.3 自称静默失败是它最危险的缺陷模式，而它恰好无法被表达（V9·22-3 明写「不存在业务对象存在但浏览器什么都没有的静默态」） |

另有三处**实现未建、因而也无图可截**，它们已在第五节以 G-x 记录，不在此重复列为 K：
G-4（恶意文件留痕处置视图）、G-5（改名入口）、以及 ⑨⑩ 两屏。
⇒ 一旦其中任一实现落地，**须同时**补图、补进三·一、并把三·三与顶部自检的数字一起改。

### ⚠ 看图时必须同时知道的「没做/做不到」（原型 agent 自陈，README 第五节）

**全部是 mock、零后端**：搜索框不真过滤、下载/导出只弹乐观 toast、上传不真跑摄取、删除不真删；
**九态是静态陈列九个例子，不是真的状态机流转**；五类预览器只有类型说明 + 骨架占位，
真实 PDF 分页 / 音频波形 / CSV 表格未做；批量 zip 的 round-trip（F33）验收面在后端，mock 演示不了；
prompt injection 防线（F38）与 `evidencePolicy` 服务端强制（F42）是后端不变量，界面上不可见；
只抓了 1360 宽桌面图，375/768 档未抓；树视图只有联动提示占位。

⇒ **签核第 ① 件确认的是信息架构、文案与状态穷举，不是「功能已经能跑」。**

---

## 四、ui-preview 已知缺口中与本束相关的（S-xx 摘录）

来源：`ui-preview/README.md`（S-01…S-18）与 `ui-preview/README-files.md`（第三、四、七节）。
它们是**「UC 没写、由实现者替 UC 做了的决定」**——签核时逐条确认。

| 编号 | 内容 | 为什么它影响本束的契约 |
|---|---|---|
| 🔴 **S-02** | **合规负责人不在角色模型里**。`identity.ts` 的项目角色**恒为四值**（裁决 O-03），实现用 `?as=compliance` 临时投影 | 本束的待删除队列 / legal hold / 回执 / 恶意留痕处置**全部**要求这个角色。**这动摇了 O-03**。两条出路：① 补第五个项目角色（推翻 O-03）；② 归到组织角色层。⇒ `coverage.md` 缺口 15，V13·22-4 在定案前无法验收 |
| 🔴 **S-05** | 撤回五步的 **02「≤5 分钟」/ 03「即时」两个 SLA 是按 D-15 推断补的**，档案只给了 01/04/05 | 本束 N-18 的 300s 硬 SLA 直接建立在这个推断上。**合规风险最高的一处**，须合规确认或给真实 SLA |
| **S-14** | 「文件删除：六类级联逐条 + legal hold 拦截 + **强制填原因（≥4 字）才可删**」——这套二次确认语义是实现补的，UC 只给了一个按钮 | `requestDeletion` 的 `reason: string(>=4)` 与 `confirmedImpact: true` 两个入参**来自界面而非 UC**。签核即把它们升为契约 |
| **S-15** | **摄取九态的表达方式**：阶梯进度条 + 失败三段式（在哪步/为什么/能做什么）+ 常驻九态图例，刻意反「转圈圈」 | 对应 N-8「非终态 `exits` 非空」。图例是否让**非技术的项目负责人**看懂「卡在哪、为什么、能做什么」是签核重点 |
| **S-12** | 丢弃清单 7 类原因是**发明的**词汇，会成为 Context Pack `omissions[].reason` 枚举 | 与本束 N-3（`sourceType` 封闭枚举）同类风险：**发明的枚举一旦被消费就变成承重结构**。请一并确认枚举收敛纪律 |
| **README-files 三·1** | 来源树用「先展开箭头 + 再点节点名」两段式（箭头管展开、节点名管筛选联动）；默认展开 `文件`/`访谈` | UC-22.1 R8 只说「左树 = 来源类型 → agenda_segment」，没说展开与选中是否同一动作 |
| **README-files 三·2** | 系统产出 vs 上传原件用**文字角标**（`files-origin-badge`）区分，不靠颜色或图标 | 架构 file-first 第 1 条要求「一眼看出」，未规定表现形式 |
| **README-files 三·4** | `STORED` 之后即标「原件可下载」，与「已进检索」**分成两个独立小字标** | 这正是 N-7 的界面形态。UC-22.2 R7 说这是两件事但没给界面表达 |
| **README-files 三·5/6** | 删除影响面做成逐条清单，第 ⑦ 条「通知拍板人复核」单独高亮；**默认展示「已导出到组织外」警示**（前置到删除确认阶段） | 把 N-19「回执须如实说明已出域」提前到删前提示。是实现替 UC 做的加法 |
| **README-files 三·9** | 上传弹层机密勾选**默认勾上**并显示「继承自项目默认：是」；可见性四选一默认「全场」；预检示范了两条被拒（`.svg` 脚本风险 / 解压炸弹），**用了 2 GB / 20 份 / 3 层占位** | ⚠ **那三个数是占位不是裁决**（对应 T-1/T-2、coverage 缺口 4）。签核时不要把界面上的数字误当已定值 |
| **README-files 三·12** | 待删除队列在 `facilitator` 或 `compliance` 视角可见，其余 `denied` | 同 S-02。这是**为缺位角色找的临时预览位** |
| **README-files 四·2** | 「不显示无权项」（R7）与「空来源节点仍显示」（A5）的区分：前者是权限过滤后不留占位，后者是来源枚举恒显示 | 已写进 `usecases.md` 的 `listProjectArtifacts`。请确认这个区分正确 |
| **README-files 四·3** | 观察者 `denied` 文案统一为「只见已发布且已脱敏」；**观察者下载权未替人类裁定**，下载按钮在观察者视角仍按 happy path 显示 | 对应 T-6。**界面目前是宽的**，裁定后须收紧 |
| **README.md 四** | 「UC-22.3 物化 —— **无独立屏**，落在文件树七类系统来源节点 + `synthesized` 标记」 | 明确的缺口而非遗漏。但它**不覆盖「物化失败」态**，见 G-3 |

---

## 五、本束的界面缺口（G）

| # | 缺口 | 影响 |
|---|---|---|
| **G-1** | ~~删除确认与待删除队列无截图~~ → **已由并行 ui-prototyper 补齐**（`8e8282a`）：`uc-22-4-delete-impact.png` / `uc-22-4-trash-compliance.png`（含部分失败）/ `uc-22-4-trash-denied.png` | ✅ 已关闭 |
| **G-0** 🔴 | **来源类型词表两套且对不上**：左树八节点由 `apps/web/lib/mock/files.ts` 的 8 值 `SourceType` 渲染，而契约 `packages/contracts/src/artifact.ts` 的 `ArtifactSource` 只有 7 值，`workshop`/`canvas` **在契约里没有对应值** | 界面已把两个契约里不存在的值当**一等来源**画进树。逐值对照与裁决要求见 `domain.md` 第二·五节 T-11。**先定词表，再让 requirement-author 锚 testid** |
| **G-2** | **合规负责人角色缺位**（S-02） | ⑦ 屏无真实角色可挂；V13·22-4 无法验收 |
| **G-3** | 🔴 **「物化失败」行态未建**。现有 `files-ingestion-failure` 是**摄取**失败，与「业务对象存在但没变成文件」不是同一件事 | V9·22-3 明写「不存在业务对象存在但浏览器什么都没有的静默态」——UC-22.3 自称最危险的缺陷模式，恰好在界面上无法表达 |
| **G-4** | **恶意文件留痕的处置视图未建**（E2·22-2 要求保留不可下载记录，仅安全/合规角色可见与处置） | V4·22-2 前端消费点为空；与 G-2 同源 |
| **G-5** | **改名入口未建** | V11·22-1 只能 API 层验收；若不提供入口须显式声明「改名仅走迁移脚本」 |
| **G-6** | 界面已实现「撤销删除」（`files-trash-revoke`），而该出口**尚未裁决**（T-5） | 界面比契约走得快。签核须一并裁定，否则实现会照界面做 |

---

## 六、怎么看

```bash
pnpm --filter web dev            # http://localhost:3100/projects/demo/files
```
- 屏：`?screen=browser|upload|ingestion|review|versions|delete|trash`
- 视角：`?as=facilitator|groupLead|member|observer|compliance`（⚠ `compliance` 是临时投影，S-02）
- 七态：`?state=loading|empty|invalid|dep-failed|denied|success`

已验证（README-files 六）：13 条 URL 全部 HTTP 200、无控制台报错；
`pnpm typecheck` 与 `./scripts/lint-design.sh` 均 exit 0。
