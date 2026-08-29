# Phase 14 · Phase 1 UI 先行原型（成本条 + 工具量化摘要）

> ADR-023 签核第 ① 件（UI）的材料。**纯前端 mock，不接后端、不改 schema、不动 `feature_list.json`。**
> 走的是 `apps/web` 里真实的组件库与设计 token，人类可点、可切状态、可展开。
> 对应需求：`requirements/phase1-cost-and-trace.md`（需求 1 = 成本条；需求 2 = 工具量化摘要）。

## 本地预览

```bash
cd apps/web && npx next dev -p 3242
# 需求 1（成本条）：
#   http://localhost:3242/preview/plan-run-cost?scene=default
# 需求 2（工具量化摘要）：
#   http://localhost:3242/preview/tool-summary?scene=with-summary
```

顶部一排 pill 切换场景（URL `?scene=` 也可直接改）。

## 截图清单

### 需求 1 —— Run 级成本/预算追踪条（七态 + 逼近/超支色调）

组件：`apps/web/components/plan-control/plan-run-cost-bar.tsx`
预览页：`apps/web/app/preview/plan-run-cost/page.tsx`（上方并排真实 `plan-run-progress` 证明设计语言一致）
mock：`apps/web/lib/mock/plan-run-cost.ts`

| 截图 | scene | 覆盖状态 |
|---|---|---|
| `req1-cost-bar-default.png` | default | 默认（执行中·健康区间 45%） |
| `req1-cost-bar-loading.png` | loading | 加载（skeleton，`data-testid="loading"`） |
| `req1-cost-bar-empty.png` | empty | 空（刚发起，¥0.00，`data-testid="empty"`） |
| `req1-cost-bar-invalid.png` | invalid | 校验失败（账本非法金额，`role="alert"` `data-testid="err-cost"`） |
| `req1-cost-bar-dep-failed.png` | dep-failed | 依赖失败（组织无预算分母，`data-testid="dep-failed"`，仍显示本轮 ¥） |
| `req1-cost-bar-denied.png` | denied | 无权限（看不到组织预算，`data-testid="denied"`，仍显示本轮 ¥） |
| `req1-cost-bar-success.png` | success | 成功（run 已终态·已结算 ¥2.47） |
| `req1-cost-bar-warning.png` | warning | 偏高（70–90%，黄色调） |
| `req1-cost-bar-over.png` | over | 超支（≥100%，红色调 + 「已超本月预算」徽标） |

### 需求 2 —— 工具执行结果结构化摘要（量化信息 + 优雅回退）

组件：`apps/web/components/chat/agent-tool-chain.tsx`（新增**可选** `resultSummaries` 入参）
＋ 共用渲染 `apps/web/components/chat/tool-result-quantities.tsx`
＋ 格式化器 `apps/web/lib/tool-result-summary.ts`
预览页：`apps/web/app/preview/tool-summary/page.tsx`
mock：`apps/web/lib/mock/tool-result-summary.ts`

| 截图 | scene | 覆盖情况 |
|---|---|---|
| `req2-tool-summary-with-summary.png` | with-summary | 读取类工具全带量化 chip（命中 12 条 · 41,208 行 8.4 MB · 3 行），写入类工具无摘要回退纯文字 |
| `req2-tool-summary-mixed.png` | mixed | 部分工具带、部分回退（核对不串味） |
| `req2-tool-summary-fallback.png` | fallback | 完全不传摘要（现状），逐字回退纯文字——不报错、不留白 |

## 取证复现

```bash
# 预热 dev server（端口 3242），另一终端：
cd apps/web && npx playwright test --config=playwright.phase14-shots.config.ts
```
截图落到本目录。spec：`apps/web/e2e/phase14-cost-trace-shots.spec.ts`。

## data-testid 锚点（供 verification / rev-uiux 锚定）

- 成本条容器 `chat-task-workbench-run-cost`；明细按钮 `chat-task-workbench-run-cost-detail`；
  预算占比 `chat-task-workbench-run-cost-budget`；超支徽标 `chat-task-workbench-run-cost-warn-badge`
- 状态锚点：`loading` / `empty` / `err-cost` / `dep-failed` / `denied`
- 工具量化 chip 行 `agent-tool-chain-quantities-<i>`；单 chip `tool-result-quantity-<n>`

---

## 待人类确认清单（我替 UC 做的设计决定 + 矛盾处理）

> 这些是 UC 没写明、我在原型里替它拍板的地方，签核第 ① 件时请逐条核对。

### 需求 1（成本条）

1. **「Y%」的分子到底是「本轮」还是「本月累计」——已定为本月累计。**
   需求正文两句话有张力：用户故事说「占我本月预算的百分比」，期望行为里又有一句
   「这笔花费占…百分比」。前者=本月累计÷预算，后者读起来像本轮÷预算。我选了
   **「本轮成本 ¥X · 本月预算已用 Y%」双指标并列**：¥ 是本轮，% 是本月累计（含本轮）。
   理由：预算是月度池子，「还剩多少」只有按月累计才有意义；本轮 ¥ 单独给量级感。
   **若人类要的是「本轮占预算 %」，改一处 mock 分子即可，组件不用动。**

2. **¥ 用两位小数（¥2.47），不是需求字面的「¥X.X」一位小数。** 模型调用成本常在角分
   量级，一位小数会把 ¥2.47 抹成 ¥2.5、¥1.87 抹成 ¥1.9，失真。取舍写在 `formatCny`。

3. **红/黄阈值我定的：≥90% 红（destructive）、70–90% 黄（warning）、<70% 主色。** 需求
   没给阈值。≥100% 额外出「已超本月预算」徽标。**这只是视觉预警**——按需求边界，
   **不做**任何自动暂停/拦截动作，所以红条旁没有「已暂停」之类按钮。

4. **依赖失败 / 无权限时不整条消失，而是降级：** 仍显示本轮 ¥（那是用户自己 run 的事实），
   只把「% 占比」那半替换成一句说明，且**不画会误导的空进度条**。需求只说了「复用组织配额
   作分母」，没说分母缺席时怎么办——我按「本轮花费始终可见」处理。

5. **加了一个「成本明细」ghost 按钮**（`...-detail`）作为交互抓手，当前是占位（无 onClick 行为）。
   需求没要求下钻明细面板；放这个是给「点了能干嘛」留扩展位，人类可裁掉。

### 需求 2（工具量化摘要）

6. **量化信息落在展开态 per-step 卡片，不塞进收起态一行摘要。** 需求同时点名了
   「折叠态摘要行」和「per-tool 卡片」两个落点。收起态那行摘要（`toolChainSummaryText`）
   是被人类多轮打磨过、有回归判据的文案，往里塞「41,208 行」会挤爆且和既有节奏冲突。
   我把量化 chip 放在**展开后每个工具记录的结果文字正下方**——这正是需求用户故事说的
   「在工具调用记录**旁**看到量化信息」。**收起态是否也要带首个量化，请人类明确。**

7. **`summary` 字段是前端侧的预期形状，本次没动后端契约。** 需求 2 的协议扩展
   （给工具结果 payload 加 `summary: { rows?, bytes?, hits? }`）属于后端契约变更，超出
   「只写前端 + mock」的本次范围。所以 `AgentToolChain` 的 `resultSummaries` 是**可选**入参，
   生产在后端字段落地前**不传**，行为与改动前逐字一致（`fallback` 屏即此）。接线时后端
   提供同名字段，`lib/tool-result-summary.ts` 的类型会被契约推导替换。

8. **chip 文案与单位我定的：** `rows→"41,208 行"`（千分位）、`bytes→"8.4 MB"`（自动 B/KB/MB/GB
   换算）、`hits→"命中 12 条"`。需求只举了「读取 41,208 行」一例，其余单位是我补的。

9. **copilotkit-v2 per-tool 卡片这一路我抽出了共用渲染但没做独立可运行预览。** 需求要求两处
   （`agent-tool-chain` + `copilotkit-v2-tool-renderers`）都展示量化。我把渲染逻辑收敛进
   `tool-result-quantities.tsx` 供两处共用，但可运行原型只做了 `agent-tool-chain` 一路
   （copilotkit-v2 路由需要 CopilotKit provider 运行时，起预览成本高）。接线时把同一个
   `<ToolResultQuantities>` 挂进 v2 renderer 即可，视觉一致由共用组件保证。

## 建议签核时重点核对的 3 处

1. **需求 1 的「Y%」语义**（上面第 1 条）：这是需求正文自相矛盾处，我拍成了「本轮 ¥ + 本月累计 %」。
   若心智应是「本轮占预算」，现在就改，别等接线后返工。
2. **成本条挂载位置**：看 `req1-cost-bar-default.png` 里成本条紧贴在进度条下方——确认这个落点
   与视觉一体感符合预期（两张 Card 上下堆叠 vs. 合成一张卡）。
3. **需求 2 量化只在展开态**（第 6 条）：确认「收起态一行摘要不带量化」可接受；若要收起态也露
   首个量化数字，需要改动那条有回归判据的摘要文案，值得先对齐。
