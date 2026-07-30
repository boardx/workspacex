# UI 先行原型 v2 · `tpl`（蓝本 / 项目模板）—— ADR-003 关卡材料

> **本版是重做**。v1（`ui-preview/tpl/`，24 张）的**蓝本设计器**被保真度审计判「重做」：它把设计器的
> **16 个配置面板只渲染了 1 个**（基本配置），其余 15 个标「未探明」占位；还把「基本配置」误当分组标题，
> 16 项数成 15，污染了完成度分母；并把原型逐字写着的规则报成「待裁决」。逐条错处见同目录 `V1-WAS-WRONG.md`。
>
> 证据不在左栏导航上——16 个面板 flag（`isBpBasic`…`isBpRep`）在 JS 数据区跨 114KB，`Read` 17MB 点不到，
> 必须 grep 才看得见。v2 已 grep 全部偏移、逐字落地 16 个面板。
>
> - 路由：预览面 `/tpl`（`?screen=` 切屏 · `?as=` 切视角 · `?state=` 切七态 · 面板切换是屏内点选）。
> - 组件：`apps/web/components/tpl/**`（新增 `designer-panels.tsx`）；mock：`apps/web/lib/mock/tpl.ts`。
> - 只写前端与 mock。**未改**任何 `requirements/`、`feature_list.json`、`*-signoff.md` 的 status。
> - `pnpm --filter web run lint`（含 lint:design/dead-controls）对本束文件全绿；抓图 0 条控制台报错。

---

## 一、截图 → 面板 / UC → feature 映射（含关键 testid）

**41 张**，命名 `<uc-id>-<屏名>-<状态>.png`。完整逐张索引见 `contracts/templates/ui.md` 第一~三节。

| 组 | 张数 | 覆盖 |
|---|---|---|
| `uc-2-1-panel-01…16-*` | 16 | **16 个配置面板各一张内容图**（本次重做核心） |
| `uc-2-1-designer-{default,loading,empty,invalid,dep-failed,denied,success,publish-confirm}` | 8 | 设计器七态 + 发布二次确认 |
| `uc-2-4-{list,versions}-*` | 7 | 蓝本列表 / 版本与锁定（含删除、归档、回滚三个确认框） |
| `uc-2-2-{apply,prep,workflow}-*` | 8 | 新建向导 / 筹备 / 工作流编排 |
| `uc-2-3-promote-*` | 2 | 提回蓝本（默认 + 空态） |

### 16 面板 ↔ 原型 flag（偏移）
01 基本配置 `isBpBasic`16529477 · 02 主题与背景 16539281 · 03 流程 Agenda 16545213 ·
04 分组规则 16556882 · 05 角色与权限 16563250 · 06 问卷 16570473 · 07 访谈与对象 16574756 ·
08 会前任务 16579564 · 09 场地与形式 16583471 · 10 项目材料 16588998 · 11 分组打印素材 16594763 ·
12 组内能力 16601016 · 13 Agent 编排 16608650 · 14 Skill 绑定 16616349 · 15 输出物 16621698 ·
16 报告模板 `isBpRep`16627026。

### 关键 testid 锚点（供 requirement-author / verification 回溯）
- 外壳：`tpl-designer-header` `tpl-version-line` `tpl-autosave` `tpl-preview-participant` `tpl-trial-run` `tpl-publish` `tpl-rule-sentence` `tpl-designer-canvas`
- 目录/完成度：`tpl-config-directory` `tpl-completion`（恒读表，禁硬编码）`tpl-config-group` `tpl-config-item` `tpl-required-tag`
- 面板通用：`tpl-panel-body` `tpl-panel-header` `tpl-panel-intro` `tpl-ai-note`
- 基本配置：`tpl-duration-section` `tpl-tier` `tpl-agenda-count` `tpl-format-section` `tpl-format` `tpl-online-added` `tpl-lang` `tpl-model-section` `tpl-model-lane` `tpl-quota-section` `tpl-quota-line` `tpl-init-preview` `tpl-init-category`
- 主题：`tpl-topic-pattern` `tpl-topic-template` `tpl-topic-rule` `tpl-topic-field` `tpl-topic-genrule`
- Agenda：`tpl-agenda-list` `tpl-agenda-seg` `tpl-agenda-action` `tpl-agenda-adopt`
- 分组：`tpl-grouping-sizing` `tpl-grouping-scenario` `tpl-grouping-rule`
- 角色矩阵：`tpl-roles-matrix` `tpl-roles-perm-table` `tpl-roles-col` `tpl-roles-permrow` `tpl-roles-cell` `tpl-roles-locknote` `tpl-roles-invite`
- 问卷/访谈/任务：`tpl-survey` `tpl-survey-q` · `tpl-itv-plan` `tpl-itv-role` `tpl-itv-auth-item` `tpl-itv-evidence` · `tpl-hw-task` `tpl-hw-seg` `tpl-hw-ifnot`
- 场地/材料/打印：`tpl-venue-space-item` `tpl-venue-format` `tpl-venue-group` · `tpl-mat-table` `tpl-mat-row` `tpl-mat-export` · `tpl-print-item` `tpl-print-ocr`
- 能力/Agent/Skill：`tpl-caps-item` `tpl-caps-state` `tpl-caps-vis-row` · `tpl-agent-row` `tpl-agent-hardlimit` · `tpl-skill-degrade-warning` `tpl-skill-row` `tpl-skill-degraded`
- 输出/报告：`tpl-out-row` `tpl-out-check` · `tpl-report-chapter` `tpl-report-by` `tpl-report-rule`
- 危险动作（沿用 parts）：`tpl-confirm-dialog` `tpl-confirm-impact` `tpl-confirm-ok` `tpl-row-archive` `tpl-row-delete` `tpl-version-rollback` `tpl-library-switch`

---

## 二、界面上无法自洽的点（人类签核重点看）

1. **默认蓝本 HMW 的档位到底是半天还是两天？** 基本配置面板的档位选择器把「两天」标为「默认」（原型
   档位区原文），但蓝本列表里 HMW 是 `3.5h / 7 环节`（= 半天档）。原型两处并存：档位区讲的是**通用默认**，
   HMW 这份蓝本**实际选了半天**。我按此渲染（档位区高亮两天为默认、流程 Agenda 面板给 7 环节）。
   若这让人困惑，说明「档位默认值」与「本蓝本已选档位」需要在界面上更明确地分开。
2. **完成度 16/16 与发布门槛的关系。** 原型目录自报 16/16（全配），但同一原型又明写「亲和图自动聚类 v2
   已降级，发布 v5 前必须替换」。即：**16/16「已配」不等于「可发布」**——配满是一回事，降级 Skill 是另一道门。
   我把发布门槛建成**降级 Skill**这道（原型明写），完成度只管「配没配」。这个双门关系原型没有一句话总述，
   是我从两处拼出来的。
3. **角色矩阵表头是「引导」还是「引导师」。** 原型矩阵表头逐字是 `引导 / 组长 / 组员 / 观察者`（省一字），
   而正文别处写「引导师」。我在矩阵里照录「引导」，在文字里用「引导师」，与原型一致但同屏两种写法。

---

## 三、我替 UC 做的设计判断（UC 没写、由我定的，请逐条看）

- **D-a｜面板是「原型面板本身」这一层，不再深入二级编辑器。** 每个面板里某个条目再点开（如单个议程环节的
  编辑弹层）我**没有**造——原型面板到这一层为止，再深就真的未探明了。这是与 v1「未探明」的关键区别：
  v1 连面板本身都没画，我画到了与原型齐平的这一层，且不越界发明更深的交互。
- **D-b｜发布门槛用降级 Skill，不用 D-2 那份未定的必填清单。** 见上文自洽点 2。`publishBlockers()` 只由降级
  Skill 驱动；`blockingRequiredItems()`（required 列）仍在、但标注 D-2 未定，只在确认框里作次级提示。
- **D-c｜首段分组不画小标题。** 原型左栏首 5 个面板直接列在「设计配置 16/16」标题下，没有分组小标题；
  我用 `divider:false` 复现，而不是硬塞一个「基本配置」当组名（那正是 v1 的错）。
- **D-d｜删除确认框补齐第二支。** 原型/需求要求行操作二分（删除 vs 归档）由服务端派生；v1 只画了归档一支，
  我补了删除确认框（`uc-2-4-list-delete-confirm`），让二分两支都可见。
- **D-e｜mock 数值全部贴原型量级**（用过 12 次、满意度 4.6/9 场、单场 3.5M token、降级阈 62%/90% 等），
  不用「三行假数据」，让信息密度问题能被看出来。数据集中在 `lib/mock/tpl.ts`，标 `TODO(contract): 待迁入
  packages/contracts/templates`。

---

## 四、R8 线索之间的矛盾及处理

- **「设计环节 16/16」vs 我们的正名「设计配置」**：原型左栏原文是「设计环节」，但 D-03 已把这一层正名为
  「设计配置」（避免与「议程环节 agenda_segment」「方法环节」混用）。界面标题用「设计配置」，计数形式
  `n/16` 保留、分母恒读表。**这是刻意的不照抄**（ui.md 第一节脚注也说明了）。
- **换档位规则：原型给了答案却被 v1 报冲突**：`可选环节自动增删，必留环节只压缩时间`（偏移 16530146）与
  档位区「环节表随之变化」并存，不是矛盾——后者是概述、前者是细则。v2 按细则渲染，撤掉 v1 的 D-8 冲突旗标。
- **议程环节字段名四方打架**（`stepId` / `stage.*` / `agenda_stage` / `agenda_segment_id`）：这是**项目侧**的
  未决（Q-3），与本束 16 面板无关，但会前初始化写进的是议程环节。按人类 2026-07-30「改名对齐」，本版
  统一用 `agenda_segment`；新建向导底部仍保留「项目侧缺失概念」警示框如实呈现这处打架。

---

## 五、明确没做的部分（不许当作已签）

- **各面板内条目的二级编辑器**（单议程环节编辑、单物料编辑弹层等）——原型面板到面板这一层，更深未探明，未画。
- **换时长档位的增删动画与撤销**（G-3）——规则已确认、动画未演示；不阻断，属演示层。
- **矩阵格 → 待办的跨屏 round-trip**（G-1，F27）——`[看任务]` 只弹 toast，粒度前提卡 D-10。
- **提回蓝本两侧屏**（G-7 复盘归属未探明 / G-8 收件面入口确认缺失）——整份 UC-2.3 不可 sign-off。
- **移动档 375/768 截图**（G-10）——只跑了溢出探针，未抓图。
- **产品路由**（`/admin/blueprint` 等）——本原型跑在预览面 `/tpl`，产品路由在 `apps/web` 里仍不存在。

---

## 建议在束级 `design-signoff.md` 第 ① 件签核时重点核对的 3 处

1. **16 个面板是否与原型齐平**（对着 `uc-2-1-panel-01…16` 看）——尤其：角色权限矩阵的灰色🔒硬约束
   （改议程只有引导可、提交产出只有组长可）、Skill 绑定的降级阻断、报告模板 18 页每章「必须人写/AI 起草」。
   这三处是原型里最有约束力的内容，v1 完全没画。
2. **完成度分母 = 16 且恒读表**（`tpl-completion` 显示 `16 / 16`）——确认没有任何地方硬编码 15/16，
   这是 v1 污染 I-5 的根因。
3. **发布门槛是「降级 Skill」而非「必填清单」**（`uc-2-1-designer-publish-confirm`）——确认这个建模判断成立；
   若产品本意是「必填项完成才能发布」，`publishBlockers()` 与确认框都要改，且 D-2 那份清单必须先由人给出。
