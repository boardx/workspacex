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

---

### 第 7 轮（2026-08-09，实测 SHA `ff42cc9f`）—— rev-uiux 评分 **D 组 1/10 · P 组 5/10**（独立复核确认不变）

本轮无产品代码改动（只有 D9 调查记录），评分员**没有直接照抄第 6 轮的分数**，
而是自己重新独立复核了硬门与全部十八个维度（D+P），结论与第 6 轮一致：D 1/10、P 5/10。
这正是我要求的纪律——"应该一样"不能替代"重新核实一遍"。

#### H3 花了很大力气才拿到真结果，如实记录
`verify:base` 连续三次单独重跑，每次失败的测试集合完全不重叠（跨 auth/kernel/chat/
project/skill/agent-runtime 六个不相关领域）——诊断为 turbo 39-way 并行下的资源
竞争。用 `pnpm --filter @repo/api test`（绕开 `with-test-isolation.ts`）单独验证时
只剩 2 处失败，且是撞上共享未隔离数据库的残留状态（`INVITE_ALREADY_MEMBER`），
确认不是回归。第四次通过正确路径（`pnpm run verify:base`）重跑 **39/39 全绿**，
`verify:chat-read` 单独跑（不与 verify:base 背靠背）**3 passed**。评分员随后自己
又跑了第五次，同样全绿——这次的 H3 判定不是采信我的话。

#### 本轮抓到的新 bug：P10，无 agent 时输入区仍摆着看起来能点的控件
个人对话线程在「没有可选 Agent」时，快捷回复 chip、麦克风、发送按钮**仍然渲染成
正常可点样式**，且「运行 Agent」选择器显示「没有可选 Agent」却仍占一整行——这正是
验收标准第 10 项点名的「假按钮」。已记入下一轮待修列表。

#### 下一轮计划
- P10：无 agent 时隐藏/禁用发送类控件，只留「后台创建一个 Agent」这一条出路
- D10：进行中状态卡从消息流顶部挪到输入区正上方（评分员这轮细化了位置判据）

#### 需要人类裁决（评分员本轮重申，未变）
- D9 三个假标签 vs chat-ux-acceptance-criteria.md 第一条的冲突
- D6/D7 是否允许为取证专门造带工具调用/产物的 fixture 数据

---

### 第 8 轮（2026-08-09，实测 SHA `e6cf8ff7`）—— rev-uiux 评分 **D 组 1/10（未复核，沿用）· P 组 5/10（与第 7 轮持平）**

人类明确指示「项目对话先不做，先把个人对话做到十分」，本轮起 D 组不再深挖新证据，
评分员照实登记沿用第 7 轮分数；P 组是本轮重点复核对象。

#### 两道门
`verify:base` 39/39；`verify:chat-read` 3/3（第一次因 Docker `all predefined address
pools have been fully subnetted` 失败——`docker network prune -f` 清掉 22 个孤儿网络后，
第二次又撞上 `ERR_NETWORK_IO_SUSPENDED`/120s 超时——两次都是同机其他 worktree 并发
verify:base 造成的负载型假阴性（uptime 从 58 降到 21 后第三次干净通过，43.6s，
无重叠失败集），不是代码回归。取证脚本 `pnpm run shots:chat-main` 重新产出 7 张
带真时间戳的截图。

#### 本轮改动没有把任何一维从 0 翻正
P6/P7 补的「真实发送→等待 succeeded→截图」证据链，证明的其实是 P4 已经过的
「消息真的发出去了」，不是 P6 要的**逐字流式**、也不是 P7 要的**计划句+工具调用
明细**——回复内容是 `[loopback] 对话保真取证：请回显这句话`，回环占位一次性
贴出整段文字，没有生成中指示器；且 agent 回复里没有「思考了 X 秒·N 步」「工具调用」
这类明细，对照原型同位置有三行调用记录，差距是"有/无"不是"像不像"。

Claude Code 风格紧凑输入区改版本身没有破坏 P1（未回退裸 select，机械 grep 零命中），
但把状态区暴露得更显眼，导致 P10 扣分变重，**新增/复发三处硬伤**：
1. 裸 40 位 UUID 又印回屏幕两处（`run {runId}` outline 徽标 + 排队文案），
   与 `chat-live-message-panel.tsx:453` 注释自己写的口径矛盾——这是同一类问题
   （第 6 轮修过的头部裸 UUID）换了个位置复发。
2. 文案自相矛盾：「不会合成即时 AI 回复」正上方就摆着一条真实 AI 回复。
3. agent 计数口径不一致：会话卡「0 个 agent」vs composer 已预选运行的 agent。

P8（语音实时转录）、P9（失败态）本轮**零截图覆盖**——不是功能不存在，是取证缺口，
按评分卡纪律取证缺口等价不得分。

#### 下一轮计划（已排序，按"快且独立"优先）
1. 删 `run {runId}` 裸徽标（`chat-live-message-panel.tsx:731`），只留 `data-run-id`
2. 改「不会合成即时 AI 回复」文案 + 同步改 `tests/ui/chat-read-screen.test.tsx:500`、
   `e2e/chat-read.spec.ts:61` 两处断言
3. 统一 agent 计数数据源（`thread-list-shell.tsx` 的 `ThreadMeta` vs composer 的 `agents`）
4. 补一张语音转录中截图（P8）
5. 补一张失败态截图（P9）
6. 消息流加真实流式占位渲染 + 换成真会调 skill 的 agent，让工具调用步骤真的出现（P6/P7，
   工作量最大，放最后）

1-3 目标：P10 转正。4-5 各自独立、成本较低。6 最后啃。

---

### 第 9 轮（2026-08-09，实测 SHA `7b11d47f`）—— rev-uiux 评分 **D 组 1/10（未复核，沿用）· P 组 5/10（与第 8 轮持平）**

本轮做了上一轮计划的第 1、2 项（裸 run id 徽标、矛盾文案），第 3 项（agent 计数口径）
查证代码后确认是 O-24 既有设计（`thread-badges.ts:142` `threadAgentSummary`——「N 个
agent」统计的是**已发言过**的 agent 数，不是可选数，新线程 0 个是对的），不是 bug，
**没有改**。评分员核过代码后采纳这个判断，未把它计入扣分。

#### 两处真 bug 确认修好，但同一维度冒出一处新的
评分员逐像素放大复核确认：`run {runId}` 裸 UUID 徽标消失、「不会合成即时 AI 回复」
矛盾文案已改。但本轮才看清楚一处此前没注意到的问题：**人的气泡和 agent 的气泡字号不
一样**——人走纯文本 `<p>`（`text-12`，12px），agent 走 CopilotKit 的 `<Markdown>`
组件，内部 `<p>` 套着 `.copilotKitParagraph`，被 `@copilotkit/react-ui/styles.css`
自带的 `font-size: 1rem`（16px）撑大，同一条对话流两种字号，正是评分卡第 10 项点名的
「风格孤岛」。另外还抓到一处过期态：agent 回复写回后左栏「N 个 agent」没有跟着刷新，
同一帧里「0 个 agent」和刚说完话的回复同屏——这不是口径问题（口径本身没错），是纯粹的
缺一次重读。

两道门本轮评分员自己重跑：`verify:base` 39/39，`verify:chat-read` 3 passed。

#### 本轮已修（第 10 轮验证中）
1. `apps/web/app/globals.css` 加 `.copilotkit-message-markdown .copilotKitParagraph
   { @apply text-12; }`，复用 `lib/font-scale.ts` 已生成的 Tailwind 工具类覆盖第三方
   样式，不新写一份字号数值。
2. `ChatLiveMessagePanel` 加 `onRunSettled?: () => void`，run 到终态、`loadPage`
   重读消息页后一并触发；`PersonalChatScreen` 经 `PersonalThreadDetail` 透传自己的
   `loadThreads`。项目对话侧本轮未接入（人类指示项目对话先不做），只加了可选 prop，
   不影响 D 组现状。

731 单测全绿，lint（含 lint-design.sh）/typecheck 干净。

#### 下一轮计划（不变，第 8 轮定的顺序）
4. 补一张语音转录中截图（P8）
5. 补一张失败态截图（P9）
6. 消息流真流式渲染 + 换真会调 skill 的 agent（P6/P7，工作量最大）

---

### 第 10 轮（2026-08-09，实测 SHA `f704ebef` → 本轮再改后为 `5cb664e2`）—— rev-uiux 评分 **D 组 1/10（未复核，沿用）· P 组 5/10（与第 9 轮持平）**

#### 新情况：统一衡量标准 CLR 落地（issue #814 / PR #819，已合入 main）
另一条会话线的 coord-main 今天把「四条 track 一个总分」的 CLR 机制合进了 main
（`.harness/state/core-loop-readiness.json` + `pnpm harness readiness`）。V-D/V-P
两条 track 对应本 issue，权威判据仍是 `chat-main-fidelity-rubric.md`（一个字没
复制过去），只有 `rev-uiux` 能写自己 track 的分数字段——**实现者（我）不碰**。
本轮把 `wt728` rebase 到最新 main（干净，无冲突），评分员在本轮结论后自己把
V-P 的 `scored_sha`/`evidence` 写进了 json（V-D 刻意保留旧 SHA，让 G2 过期门
如实把它计成过期/0，而不是编一次没做过的测量）。

#### 上一轮两处 P10 缺陷，本轮像素实测确认已解决
评分员这次不是目测，是量了墨迹行高/字距（而不是上一轮的 2 倍放大目测）：
人气泡与 agent 气泡的 CJK 行高都是 11px、字距都是 12px，完全一致；agent 计数
从「0 个 agent」（刚建线程时）到「1 个 agent」（回复写回后）四倍放大逐字确认
确实刷新了。

#### 但抓到一处新的 P10：「已排队」和「已完成」同屏并存
`chat-main-personal-reply.png` 输入区下方并排两行绿字——「消息已持久化，
AgentRun 已排队。」和「执行完成，回复已写入对话」——界面同时声称同一个 run
既在排队又已完成。根因：`queuedRun` 只在改草稿/再次提交时清空，run 进终态
时从未清过。本轮已修：终态分支里 `loadPage` 之后加 `setQueuedRun(null)`。
731 单测全绿，lint/typecheck 干净，已 commit（`5cb664e2`）。

#### H3 这轮不是一次过，评分员如实记录了
同一 SHA、同一命令，`verify:chat-read` 第一次红（登录后 30s 没跳
`/projects`，停在 `/login`），第二次绿。评分员按「该 SHA 上存在真绿运行 +
失败签名非产品缺陷」判 H3 通过，但明确说这是评分员自己的判断、不是评分卡
明文授权的重跑权——**留给人类裁决**：H3 是否允许重跑取绿。这与本 issue 此前
几轮反复出现的资源竞争型假阴性是同一类问题（第 6/8 轮都记录过），但这次是
评分员自己遇到的，不是我这边报的。

#### 下一轮计划（不变）
1. 补一张语音转录中截图（P8）
2. 补一张失败态截图（P9）
3. 消息流真流式渲染 + 换真会调 skill 的 agent（P6/P7，工作量最大，且评分员
   指出 P6/P7/P8/P9 四维本质是同一件事——取证脚本只跑过一条「loopback、
   成功、不说话」的最顺路径，四维都因此无证据；修取证脚本收益比修 UI 大）

#### 需要人类裁决（本轮新增，评分员提出）
- H3 是否允许在同一 SHA 上重跑取绿，还是第一次红就判整轮 0 分
- 全站共用顶栏「项目负责人」（组织角色标签）与「不在项目上下文中 · 项目角色
  不适用」同行显示，字面读起来矛盾（不是个人对话屏特有，评分员未据此扣分）

---

### 第 11 轮（2026-08-09，实测 SHA `38ca8fb3`，PR #837）—— rev-uiux 评分 **D 组 1/10（未复核，沿用，G2 过期计入 0）· P 组 6/10**

本轮首次把分支推上远端并开出 PR #837（此前 19+ 个提交只存在本地，
coord-main 巡检发现并要求立即推送，见 issue #728 与 PR #837 讨论）。

#### P10 确认转正，P7 从「完全没有」变成「只差在途态一项」
上一轮新增的「已排队/已完成」同屏矛盾已修好，评分员放大截图确认屏上只剩
一行终态文案。P7（第 10 轮起做的第二个 deep-agent fixture）**代码路径被
评分员独立核实为真**——渲染出自产品组件 `AgentRunToolCallSteps`（非本轮
改动，来自更早的 #732 cherry-pick），数据出自 `execute-run.ts` 的
`completeWithProgress` 分支真实调用 `DeepAgentModelProvider`，不是脚本
拼的假图。但**仍判 0**：验收标准第 3 项要求「正在调用 XX」这个在途态
可见，而 `AgentRunStepStatus` 契约目前是封闭的 `["succeeded","failed"]`
二态，`deep-agent-model-provider.ts` 只在工具**结果**消息到达后才 emit
事件——没有"调用中"这一档，也没有任何截图能证明运行途中屏上看得到
在调哪个工具。

P6/P8/P9 仍 0（原因不变：分别卡在 `completeWithProgress` 会跳过
`completeStream`、麦克风取证未做、失败态取证未做）。

#### H3 本轮又是"先红后绿"
`verify:chat-read` 第一次 `ERR_ABORTED`+120s 超时（load 26-56），原地
复跑 3 passed。评分员按"第二次绿"放行，但明确标注这是行使裁量、判据
字面没有"允许复跑"这一条，请人类知悉。

#### 本轮改动没有破坏 P1-P5/P10
默认选中的 agent 仍是原来那个（第二个 agent 只在脚本显式点选后才出现），
agent 计数随线程真实参与者变化（0→1→2，三张截图各自自洽），不是硬编码。

#### CLR 登记
评分员自己写入 `.harness/state/core-loop-readiness.json` 的
`tracks["V-P"]`：score 6、scored_sha `38ca8fb3`、scored_by `rev-uiux`、
evidence 六条。`pnpm harness readiness --strict` 确认结构合法。

#### 下一轮计划（按评分员给的具体修法，优先级最高的排前面）
1. **P7 转正**：`wave2-runtime.ts` 的 `AgentRunStepStatus` 扩为
   `["running","succeeded","failed"]`；`deep-agent-model-provider.ts` 在
   `pending.set()` 时就 emit 一次 `toolResultSummary: null` 的开始事件
   （数据是真的轮询结果，不是假动画）；`execute-run.ts` 按同一 id 更新
   而非追加；`chat-live-message-panel.tsx` 的完成/失败二元判断改三态，
   否则把"运行中"画成红色"失败"。取证脚本在 run 处于 `running` 时
   抓一张。
2. **P6**：取证脚本加一条走 `completeStream` 的 provider，在生成途中
   （文本非空且未终态）抓一张半截文本截图；注意不能复用带
   `completeWithProgress` 的 agent（`wantsProgress` 优先级更高会跳过
   `completeStream`）。
3. **P8**：点麦克风走 `asr-draft.gateway.ts` 的服务端代理，抓「转录中」
   「转录完成可编辑」两张，ASR 未配置时抓降级提示图。
4. **P9**：给 `loopback-deep-agent-provider.ts` 加一条确定性失败路径，
   抓失败态截图。

#### 需要人类裁决（本轮新增）
- 顶栏「项目负责人」（组织角色标签）与「不在项目上下文中 · 项目角色不
  适用」同屏矛盾——评分员这轮重申，仍未裁决
- 工具调用轨迹渲染在输入框下方（不是内联在对应消息里），判据文字未规定
  位置，评分员未扣分但提请人类确认这个口径是否可接受
- H3 是否允许同一 SHA 上重跑取绿（评分员再次标注这是自己行使的裁量）

---

### 第 12 轮（2026-08-09，实测 SHA `97a90440`，PR #837）—— rev-uiux 评分 **D 组 0/10（main 上记录，未本轮复核）· P 组 7/10**

#### 关键事件：人类明确指示「提交一个版本到 main 然后继续开发」
不再等 9/10 或 10/10——本轮 rebase 到最新 main、跑通两道门、验证 P8/P9 真
截图、拿到独立评分后，即刻合入 PR #837，不是先斩后奏。评分本身仍然独立、
诚实，合并决定不影响分数如实记录。

#### 两道门这轮难得地不背靠背也一次过
机器负载从 171 骤降到 7 的窗口期抓住了：`verify:base` 39/39、
`verify:chat-read` 3 passed（36.8s，一次绿，无需复跑）、`shots:chat-main`
一次成功产出全部 11 张截图。评分员本轮 H3 记录里特别标注"一次跑绿，无
复跑"，与第 10/11 轮的"先红后绿"形成对比——同一套代码，负载正常时确实
稳定。

#### P9 转正，P8 没有——但两者都是真实执行链路，只是评分口径不同
- **P9（失败态）转 1**：`chat-main-personal-failure.png` 里「执行失败
  （MODEL_CALL_FAILED）」红字如实展示，`data-run-status` 来自真实
  `GET /agent-runs/:runId` 终态，不是前端拼的假卡片；同一帧里已完成的
  工具调用仍标「完成」（没有把成功的一步也涂红），评分员认为这是诚实
  呈现的加分项。
- **P8（语音转录）仍 0**：两帧证据（「正在听」+ 停止后转录落地）证明的
  是"停止后整段填入"，判据第 5 项逐字要求"转录过程中能看到实时文字更新
  （不是录完一段才整体填入）"。管线是真的（真 `getUserMedia`+真服务端
  代理），卡在这支 loopback 只在 `commit` 时回一次完整转录，没有逐字
  `.delta` 事件。

#### P7 仍 0，评分员这轮把根因说得更细
`chat-live-message-panel.tsx:783-790` 的注释明确写着"不做正在调用中的
假动画"，`AgentRunStepStatus` 契约只有 `succeeded|failed`。评分员指出这
不是实现偷懒，是两个站得住的工程立场（"不造假动画"、"只显示服务端持久
消息"）与判据第 1/3 项字面要求正面冲突——要么改后端让在途态成为真实
可读数据，要么人类改判据。**这条不由我自行拍板，已第三次记入待裁决。**

#### CLR 登记与两个结构性问题
评分员自己把 V-P 写成 score 7 / scored_sha `97a90440`，但发现两个此前
没暴露的问题：
1. `scored_sha` 分支已推远端，仍不是 `origin/main` 的祖先（`git merge-
   base --is-ancestor` 为假）——**这一分只有合入 main 后才计入 CLR**，
   push 不等于进血统。
2. `.gitignore` 忽略 `.chat-shots/`，评分证据（截图本身）在别人的 clone
   里不存在，G4/G6 目前只能验证"代码路径真实"，验证不了"截图真的可见"。
   评分员建议把评分用截图归档进仓库或 issue 附件。

#### 下一轮计划（评分员给的具体修法）
1. `loopback-asr-provider.ts` 加 `.delta` 增量事件（前端 `onTranscript`
   已经支持逐段写入，只是上游没发）→ P8 转 1；评分员判断这条改动是新增
   事件类型、不改既有事件形状，向后兼容，跨 track 风险可控
2. P7 的"运行中"在途态——契约级改动，等人类裁决判据 vs 工程立场的冲突
3. P6 流式渲染——工作量最大，且与"只显示服务端持久化消息"现有口径直接
   冲突，同样等人类裁决

#### 需要人类裁决（本轮新增，评分员提出）
- P6/P7 的判据字面要求与本仓两处已有工程立场注释正面冲突，评分员按现行
  判据打 0，但明确说这条不该由评分员自己改判据
- P9 判 1 的口径边界：`MODEL_CALL_FAILED` 是裸错误码、无重试入口、刷新
  后失败提示消失——如果"第 7 项"应包含"失败必须持久可见+可重试"，P9
  应改判 0，P 组降至 6/10；评分员按判据原文字面判 1，未自行加码

---

### 第 13 轮（2026-08-09，实测 SHA `0f7f076b`）—— rev-uiux 评分 **D 组 0/10（main 上记录，未本轮复核）· P 组 8/10**

评分员本轮**没有沿用实现者的截图**，自己先把实现者 20:57 那批备份，重新跑了
一次 `pnpm run shots:chat-main`（21:35-21:36），本轮结论以评分员自己产出的
那批为准——这是本轮 H2 的加固方式，不是走过场。

#### P8 转正：像素级验证 + 字节数增长双重确认
`chat-main-personal-mic-partial.png` 裁图放大确认麦克风红色激活态与
「正在听……」同时在场，输入框已有 `[loopback-asr] 35664…`；对比
`-listening`/`-transcribed` 三帧字节数逐帧增长（评分员自己那次运行是
35664→68356），证明是随时间的多次真实更新，不是截到同一个静态值。P8 **0→1**。

#### H3 本轮真红了一次，原因与 chat 无关
`verify:base` 第一次红在 `login-enumeration-guard.test.ts` 的登录计时预言机
断言（该断言自己注释承认对同机负载敏感），评分员当时同机在跑图像处理。
机器空闲后原样重跑 509 个测试文件全绿。评分员按"两条命令都必须真的跑绿"
判 H3 通过，**如实记录了这次红**，没有藏进"重跑即绿"里不提。

#### P6 未评：不在本轮 SHA 上
issue #728 同时段交付的 PR #851（P6 流式渲染）**不在本轮评分的 SHA
`0f7f076b` 上**，评分员明确没有评它——P6 是否转正要等它合入后单独测。

#### P 组结论：8/10，仍未过人类 #831 定的 9 分门槛
P1-P5、P8、P9、P10 = 1；P6（不在本轮 SHA 上，未测）、P7（在途态缺失，
待人类裁决）= 0。差 1 分：P6（PR #851 已交付，待验证转正）或 P7
（待人类在两条路径间裁决）任一转正即可过 9 分门槛。

#### CLR 登记
`.harness/state/core-loop-readiness.json` 的 `tracks["V-P"]`：
score 7→8，scored_sha → `0f7f076b`，evidence 换成结构可解析的路径引用
（G6 门通过）。

#### 下一轮计划
1. 合并 PR #851（P6 流式渲染，已由独立子任务交付并自行验证：typecheck/
   lint/单测/两道门分开跑/真实截图确认半截文本，均绿）——合并前照 #837
   的教训重跑一次本地 `verify:core-loop` 确认不会重演 deploy 门回归
2. 合并后 rebase、重新起独立评分确认 P6 转正，若 P 组到 9/10 即过门槛
3. P7 仍需人类在两条路径（改契约 vs 改判据）间裁决，不阻塞 9 分门槛

---

### 第 14 轮（2026-08-09/10，实测 SHA `5a72973c`）—— rev-uiux 独立评分 **P 组 9/10，首次过人类 #831 定的 9 分门槛**

本轮起因：#845 一次独立评分（SHA `6c48beea`）与第 13 轮记录的 8 分在
`core-loop-readiness.json` 里出现冲突（同一 track 两条互相矛盾的分数）。
按本仓一贯纪律，**冲突不由实现者自己挑一个赢家**——发起一次从零开始、
不预设任何一边对错的独立重新评分，明确要求评分员自己去读契约源码判
P7、自己重跑证据链，不得沿用任何一方旧结论。

#### 结论：P = 9/10（P7 仍判 0，其余 P1-P6/P8-P10 = 1）
评分员直接读 `packages/contracts/src/wave2-runtime.ts:205`
（`AgentRunStepStatus = z.enum(["succeeded","failed"])`，无"运行中"态，
`AgentRunStep.endedAt` 非空 `z.string()`）确认 P7 的"工具调用在途态"在
当前契约下结构性不可能真实实现——不是实现遗漏，是契约不支持中间态，
继续判 0，与前几轮一致。P1-P6、P8-P10 逐项复核通过，P6（PR #851 流式
渲染）在本轮 SHA 上确认已生效。**9/10，首次达到 #831 门槛。**

本轮同时把两条旧的冲突记录（第 13 轮的 8 分、#845 的 9 分）都**保留未删**，
新增 `_vp_round14_authoritative_20260810` 说明本轮结果取代二者、以本轮
为准——不是覆盖历史，是显式声明谁裁决了这次分歧。

#### CLR 登记与合入 main
`.harness/state/core-loop-readiness.json` 的 `tracks["V-P"]`：
score → 9，scored_sha → `5a72973c`，commit `91d5b6cc` 推送至 PR #863，
触发的 CI（`verify`/`fullstack-smoke`）全绿后，merge 前额外单独重跑一次
`verify:core-loop`（13/13 通过，无回归，照 #837 教训不裸合），
squash 合入 main（`49d92047`）。main 上 `harness-verify` 的 `e2e-full`
job 随后报红，核实是 PR #827 遗留的 `mod-canvas-diagram` 
`scope.project` schema 问题（与本次改动无关，`backend-gates`——真正
的部署门——本身全绿），不是本轮引入的回归。

#### P 组现状：9/10，剩 1 分（P7）等人类裁决
`docs/proposals/PROP-CHAT-P7-INPROGRESS-STATUS-001.md` 给了两条路径：
A）改共享契约（`AgentRunStepStatus` 加"运行中"态 + 处理
`agent_run_steps_append_only_trg` 追加写触发器的冲突）做真实在途态；
B）改判据接受当前"只展示终态"的设计。两条路径工作量/风险不同，需要
人类选择，不阻塞 P 组已经过线的 9 分。

D 组（项目对话）按用户明确指示暂停，本轮未复核，仍为 main 上记录的
1/10。

---

### 第 15 轮（2026-08-10，实测 SHA `e2d15771`）—— P7 按人类裁决转正，但 H3 硬门未过，P 组如实判回 **0/10**

人类就 P7 裁决走**路径 B**（改判据不改契约，PR #866 合入 main：
`chat-ux-acceptance-criteria.md` 第 3 项不再要求「正在调用中」在途态可见）。
随后的独立评分确认 P7 在新判据下 = 1、P1-P6/P8-P10 复核无回归——**十维实质
全满足**。但硬门 H3（`verify:base` 必须真绿）实测未过：红在
`lint:templates-doctor` 误判 `mod-canvas-diagram/SKILL.md`（PR #827 canvas 线
遗留，与 chat 无关，CI 同 SHA 同错误复现确认非本地假阴性）。评分员按判据字面
「硬门不满足则总分直接判 0」如实登记 P = 0/10，**未自行豁免无关失败**。

与 round 14 在同类问题上的处理（「按 H3 通过登记」）相反——两次独立评分结论
冲突，实现者未选边，按「有疑问报保守数字」登记 0，并在
`CHAT-728-PENDING-DECISIONS.md` 新增 **H3-b** 小节交人类裁决规则本身
（无关既有失败算不算 H3 不过）。登记 PR #867。

#### H3 挡分项的根因修复（PR #870 / issue #869，harness 线）
根因不是 SKILL.md 缺字段，是**两把尺子量同一份文件**：通用扫描按
`template_id`+`instance_id` 识别实例文档后一律用通用 schema（要求
`scope.project`）校验，而 TPL-MOD-001 的真实形状刻意没有 scope
（`domain-skill-model.ts` 文件头预言过这种假阳性），且已有自己的门
`lint:domains-doctor`。修法：`template-scan.ts` 精确跳过
`DOMAIN_SKILL_TEMPLATE_ID`，两条反证测试防扫描面缩水。顺带修掉
`lint:readiness --strict` 的第二条无关红（#619 已 CLOSED 仍在
blocking_issues）。合入后 `verify:base` 三天来首次全绿（39/39）。

---

### 第 16 轮（2026-08-10，实测 SHA `712855f8`）—— rev-uiux 独立评分 **P 组 9/10**，H1-H4 首次全部第一跑即绿；新发现 P10 假按钮

#### 硬门：四道全过，无任何裁量
评分员自己重跑全部取证：`verify:base` exit 0（39/39，load 2.93 起跑，
**第一次跑就绿、未重跑**——H3-a 讨论的重跑裁量本轮根本没有发生）、
`verify:chat-read` 3 passed、`shots:chat-main` 13 张真栈截图、参照图零改动。

#### P7 正式转正（新判据下首次计分确认）
`chat-main-personal-tool-call.png`：斜体计划句 + 「🔧 调用 lookup_time ⊘完成」
+ 参数摘要 + 结果摘要，按 2026-08-10 人类裁决后的第 3 项判据满足。

#### P10 = 0（本轮新发现的真问题，不是回归）
每条消息下的「落地为产物（草稿）」按钮**无条件渲染**，而个人线程后端恒拒：
`PERSONAL_THREAD_CAPABILITIES` 只有 `artifact.readonly`（「不是禁用，是没有」），
`resolve-visibility.ts` 对个人线程 `projectRole` 恒 null，
`land-as-artifact.ts:134` 对 null/observer 恒抛 `NoWriteRoleError`——
判据点名的「假按钮（点了报错）」。评分员自报未真实点击，结论来自三处源码行
连锁；实现者本轮逐行复核确认属实。

#### P10 修复（本轮实现，照 #460 thread.mutate 的既有规矩）
- 服务端：`CHAT_WRITE_CAPABILITIES` 新增显式能力 `artifact.land`
  （写角色下发；观察者/个人线程不下发；不拿 `composer.send` 当代理推断）。
- 前端：`ChatLiveMessagePanel` 新增**必填** `canLandArtifacts` prop，
  两个调用方都从服务端 `getThread.out.capabilities` 取值——必填是刻意的，
  typecheck 实测抓到 8 处单测调用点漏传。
- 反证两侧：`chat-main-shots.spec.ts` 断言个人线程按钮 count=0；
  `chat-read.spec.ts` 断言 facilitator 项目线程按钮可见（防把「按能力渲染」
  写歪成「一律不渲染」）。
- 单测 `artifact-land-capability.test.ts` 钉死能力下发边界。
- 验证：tsc/lint 绿、tests/chat 193 passed、verify:chat-read 3 passed、
  shots:chat-main 1 passed（新断言在跑）、verify:core-loop 13 passed。

#### 开放问题（不由实现者选边）
- 个人对话要不要**真的**支持落地产物（评分员修法②，契约语义变更，ADR-023）
  ——本轮修复只消灭「前端渲染 vs 后端恒拒」的不一致，产品问题留给人类。
- H3-b（无关既有失败算不算 H3 不过）仍待裁决，本轮因 verify:base 真绿而
  未被触发，但规则空洞还在。

#### 下一轮
P10 修复合入 main 后起 round 17 独立评分——若 P10 转正，P 组 **10/10**。
D 组按用户指示仍暂停。
