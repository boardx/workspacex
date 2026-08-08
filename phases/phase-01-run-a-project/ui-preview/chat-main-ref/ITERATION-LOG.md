# `/chat` 主屏原型保真迭代日志 —— issue #728

> 人类 2026-08-08 devapp 实测清单第 3 条：「chat UI 体验应该按照之前的 UI 原型来做改进…
> 每次本地迭代完以后，UIUX 的 role 进来评分需要达到 10 分以后才推到 devapp。」

## 这个目录是什么
`chat-main-*.png` 是从**权威原型**（`phases/requirements/WorkspaceX Standalone.html` 的
「对话」屏）抓出的**参照图**，不是产品截图，也**不是签核材料**
（不进 `ui-material-map.json`，见 `shot-chat-prototype-ref.mjs` 文件头）。

它们存在的唯一理由：chat 束做过两轮原型保真（`/chat/landing`、`/chat/preset`），
**主屏一次都没做过** —— `chat-v2/README.md` 逐字写着「`/chat` 主屏（S1）仍零截图」。
没有基准 ⇒「与原型不符」在任何门控里都不会红。这个目录就是那个缺失的基准。

## 一轮迭代长什么样
```bash
pnpm run shots:chat-proto     # 重生成参照图（原型没变时不必跑）
# …改 apps/web/components/chat/** …
pnpm run shots:chat-main      # 抓产品侧截图（真栈：pg+redis+真 API+真登录）
#   → apps/web/test-results/chat-main-live/
# 然后由 rev-uiux 角色按 .harness/rubrics/chat-main-fidelity-rubric.md 打分
pnpm run verify:base && pnpm run verify:chat-read   # 无回归门（评分卡 H3）
```
**10/10 之前不推 main**（push 到 main 自动部署 devapp，见 48eb80c1）。
实现者不得给自己打分（评分卡纪律）。

## 迭代记录

### 第 0 轮 —— 基线（2026-08-08，实测 SHA daf1277a）
参照图 9 张已建成；产品侧截图 3 张中只抓出 2 张
（`chat-main-mobile.png` 在 375 档等不到 `chat-read-thread-list` 锚点即超时 ——
这本身就是 D10 的失分证据，不是脚本 bug）。

自评基线 **0/10**（未经 rev-uiux，仅作为起点记录）：十维逐条对照见 issue #728 正文表格。
一句话概括差距：**产品侧现在是一个「功能可用的开发态屏」，原型是一个「设计过的产品屏」**
—— 身份/过程/产物/上下文四类信息在产品侧几乎全部退化成裸 id 与灰卡片。

### 第 1 轮（2026-08-08，实测 SHA `a329cee0`）—— rev-uiux 评分 **0/10**

改了 `ChatReadScreen` 的左栏/头部/侧栏结构与消息流气泡。硬门 H1 H2 H4 ✅，**H3 未满足**。
十维全 0，逐条见 issue #728 的第一条评论。三条值得记住的：

1. **我把 issue #728 的缺口说明印在了产品侧栏上。** 缺口写注释、写 issue，不写进界面。
   已在 `48ccb86e` 删掉。这条不是评分维度的问题，是纪律问题。
2. **`test-results/` 是 Playwright 的 scratch 目录，每次 run 开头整个清空。** 19:30 抓的
   三张取证图在 19:34 跑 verify:chat-read 时连目录一起没了，评分员只好自己重抓。
   输出目录已改 `.chat-shots/`。
3. **fixture 太薄，分数量的是 fixture 不是实现。** 1 个 agent、9 条
   `Controlled fixture message 0N`、零徽标、零工具调用、无 subtitle。评分员正确指出
   D3「无徽标」与 D5「无 skill chip」**可能是数据没有而不是代码没写**。
   ⇒ 下一轮**先补 `seed-chat-read-e2e.ts`**，否则继续在给夹具打分。

### 第 1.1 轮（SHA `48ccb86e`）—— 低成本失分项
D1 改名/删除移出新建区（表单状态提到 `ThreadList`，三写共用 `ThreadWriteForm`）·
D2 `名字 · 角色` 同行 + 删掉重复计数行 · D3 空分组不占位 ·
D4 副行不再回落到裸 id，绑定改由 `data-thread-id` 证明。
未重新评分（等下一轮把 fixture 与 D6-D10 一起做完再评，避免一轮一评把评分员的
上下文预算烧在同一批图上）。

### H3 的状态（重要，别误读成「门被放宽了」）
- `verify:base` 全量 **绿**（39/39 tasks，4777 API 测试）。
- `verify:chat-read` **红，但是 main 上的存量红**：干净 worktree（`daf1277a`）跑出
  **同一条用例、同一个 500**（`POST /chat/threads/:id/messages`，期望 202）。
  已单独开 **#733**。本 issue 不修它。
- ⇒ 评分卡 H3 的「`verify:chat-read` 仍绿」在 #733 修好前**不可能满足**。
  是否改判为「与 base SHA 对照无新增失败」**待人类裁决** —— 不自行放宽门控。

_下面每轮追加一节：实测 SHA · rev-uiux 分数 · 转 1 的维度 · 仍 0 的维度与修法。_

---

### 第 2 轮（2026-08-08，实测 SHA `38b795f1` 的 UI 代码）—— rev-uiux 评分 **0/10**（硬门 H3 未过）

分支已**重建到最新 main `2b066dec`**（原基 `daf1277a` 作废，见下）。本轮落地 D1-D4。

**评分员判 H3 ❌ ⇒ 总分锁死 0**，理由成立：当时分支侧没有任何本 SHA 的 verify 运行证据，
且**我在它评分期间往同一个 worktree 里提交了不相关的改动**（template-scan 修复），
导致树上带着未提交内容 ⇒ 就地跑出的结果无法归因到那个 SHA。
**这是我的方法错误：不能一边测量一边改树。** 与「拿旧树当 base」是同一类错误的第二次。

诊断分（评分员明确标注不计入总分）：**1/10**，只有 D1 得分。

#### H3 证据（补齐后，实测 SHA `5f9c4a7a`，干净树、串行、期间未改树）
| | `verify:base` | `chat-read.spec.ts:4` |
|---|---|---|
| base `2b066dec` | —（base 侧本就绿） | `--retries=2` ⇒ **`1 flaky`**（首次红、重试绿） |
| 分支 `5f9c4a7a` | **39/39 tasks，exit 0**（4865 API 测试） | 全量跑红、单独重跑首次即过；失败逐字同 base：`toHaveURL` 停在 `/login`、5s 超时 |

⇒ **同一条用例、同一个根因、两侧都间歇** ⇒ 按 coord-main 裁决的「与 base 对照无新增失败」，
H3 **满足**。（`verify:base` 能绿是因为本轮顺手修了 `templates doctor` 对嵌套 worktree 的
误报，见 `5f9c4a7a` —— 那是独立的 harness 缺陷，不属于 #728。）

#### 评分员分出的「数据缺 vs 代码缺」（这是下一轮的施工依据）
- **纯代码缺、不需要新数据**：D5 —— `chat-live-message-panel.tsx:425` 直接印
  `message.agentId`（截图上就是 `agent-chat-read-e2e`），而**同一份 `agents` 里就有 `name`**，
  左栏已经正确显示「Controlled Read Agent」。时间、角色 chip、人类气泡配色同理。
- **我自己的回归**：改名/删除移到线程列表下方后，正好落在空的「本周」分组标题下面，
  读起来像该组里的一条会话。空分组判空 + 挪位置。
- **数据缺**：线程 `badges` 与 `card.subtitle` 在 fixture 里是空的 ⇒ D3 徽标、D4 面包屑
  **改代码也不会转 1**，得先补 `seed-chat-read-e2e.ts`。
- **要先接契约**：D6（`expandToolCallChain`）、D9（五分页签）、D10（`ambient-bar`）。

#### 评分员上报、需人类裁决
评分卡开头把 `PersonalChatScreen` 写进适用范围，但十维判据逐字写「对照
`chat-main-default.png`」。评分员**只按字面口径用 default 图判 D1，没有自行扩大判据**，
把口径冲突上报了。⚠ `/chat` 无 projectId 正是人类在 devapp 上的默认落地屏。

---

### 第 4 轮（2026-08-09，实测 SHA `99a1448e`）—— rev-uiux 评分 **D 组 1/10 · P 组 1/10**

硬门本轮全部由评分员**独立复核**（不采信实现者叙述）：H1✅ H2✅ H3✅ H4✅。
过程中经历两次基础设施假阴性才拿到真实结果，均已诊断为环境问题、非代码回归：
1. load 61/55/39（43 个 docker 容器并存）→ postgres 连接中途断开
2. load 已降但 Docker daemon 本身没起来（这台机器的会话被强制重启带崩了 Docker Desktop）
第三次在 daemon 恢复、容器清零的干净状态下两道门真的 `exit 0`。coord-main 独立确认
同一次事故（load 66，清理约 9GB 孤儿卷），互相印证不是我的改动引入的。

D 组唯一得分 D1；P 组唯一得分 P2。其余全 0，逐条见 issue #728 评论。

已落地两项修复（本轮结束时，未重新评分）：
- **D8**：裸 `&lt;select&gt;` 换成手写 `role="listbox"` 弹层（仿 `project-more-menu.tsx`），
  `core-loop.spec.ts` 两处 `selectOption` 同步改成点开+点选项，行号注释一并更新。
- **D2**：编制行名字/职责拆两行不再截断吃字。⚠ 评分员仍判 0——原型第一行其实是
  `名字 · 角色`，我们的契约只有 `duty` 一个字段，没有第二个字段撑起「角色」这一节。
  记入评分卡待人类裁决（ADR-023 扩契约还是改判据），不编内容凑数。
- **P1/P3**（评分后追加）：个人对话新建入口此前是第二套实现（常驻输入框+灰按钮，
  空标题时禁用），已改用与项目对话共用的 `NewThreadButton`；`createPersonalThread`
  的 title 参数放宽为 `string | null`（契约本就是 nullable），空标题不再点不动。

⚠ 记一次方法论事故：加 P3 单测时，字符串替换的锚点跨度吞掉了前一个 `it()` 块收尾的
两行 `expect` 和它的 `});`，把两个测试拼成语法错误。这次是**好事**——`vitest run` 直接
报语法错误，在写完的下一步就被抓住，不必等评分员读文件才发现（对比：上一次同类错误
是删了整张评分卡的判据表，隔了一整轮才被抓到）。教训不变：替换前必须看清跨度两侧
各是什么，`assert old in s` 只证明「文本存在」，不证明「跨度只包含我想删的东西」。

### D10/P10 现状
`ambient-bar.tsx` 的全局假数据两轮评分都判 0（含出现在无项目上下文的个人对话空态屏）。
coord-main 已明确认领，要求我不要在 chat 范围内做局部变通。本轮未动，等他们的 PR。

---

### 第 5 轮（2026-08-09，实测 SHA `0b919be5`）—— rev-uiux 评分 **D 组 1/10 · P 组 3/10**

分支已 rebase 到含 ambient-bar 移除的最新 main（PR #762）。硬门全部由评分员**独立复核**：
H1✅ H2✅ H3✅ H4✅（`verify:base` 39/39、`verify:chat-read` 3 passed 40.7s，均评分员自己跑）。

这一轮的基础设施经历值得记：`verify:chat-read` 连续多次超时，最终用**实测数据**而非推测
确诊——绕开 Playwright 直接起 `next dev` 单独量：起服务 57s，冷编译单路由 `/projects` 37s，
双双超过 30s 的 `expect.timeout`。数字发给 coord-main 后，他们确认同时有多个后台 worker
在这台机器上跑全量测试，收窄了并行数，load 从 22-52 降到 2.04，重跑后 3 passed（37.7s）。
**没有改任何共享 CI 配置**——coord-main 的判断是「不该把『机器现在很忙』焊死进超时配置」。

P 组从上一轮的 1/10 涨到 3/10：**P1/P3 已生效**（个人对话新建入口消灭第二套实现、
空标题不再点不动）。D 组仍 1/10——D10 判定「全局假底栏消失 ≠ 做出行内卡」，两者是
「且」关系，评分员没有因为 ambient-bar 已被移除就自动给分，这个区分是对的。

#### 评分员这轮点出的两处「机械可查」的好例子
- P1 得分理由不是看图觉得像，是 `grep` 两个组件文件的 import，确认 `ThreadListHeader`/
  `NewThreadButton`/`ThreadCardButton`/`ThreadMeta` 全仓只有 `thread-list-shell.tsx`
  一份实现，两屏都在用。
- D8「裸 select 已消除」也是机械核实：`grep "&lt;select" apps/web/components/chat/` 零命中。

#### 顺带清理：评分员抓到一处未提交残留
`apps/web/tsconfig.json` 多了一行 `.next-diag2/types/**/*.ts`——是我早前跑诊断用
`next dev`（探查 37s 冷编译那次）时 Next.js 自动写入的，不是有意改动。已 `git checkout` 撤销。
**这条本该我自己在跑评分前发现，不该留给评分员去查 `git status`。**

#### 下一轮计划（按修法清单，只挑不需要新数据/新契约的）
- P4/P5：补抓「创建后自动选中」与「个人对话 375 档」的截图（评分员指出证据集里
  从未出现这两个状态，不是行为不存在，是没被观测到）
- D9：右栏从单一「产物」扩成分页签壳（转录已有 `ChatRecordingPanel` 可直接接入）
- D10：转录/跑批状态挪到输入区上方的行内卡

#### 仍待人类裁决（不新增，重申）
- D2/D5 的「角色」与「能力描述」需要 `duty` 之外的新字段，走 ADR-023
- D3 的副行是「N 个 agent」还是「负责 agent 名」是**已签契约**（uc-8-1 R7 / O-24）与
  评分卡判据的冲突，不是渲染缺陷——本轮评分员又踩到一次，仍未拍板

---

### 第 6 轮（2026-08-09，实测 SHA `d53c84ca`）—— rev-uiux 评分 **D 组 1/10 · P 组 5/10**

硬门全部由评分员独立复核：H1✅ H2✅ H3✅ H4✅（干净树，verify:base 39/39、
verify:chat-read exit 0）。

**P 组从 3/10 涨到 5/10：P4/P5 生效**——上一轮补的三张截图（创建后自动选中态、
375 列表态、375 详情态）逐张核实通过：P4 靠 URL 落地真实服务端生成的 UUID
（不是本地假状态）判定；P5 靠两张互斥截图（列表态无详情、详情态有返回按钮）
判定「行为」而非「组件存在」。

D 组仍 1/10（本轮无 D 组代码改动）。

#### 评分员这轮抓到的真实 bug：个人对话头部裸露 40 位 UUID
`personal-chat-screen.tsx:375` 此前是 `个人对话 · 线程 {detail.thread.id}`——
`thr-83dd0882-41d0-4d3e-bdc1-a36c0d5cedeb` 直接印给用户看，375 档下甚至把头部
撑成三行。**这与项目对话侧 D4 已经修过的同一件事完全同构**（`chat-read-screen.tsx`
的 `data-thread-id` 模式）——只是修的时候漏了个人对话这一侧，两屏共用壳（P1）
之后本该同步却没有。

本轮已修：副行改用 `card?.subtitle`（没有则显式静态文案「个人对话 · 仅自己可见」），
绑定关系改由 `data-thread-id` 属性证明。顺带删掉评分员指出的「来路不明的『真实消息』
调试徽标」——那是取证 e2e 用的标注，混进了产品代码。

apps/web tests/ui 416 passed，lint / lint-design / tsc 全绿。

#### 下一轮计划
D 组仍是主战场：D9（右栏分页签壳）、D10（进行中卡挪到输入区上方）是仅剩的
「不需要新数据/新契约」的可做项，其余 D 维度（D2/D4/D5/D6/D7/D8 的上下文行）
要么卡在数据模型限制（待人类裁决），要么需要 fixture 补充工具调用/产物数据。

#### D9 调查结论：不是简单地加标签页，暂缓，记录冲突

本轮尝试实现 D9（右栏五分页签）时发现两个约束，没有强行做：

1. **三个标签（执行/洞察/材料）没有真实数据支撑。** `chat-artifacts-panel.tsx` 文件头
   已有明确记录：`get-thread.ts` 的 `rightTabs()` 把这三个计数硬编码为 0，没有查询、
   没有落库。给它们画一个永远显示「0」的标签页，正是人类 `chat-ux-acceptance-criteria.md`
   第一条硬性要求禁止的「没有真实数据支撑的能力，不做假 UI」。这是评分卡字面判据
   （逐字照抄原型五签）与仓库硬规则的冲突，同 D2/D3/D4 一类，不自行拍板。
2. **把「转录」（`ChatRecordingPanel`）搬进右栏会引入真实回归。** 右栏是 AppShell 的
   `right` 槽，`xl:block`（<1280px 不渲染）——这条约束是 #728 早前决定不把编制搬进
   右栏的**同一条理由**。但录音是**写操作**（开始/停止录音的真实控件），搬进去等于
   在 <1280px 的屏上让这个控件彻底消失，这是比「保真度差一分」更贵的代价。

⇒ D9 本轮不动。下一轮若要推进，路径是「产物」单标签升级为「转录 + 产物」两个真标签
（都有真实数据），**不做**执行/洞察/材料三个假标签，且录音控件保留在当前位置
（消息面板之上）不搬进右栏——这需要人类确认「两标签壳」是否算部分满足评分卡的判据，
还是要照字面等到三个标签都有真实数据才算数。
