# 契约束 `chat` — ① UI（签核面第 ① 件）

# 🔴 截图待 ui-prototyper 产出后补；在此之前第 ① 件**不具备签核条件**

`phases/phase-01-run-a-project/ui-preview/` 下**只有三份 markdown、零张截图**
（`README.md` / `PROTOTYPE-DIGEST.md` / `README-files.md` + 一个 `files/` 目录）。

**「人看到的界面对不对」这件事，没有截图就没法签。**
本文件因此写成**骨架**：屏的清单、路由、组件落点与 `data-testid` **全部来自代码实测**
（`apps/web/components/chat/`、`apps/web/app/chat/`，已逐个 `grep` 核实），
截图一律标「**待补**」并给出约定文件名。

⚠ 若在无截图状态下把 `design-signoff.md` 的 `status` 改成 `confirmed`，
等于把 ADR-003 想防的事再犯一次：**feature_list 在任何人看到真实界面之前就被定成权威**。
ADR-023 背景 3 记录的正是这个爆点「没有被消除，只是被推迟了」。

---

## 一、本束需要哪几块屏

| # | 屏名 | 期望路由 | 服务哪几个 feature | 现状 |
|---|---|---|---|---|
| S1 | **对话主屏（三栏骨架）** | `/chat` | F108 F109 F110 F111 F112 F113 F114 | ✅ **已建成** |
| S2 | **可见范围徽标**（线程卡 / 线程头） | `/chat`（内嵌） | F108 | ❌ **未建**（原型本身就没有，uc-8-5 R8 自述） |
| S3 | **agent 私聊入口与告知条** | `/chat`（内嵌） | F108 | ❌ **未建**（契约上存在，界面上没有入口） |
| S4 | **「为什么被拒」两层区分** | `/chat?state=denied` | F108 | ⚠ **半建**（七态占位在，**不区分组织层/项目层**） |
| S5 | **agent 编制面板**（`[编制]` 点开） | `/chat`（抽屉） | F110 | ⚠ **半建**（原型是空按钮；现为 `chat-team-edit-hint` 一行提示） |
| S6 | **三模式选择器 + 产物徽标** | `/chat` 右栏「产物」 | F114 | ❌ **未建**（phase-00 `artifact` 束缺口④说的是同一块 UI） |
| S7 | **未挂来源标灰 + 「补来源」入口** | `/chat`（产物卡） | F114 | ❌ **未建**（标灰原文在洞察报告工作台，不在对话侧） |
| S8 | **预设列表 / 编辑器 / 下发对象选择器 / 使用计数 / 接收入口** | 未定（uc-8-4 R8 的「预设对话与技能」是**推断的页面名**） | F115 | ❌ **整块不存在**（原型 0 命中） |
| S9 | **「项目工作台 → 与 AI 的对话」第二入口** | `/projects/[id]`（未建） | F110（uc-8-2 V12） | ❌ **未建** |

> ⚠ **8 个 feature 目前只落在 S1 这一块屏上。** S2–S9 是这一轮设计查出来的界面缺口，
> 对应 `coverage.md` 的缺口 2 / 11 / 13 / 14 / 15 / 16 / 18 / 19。

---

## 二、S1 对话主屏 —— 已建成部分的落点与真实 `data-testid`

路由：`apps/web/app/chat/page.tsx` → `/chat`
组件目录：`apps/web/components/chat/`
预览开关（**生产构建下不可达**，由 `scripts/verify-prod-gates.sh` 断言）：
`?state=loading|empty|invalid|dep-failed|denied|success` · `?as=facilitator|groupLead|member|observer` · `?org=…`

### 2.1 三栏骨架

| 区 | 组件 | 真实 `data-testid` |
|---|---|---|
| 壳 | `chat-main.tsx` | `chat-main` `chat-thread-header` `chat-header-team` `chat-header-present-count` `chat-header-roster-count` `chat-header-share` `chat-header-sidebar` `chat-team-popover` `chat-team-popover-agent-<id>` `chat-share-popover` `chat-share-link` `chat-share-copy` `chat-share-scope-note` `chat-share-close` `chat-observer-tag` `chat-readonly-note` |
| 第二栏 · 线程列表 | `chat-left-panel.tsx` | `chat-left-panel` `chat-new-thread` `chat-thread-list` `chat-thread-<id>` |
| 第二栏 · AI 团队面板（常驻列表之上） | `chat-team-panel.tsx` | `chat-team-panel` `chat-team-agent-<id>` `chat-team-toggle-<id>` `chat-team-presence-<id>` `chat-team-compose` `chat-team-edit-hint` `chat-team-market` |
| 第三栏 · 消息流 | `message-stream.tsx` | `chat-message-stream` `chat-human-message` `chat-artifact-card` `chat-artifact-fullscreen` `chat-artifact-done-<i>` `chat-artifact-action-<i>` `chat-progress-card` `chat-progress-view` `chat-progress-pause` `chat-progress-paused` `chat-transcript-card` `chat-transcript-inline` `chat-transcript-inline-<id>` `chat-transcript-view` `chat-transcript-stop` `chat-transcript-stop-confirm` `chat-transcript-stop-yes` `chat-transcript-stop-no` `chat-transcript-stopped` |
| 第三栏 · AI 消息 | `ai-message.tsx` | `chat-ai-message` `chat-ai-skill` `chat-badge-degraded` `chat-badge-review` `chat-tool-calls` `chat-tool-calls-toggle` `chat-tool-calls-detail` `chat-tool-call-row` `chat-citations` `chat-citation-row` `chat-citation-anchor` |
| 第三栏 · 批准卡 | `approval-card.tsx` | `chat-approval-card` `chat-approval-status` `chat-approval-callchain-toggle` `chat-approval-callchain-detail` `chat-approval-model` `chat-approval-model-edit` `chat-approval-budget` `chat-approval-budget-edit` `chat-approval-datascope` `chat-approval-datascope-note` `chat-approval-policy-violation` `chat-approval-expired-note` `chat-approval-actions` `chat-approval-approve` `chat-approval-reparam` `chat-approval-decline` `chat-approval-confirm` `chat-approval-confirm-yes` `chat-approval-confirm-no` `chat-approval-approved` `chat-approval-declined` `chat-approval-queue` `chat-approval-reparam-panel` `chat-approval-toggle-local` `chat-approval-reparam-run` `chat-approval-reparam-cancel` |
| 第三栏 · 改派条 | `reassign-bar.tsx` | `chat-reassign-bar` `chat-reassign-reason` `chat-reassign-apply` `chat-reassign-dismiss` `chat-reassign-applied` |
| 第三栏 · 输入区 | `composer.tsx` / `composer-settings.tsx` | `chat-composer` `chat-composer-status` `chat-composer-input` `chat-composer-send` `chat-composer-settings` `chat-settings-panel` `chat-settings-close` `chat-settings-agents` `chat-settings-agent-<id>` `chat-settings-context` `chat-settings-scope-<id>` `chat-settings-models` `chat-settings-model-<id>` `chat-settings-confidential-notice` `chat-settings-apply` |
| 右栏 · 五标签 | `chat-right-panel.tsx` | `chat-right-panel` `chat-tab-transcript` `chat-tab-execution` `chat-tab-insight` `chat-tab-artifact` `chat-tab-material` `chat-tabpanel-<key>` `chat-transcript-timer` `chat-transcript-tab` `chat-transcript-search` `chat-transcript-row` `chat-transcript-identifying` `chat-transcript-insight` |

> `chat-approval-model-edit` / `chat-approval-budget-edit` 由 `MetaRow` 的
> `data-testid={`${testid}-edit`}` 生成；`chat-tab-<key>` / `chat-tabpanel-<key>` 的 key
> 取自 `apps/web/lib/mock/chat.ts` 的 `RIGHT_TABS`：`transcript` `execution` `insight` `artifact` `material`。

### 2.2 ⚠ 界面背后住着五个**未经评审的后端契约函数**

`apps/web/lib/mock/chat.ts` 里：
`dataScopeConstraint` / `modelPolicyViolation` / `isModelSelectable` / `modelLine` / `budgetLine`。

它们决定「批准卡上印什么模型、多少钱、能不能点批准」——**这是后端契约，不是 mock**。
`contract-design.md` 开篇举的反面例子逐字就是它（「机密数据的模型路由规则住在 `lib/mock/chat.ts`」）。

⇒ 签核通过后，F112 开工的第一件事是把它们收敛进 `packages/contracts/src/chat.ts`，
**mock 从契约生成，不再手写**。

---

## 三、截图清单（待补）

约定：文件放 `phases/phase-01-run-a-project/ui-preview/`，命名 `chat-<slug>.png`。
每张要能独立回答一个签核问题。

| 截图文件名 | 拍什么 | 回答哪个签核问题 |
|---|---|---|
| `chat-main-default.png` | `/chat` 默认态全屏（三栏） | 信息架构对不对；「在场 4 / 编制 6」两个数字同屏是否可接受（**S-06**） |
| `chat-thread-list-groups.png` | 第二栏「今天 / 本周」两组 + 四类线程卡徽标 | 徽标是不是一等取值；「更早」的缺失是否可接受 |
| `chat-team-panel.png` | AI 团队面板 6 个 agent 三态 + 职责一句话 + `＋ 从 Agent 市场加入` | 三态枚举与职责非空 |
| `chat-tool-calls-expanded.png` | 工具调用区展开（含一条失败态） | 逐条签名/实参/命中数/运行态；**失败条不被隐藏** |
| `chat-citation-anchor.png` | 引用角标三段（编号 + 出处全称 + 页码/时间段） | 三段缺一不可 |
| `chat-approval-card.png` | 批准卡六项披露 + 三出口 + 「已暂停」 | 🔴 **S-01 机密-模型口径**；六项是否齐 |
| `chat-approval-reparam.png` | `[改参数再跑]` 面板 + 生成新卡后原卡存档 | 原卡不就地改写 |
| `chat-approval-expired.png` | 过期态「已过期 · 未执行」 | 原型无此态，实现补的文案与力度 |
| `chat-right-tabs.png` | 右栏五标签与计数（`执行 2/4`） | 恰好五个；计数与真实数据一致 |
| `chat-badges-in-place.png` | `降级运行 · sonnet` 与 `待复核 3` 标在消息头 | 状态 4.5「不变量放在它发生的地方」 |
| `chat-observer-view.png` | `?as=observer` 全屏 | **S-11 观察者到底还剩什么**；操作按钮**不渲染**（不是禁用） |
| `chat-role-views-4up.png` | 四视角（引导师/组长/组员/观察者）并置 | 四视角投影是否与 uc-8-5 的权限说明原文一致 |
| `chat-empty.png` | `?state=empty` 新线程空态 | 不生成示例对话；五标签计数全 0 且**不隐藏** |
| `chat-dep-failed.png` | `?state=dep-failed` | 输入与最近成功数据保留 |
| `chat-denied.png` | `?state=denied` | ⚠ 需**区分组织层/项目层**——现在不区分（缺口 18） |
| `chat-artifact-card.png` | 产物卡（`[AI]` 标 + 结构摘要 + 语义标注 + 后续动作） | 三层可追溯的「产物层」 |
| `chat-transcript-card.png` | 转录卡（内嵌实时文字 + 计时） | 计时须是真实录制时长 |
| `chat-mobile.png` | 移动端（底部 tab + 上滑抽屉） | 现场关键动作在移动端可达 |

**待补画后才有的截图**（对应 S2–S9，画完再补进本表）：
`chat-visibility-badge.png` · `chat-private-chat-entry.png` · `chat-team-compose-panel.png` ·
`chat-binding-mode-selector.png` · `chat-no-source-greyed.png` · `preset-list.png` ·
`preset-editor.png` · `preset-dispatch-targets.png` · `preset-usage-count.png`

---

## 四、`ui-preview` 三份 markdown 里与本束相关的已知缺口

> 这些 S-xx 条目是「**UC 没写、由实现者替 UC 做了的决定**」——不是 bug，是缺口被填的位置。
> 签核时逐条确认；确认后结论回写对应 UC。

### 🔴 S-01 批准卡：机密数据能否与云端模型并存（**本束最重要的一条**）

`ui-preview/README.md` 原文：原型同时印着「gpt-5.2 ＋ **本地** qwen3-32b」和
「含机密，**仅本地模型**」，**字面矛盾**。实现取的口径是
「**机密数据只路由到本地模型，云端模型可并存承接非机密部分**」，
故 `modelPolicyViolation()` 只在「有机密但无任何本地模型」时报违规，而非「有云端模型就违规」。

而 `feature_list.json` 的 F112 与 **D-U1** 写的是「**含机密⇒整轮走本地**，不是分流」。

**两个口径会做出两个不同的 gateway，而 gateway 只能有一个。**
⚠ 这条同时被 `agent-runtime`（模型网关 / model registry）束记为交叉约束
（`design-signoff.md` X-1）——**两边指向同一条裁决，不各自定义一份口径**。
位置：`/chat`，`apps/web/lib/mock/chat.ts` 的 `modelPolicyViolation`。
`README.md` 自己把它列为「建议优先核对的 5 处」第 1 位。

### 🟠 S-06 「在场数」是否包含跑批中的 agent

原型同时有「团队 **4**」与「AI 团队 · **6**」。实现定义 `在场 = presence === "present"`（4 个），
**跑批中（Ledger）与空闲（Echo）不计入在场**，与编制数 6 分离
（`TEAM_PRESENT_COUNT` / `TEAM_ROSTER_COUNT`）。
它同时决定线程卡上「N 个 agent」是哪个数。位置：`/chat`。→ `domain.md` I-18、待裁决第 4 条。

### 🟡 S-11 观察者能看到多少

`/chat` 的实现口径：**滤掉批准卡与转录卡，不渲染输入区/改派条/分享，仅留 AI 发言与产物卡**。
`README.md` 自己标了「**待定：是否还应保留『已发布产出』的只读展示**」。
⚠ 同一份 README 还写着访谈现场与研究两处观察者判断**各不相同**——
「两处判断不同，需统一」是原话。本束只能对 `/chat` 这一处负责，
**跨屏统一属阶段一致性复核**。→ `domain.md` 待裁决第 3 条。

### 🟡 S-13 后台里编造的部分（影响本束的两条）

- 「**18 台模型的型号与定价全是编的**」（`gpt-5.2`、`claude-opus-4.6` 等）——
  批准卡的模型行与预算行**现在读的就是这批编造值**。→ `coverage.md` 缺口 7。
- 「**「可承接机密」徽标只贴自托管模型**」——把「机密只走自托管」做成了模型列表上的显式标记，
  而原型只在**批准卡侧**写过这条约束。这是 S-01 那条规则**被复制到了第二个地方**。

### 🟡 S-14 危险动作补了二次确认与影响范围（UC 只给了一个按钮）

本束受影响的是：批准卡的 `[批准执行]` 现在走 `chat-approval-confirm` 二次确认
（`confirm-yes` / `confirm-no`）；线程删除的「影响范围」同理。
**UC 只给了一个按钮**，二次确认是实现补的，需确认力度。

### 🟡 S-12 丢弃清单的 7 类原因（间接相关）

`已撤回 / 时效过期 / 低置信 / 无授权 / 预算截断 / 去重 / 越出范围` **是实现发明的**，
会成为 Context Pack 的 `omissions[].reason` 枚举。本束通过 `UC-16 replayContextPack` 消费它，
**但它的封闭性裁决不在本束**（属 `context-pack`）。→ `design-signoff.md` X-9。

### 未建的屏（`README.md` 第四节，与本束相关）

「**移动端各业务屏**：只做了 `AppShell` 层的三档折叠；各屏的移动端专属布局未做」——
uc-8-1 R8 要求的移动端「对话」tab 首屏（底部 tab + `对话 [＋]` + 筛选条）**属于这一条**。

### `PROTOTYPE-DIGEST.md` 中与本束相关的原文锚点

第二节「对话（08-chat）—— 产品的主屏，信息密度最高」逐项记录了
左栏「本线程的 AI 团队 · 6」+ `编制`、批准卡四个动作
（`批准执行` `改参数再跑` `不用了` `看任务队列`）与脚注
「批准后转后台任务，约 6 分钟回到本线程」、移动端「对话 ＋ 转录常驻输入区上方」。
**这些是本束 `data-testid` 与文案的原始出处**，补截图时按它逐字核对。

### `README-files.md`

与本束的交点只有一处：「对话右栏 材料 12」是**分组打印素材的计数来源**，
且该文自述「**没有浏览器本体**」——即 `messages.jsonl` 在 22-files 中的可见性
（`coverage.md` 缺口 10）在文件侧同样是缺口，不是只有本束缺。
