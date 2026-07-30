# project（项目本身）· UI 先行原型截图与 sign-off 说明

> ADR-003 / ADR-023 签核第 ① 件材料。**能力域 `project`（项目工作台），phase-01 第 10 个、也是最晚被发现缺失的域。**
> 路由：`/project`（顶层，本 agent 独占，并行安全）。
> 代码：`apps/web/app/project/page.tsx` ＋ `apps/web/components/project/*` ＋ `apps/web/lib/mock/project.ts`（纯 mock，不接后端）。
>
> ⚠ **这是转译，不是发明**：本域界面**已存在于运行态原型**（`WorkspaceX Standalone.html` 的
> `wsDetailView`）。所以做法是把原型逐屏译成 `apps/web` 的真实组件与设计 token，
> **能复用九个已建成域的就复用**，净新只在项目外壳 + 视角切换器 + 概览 + 待办看板。
>
> 截图用真实组件跑 `next dev`（视口 1360×900，deviceScaleFactor 2）抓的，**不是设计稿**。
> 每屏可点、可切标签 / 视角 / 七态。抓图时 **0 条真实控制台报错**（连字体 404 都没有）。
>
> ⚠ **我没有改任何 `ui-signoff.md` / `design-signoff.md` / `design-coherence.md` 的 status，
> 也没有改 `feature_list.json` 或任何 `requirements/`、`contracts/` 下的文件，未改 `OPEN-QUESTIONS.md`。**
> 「原型到底定了什么」的逐条核验在同目录 **`PROTOTYPE-ANSWERS.md`**（价值可能比截图高，请先看它）。
> 下面第五节「待确认清单」是给 sign-off 用的，不是已确认结论。

预览控制（仅 dev，生产 `NODE_ENV=production` 不渲染）三维：
- **屏 / 标签** `?tab=`：overview / research / prep / live / results / todo / settings
- **视角** `?as=`：facilitator / groupLead / member / observer（= 契约 `ProjectRole` 四种；已核实对应关系见下）
- **七态** `?state=`：default / loading / empty / invalid / dep-failed / denied / success（走共享 `StateShell`）

**视角 ↔ ProjectRole 对应关系（已核实，非想当然）**：原型顶栏视角切换器四档
`引导师 | 组长 | 组员 | 观察者`，逐一对应 `@repo/contracts` 的 `ProjectRole`
`facilitator | groupLead | member | observer`（`apps/web/lib/identity.ts` 的 `PROJECT_ROLE_LABEL`
就是这个映射，由契约 `z.infer` 派生，非本域另抄）。

---

## 一、截图清单 —— 每张对应哪个 UC 的哪一节、覆盖了哪些状态/视角

| 截图 | 屏 / 状态 · 视角 | UC 溯源 | 说明 |
|---|---|---|---|
| `uc-00-2-overview-default.png` | 概览 · 默认 · 引导师 | uc-00-2 R3 · uc-1-4 R5 | 项目问题 + 状态条 + 当前环节三角色卡 + 待办 + 最新动态（原型 `isWsOver`） |
| `uc-00-2-overview-loading.png` | 概览 · 加载态 | UC-0.4 R3 步骤 5 | 共享 `StateShell` 骨架屏 |
| `uc-00-2-overview-empty.png` | 概览 · 空态 | UC-0.4 R3 | 引导「套蓝本或从空白开始」，不伪造结构（uc-2-2 V15） |
| `uc-00-2-overview-invalid.png` | 概览 · 校验失败态 | UC-0.4 R3 | 「发布结论前必须绑定确定版本」`err-*` |
| `uc-00-2-overview-dep-failed.png` | 概览 · 依赖失败态 | UC-0.4 R3 | 转写/图谱服务不可用 + 重试 |
| `uc-00-2-overview-denied.png` | 概览 · 无权限态 | UC-0.3 R8 | 说明是**项目层**限制，不只显示「无权限」 |
| `uc-00-2-overview-success.png` | 概览 · 成功态 | UC-0.4 R3 | 「已发布 · 绑定 v2，审计已留痕」 |
| `uc-00-2-overview-groupLead.png` | 概览 · **组长视角** | uc-1-4 R5 · X-1 | 顶栏出现「提交本组产出」；视角说明条换成组长口径 |
| `uc-00-2-overview-member.png` | 概览 · **组员视角** | uc-1-4 R5 | 顶栏出现「举手」；说明条换成组员口径 |
| `uc-00-2-overview-observer.png` | 概览 · **观察者视角** | uc-1-4 R5 · X-1 | 无操作按钮、说明条「只读」、右侧标「只读」 |
| `uc-00-2-research-default.png` | 研究洞察 · 默认 | 06-itv/uc-6-0 · uc-0-2 | 洞察库 + 来源分布 + 尚未验证的假设（原型 `isWsRov`，复用 itv/research/survey） |
| `uc-2-2-prep-default.png` | 项目筹备 · 默认 | 02-tpl/uc-2-2 | 定题 + 四组（场景/组长/组员/访谈对象）+ 议程环节三角色分工表 |
| `uc-5-1-live-default.png` | 现场协作 · 默认 · 引导师 | 05-rec/uc-5-1 · 07-canvas/uc-7-3 | 主持台状态条 + 四组并行卡（含「需要介入」）+ 推提示/听这组 |
| `uc-5-1-live-observer.png` | 现场协作 · **观察者** | uc-1-4 R5 · X-1 | 四组卡的原始引述**换成脱敏占位**，介入/听组按钮全隐藏 |
| `uc-00-3-results-default.png` | 成果沉淀 · 默认 · 引导师 | artifact backflow · uc-00-3 | 结论 + 假设状态 + 成果去向 + 发布结论(危险动作) + 候选决策(签署) + 审计 |
| `uc-00-3-results-observer.png` | 成果沉淀 · **观察者** | uc-1-4 R5 | 发布区与候选决策区整块隐藏，只剩结论/统计/审计聚合 |
| `uc-11-1-todo-default.png` | 待办 · 默认 | 11-board/uc-11-1 | 四列看板（待办/进行中/待复核/已完成）+ 卡片来源徽标 |
| `uc-11-1-todo-observer.png` | 待办 · **观察者** | uc-1-4 R5 | 「新建/加一张」隐藏，卡片不可拖 |
| `uc-2-2-settings-default.png` | 设置 · 默认 | 02-tpl/uc-2-2 · uc-1-3 · uc-0-5 | 六块 + 参与者与邀请 + AI 权限开关 + 产出与留存 |

**testid**：每个可交互元素与关键展示区都带 `data-testid`（`project-*`、`project-tab-*`、
`project-role-*`、`agenda-item-*`、`project-todo-card-*`、`project-results-sign-*` …；
七态保留名 `loading/empty/err-*/denied/dep-failed/saved` 由 `StateShell` 承担），供 requirement-author 锚定 verification。
七态与四视角切换入口在 dev 预览条 `project-preview-*`（生产不渲染）。

**seven-state 说明**：本工作台 7 个标签共享一个中区 `StateShell`，故七态截图在概览上抓一套即代表全屏机制；
换任意标签 `?state=X` 都会命中同一套保留 testid（与 `/tasks` 分区级降级不同，本域是整区级）。

---

## 二、我替 UC 做了哪些它没写明的设计决定（sign-off 请逐条看，全部标 [设计]）

1. **[设计] 概览用「就绪检查 3/3」而非「准备度 %」。** 原型两处都有，但准备度的**计算口径**
   被 uc-2-2 登记为 `[待确认]`；在概览里放一个百分比等于替它编了个分母。故概览只放口径明确的「就绪检查」，
   准备度%留给项目列表（那屏不归本域）。
2. **[设计] 议程环节 testid 用中性名 `agenda-item-<no>`、界面显示中文「环节」。** 四个候选字段名
   （stepId/stage.*/agenda_stage/agenda_segment）未裁决（Q-3），我拒绝挑一个用，代码里注明「命名待裁决」。
3. **[设计] 观察者视角的「看得更少」具体减了什么，是我定的。** 原型只给了观察者说明条文案
   （「原始转写、私聊与任何操作按钮都关掉了」），但没逐屏演示异常态。我据此在四个标签里实装：
   现场协作四组卡的原始引述→脱敏占位；成果沉淀隐藏发布区与候选决策区；待办隐藏新建/加卡且不可拖；
   概览隐藏三角色 CTA。**这是「四视角真的改变界面」的可见面（X-1），也是新屏与旧原型最大的差别——旧原型零异常态、零权限差异。**
4. **[设计] 发布结论的二次确认对话框与影响范围文案是我加的。** 原型「发布结论」是个按钮 +
   一段范围说明，但点下去没有后续。按 R8「危险动作要二次确认 + 影响范围」，我补了确认框
   （列出影响范围 / 观察者将获只读 / 发布后不可静默撤回）。
5. **[设计] 「设置只有引导师+项目负责人可改」的投影粒度是我定的。** 原型没演示组员/观察者进设置的样子；
   我用 `canWrite && view !== "member"` 把邀请/开关做成只读投影。**真实权限在服务端 RLS，此处仅界面投影。**
6. **[设计] 候选决策「签署」按钮的可签/不可签二态。** 原型区分了「你有签署授权 · 有效期至 8/31」（可签）
   与「须周宁签署（合伙人 · 路径类决策）」（不可签，只能「请他签署」）——我把它实装为
   `disabled` 二态，但**具体谁能签哪类决策的授权矩阵原型没给全**，我只照原型两条示例做。
7. **[设计] 工作台外壳套在全局 `AppShell`（图标栏 + 组织切换顶栏）内。** 原型的工作台是「项目详情视图」，
   我保留了三栏骨架的图标栏与组织顶栏以保持产品心智一致；项目身份 / 视角切换器由工作台自己的第二级头承担。

---

## 三、界面上无法自洽 / R8 线索互相矛盾的点（sign-off 必须先裁）

1. **🔴 Q-12：原型用「项目挂到另一个项目」表达两级归属——候选集里没有这个形状。**
   新建项目有「挂到哪个项目（决定能读哪些洞察与图谱）」字段，子项目「定题项目」挂到父项目「欧洲市场进入」。
   这**不是** kind 维度（A/D）、**不是**两张表（C），更像「项目自引用的可选父项目」。
   itv agent 看到的「研究项目 vs 业务项目」两级，在本原型里正是**父子项目**。详见 `PROTOTYPE-ANSWERS.md` Q-12。
   → 我没裁决，只把原型渲染成父子归属并显式标注「命名待裁决 → Q-1 / Q-3」。

2. **🟠 全局顶栏说「不在项目上下文中 · 项目角色不适用」，而工作台顶头又显示满满的项目身份。**
   根因：`apps/web/lib/project-context.ts` 只认 `/projects/<id>`，不认 `/project`（我按并行纪律**未改这个共享文件**）。
   两处对「我在不在项目里」给了相反答案。sign-off 需裁：`/project` 要不要纳入 project-context
   （纳入后全局顶栏会重复渲染一次项目层身份+视角切换器，与工作台第二级头**冲突**——这正是当初把
   视角切换器只放项目上下文的原因）。**这是一处真实的信息架构分歧，不是样式 bug。**

3. **🟠 观察者「只读」到底能不能下载/带走已发布产出——原型没定，我只能二选一呈现。**
   与 rec 域 README 第 #2 条同源：观察者说明条只说「已发布产出与脱敏聚合可见」，
   没说可否导出。我画成「可见不可下载」（无导出按钮），但这条边界实际未定。

4. **🟠 候选决策的「签署授权矩阵」不完整。** 原型只给两条示例（路径类决策须合伙人签 / 你有此类授权且有效期至 x）。
   「哪些角色能签哪类决策、有效期从哪来、过期后怎样」原型空白，我只照两条示例实装，不外推。

5. **🟡 发布结论「绑定一个确定的产出版本」与 artifact I-11/X-4 的关系没在本屏体现。**
   本屏只演示「发布=绑定 v2」，没有触及「被定版引用的材料到期能不能删」——那条冲突在 rec 域 README #1 已暴露，
   本域不重复画，但发布动作是它的上游，sign-off 时应一并想到。

---

## 四、复用了哪些已有域、净新写了什么

**复用（不重画，只投影 / 链接过去）**：
- **研究洞察**标签 → 投影 `itv`（用户洞察 9/22）、`research`（深度研究 4）、`survey`（问卷 34/48）、`chat`（对话 6）；
  本屏只做项目级汇总（洞察库 / 来源分布 / 尚未验证的假设），点任意条进对应 Studio 工作台。
- **现场协作**标签 → 复用 `rec`（实时转录/说话人）与 `canvas`（各组画布、AI 落笔）的心智，做主持台全场视图。
- **项目筹备**标签 → 复用 `tpl`（套用蓝本、议程环节、三角色分工）。
- **成果沉淀**标签 → 复用 `canvas`/`artifact` 回流（backflow）与产出物快照心智。
- 外壳复用 `components/shell/*`（`AppShell` 三栏骨架 + 图标栏五段导航 + 组织切换顶栏）、
  `components/state/state-shell`（七态）、`components/ui/*`（Card/Button/Badge/Progress/Toggle）。

**净新（本域真正新写的）**：
- **项目外壳**：`components/project/project-workbench.tsx`（‹全部项目 + 项目头 + 三类人 + Facilitator(AI) + 主标签 + 视角说明条 + dev 预览条）。
- **视角切换器**（四档，真的改变界面）——散在 workbench 与各 tab 的 `canWrite`/`isObserver` 投影里。
- **概览** `tab-overview.tsx`（状态条 + 当前环节三角色卡 + 待办 + 动态）。
- **待办看板** `tab-todo.tsx`（四列 + 卡片来源徽标）。
- 其余 tab（`tab-live/results/research/prep/settings.tsx`）是复用域在项目下的**投影屏**。
- mock 集中在 `lib/mock/project.ts`，契约缺的字段就地标注「待迁入 packages/contracts」；
  因含 AI agent 名与蓝本清单（一个组织的示例配置），已按纪律登记进
  `apps/api/tests/kernel/no-builtin-capability-lists.test.ts` 的 `DECLARED_MOCK_DEBT`（门控绿）。

---

## 五、给 sign-off 的待确认清单（人类动作，agent 不改 status）

> ⚠ 以下是**待确认**，不是已确认结论。相关的 12 条裁决在 `requirements/00-project/OPEN-QUESTIONS.md`
> （另有 agent 在给它加裁决总表，我未改它）；本清单只把「原型这一侧能看见的裁决点」列出来。

1. **[待确认] Q-12 的第五种形状**：原型是「项目挂父项目」的父子归属，不是 kind 维度。
   请确认这是数据模型（项目自引用外键）还是仅 UI 措辞。**（阻塞 F80/F81 与本域实体形状，最高优先）**
2. **[待确认] `/project` 要不要纳入 `project-context`**（见第三节 #2）——决定全局顶栏是否重复渲染项目层身份。
3. **[待确认] 观察者能否下载/带走已发布产出**（第三节 #3）。
4. **[待确认] 候选决策的签署授权矩阵**（谁能签哪类、有效期来源、过期行为，第三节 #4）。
5. **[待确认] 议程环节字段名（Q-3）**——UI 已显示中文、testid 用中性名 `agenda-item-*`，待裁后统一。
6. **[待确认] 准备度%的计算口径（uc-2-2 已登记）**——概览暂用「就绪检查」，口径定了才放百分比。
7. **[待确认] 项目归档语义（Q-5 连带四问）**——原型只有「已归档」标签，行为未演示。

### 建议 sign-off 时**重点核对的 3 处**
1. **四视角是不是真的改变了界面**（不是换个文案）——对比 `uc-5-1-live-default` vs `uc-5-1-live-observer`、
   `uc-00-3-results-default` vs `uc-00-3-results-observer`：观察者的原始引述、发布区、签署区应**消失**而非变灰。
2. **Q-12 的父子项目**（`uc-2-2-prep-default` 顶部「已套用蓝本」区 + `PROTOTYPE-ANSWERS.md` Q-12）——
   这决定整个 project 实体的形状，也决定 itv 的范围模型。
3. **危险动作的二次确认**（`uc-00-3-results-default` 的「发布结论」→ 确认框列影响范围）——
   确认「发布=绑定确定版本 + 影响范围 + 不可静默撤回」这套话术是否符合合规预期。
