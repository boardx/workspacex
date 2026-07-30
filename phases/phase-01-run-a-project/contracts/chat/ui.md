# 契约束 `chat` — ① UI（签核面第 ① 件）

> **自检：本文件引用 18 张截图，`ui-preview/chat/` 目录下实际 18 张。N == M == 18，逐张核对全部真实存在。**
> （核对命令：`ls -1 phases/phase-01-run-a-project/ui-preview/chat/*.png | wc -l`）

# 🟠 截图已部分产出：UC-8.3 / UC-8.4 两屏可签，其余屏仍**不具备签核条件**

ui-prototyper 已产出 **18 张真实截图**（`ui-preview/chat/`，另附一份 `README.md` 说明），
覆盖 **UC-8.3 对话产出落地（`/chat/landing`）9 张** 与 **UC-8.4 预设对话下发（`/chat/preset`）9 张**，
均为真实组件跑 dev server（1360×900，2×）实拍，非设计稿。

**但本束的主屏 `/chat`（UC-8.1 / 8.2 / 8.5，服务 F109 F110 F111 F112 F113）一张截图都没有。**
第一节列的 S1–S5、S9 全部无图。「人看到的界面对不对」这件事，没有截图就没法签——
所以本文件第三节既是**真实截图的完整索引**，也在第四节把**未产出的屏逐条点名**。

屏的清单、路由、组件落点与 `data-testid` **全部来自代码实测**
（`apps/web/components/chat/`、`apps/web/app/chat/`，已逐个 `grep` 核实）。

⚠ 若在 `/chat` 主屏仍无截图的状态下把 `design-signoff.md` 的 `status` 改成 `confirmed`，
等于把 ADR-003 想防的事再犯一次：**feature_list 在任何人看到真实界面之前就被定成权威**。
ADR-023 背景 3 记录的正是这个爆点「没有被消除，只是被推迟了」——
现在它对 F114 / F115 已被消除，对 F109–F113 **仍然只是被推迟**。

---

## 一、本束需要哪几块屏

| # | 屏名 | 期望路由 | 服务哪几个 feature | 现状 | 截图 |
|---|---|---|---|---|---|
| S1 | **对话主屏（三栏骨架）** | `/chat` | F108 F109 F110 F111 F112 F113 F114 | ✅ **已建成** | ❌ **零张**（见第四节 G-01～G-18） |
| S2 | **可见范围徽标**（线程卡 / 线程头） | `/chat`（内嵌） | F108 | ⚠ **半建**（原型本身就没有，uc-8-5 R8 自述；现有 `VisibilityBadge` 提案组件，**仅嵌在 8.3 产物条上演示**，未铺到线程卡/线程头） | ⚠ 仅作为 8.3 截图的附带元素出现，**无独立落点截图**（G-19） |
| S3 | **agent 私聊入口与告知条** | `/chat`（内嵌） | F108 | ❌ **未建**（契约上存在，界面上没有入口） | ❌ **零张**（G-20） |
| S4 | **「为什么被拒」两层区分** | `/chat?state=denied` | F108 | ⚠ **半建**（`/chat` 七态占位在，**不区分组织层/项目层**；`/chat/landing` 的 denied 态已带 `denied-layer`） | ⚠ 只有落地屏那张（`uc-8-3-landing-denied.png`），`/chat` 主屏侧无图（G-15） |
| S5 | **agent 编制面板**（`[编制]` 点开） | `/chat`（抽屉） | F110 | ⚠ **半建**（原型是空按钮；现为 `chat-team-edit-hint` 一行提示） | ❌ **零张**（G-21） |
| S6 | **三模式选择器 + 产物徽标** | 原设想 `/chat` 右栏「产物」→ **实际落在 `/chat/landing`** | F114 | ✅ **本轮已画**（phase-00 `artifact` 束缺口④说的是同一块 UI） | ✅ **9 张**（见 3.1 #1～#9，尤以 #1 为主） |
| S7 | **未挂来源标灰 + 「补来源」入口** | 原设想 `/chat` 产物卡→ **实际落在 `/chat/landing`** | F114 | ✅ **本轮已画**（标灰原文在洞察报告工作台，对话侧属跨屏借证，见 `ui-preview/chat/README.md` 第二节 4） | ✅ **1 张**（见 3.1 #9） |
| S8 | **预设列表 / 编辑器 / 下发对象选择器 / 使用计数 / 接收入口** | 原设想未定（uc-8-4 R8 的「预设对话与技能」是**推断的页面名**）→ **实际定为 `/chat/preset`** | F115 | ✅ **本轮整屏补画**（原型 0 命中，每个控件都是新设计，权限模型三条待裁决） | ✅ **9 张**（见 3.2 #10～#18） |
| S9 | **「项目工作台 → 与 AI 的对话」第二入口** | `/projects/[id]`（未建） | F110（uc-8-2 V12） | ❌ **未建** | ❌ **零张**（G-22） |

> ⚠ **本轮把 S6 / S7 / S8 从「未建」推进到「已画并有截图」，落点由 `/chat` 内嵌改成了两条新路由
> （`/chat/landing`、`/chat/preset`）——这个落点变更本身需要在签核时确认。**
> S1–S5、S9 仍是这一轮设计查出来的界面缺口，对应 `coverage.md` 的缺口 2 / 11 / 13 / 18 / 19；
> 且 **S1 虽已建成，本轮一张截图都没抓**，签核材料上等同于看不见。

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

## 三、截图清单（真实索引 —— 18 张，全部实拍存在）

目录：`phases/phase-01-run-a-project/ui-preview/chat/`（另含一份 `README.md`，是 ui-prototyper 的
sign-off 说明，**它才是每张图的原始注解，本表是给签核人用的索引**）。
抓图条件：真实组件 + `next dev`，视口 1360×900 @2×，0 条真实控制台报错。
七态由 `?state=` 切、四视角由 `?as=` 切，均走共享 `StateShell`。

> ⚠ 下表**是本文件对截图的全部引用，共 18 条，与目录下 18 个 `.png` 一一对应，不多不少、不重复**。
> 原骨架里那套 `chat-<slug>.png` 命名约定（`chat-main-default` 等）**是当时设想的、一张都不存在**，
> 已整体移入第五节的缺口清单，不在此处伪装成材料。

### 3.1 UC-8.3 对话产出落地 · `/chat/landing`（服务 F114） —— 9 张

| # | 截图路径 | 状态 / 视角 | 拍什么 | 回答哪个签核问题 |
|---|---|---|---|---|
| 1 | `ui-preview/chat/uc-8-3-landing-default.png` | `default` · facilitator | 落地主屏：落地动作集 + 产物列表 + **三模式选择器（并列三卡 + 各自后果）** + 决策门控 chip 排 | 三模式是否该做成并列三卡而非单选钮；「能被拿来干什么 / 会不会随源变动 / 可不可进决策」印在卡上是否合适（UC-8.3 R3 步骤 1/3/4、R8） |
| 2 | `ui-preview/chat/uc-8-3-landing-loading.png` | `loading` · facilitator | 骨架屏（skeleton），保留名 `loading` | 七态齐备性（UC-0.4 / U1） |
| 3 | `ui-preview/chat/uc-8-3-landing-empty.png` | `empty` · facilitator | 线程内无可落地结论 —— **不生成伪产出** | 空态不造数据（UC-8.3 A1 / U2） |
| 4 | `ui-preview/chat/uc-8-3-landing-invalid.png` | `invalid` · facilitator | 校验失败：未选绑定模式 / 未挂来源不可定版（`err-mode` / `err-source`） | 校验点是否落在正确的两处（UC-8.3 R3 步骤 3 / U3） |
| 5 | `ui-preview/chat/uc-8-3-landing-dep-failed.png` | `dep-failed` · facilitator | 报告服务 / 图谱写回不可用时的降级呈现 | 依赖失败时输入与最近成功数据是否保留（UC-8.3 E2/E8） |
| 6 | `ui-preview/chat/uc-8-3-landing-denied.png` | `denied` · observer | 无权限态，**带 `denied-layer` 区分组织层/项目层**（此处为项目层：观察者，落地不下发） | ⚠ 两层区分只在这一屏做到了；`/chat` 主屏仍不区分（缺口 18 / 第四节 G-15） |
| 7 | `ui-preview/chat/uc-8-3-landing-success.png` | `success` · facilitator | 已定版 v3 · 已加入报告正式版（`saved`） | 成功文案是否体现「产生了不可变版本」 |
| 8 | `ui-preview/chat/uc-8-3-landing-observer.png` | `default` · **observer**（视角投影，非拒绝） | 观察者默认态：**落地动作整块不渲染**，不是置灰 | **S-11 观察者到底还剩什么**；「不渲染 ≠ 禁用」是否为正确投影（UC-8.3 R5 / UC-8.5 R6）。⚠ 界面投影不等于权限实现，真实降级须服务端不下发 |
| 9 | `ui-preview/chat/uc-8-3-landing-nosource-gate.png` | 特殊态 · facilitator | **选中「未挂来源」的结论**后：条目标灰 + 「固定快照」模式卡禁用并给原因 + 四个决策动作 chip 全灰 + 一行「被服务端阻断」+ `chat-gate-pin-now` 一键定版入口 | 🔴 两条关键裁决同屏：①「加入报告」走**阻断 + 一键定版**而非自动定版（UC-8.3 标 [待确认]，实现选了保守一路）；② **对话侧标灰是否与洞察报告工作台同规则**（标灰原文只在 proto-05，对话侧属跨屏借证）。对应 UC-8.3 R7 AC3 / R3 步骤 4 |

### 3.2 UC-8.4 预设对话下发 · `/chat/preset`（服务 F115） —— 9 张

> ⚠ **整屏为补画原型**：「预设」二字在原型抽取档案 proto-01～10 中 **0 命中**，
> 每一个控件都是新设计，屏内 `chat-preset-proto-tag` 已自标「补画原型 · 待裁决」。

| # | 截图路径 | 状态 / 视角 | 拍什么 | 回答哪个签核问题 |
|---|---|---|---|---|
| 10 | `ui-preview/chat/uc-8-4-preset-default.png` | `default` · facilitator | 预设主屏：**权限未定橙色横幅**（`chat-preset-power-banner`）+ 预设列表 + 编辑器 + **右侧三张「待裁决」卡**；使用计数与下发人数**分两行**（`用过 N 次` / `下发给 M 人`） | 🔴🔴 **本束唯一的权限模型空洞**：谁能下发（组长？项目负责人跨组？）/ 被下发者能不能改（改了还算同一预设的实例吗→ 直接决定 AC1「真实实例数」口径）/ 能不能拒（推送 vs 上架）。**必须在此拍板，否则 feature_list 会把未定的权限模型当成已定**（UC-8.4 R3 步骤 1/2/3、R8） |
| 11 | `ui-preview/chat/uc-8-4-preset-loading.png` | `loading` · facilitator | 骨架屏 | 七态齐备性（U1） |
| 12 | `ui-preview/chat/uc-8-4-preset-empty.png` | `empty` · facilitator | 无预设，引导编写并下发 | 空态引导措辞（UC-8.4 V3 / U2） |
| 13 | `ui-preview/chat/uc-8-4-preset-invalid.png` | `invalid` · facilitator | 校验失败：预设名为空 / 未选下发对象（`err-name` / `err-target`） | 校验点是否够（UC-8.4 R3 步骤 1） |
| 14 | `ui-preview/chat/uc-8-4-preset-dep-failed.png` | `dep-failed` · facilitator | skill / agent 目录不可用 → **无法校验范围**时的降级 | 范围校验不可用时应拒绝下发还是允许带风险下发（UC-8.4 E1） |
| 15 | `ui-preview/chat/uc-8-4-preset-denied.png` | `denied` · member | 无权限态：「只有引导师可下发」 | 🔴 **这条判定本身就是待裁决项**——截图呈现的是实现暂取的口径，不是已定结论（UC-8.4 R5） |
| 16 | `ui-preview/chat/uc-8-4-preset-success.png` | `success` · facilitator | 已下发全场 8 组，各人开始后生成私有对话（`saved`） | 「下发」与「实例化」的时机分离是否正确（UC-8.4 R3 步骤 3/4） |
| 17 | `ui-preview/chat/uc-8-4-preset-observer.png` | `default` · **observer** | 观察者视角投影：**编辑器整块不渲染**（`readOnly` 分支） | 观察者对预设的可见边界（UC-8.4 R5） |
| 18 | `ui-preview/chat/uc-8-4-preset-scope-violation.png` | 特殊态 · facilitator | **把下发对象切到「指定组 = 第5组」** → 预设 2 引用的「引述抽取」skill 仅「能源组」可见 → **下发即被拒**（`chat-preset-scope-violation`） | V1c「**下发时即拒绝，不是下发后失败**」是否为正确时机；越范围拒绝属组织层限制的文案与力度（UC-8.4 R3 步骤 1 / V1c） |

> **视角覆盖说明**：18 张里实际出现的 `?as=` 取值是 **facilitator / observer 两种**
> （observer 各 2 张：#6 denied、#8 投影；#15 denied 为 member 视角）。
> **groupLead 视角一张都没有** —— 而「组长能不能给本组下发预设」正是 UC-8.4 待裁决三条之一，
> 也是 uc-8-5 R7「组长能看本组组员私聊」的落点。这一缺口记为第四节 **G-23**。

### 3.3 `data-testid` 前缀（供后续 verification 锚定）

新增两屏的前缀：`chat-landing-*` · `chat-mode-*`（含 `chat-mode-option-snapshot`）·
`chat-gate-*`（含 `chat-gate-blocked` / `chat-gate-pin-now`）· `chat-decision-action-*` ·
`chat-preset-*`（含 `chat-preset-power-banner` / `chat-preset-question-*` /
`chat-preset-scope-violation` / `chat-preset-proto-tag`）· `chat-visibility-*`；
七态保留名 `loading` / `empty` / `err-*` / `denied` / `dep-failed` / `saved`。
第二节 2.1 那张表列的是 **`/chat` 主屏**的实测 testid，两者不重叠。

---

## 四、第 ① 件材料缺口 —— 原设想里有、**实际没画**的屏

> 下面每一条都曾出现在本文件早先的「截图清单（待补）」或第一节 S1–S9 里。
> **它们没有被删掉，也没有被当成已有材料。** 签核时要么补画，要么显式接受「这几块屏不看图就签」。
> 编号 G-xx 供 `design-signoff.md` 与阶段一致性复核引用。

### A. `/chat` 主屏（S1，已建成但零张截图）—— G-01 ～ G-18

- ⚠ 未产出：`/chat` 默认态全屏三栏（原设想 `chat-main-default`） —— 该屏尚未画（**G-01**）
  ↳ 连带 **S-06「在场 4 / 编制 6 同屏是否可接受」无图可签**。
- ⚠ 未产出：第二栏「今天 / 本周」两组 + 四类线程卡徽标（原 `chat-thread-list-groups`） —— 该屏尚未画（**G-02**）
- ⚠ 未产出：AI 团队面板 6 个 agent 三态 + 职责一句话 + `＋ 从 Agent 市场加入`（原 `chat-team-panel`） —— 该屏尚未画（**G-03**）
- ⚠ 未产出：工具调用区展开含一条失败态（原 `chat-tool-calls-expanded`） —— 该屏尚未画（**G-04**）
  ↳ 「失败条不被隐藏」这条 F111 的核心承诺**无图可验**。
- ⚠ 未产出：引用角标三段（编号 + 出处全称 + 页码/时间段）（原 `chat-citation-anchor`） —— 该屏尚未画（**G-05**）
- ⚠ 未产出：**批准卡六项披露 + 三出口 + 「已暂停」**（原 `chat-approval-card`） —— 该屏尚未画（**G-06**）
  ↳ 🔴 **本束最重要的一条 S-01（机密数据能否与云端模型并存）的界面载体就是这张，现在没有。**
  第五节说它是「`README.md` 自己列的建议优先核对 5 处第 1 位」——**优先核对的东西没有图**。
- ⚠ 未产出：`[改参数再跑]` 面板 + 生成新卡后原卡存档（原 `chat-approval-reparam`） —— 该屏尚未画（**G-07**）
- ⚠ 未产出：批准卡过期态「已过期 · 未执行」（原 `chat-approval-expired`） —— 该屏尚未画（**G-08**）
  ↳ 这是实现替原型补的态，`design-signoff.md` 第 ① 件已把它列为待确认项，无图。
- ⚠ 未产出：右栏五标签与计数（`执行 2/4`）（原 `chat-right-tabs`） —— 该屏尚未画（**G-09**）
- ⚠ 未产出：`降级运行 · sonnet` 与 `待复核 3` 标在消息头（原 `chat-badges-in-place`） —— 该屏尚未画（**G-10**）
- ⚠ 未产出：`/chat?as=observer` 全屏（原 `chat-observer-view`） —— 该屏尚未画（**G-11**）
  ↳ 落地屏有观察者投影（#8），但 **S-11 问的是 `/chat` 主屏观察者还剩什么**，不能拿落地屏顶替。
- ⚠ 未产出：四视角（引导师/组长/组员/观察者）并置对照（原 `chat-role-views-4up`） —— 该屏尚未画（**G-12**）
- ⚠ 未产出：`/chat?state=empty` 新线程空态（原 `chat-empty`） —— 该屏尚未画（**G-13**）
- ⚠ 未产出：`/chat?state=dep-failed`（原 `chat-dep-failed`） —— 该屏尚未画（**G-14**）
- ⚠ 未产出：`/chat?state=denied` **且区分组织层/项目层**（原 `chat-denied`，即 S4） —— 该屏尚未画（**G-15**）
  ↳ 落地屏 #6 已带 `denied-layer`，但 `/chat` 主屏**代码上仍不区分**（缺口 18），两处口径需统一。
- ⚠ 未产出：产物卡（`[AI]` 标 + 结构摘要 + 语义标注 + 后续动作）（原 `chat-artifact-card`） —— 该屏尚未画（**G-16**）
- ⚠ 未产出：转录卡（内嵌实时文字 + 真实录制时长计时）（原 `chat-transcript-card`） —— 该屏尚未画（**G-17**）
- ⚠ 未产出：移动端（底部 tab + 上滑抽屉）（原 `chat-mobile`） —— 该屏尚未画（**G-18**）
  ↳ 与第五节「未建的屏」同源：`AppShell` 只做了三档折叠，各屏移动端专属布局未做；
  `/chat/landing`、`/chat/preset` 的 375 / 768 档同样未截图。

### B. 早先标为「待补画后才有」、至今仍未产出的屏 —— G-19 ～ G-22

- ⚠ 未产出：**可见范围徽标的真实落点**（线程卡 / 线程头，原 `chat-visibility-badge`，即 S2） —— 该屏尚未画（**G-19**）
  ↳ `VisibilityBadge` 提案组件存在，但**只嵌在 8.3 产物条上演示**。
  uc-8-5 AC1 要签的恰恰是「**贴在哪几处**」，而那几处一张图都没有。
- ⚠ 未产出：**agent 私聊入口与告知条**（原 `chat-private-chat-entry`，即 S3） —— 该屏尚未画（**G-20**）
  ↳ 契约上存在、界面上连入口都没有；uc-8-5 R7/R10 的「是否对组员显式告知」无处可签。
- ⚠ 未产出：**agent 编制面板**（`[编制]` 点开的抽屉，原 `chat-team-compose-panel`，即 S5） —— 该屏尚未画（**G-21**）
  ↳ 现状是 `chat-team-edit-hint` 一行提示文字，不是面板。
- ⚠ 未产出：**「项目工作台 → 与 AI 的对话」第二入口**（`/projects/[id]`，即 S9，uc-8-2 V12） —— 该屏尚未画（**G-22**）

> 早先同列于「待补画」的 `chat-binding-mode-selector` / `chat-no-source-greyed` /
> `preset-list` / `preset-editor` / `preset-dispatch-targets` / `preset-usage-count`
> **六项已被本轮真实截图覆盖**（分别落在 3.1 的 #1/#9 与 3.2 的 #10/#16/#18），
> 只是**文件名与落点路由都与当初设想不同**，故不再保留旧名。

### C. 视角维度缺口 —— G-23

- ⚠ 未产出：**groupLead（组长）视角的任何一张截图** —— 该视角尚未画（**G-23**）
  ↳ 四视角切换器代码里支持 `?as=groupLead`，但 18 张图里 0 命中。
  而「组长能否给本组下发预设」「组长能看本组组员私聊」都是本束待裁决的核心，
  **签核人无法从材料里看到组长看到的是什么**。

### 缺口小结（可机械核对）

| 口径 | 数 |
|---|---:|
| 本文件引用的截图（第三节） | **18** |
| `ui-preview/chat/` 目录下实际 `.png` | **18** |
| 差额 | **0** |
| 明确记名的未产出缺口（G-01 ～ G-23） | **23** |
| 其中屏级缺口（G-01～G-22） | 22 |
| 其中视角级缺口（G-23） | 1 |

**⇒ 第 ① 件的可签范围 = F114（UC-8.3）+ F115（UC-8.4）；F108～F113 所依赖的 `/chat` 主屏材料为零。**

---

## 五、`ui-preview` 三份 markdown 里与本束相关的已知缺口

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
