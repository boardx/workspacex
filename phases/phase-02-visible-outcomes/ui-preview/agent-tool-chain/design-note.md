# TOOLCHAIN-01 设计说明 —— 活体 run 工具调用链改折叠式内联展示

> ADR-023 签核第 ① 件（UI）支撑材料。给 coord / 人类评审看"怎么做的、为什么、
> 单源纪律怎么守的"。截图与状态清单见同目录 `README.md`。
> **完全对齐 VZ-01 的物料结构**（同为 chat 消息渲染面）。

## ⚠ 头等待裁决项：默认收起 vs 默认展开（P7 冲突）——请人类明确重裁

这是本原型**唯一**需要人类拍板的争议，放在最前面：

- **现状**：活体那块 `AgentRunToolCallSteps`（`chat-live-message-panel.tsx` 第 1138 行）
  是 `<details open>`——**默认全展开**。第 1135 行注释写明这是**故意**的：
  > 「P7（round 17 的 10/10）判据要求工具调用的参数/终态**默认可见**。」
- **本原型**：改成 **Claude-Code 风的默认收起**（一行摘要，点开才见参数/终态）。
  这**直接反转**了那条已经拿到 10/10 的 P7 验收判据。
- **所以**：能不能落地，取决于人类**明确重新裁决**：
  - 方案 A（本原型推荐）：**默认收起 + 一行摘要**。符合用户本次诉求（"不再占底部一大块"）；
    信息**不丢**——摘要行已表达终态（全绿 ✓ / 红色失败计数），参数/结果**一键可达**。
  - 方案 B：**保持默认展开**（P7 旧判据），只把本原型的一行摘要样式作为"可收起"的头。
- **我的推荐 = A**，理由：P7 要的是"可见"，收起态并没有让它不可见，而是让它"默认不铺开、
  一键展开"。但 P7 是**人类**给的 10/10，**agent 不能替人类反转人类的判据**——
  故把决定权交回人类。若人类选 B，`AgentToolChain` 的 `defaultOpen` 传 `true` 即可，
  组件本身两态都支持，无需改结构。

**签核落地前，此项必须有人类的一句话结论。** 组件默认 `defaultOpen=false`（即方案 A），
但这只是原型缺省，不构成对 P7 的既成反转。

## 1. 目标与边界

- **要补什么**：活体 run 的工具调用链现在 `<details open>` 默认全展开、常驻 composer
  下方把界面往上挤，逐条铺开「调用 X ✓完成 / 参数:{} / 结果:…」。TOOLCHAIN-01 把它
  重画成与**持久消息** `ToolCalls`（`ai-message.tsx` 第 82 行）一致的折叠式：默认收起
  成**一行**摘要，点开才展开。属于 R8 的**原型待补**（渲染在、观感不对，非全新屏）。
- **对齐对象**：`ai-message.tsx` 的 `ToolCalls`——**它已经是**理想折叠式（border-subtle/card
  容器、ChevronRight 旋转、text-11 摘要、hover:bg-muted）。本组件复用同一套视觉语言，
  不另起一套。这是"两处工具链行为不一致"的收敛方向。
- **纯客户端原型**：吃 mock 的 `AgentRunView["steps"]`（活体轮询里**已有**的字段，
  无新接口、无后端逻辑）。签核后由第 3 步把 `chat-live-message-panel.tsx` 换成本组件
  （**本轮不碰**活体文件）。

## 2. 组件结构

```
app/preview/agent-tool-chain/page.tsx     (server, 场景切换 + mock 落点框架)
  └─ AgentToolChain (client)              components/chat/agent-tool-chain.tsx
       ├─ toolChainSummaryText(steps)     ← 收起态一行摘要文案（下节）
       ├─ 收起头：ChevronRight + 摘要 + 终态指示（✓ / 红色失败计数）
       └─ 展开体：
            ├─ toolSteps.length===0 → 「本次没有工具调用，模型直接作答」
            └─ 否则 <ol> 逐条 ToolChainStep：
                 planningNote(有则) · Wrench+调用名+完成/失败徽标 · 参数 · 结果/失败原因
```

- 数据形状与纪律**照搬活体**：每个 tool_call step 的 `toolName`/`toolArgsSummary`/
  `toolResultSummary`/`planningNote` 任一为 `null` 就**不渲染那行**，绝不用占位文案顶替。
- `deriveThinkingSeconds` 逻辑与活体 `deriveThinkingSummary` **一字不差**（秒数 = 最晚
  endedAt − 最早 startedAt；无法解析则 null）——不引入第二套推导，避免"同一事实两处声明"。

## 3. 摘要文案的推导规则（收起态一行）

`toolChainSummaryText(steps)`：
- 令 `seconds = deriveThinkingSeconds(steps)`，`N = tool_call 步数`。
- `head = seconds!==null ? "思考了 {seconds} 秒 · " : ""`（秒数缺失就不编，直接不带秒）。
- `N===0` → `{head}模型直接作答`（不显示"调用了 0 个工具"这种别扭话）。
- `N>0`  → `{head}调用了 {N} 个工具`。
- **终态指示不进文案、进图标**（收起态右侧）：全绿 → `CheckCircle2`（text-primary）；
  有失败 → `Badge tone="danger"` 显示 `{failCount} 个失败`（不点开就知道出事了）。

样例（见截图）：`思考了 3.5 秒 · 调用了 3 个工具 ✓` / `思考了 7.7 秒 · 调用了 3 个工具 [1 个失败]`
/ `思考了 2.1 秒 · 模型直接作答` / `思考了 0.9 秒 · 调用了 1 个工具 ✓`。

## 4. 设计 token / 排版（无裸数值）

- 容器/交互**照搬 `ToolCalls`**：`rounded-md border border-border-subtle bg-card`；
  头 `px-2.5 py-1.5 text-11 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring`；
  `ChevronRight h-3.5 w-3.5 transition-transform ... open&&rotate-90`。
- 字号全取 `lib/font-scale.ts` 档位：摘要 text-11、参数/结果 text-10、徽标 text-10（Badge 内置）。
  **无 text-15 等表外档位。**
- 色彩全走 `globals.css` CSS 变量：`card-foreground`/`muted-foreground`/`border-subtle`/
  `primary`（成功 ✓/完成徽标）/`destructive`（失败原因文字 + 失败徽标）。
- 徽标复用既有 `Badge`（tone `primary`/`danger`），图标复用 lucide `CheckCircle2`/`XCircle`/
  `Wrench`/`ChevronRight`——与活体、与 `ToolCalls` 同一套，无新增依赖。
- `pnpm --filter web lint:design` 全绿（token / 字号 / testid 命名）。

## 5. 与既有设计语言的一致性

- **对齐持久消息 `ToolCalls`**：同容器、同 chevron 旋转、同 text-11 摘要、同 hover——
  这正是任务要求的"两处工具链视觉统一"。
- **保留活体的展开体形态**：逐条 Wrench+调用名+完成/失败徽标+参数+结果/失败原因、
  planningNote 斜体前置——与活体 `AgentRunToolCallStepList` 一致，只是从"默认铺开"
  收进"点开才见"。用户已熟悉的展开内容不重画。
- **AI 在场方式**仍是"线程里的同事 / 后台的 worker"（run 落在 composer 下方的既有落点），
  未另起一套心智。

## 6. 七态覆盖（本渲染层天然只涉及其中几态）

- 默认 → collapsed 收起（主打屏）
- 成功 → collapsed / expanded（全绿 ✓）
- 校验失败 + 依赖失败 → failure 屏（工具级 `status:"failed"`，失败原因走 destructive；
  mock 里 `fetch_external_market_data` 的 502/外网依赖不可用即"依赖失败"的具体形态）
- 空 → no-tools（run 有 step 但无 tool_call → 「模型直接作答」）
- 加载态 → **不属于本层**：活体在 tool_call 真正完成后才写 step，调用期间没有中间态可读
  （活体注释第 1099–1104 行已论证"不做假的正在调用动画"）。整体"正在执行"由 run 状态
  上游负责，本组件不重复表达。
- 无权限 → **不属于本层**：权限是服务端投影，本组件只渲染拿到的 steps。
  见 README 待确认第 4 条。

## 7. 自检结果

- `pnpm --filter web exec tsc --noEmit` → exit 0（无 web 报错）。
- `pnpm --filter web lint:design` → 全部通过。
- dev server（PORT=3132）起得来，5 个 scene 均 HTTP 200，Playwright 探测**零 console error**
  （shot 脚本内置 console 监听，有 error 即 exit 1；本次 exit 0）。
- 截图 14 张：7 场景 × （light + dark），收起态与展开态各拍。
- 每个可交互/关键展示元素带 testid（见 README 表）。

## 8. 变更清单

新增：
- `apps/web/components/chat/agent-tool-chain.tsx`（折叠式组件 + 摘要推导）
- `apps/web/lib/mock/agent-tool-chain.ts`（5 场景 mock steps）
- `apps/web/app/preview/agent-tool-chain/page.tsx`（预览路由）
- `apps/web/scripts/shot-agent-tool-chain.mjs`（截图脚本，light+dark）
- `phases/phase-02-visible-outcomes/ui-preview/agent-tool-chain/`（本目录：14 张截图 + README + 本文件）

**未触碰**：任何 `apps/api/**`、任何 `packages/contracts/**`、任何 `requirements/**`、
任何 `design-signoff.md` 的 status，以及**活体 `chat-live-message-panel.tsx`**（那是签核后
第 3 步的活）。本轮只做原型供签核。
