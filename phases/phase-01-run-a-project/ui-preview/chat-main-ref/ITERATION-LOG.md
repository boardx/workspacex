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
