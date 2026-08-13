# agent-tool-chain（TOOLCHAIN-01）UI 先行原型 —— 截图与状态清单

> ADR-023 签核第 ① 件（UI）材料。**人类**在束级 `contracts/<束>/design-signoff.md`
> 第 ① 件签核时看这里；本文件只列"待确认清单"，**不改任何 status**。

TOOLCHAIN-01 = 把**活体 run** 的工具调用链从 `<details open>`（默认全展开、占 composer 下方
一大块）重画成 **Claude-Code 风折叠式**（默认收起成一行摘要，点开才展开）。视觉语言对齐
**持久消息**的 `ToolCalls`（`ai-message.tsx` 第 82 行，本已是理想折叠式）。
纯客户端渲染 mock 的 `AgentRunView["steps"]`，**不接后端**。

## ⚠ 头等待人类裁决：默认收起 vs 默认展开（P7 冲突）

**签核落地前，此项必须有人类一句话结论。** 详见 `design-note.md` 顶部同名小节。摘要：

> 活体那块的 `<details open>` 默认展开是**故意**的（`chat-live-message-panel.tsx` 第 1135 行
> 注释：「P7 round 17 的 10/10 判据要求工具调用的参数/终态**默认可见**」）。改成"默认收起"
> **直接反转**了这条已得 10/10 的验收判据。
>
> - **方案 A（推荐）**：默认收起 + 一行摘要。符合用户诉求，信息不丢（终态在摘要行可见、
>   参数/结果一键可达）。
> - **方案 B**：保持默认展开（P7 旧判据），只采用本原型的摘要头样式。
>
> **我推荐 A，但这是人类给的 10/10，得人类明确重裁。** 选 B 只需给组件传 `defaultOpen=true`，
> 无需改结构。

## 预览怎么跑

```bash
cd apps/web && PORT=3132 pnpm dev
# 浏览器打开（顶部有场景切换 pill）：
#   http://localhost:3132/preview/agent-tool-chain?scene=collapsed   # 主打：3 工具全绿，默认收起
#   http://localhost:3132/preview/agent-tool-chain?scene=expanded    # 同数据默认展开
#   http://localhost:3132/preview/agent-tool-chain?scene=failure     # 含 1 个失败
#   http://localhost:3132/preview/agent-tool-chain?scene=no-tools    # 模型直接作答
#   http://localhost:3132/preview/agent-tool-chain?scene=single      # 单工具
# 每屏都可手动点摘要行展开/收起。
# 截图复现（light + dark，收起态 + 展开态）：
BASE=http://localhost:3132 \
  OUT=$(cd .. && pwd)/phases/phase-02-visible-outcomes/ui-preview/agent-tool-chain \
  node scripts/shot-agent-tool-chain.mjs
```

## 截图 ↔ 状态 ↔ 落点（`-dark.png` 为对应深色态）

| 截图 | scene | 对应 UC 节 | 覆盖状态 | 关键 testid |
| --- | --- | --- | --- | --- |
| `toolchain01-chain-default-collapsed.png` | collapsed | UC-8.2 R7 工具调用层 · R8「活体 run 观感」 | **默认（主打）**：一行摘要 `思考了 3.5 秒 · 调用了 3 个工具 ✓`，不占底部一大块 | `agent-tool-chain` · `agent-tool-chain-summary` · `agent-tool-chain-toggle` · `agent-tool-chain-ok` |
| `toolchain01-chain-expanded.png` | collapsed（点开） | 同上 | **成功（展开）**：逐条 toolName + 完成徽标 + 参数 + 结果 + planningNote | `agent-tool-chain-detail` · `agent-tool-chain-step-{0..2}` · `agent-tool-chain-plan-{i}` |
| `toolchain01-chain-with-failure-collapsed.png` | failure | 同上 · 异常态 | **依赖失败（收起）**：摘要右侧红色 `1 个失败` 徽标，不点开也知出事 | `agent-tool-chain-fail-badge` |
| `toolchain01-chain-with-failure-expanded.png` | failure（点开） | 同上 | **依赖失败（展开）**：失败行 destructive 色 + 「失败原因：上游 502…」，成功行仍绿 | `agent-tool-chain-step-1`（`data-tool-status="failed"`） |
| `toolchain01-chain-no-tools-collapsed.png` | no-tools | 同上 | **空（收起）**：`思考了 2.1 秒 · 模型直接作答` | `agent-tool-chain-summary` |
| `toolchain01-chain-no-tools-expanded.png` | no-tools（点开） | 同上 | **空（展开）**：「本次没有工具调用，模型直接作答」 | `agent-tool-chain-no-tools` |
| `toolchain01-chain-single-collapsed.png` | single | 同上 | **成功（单工具）**：`思考了 0.9 秒 · 调用了 1 个工具 ✓`（不写"1 个工具"以外的复数腔） | `agent-tool-chain-summary` |

七态映射说明（本渲染层天然只涉及其中几态）：
- 默认 / 成功 → collapsed、expanded、single
- 校验失败 + 依赖失败 → failure（工具级 `status:"failed"`，mock 为外网 502/依赖不可用）
- 空 → no-tools（run 有 step 但无 tool_call）
- 加载态 → **不属于本层**：活体在工具调用**真正完成后**才写 step，调用期间无中间态可读
  （沿用活体"不做假的正在调用动画"的既定纪律，见 design-note §6）
- 无权限 → **不属于本层**：权限是服务端投影，本组件只渲染拿到的 steps（见待确认第 4 条）

## 我替 UC 做了哪些它没写明的设计决定（请逐条确认）

1. **摘要文案措辞**：`思考了 {秒} 秒 · 调用了 {N} 个工具`，秒数缺失时去掉"思考了 X 秒 · "
   前缀（不编耗时），N=0 时说"模型直接作答"（不写"调用了 0 个工具"）。**这些具体措辞是我定的**，
   UC 只说要有摘要。若产品有既定文案规范，以规范为准。
2. **终态放图标不放文案**：全绿用 `CheckCircle2`（primary），有失败用红色 `{n} 个失败` 徽标，
   都在收起态右侧。**决定点**：是否接受"失败在收起态就用红徽标显性暴露"（我认为该暴露——
   出错不该藏在折叠里）。
3. **展开体沿用活体旧样式**：逐条 Wrench+调用名+完成/失败徽标+参数+结果+planningNote 斜体前置，
   与活体 `AgentRunToolCallStepList` 一致。我**没有**重画展开内容，只改了"默认是否铺开"。
   若人类想顺带调整展开体密度/字段顺序，请在此提出。
4. **本层不做空正文/无权限态**：组件只渲染传入的 `steps`。空正文由上游消息流决定，权限是
   服务端投影，不在此组件。请确认这个边界划分符合预期（与 VZ-01 同款边界）。
5. **失败徽标文案 `{n} 个失败`**：多失败时只显示计数不逐一点名（点开可见）。若产品希望收起态
   就点名首个失败工具，可调——但会加长摘要行、可能换行，与"收起态一行"目标相悖。

## R8 线索之间的矛盾 & 处理

- **最大矛盾 = P7 冲突**（默认展开 vs 收起），已提到本文件与 design-note 最前，交人类裁决。
  这是"用户本次诉求"与"一条已得 10/10 的旧验收判据"正面对撞，agent 不自行裁。
- 次要：R8 既要"活体 run 可观测（看到调用了什么、结果如何）"，又要"不占界面一大块"。
  处理：收起态用摘要 + 终态图标**保住可观测的最小信号**（调了几个、成没成），完整细节
  折进一键展开——两者不再二选一。

## 建议签核时重点核对的 3 处

1. **P7 冲突的裁决**（头等）：默认收起（A，推荐）还是默认展开（B）。这是能否落地第 3 步
   （改活体 `chat-live-message-panel.tsx`）的前置条件。
2. **failure 屏**：收起态红色 `1 个失败` 徽标 + 展开态失败行 destructive 色 + 「失败原因」回显，
   是否达到"出错显性、不静默"的标准（这是与旧原型 happy-path 的关键差别）。
3. **collapsed 主打屏的信息密度**：一行摘要 `思考了 3.5 秒 · 调用了 3 个工具 ✓` 在真实体量下
   是否够传达"发生了什么"，且与持久消息 `ToolCalls` 的 `工具调用 · N｜读了 X 条 · Y token`
   摘要风格是否协调（避免同一产品两种摘要腔）。
