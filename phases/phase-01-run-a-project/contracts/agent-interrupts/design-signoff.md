---
bundle: agent-interrupts
phase: "01"
# 束↔feature 映射的权威（ADR-023 决策三）。
# ⚠ 当前为空：本束是纯新能力，feature 尚未生成——全仓 grep
#   `confirm_intent|fill_params|choose_option` 在 `apps/web`/`apps/api`/
#   `apps/deep-agent-service`/`packages` 零命中（2026-08-26 实测 origin/main d88e7693）。
#   签核通过后由 requirement-author 生成 feature 再追加；追加规则见
#   .harness/instructions/contract-design.md「covers 追加规则」三条件。
covers: []
status: pending            # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:               # 确认人（姓名/邮箱）
confirmed_at:                # ISO 8601，且不得晚于签核当下
confirmed_via:                # ⚠ 逐字转写人类给出的选择依据，不得替人类归纳或美化
---

# 契约束 `agent-interrupts` 设计签核

**实测基线**：`origin/main` @ **`d88e7693`**（2026-08-26 `git fetch` 后实测）。
本包全部「现在有 / 现在没有」的断言都指该 SHA。

覆盖判据：coord-main 交办任务原文（三种新 HITL 中断：目标复述卡 `confirm_intent` /
参数补全表单 `fill_params` / 多方案对比 `choose_option`）。**任务原文是判据的单一事实源，
本文件只转述关键点，不代替它。**

---

## 〇、这份包的由来

coord-main 交办：为三种新的 HITL 中断出契约设计，走 `contract-design.md` 流程，
产出物比照 `plan-control`（PR #2116）完整度；本轮只出契约，不写实现代码。
人类已裁决「现在出契约设计」——但**这句话是「现在可以开始设计」，不是「设计已经过审」**，
下面 `status` 继续留空，等本 PR 被 Review/Approve 才是「我看过」的机械证据。

---

## 一、为什么是新束，不并进 `agent-runtime` / `chat` / `plan-control`

四个候选都读过了（`origin/main` 实测），判据同 `contract-design.md` §一：
「这些东西的不变量互相依赖吗」。

| | `agent-runtime` | `chat` | `plan-control` |
|---|---|---|---|
| 签核状态 | `confirmed`（2026-07-30） | `confirmed`（2026-07-30） | `pending`（本身待签，不能承接更多） |
| 有没有 confirm_intent/fill_params/choose_option | **零命中**（domain/usecases 全文 grep） | **零命中** | **零命中** |
| 自述边界 | `domain.md:528`「批准卡…宿主屏：属 `chat` 束。本束定判定与数据，不定渲染」——本束与它是**同一关系**：本束定三种中断的判定与数据，渲染宿主仍是 `chat` | 已有**两套**HITL 相关但不同构的东西（见下「与 chat 束的两处既有关系」），均未覆盖这三种新中断 | 覆盖「六态工作流」，三种新中断可能在其「计划」「执行」态触发，但不是同一件事——plan-control 定义的是*任务执行的阶段机*，本束定义的是*某个具体 interrupt() 调用点怎么被人类决策*，后者可以在任何阶段发生，不专属六态中的某一态 |

**判据落地**：本束三个核心不变量（I-1 未确认不执行、I-5/I-6 选项集合与回指、
I-7 kind 与工具名一一对应）互相依赖，且**只调用**上述三束的判定结果，不依赖它们的
内部不变量——这正是「该独立成束」的形状（与 `plan-control` 自己给出的判据同一逻辑，
`plan-control/design-signoff.md` 第一节）。

### 为什么不并进 `agent-runtime`

`covers` 追加规则三条件（UI 已签 / 契约已签 / 零新增设计面）**三条全不满足**：
三个全新工具名、全新错误码、全新交互语义。走追加等于谎报「已评审」。

### 为什么不并进 `chat`——且必须说清「与 chat 束的两处既有关系」

`chat` 束里已经存在**两个看起来相关、但互不相同**的东西，本包必须讲清楚本束跟它们
分别是什么关系，否则「同一事实两处声明」会在这里第八次发生：

1. **`createApprovalRequest` / `decideApproval`**（F112，`chat.ts:870-939`）：
   一套**异步 HTTP 请求-决策**模型，`ApprovalExit = approve|reparam|decline`，
   `ApprovalStatus` 走 `paused → approved/reparamed/declined/expired`，
   服务端把决策结果推进一个后台任务队列（`TaskStatus`）。**实测**：
   `grep -rn "createApprovalRequest\|decideApproval" apps/api/src` **零命中**——
   这套契约签了但从未实现。
2. **`call_skill` 的 langgraph `interrupt()`**（`deep-agent-hitl.ts` +
   `copilotkit-v2-panel.tsx`）：**真实跑通**的机制，`interrupt()` 原生暂停
   graph 执行，前端 `useHumanInTheLoop` 直接 resume。TW-P0-6「审批卡片（三态
   决策）」判据里的「approve / edit / reject 三个按钮」逐字对应的是**这一套**，
   不是①那一套（①是 `approve/reparam/decline`，动词都不一样）。

⇒ **本束沿用②（真实跑通的那一套），不沿用①**。这不是我替 chat 束修正历史遗留分歧
（①②本身已经是「同一事实两处声明」的既存漂移，登记在 `chat.ts` 的
`KNOWN_CONTRACT_GAPS.C_CHAT_7/8/9` 附近，非本束职责，**本束不改一个字**）——
本束只是在「新建三种中断该长成什么样」这个问题上，选择跟已验证可行、已有真实用户
在用的②对齐，而不是跟未实现的①对齐。这条选择本身也写进下面待你确认的清单。

⇒ **建议：新建 `agent-interrupts` 束**。若人类不同意，退化方案是把三种中断的每一种
都作为 `agent-runtime` 束的一条 delta 追加（走「零新增设计面」以外的正式重签路径），
代价：`domain.md`/`coverage.md` 两件最有价值的产出会被拆散进 delta 附录，
交叉可读性变差（`plan-control` 先例同样论证过这一点）。

### 新建束的连带后果——同 `plan-control` 先例

签完本束后，人类需要把 `agent-interrupts` 加进
`phases/phase-01-run-a-project/design-coherence.md` 的 `covers_bundles`
并重做一致性复核——**本包没有碰 `design-coherence.md` 一个字**（F149/`plan-control`
先例：agent 代加等于谎报"已复核"）。

---

## 二、① UI —— 人看到的界面对不对

材料：本束 [`ui.md`](./ui.md)。

**⚠ 现状：本轮零截图，只有三屏文字设计说明。** 理由与是否需要先补图再签，见
`ui.md` 顶部「交给谁画」一节——我判断这轮不吃（没有浏览器工具链、也没有触碰
`apps/web` 的权限），建议移交 `ui-prototyper`，具体时机收窄进下面的决策清单。

### 签核前请重点确认

- [ ] 三屏设计说明（复述卡 / 参数表单 / 对比卡）是否符合原始需求，见 `ui.md`。
- [ ] `choose_option` 要不要「都不要」的逃生口按钮（契约层已允许 `reject`）。
- [ ] **先签设计说明再补图，还是与 `plan-control` 同标准零截图不许签**——
      见本文件末尾「收窄决策 ③」。

---

## 三、② 用例 —— 用例接口与失败模式穷不穷举

材料：本束 [`usecases.md`](./usecases.md)（3 个 UC，统一失败枚举 8 码），
支撑：[`domain.md`](./domain.md)（9 条不变量 + 3 条依赖缺口）+
[`coverage.md`](./coverage.md)（双向覆盖 + 6 条实现期待办）。

### 签核前请重点确认

- [ ] **UC-1 反证**（未确认不执行任何工具）是否写成了可判定的形式——
      `usecases.md` UC-1 反证节给的是「查询即断言」的机制事实，不是靠计时器猜。
- [ ] **UC-2 的「只重跑受影响下游」被降级**（`domain.md` 缺口 AI-1）——
      技术上未证实存在选择性重跑能力，本轮只做 `full-rerun` / `ledger-only` 两态。
      这是「本来要求的能力做不到」的诚实登记，**不是把判据改松**：若你要求的就是
      精确的「只重跑受影响节点」，这条需要你知情后决定接受降级还是暂缓这一整个
      fill_params 能力（见下方「收窄决策 ①」）。
- [ ] **UC-3 的 decision 类型选择**（`edit` 而非 `respond`，`usecases.md` UC-3
      逐条排除表）——这是本包的核心设计决策，见下方「收窄决策 ②」。
- [ ] **`FIELD_REQUIRED_BLANK` 是占位码**，正式码等两束（本束 + `plan-control`）
      都签核后的一致性复核裁决（`coverage.md` AI-6）。

---

## 四、③ API 契约 —— 对外形状与错误码对不对

**本束没有独立 HTTP 面**（`usecases.md` 顶部已声明）——三个 UC 都是既有
`POST /copilotkit` AG-UI 桥的内部投影，走 langgraph `interrupt()`/resume 语义，
不新开路由。第 ③ 件的落点：

```
packages/contracts/src/agent-interrupts.ts     ← 尚未创建，本轮只产出骨架
```

⚠ 本轮体量小（3 个工具，8 个错误码），预计不会触发 2000 行拆分规则。

### 需要连带修订的既有文件（签核通过、实现期开工时的必做项，本轮不动）

| 文件 | 改什么 | 为什么必须改，不能绕开 |
|---|---|---|
| `packages/contracts/src/deep-agent-hitl.ts` | `DEEP_AGENT_HITL_TOOL_NAME`（单值）改造成支持多值（该文件目前是「单一工具名=单一种中断」的单例设计，新增三个工具名需要它从单例变集合，或本束另建 `agent-interrupts.ts` 平行导出，两案对比见 `usecases.md` UC 与下方决策） | 它是 `DEEP_AGENT_HITL_TOOLS` 环境变量与 `build_interrupt_on` 的唯一事实源 |
| `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts:243-244` | `ARGS_MAX_CHARS` 豁免清单加三个工具名 | 封闭清单，不加行就被默认 500 字符截断成非法 JSON（`coverage.md` AI-3） |
| `apps/deep-agent-service` 侧 `harness.py` 的 `DEEP_AGENT_HITL_TOOLS` 部署值 | 逗号分隔值从一个扩到四个 | 同上，环境变量投影链条 |
| Python `@tool` 三个新工具定义 | 新建 | 契约的实现主体 |

⚠ **这些都不是本轮的产出**——本轮只出骨架 md + 在这里如实列出实现期必须动的既有文件，
避免实现者到一半才发现要碰这么多既有代码（`contract-design.md` 硬规则 8 同款教训）。

### 签核前请重点确认

- [ ] **`deep-agent-hitl.ts` 单例改集合，还是新建独立 `agent-interrupts.ts` 平行文件**
      ——见下方「收窄决策 ④」。
- [ ] **错误码 `FIELD_REQUIRED_BLANK` 待跨束裁决**（同上，AI-6）。
- [ ] **响应体也要被契约校验**（`contract-design.md` 硬规则 6）：三个 UC 的 `out`
      在实现期都需要 `safeParse()` 反向断言，并特别覆盖拒绝路径——本轮骨架未含代码，
      登记为实现期第一件事。

---

## 五、本束与哪些束有交叉约束（留给阶段一致性复核）

| # | 交叉点 | 涉及 | 为什么不能在本束单独定 |
|---|---|---|---|
| **XC-1** | 批准卡/中断卡的宿主屏 | `chat`（已签核） | 本束定判定与数据，`chat` 定渲染宿主——与 `agent-runtime` X-9 同关系，需要一致性复核确认没有被读成"本束改口" |
| **XC-2** | `appliedTo: "ledger-only"` 与 `plan-control` I-11 的「执行中只落账本」处置故意同构 | `plan-control`（待签） | 两束都独立撞上"run 执行中改状态不可靠"这个坑，处置方式相同不是巧合而是同一底层限制——复核要确认这不是两处重复定义，而是共享同一条实测事实的引用 |
| **XC-3** | `FIELD_REQUIRED_BLANK` 与 `plan-control.PLAN_CONSTRAINT_BLANK` 错误语义 | `plan-control`（待签） | 两束都可能因為必填/非空校验落同一类错误，需要复核裁一次统一码或明确不统一的理由 |
| **XC-4** | 与 `chat` 束①`createApprovalRequest`/`decideApproval`（未实现）②`call_skill` interrupt（已实现）两套既有 HITL 机制的关系 | `chat`（已签核） | 本束沿用②、不沿用①——复核要确认这条选择被记录在案，不会被将来的人误读成"本束与①冲突" |
| **XC-5** | `DEEP_AGENT_HITL_TOOLS` 环境变量与部署投影白名单的扩容 | `agent-runtime`（已签核，运行时门控相关） | 部署配置投影是横切关注点，改错任一处会导致"契约签了但生产读不到"的静默失效 |
| **XC-6** | `ARGS_MAX_CHARS` 封闭清单扩容 | 无独立束（`deep-agent-model-provider.ts` 属 `agent-runtime` 实现范围） | 同上，封闭清单遗漏不会报错，只会在真实长任务下悄悄截断 |

---

## 六、收窄决策——需要人类拍板的四条

> 按 `human-decision-packaging.md` 规则一收窄，每条 2-4 个候选，硬上限 4。

### ① `fill_params` 的「只重跑受影响下游」做不到，怎么办

| | **A（推荐）：知情降级，先做两态** | **B：暂缓整个 fill_params，等 checkpoint fork 能力先补** | **C：本束自己实现选择性重跑** |
|---|---|---|---|
| 内容 | `appliedTo: "full-rerun" \| "ledger-only"`，如实标注「不是精确子集重跑」 | 只交付 `confirm_intent` / `choose_option` 两种中断，`fill_params` 缺席直到底层能力就绪 | 本束新增节点粒度重放逻辑，直接实现选择性重跑 |
| 支持理由 | 三种中断按同一节奏交付，用户先拿到能力，代价是文案要如实说"可能会重跑更多" | 不发布做不到承诺的功能 | 满足原始需求字面 |
| 代价 | 用户体验比理想弱（编辑一个字段可能触发比预期更大范围的重跑） | 三种能力变成不同批次交付，协调成本增加 | **触碰 `agent-runtime` 已签核束的 run/checkpoint 领域**（与 `plan-control` 候选(a)同一形状代价），且需要探测 LangGraph Server REST 面是否支持——本轮未验证是否存在这个原语，可能做了才发现根本不可行 |

### ② `choose_option` 的 decision 类型：`edit` 还是碰桥接层做 `respond`

| | **A（推荐）：用 `edit`，零桥接层改动** | **B：改 `parseHitlDecision` 支持 `respond`** |
|---|---|---|
| 内容 | 见 `usecases.md` UC-3 完整推导；`respond(JSON.stringify({selectedOptionId}))` 走既有 JSON→edit 分支 | 新增第四条分支识别专门的 choose_option 载荷格式，产出真正的 `RespondDecision` |
| 支持理由 | 不碰 `apps/api` 实现代码（本轮硬边界要求）；语义上 `edit` 并非完全错误（把 args 编辑成"以选中项执行"） | 语义上 `respond`（人代答，工具不执行）更贴近"选择"这个动作的本意 |
| 代价 | `edit` 语义有一点点勉强（原始 args 是菜单，编辑后 args 是单一选择，"编辑"一词不完全准确），需要在代码注释里讲清楚这条约定 | 触碰 `apps/api/src/interface/controllers/copilotkit-agui.controller.ts`，且需要同步改 `EditDecision` 之外的 `RespondDecision` 在中间件里被消费的路径（本轮未验证该路径实现细节），代价面更大 |

### ③ UI 材料：先签设计说明，还是零截图不许签（同 `plan-control` 标准）

| | **A（推荐）：先签设计说明，`ui-prototyper` 随后补图，图定后再走一次核对** | **B：与 `plan-control` 同标准，八屏（三屏）全补齐再签** |
|---|---|---|
| 支持理由 | 三种中断的交互细节依赖②的裁决结果，先画图再等裁决可能要重画；契约设计本身已经可以独立评审 | 与近期先例（`plan-control` 2026-08-26 人类裁决"八屏全补齐再签"）一致，避免"看设计说明签字，图出来才发现不对"的返工 |
| 代价 | 签核后如果截图与设计说明不符仍需二次核对（`ui.md` 已埋好"核不过不许说补好了"的检查点） | 本包签核往后推一轮，等 `ui-prototyper` 进场 |

### ④ `deep-agent-hitl.ts` 改造：单例扩集合，还是新建平行契约文件

| | **A（推荐）：`deep-agent-hitl.ts` 保留 `call_skill` 单例语义不动，新建 `agent-interrupts.ts` 平行声明三个新工具名 + 各自 `ARGS_MAX_CHARS`** | **B：把 `DEEP_AGENT_HITL_TOOL_NAME` 改造成 `DEEP_AGENT_HITL_TOOL_NAMES`（集合），四个工具共用一份声明文件** |
|---|---|---|
| 支持理由 | 不触碰已有文件的既有语义与其头注释里"唯一事实源"的单例论证；符合本轮"新建束不改已签契约面"的一贯纪律 | 更少文件，`DEEP_AGENT_HITL_TOOLS` 环境变量的拼装逻辑天然是"所有 HITL 工具名的并集"，理论上应该只有一处 |
| 代价 | `DEEP_AGENT_HITL_TOOLS` 环境变量的拼装点（`deploy.sh`）需要知道去两个文件各取一份再拼接，多一道装配逻辑 | 触碰 `deep-agent-hitl.ts`——它虽不在"不许碰"的硬边界清单里，但改一个已经被其他实现引用的单例契约文件，等于让本轮"只出新契约"的边界变得模糊 |

---

## 确认动作

人类逐节核对上面①②③（并先看第六节四条收窄决策）后，把 frontmatter 的 `status`
改为 `confirmed`，填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）/
`confirmed_via`（**逐字转写你给出的选择依据**）。

⚠ **这是人的动作，不是 agent 的。** 该字段受 `.github/CODEOWNERS` + CI 保护
（ADR-023 决策五）。在此之前 `new-sprint` 与 `claim` 都会拒绝把本束的 feature
（尚未生成）开进 sprint。

⚠ 另需满足 ADR-023 决策四：`phases/phase-01-run-a-project/design-coherence.md` 的
`covers_bundles:` 需要人类亲自加入 `agent-interrupts` 并重做一致性复核——本包没有
代劳这一步（`plan-control`/F149 先例）。
