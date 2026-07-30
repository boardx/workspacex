# `project` 束 · 第 ① 件（UI）签核材料

> **截图索引自检**：本文件引用 **19** 张截图，目录 `phases/phase-01-run-a-project/ui-preview/project/`
> 下实际 **19** 张 png —— **N == M == 19，逐张核对全部存在，无漏引、无死链、索引内无重复列**。
> （核对口径：以**唯一文件名**计数；第二节为做对比而重复提到的 5 个文件名不重复计入。）
> 机械复核：`ls ui-preview/project/*.png | xargs -n1 basename | sort -u`
> 与本文件中 `grep -o '[a-zA-Z0-9._-]*\.png'` 的去重结果应当逐行相等。
> ⚠ 数字相等**只说明索引不撒谎**，不说明覆盖完整 —— 本域仍缺 3 个屏，见第四节 C 类。

> **材料位置**：`phases/phase-01-run-a-project/ui-preview/project/` —— **19 张真实截图**
> + `README.md`（截图清单与设计决定）+ `PROTOTYPE-ANSWERS.md`（对着运行态逐条核验 12 条裁决）。
>
> ⚠ **本文不复制那两份文件**，只做两件事：
> ① 把 19 张截图与它们对应的屏 / 状态 / 视角**登记进签核范围**；
> ② 把「**原型未覆盖**」的点提取成**第 ① 件的待确认清单**（第四节）。
> 截图的抓取方式、复用了哪些域、作者替 UC 做了哪些 `[设计]` 决定，
> 权威在 `ui-preview/project/README.md`，不在这里。
>
> ⚠ **本束现在不可签核**（`covers: []`，无 feature）——见 [`design-signoff.md`](./design-signoff.md) 顶部。
> 第 ① 件的材料是九个域里最完整的之一，但**材料齐 ≠ 可签**。

---

## 一、19 张截图（文件名已核实，非编造）

截图用 `apps/web` 真实组件跑 `next dev` 抓取（视口 1360×900、deviceScaleFactor 2），
**不是设计稿**；每屏可点、可切标签 / 视角 / 七态；抓图时 0 条真实控制台报错。

### 概览（`?tab=overview`）—— 七态在此抓全，代表全屏机制

| 截图 | 状态 / 视角 |
|---|---|
| `ui-preview/project/uc-00-2-overview-default.png` | 默认 · 引导师 |
| `ui-preview/project/uc-00-2-overview-loading.png` | 加载态 |
| `ui-preview/project/uc-00-2-overview-empty.png` | 空态（引导「套蓝本或从空白开始」，**不伪造结构**） |
| `ui-preview/project/uc-00-2-overview-invalid.png` | 校验失败态 |
| `ui-preview/project/uc-00-2-overview-dep-failed.png` | 依赖失败态（含重试；**不得把失败呈现为空列表**） |
| `ui-preview/project/uc-00-2-overview-denied.png` | 无权限态（说明是**项目层**限制，不只显示「无权限」） |
| `ui-preview/project/uc-00-2-overview-success.png` | 成功态 |
| `ui-preview/project/uc-00-2-overview-groupLead.png` | **组长视角** |
| `ui-preview/project/uc-00-2-overview-member.png` | **组员视角** |
| `ui-preview/project/uc-00-2-overview-observer.png` | **观察者视角** |

> 七态说明：7 个标签共享一个中区 `StateShell`，故七态在概览抓一套即代表全屏机制；
> 换任意标签 `?state=X` 都会命中同一套保留 testid（本域是**整区级**降级，不是分区级）。

### 其余六个标签

| 截图 | 屏 · 状态 / 视角 |
|---|---|
| `ui-preview/project/uc-00-2-research-default.png` | 研究洞察 · 默认 |
| `ui-preview/project/uc-2-2-prep-default.png` | 项目筹备 · 默认（定题 + 四组 + **议程环节三角色分工表**） |
| `ui-preview/project/uc-5-1-live-default.png` | 现场协作 · 默认 · 引导师（主持台 + 四组并行 + 「需要介入」） |
| `ui-preview/project/uc-5-1-live-observer.png` | 现场协作 · **观察者**（原始引述换成脱敏占位，介入/听组按钮全隐藏） |
| `ui-preview/project/uc-00-3-results-default.png` | 成果沉淀 · 默认 · 引导师（结论 + 假设状态 + 成果去向 + 发布结论 + 候选决策 + 审计） |
| `ui-preview/project/uc-00-3-results-observer.png` | 成果沉淀 · **观察者**（发布区与候选决策区**整块隐藏**） |
| `ui-preview/project/uc-11-1-todo-default.png` | 待办 · 默认（四列看板 + 卡片来源徽标） |
| `ui-preview/project/uc-11-1-todo-observer.png` | 待办 · **观察者**（新建/加卡隐藏，卡片不可拖） |
| `ui-preview/project/uc-2-2-settings-default.png` | 设置 · 默认（六块 + 参与者与邀请 + AI 权限开关 + 产出与留存） |

**合计 19 张。**

### testid

`project-*` · `project-tab-*` · `project-role-*` · `agenda-item-*` · `project-todo-card-*` ·
`project-results-sign-*` …；七态保留名（`loading` / `empty` / `err-*` / `denied` / `dep-failed` / `saved`）
由共享 `StateShell` 承担。七态与四视角切换入口在 dev 预览条 `project-preview-*`（生产不渲染）。

⚠ **视角 ↔ `ProjectRole` 的对应关系已核实**（不是想当然）：顶栏四档
`引导师 | 组长 | 组员 | 观察者` 逐一对应契约枚举 `facilitator | groupLead | member | observer`，
映射由契约 `z.infer` 派生，**本域未另抄一份**。

---

## 二、签核时**重点核对的 3 处**（来自原型作者的建议，本文只转指针）

1. **四视角是不是真的改变了界面**（不是换个文案）——
   对比 `ui-preview/project/uc-5-1-live-default.png` vs `ui-preview/project/uc-5-1-live-observer.png`、
   `ui-preview/project/uc-00-3-results-default.png` vs `ui-preview/project/uc-00-3-results-observer.png`：
   观察者的原始引述、发布区、签署区应**消失**而非变灰。
   ⚠ 这与 `domain.md` I-P11「`observer` 动作集合**恰好** `["read.published"]`」是同一件事的两侧：
   **服务端不下发**，不是前端隐藏。
2. **Q-12 的父子项目**（`ui-preview/project/uc-2-2-prep-default.png` 顶部「已套用蓝本」区 +
   `PROTOTYPE-ANSWERS.md` Q-12）——**它决定整个 project 实体的形状，也决定 itv 的范围模型。**
3. **危险动作的二次确认**（`ui-preview/project/uc-00-3-results-default.png` 的「发布结论」→ 确认框列影响范围）——
   确认「发布 = 绑定确定版本 + 影响范围 + 不可静默撤回」这套话术是否符合合规预期。

---

## 三、原型作者替 UC 做的 `[设计]` 决定（7 条）

**逐条在 `ui-preview/project/README.md` 第二节，本文不复制。**
签核时必须逐条看，因为它们**不是 UC 写明的**，是原型作者补的：
概览用「就绪检查 3/3」而非「准备度 %」· 议程环节 testid 用中性名 ·
观察者「看得更少」具体减了什么 · 发布结论的二次确认与影响范围文案 ·
设置的只读投影粒度 · 候选决策签署的可签/不可签二态 · 工作台外壳套在全局 `AppShell` 内。

---

## 四、**「原型未覆盖」的点** —— 第 ① 件的待确认清单

> 来源：`ui-preview/project/PROTOTYPE-ANSWERS.md`（标「空白」/「矛盾」的条目）
> 与 `ui-preview/project/README.md` 第三、五节。
> ⚠ **这些是「运行态原型在这一点上没有任何体现」，不是「产品决定不做」。**
> `DECISIONS-FINAL.md:115` 的通用规则第 2 条：**不得把「未探明」写成「原型没做」**。

### A. 界面上无法自洽 / 两处相反（**必须先裁才能签 ①**）

| # | 点 | 出处 |
|---|---|---|
| **A-1** 🔴 | **「项目挂到另一个项目」是数据模型还是仅 UI 措辞。** 新建项目有「挂到哪个项目（**决定能读哪些洞察与图谱**）」字段，子「定题项目」挂父「欧洲市场进入」。这不是 `kind` 维度、不是两张表，更像**项目自引用的可选父项目** | `PROTOTYPE-ANSWERS.md` Q-12 → `OPEN-QUESTIONS.md` **Q-12 候选 E**。⚠ 括注那句字面要的是**沿父子边放宽读范围**，与 I-7 / I-13「只收紧不放宽」冲突（`design-signoff.md` X-15） |
| **A-2** 🟠 | **`/project` 要不要纳入 `project-context`。** 全局顶栏说「不在项目上下文中 · 项目角色不适用」，工作台顶头又显示满满的项目身份——**两处对「我在不在项目里」给了相反答案**。纳入后全局顶栏会**重复渲染**一次项目层身份 + 视角切换器，与工作台第二级头冲突 | `README.md` 第三节 #2。⚠ 这是真实的信息架构分歧，**不是样式 bug**；与 `domain.md` I-P31（非项目页不得泄漏项目层，**已有机械门控**）直接相接 |

### B. 原型完全空白（UI 侧无从判断）

| # | 点 | 归属 |
|---|---|---|
| **B-1** | **观察者「只读」能不能下载 / 带走已发布产出。** 说明条只说「已发布产出与脱敏聚合可见」，没说可否导出；原型作者画成「可见不可下载」（无导出按钮），**但这条边界实际未定** | `README.md` 第三节 #3（与 `rec` 域 README #2 同源） |
| **B-2** | **候选决策的「签署授权矩阵」不完整。** 原型只给两条示例（路径类决策须合伙人签 / 你有此类授权且有效期至 x）。「哪些角色能签哪类决策、有效期从哪来、过期后怎样」空白 | `README.md` 第三节 #4 |
| **B-3** | **项目归档后的行为。** 列表卡片上「已归档」标签存在，但**归档 = 只读？可否撤销？进行中的环节怎么办？归档内容还能被下游 / Context Pack 召回吗**——原型只把它当展示标签，**没有演示任何行为** | `PROTOTYPE-ANSWERS.md` Q-5 → **Q-5** 连带四问 |
| **B-4** | **环节的「接受哪些产出来源」白名单控件不存在。** 环节卡只显示「绑哪张模板」，没有任何 `acceptedSources` 的呈现 ⇒ `STEP_REJECTS_ARTIFACT_TYPE` 的拒绝提示也无处显现 | `PROTOTYPE-ANSWERS.md` Q-2③ / Q-8 → **Q-2③** / **Q-8** |
| **B-5** | **`lead` 对自己创建但未加入的项目**这条边的两端从未被演示（原型里操作者始终是**已加入的引导师**） | `PROTOTYPE-ANSWERS.md` Q-4 → **Q-4②** |
| **B-6** | **删除项目入口不存在**（卡片右下只有「⋯ 更多」与「看产出」）。⚠ 这**既不证明提供也不证明不提供**，只是弱旁证 | `PROTOTYPE-ANSWERS.md` Q-9 → **Q-9** |
| **B-7** | **一个人所属项目数上限**在原型里没有任何体现 | `PROTOTYPE-ANSWERS.md` Q-7 → **Q-7①** |
| **B-8** | **准备度 % 的计算口径。** 原型列表**显示了数字**（「准备度 68% · 9/12 已确认」）却不暴露分母；概览因此**刻意改用**口径明确的「就绪检查 3/3」 | `PROTOTYPE-ANSWERS.md` Q-6 → `uc-2-2:419-420` 的 `[待确认]`。⚠ **不要在别处编一个分母**，那就是第二份事实 |

### C. 本域截图**没有覆盖到的屏**（不是原型空白，是本轮没画）

| # | 缺的屏 | 影响 |
|---|---|---|
| **C-1** | **项目列表 / 「全部项目」屏**（工作台头部的 `‹ 全部项目` 指向它） | `uc-00-2` 的 V10（列表口径）无前端消费点。⚠ 它的形状被 **Q-6①** 卡着，`uc-00-2:195` 已明写「Q-6 裁决前不要为项目列表生成 feature」 |
| **C-2** | **新建项目流程屏**（选蓝本九宫格 / 「从空白开始」/「挂到哪个项目」） | 这正是 **A-1** 与 **Q-1** 的证据所在屏。运行态原型里有，但**本域未译成 `apps/web` 组件、未抓图** |
| **C-3** | **组织停用后项目的只读呈现** | `uc-00-1` V12 的界面部分（「显示只读原因而非隐藏」）无截图 |

⚠ **C 类不是「原型未覆盖」，是「本轮 UI 先行未做完」。** 两者性质不同：
B 类要人类裁决，C 类要 ui-prototyper 补画。**签第 ① 件时 C 类必须补齐**，
否则就是 ADR-003 想防的「feature_list 在任何人看到真实界面之前就被定成权威」。

### D. 天然不是 UI 能答的（登记但不作为 ① 件门槛）

议程环节是不是一张**独立表**（Q-2①）· 环节字段的**英文名**（Q-3，UI 只显示中文「环节」）·
`GET /projects` 是不是**两段式响应体**（Q-6①）· 两个后端**失败码**的判据（Q-8）·
`readContent.in.projectId` **非空**造成的读取路径缺口（Q-10）·
创建事务是**一处还是两处**（Q-1）。

`PROTOTYPE-ANSWERS.md` 对这一类的纪律逐字是：
「**不用 UI 的样子去反推后端，那正是本仓要防的『造出已算过的假象』。**」本文沿用。
