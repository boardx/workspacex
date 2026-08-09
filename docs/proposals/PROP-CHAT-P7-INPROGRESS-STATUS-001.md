# PROP-CHAT-P7-INPROGRESS-STATUS-001 — 「工具调用『正在调用中』在途态」提案

> 状态：**待人类 / coord-main 裁决，未执行**。
> 本文档只是提案，不代表任何代码已经开始改动，等人类/coord-main 拍板后再动工。
> 发起：issue #728 独立评分（rev-uiux）在 P7（工具调用可见）判据上给出"缺一档在途态"的
> 扣分意见与修法建议，本 agent 受命核实该修法描述、评估影响面，产出书面提案供裁决。

## 一、结论先行

rev-uiux 的判断——"当前实现只有工具调用的终态（成功/失败）可见，没有『正在调用中』的
在途态"——**核实为真**，且是当前代码的刻意设计（有专门的注释解释为什么不做），不是遗漏。
但 rev-uiux 给出的**具体修法描述里，四处文件/函数指认与当前代码实际路径不符**，见第二节
「对修法描述的核实结果」。本提案在核实清楚真实改动点的基础上，重新列出改动形状，并把
"要不要推翻现有的『不做假在途态』设计决定"这件事原样交给人类裁决，不擅自做主。

## 二、对修法描述的核实结果

逐条核对 rev-uiux 给出的五点描述：

| # | rev-uiux 的描述 | 核实结果 |
|---|---|---|
| 1 | `packages/contracts/src/wave2-runtime.ts` 的 `AgentRunStepStatus` 是 `z.enum(["succeeded","failed"])`，需要扩成三态 | **准确**。实际在该文件第 205 行：`export const AgentRunStepStatus = z.enum(["succeeded", "failed"]);` |
| 2 | `AgentRunStep.endedAt` 是 `z.string()` 非空必填，需要 nullable | **准确**。第 263-264 行：`startedAt: z.string(), endedAt: z.string(),`，两者都非空必填 |
| 3 | 需要对应的数据库 migration | **准确，且方向找对**，具体形状见第三节 |
| 4 | `deep-agent-model-provider.ts` 的 `extractToolCallEvents`，在 `pending.set(id, ...)` 那一刻 emit "running" 事件，与文件头注"a call announced but not yet answered is not reported early as a guess"冲突 | **文件与函数名不存在，指认有误**。仓库里没有 `deep-agent-model-provider.ts` 这个文件，也没有 `extractToolCallEvents` 这个函数（`grep -rln "extractToolCallEvents" apps/api` 零命中）。工具调用循环的真实位置是 `apps/api/src/application/agent-run/execute-run.ts` 里的 `executeToolLoop`（第 291-376 行），它 `await executeSkillTool(...)` **拿到结果之后**才调用 `record()`（第 354-362 行）把这一步写入 `agent_run_steps`——即调用发起时确实没有任何"我正在调用"的落库动作，**这个核心事实和 rev-uiux 的判断一致**，只是承载它的文件/函数名认错了。"a call announced but not yet answered..." 这句英文头注本身在当前代码里也搜不到，可能是评分员记忆里另一版本代码的注释，或是对 `chat-live-message-panel.tsx` 里下面这段中文注释的转述（见第四节原文引用）——真正对应的设计理由写在前端，不在后端 |
| 5 | `apps/web/components/chat/chat-live-message-panel.tsx` 的 `AgentRunToolCallSteps` 是二元判断（`succeeded ? 完成 : 失败`），需要改成三态渲染 | **准确**。第 714-760 行的 `AgentRunToolCallSteps`：`const succeeded = step.status === "succeeded";` 后直接二元分支渲染 `完成`/`失败` 两个 `Badge`，没有第三态处理 |

**结论**：核心论点站得住——工具调用步骤的"进行中"状态在当前架构里**从未被落库过**，前端自然也就渲染不出来；这不是前端遗漏，是后端从设计上就只在调用**完成之后**才写这条 step。但 rev-uiux 指认的具体文件路径（`deep-agent-model-provider.ts`）和函数名（`extractToolCallEvents`、`completeWithProgress`）在当前 SHA 下**都不存在**，`grep -rn "completeWithProgress" apps/api/src` 同样零命中。这份提案改用下面核实过的真实路径。

### 真实的改动点（替代 rev-uiux 的文件指认）

- 契约：`packages/contracts/src/wave2-runtime.ts:205`（`AgentRunStepStatus`）、`:260-289`（`AgentRunStep`，`startedAt`/`endedAt`）
- 后端类型镜像：`apps/api/src/application/agent-run/ports.ts:76`（`AppendedRunStep.status: "succeeded" | "failed"`，是契约类型手写的一份 TS 镜像，同样需要跟着改）
- 后端写入逻辑：`apps/api/src/application/agent-run/execute-run.ts` 的 `executeToolLoop`（291-376 行）与 `record()`（171-196 行）—— 这是真正决定"什么时候写一条 tool_call step"的地方，不是所谓的 model provider 文件
- 落库：`apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts:161`（`appendStep`）
- 前端渲染：`apps/web/components/chat/chat-live-message-panel.tsx:714-760`（`AgentRunToolCallSteps`）

## 三、Migration 形状预估（不写代码，只描述形状）

`agent_run_steps` 表当前由 `apps/api/migrations/20260805110000_wave2_agent_run_execution.sql`
（第 81-109 行）建表，此后被两次 `ALTER TABLE` 增量修改：
`20260808130000_i725_tool_calling_loop.sql`（加 `tool_call` 到 `kind` 枚举）、
`20260808140000_i731_tool_call_planning_note.sql`（加 `planning_note` 列）。当前 schema：

```
ended_at      timestamptz NOT NULL   -- 需要改 nullable
status        text NOT NULL
CONSTRAINT agent_run_steps_status_check CHECK (status IN ('succeeded', 'failed'))
CONSTRAINT agent_run_steps_failure_shape_check CHECK (
  (status = 'failed' AND failure_code IS NOT NULL)
  OR (status = 'succeeded' AND failure_code IS NULL)
)
```

新增一条 `2026080Xxxxxxx_iNNN_tool_call_running_status.sql`，形状预估：

1. `ALTER TABLE agent_run_steps ALTER COLUMN ended_at DROP NOT NULL;`—— running 态的 step 还没结束。
2. `DROP CONSTRAINT agent_run_steps_status_check` 后重建为 `CHECK (status IN ('running','succeeded','failed'))`。
3. `agent_run_steps_failure_shape_check` 需要重写，三态而非两态：`running` 时 `failure_code IS NULL` 且（建议）`ended_at IS NULL`；`succeeded` 时 `failure_code IS NULL` 且 `ended_at IS NOT NULL`；`failed` 时 `failure_code IS NOT NULL` 且 `ended_at IS NOT NULL`。**这条约束是本次改动里最容易写错的一条**——三态交叉两个可空字段，组合数变多，需要显式列出而不是简单加一个 OR 分支。
4. 追加只读约束——`agent_run_steps` 表当前有 `agent_run_steps_append_only_trg`（第 124-126 行，`BEFORE UPDATE OR DELETE` 触发器拒绝任何更新/删除）。**这一条触发器与"running → succeeded/failed 需要原地更新同一行"直接冲突**——rev-uiux 的五点描述完全没提到这一点，是本次核实发现的额外复杂度（见下一节"遗漏的复杂度"）。
5. 契约侧同步：`wave2-runtime.ts` 与 `pg_constraint` 之间的等价性由 `no-tool-run-writeback.test.ts` 读 `pg_constraint` 断言 set equality（见 `wave2-runtime.ts:214-217` 头注），改枚举必须两边一起改，否则该测试会红。

## 四、"不做假在途态"注释原文与出处

原文引用（`apps/web/components/chat/chat-live-message-panel.tsx` 第 704-713 行，
`AgentRunToolCallSteps` 组件正上方的文档注释）：

> ```
> /**
>  * #731 follow-up —— chat-ux-acceptance-criteria.md 第 2/3 项在界面上的交付物。
>  *
>  * ## 数据源：轮询里已经有的东西，不是新接口
>  * ...
>  *
>  * ## 为什么不做"正在调用中"的假动画
>  *
>  * 后端只在一次工具调用**真正完成**（成功或失败）之后才写入这条 step——调用期间没有
>  * 中间状态可读。伪造一个"正在调用…"的过渡态会是一句界面从未验证过的谎言；这里如实
>  * 只展示"已经发生的事"，`AgentRunStatus` 上方已有的"正在执行"整体状态负责传达"run
>  * 还没完"，两者不重复表达同一件事。
>  */
> ```

出处：`git log --follow -S "假动画" -- apps/web/components/chat/chat-live-message-panel.tsx`
定位到 commit `d9561e71`（`feat(chat): #728 D6 —— cherry-pick #732 工具调用可见性渲染，接进
新的消息行结构`），是从 issue #732 的原始实现 cherry-pick 进当前分支的，本分支上没有比这更早
的版本可比对。这条注释当初的理由是**如实性原则**：与其在前端伪造一个"看起来在动"但背后
没有真实数据支撑的过渡态（这正是 `chat-ux-acceptance-criteria.md` 第 23 行"没有真实数据
支撑的能力，不做假 UI"明令禁止的事），不如承认后端确实没有这个数据，用上方已有的整体
`AgentRunStatus`（"正在执行"）承担"run 还没完"这个信息，工具调用列表只展示已发生的事实。
这是一个**自洽的、有文档理由的设计决定**，不是遗漏或疏忽——所以要推翻它，需要人类明确
拍板，不能当作一次普通的 bug 修复处理。

## 五、为什么这条改动需要人类签核

1. **涉及共享契约**：`AgentRunStepStatus`/`AgentRunStep` 定义在 `packages/contracts/`，
   是前后端共用的单一事实源，`AGENTS.md`「设计签核」硬约束明确把契约级变更划进签核范围。
2. **推翻一条已有的、写明理由的设计决定**：第四节引用的注释不是过时代码，是当前分支
   （`worker/dev-chat-e2e-01-chat-main-fidelity`，issue #728）里活跃的实现依据。推翻它
   意味着承认"过去这个理由不成立了"，这是产品/架构判断，不是代码正确性问题。
3. **需要 migration**：任何触碰 `agent_run_steps` 表结构或约束的改动都要经过评审——
   尤其这张表还挂着一条 append-only 触发器，第三节第 4 点已指出这条改动会与它正面冲突，
   这是一处需要人类明确决定怎么处理的架构选择，不是可以顺手改掉的细节。

## 六、两个可选路径

### 路径 A：做这个改动，让"运行中"成为真实的、有数据支撑的状态

把 `pending`（工具调用已发出、结果未回）在**调用发起时**就落一条 `status='running'` 的
step，等结果回来后**原地把同一行更新**为 `succeeded`/`failed`（而不是新插一行）。前端按
三态渲染，运行中显示中性徽标（不是绿色"完成"也不是红色"失败"）。

**粗略工作量估计**：中等，预估 0.5-1 天（不含评审等待时间）。分五块：
1. 契约改 `AgentRunStepStatus` 枚举 + `endedAt` nullable（`wave2-runtime.ts`，~10 行）。
2. Migration：新增一条 `ALTER TABLE`，重写两条 CHECK 约束，**外加处理 append-only
   触发器与"running→终态需要原地更新"的冲突**（见下方风险点，这是唯一预估不确定的部分）。
3. `execute-run.ts` 的 `executeToolLoop`：在 `await executeSkillTool(...)` **之前**插入
   一次"发起"落库（新方法，例如 `beginStep`），拿到结果后原来的 `record()` 改成"更新
   已存在的行"而不是"插入新行"——这是对 `AppendedRunStore` 接口（`ports.ts`）的新增方法，
   不是对现有 `appendStep` 语义的复用，因为 `appendStep` 目前的唯一约束
   `agent_run_steps_seq_uniq UNIQUE (org_id, run_id, seq)` 和 append-only 触发器都假设
   "一个 seq 只写一次"。
4. `pg-agent-run-repository.ts`：新增对应的 SQL（INSERT running 态 / UPDATE 终态）。
5. 前端 `AgentRunToolCallSteps`：三态渲染分支 + 一个新的中性色 `Badge`。

**风险点**：
- **append-only 触发器是本次核实发现的、rev-uiux 完全没提到的额外复杂度**——`agent_run_steps`
  当前设计假设每个 `(run_id, seq)` 只写一次、写完不再改，这是一条有意的完整性保证
  （防止篡改历史）。"running → 终态原地更新"天然要求打破这条假设，需要人类明确选择：
  (a) 允许 `running → succeeded/failed` 这一条特定路径的更新（触发器加白名单逻辑），
  或 (b) 保持 append-only，改为"运行中插一行 running，完成后再插一行终态，同一 `toolName`
  出现两条 step"，让前端做去重/合并渲染。两种做法工作量和前端复杂度都不同，需要在动工前
  选定，本提案不代自行选择。
- **契约改动的影响面**：`grep` 结果显示 `AgentRunStepStatus`/`AgentRunStep` 目前只有三处
  引用（`execute-run.ts`、`ports.ts`、`wave2-runtime.ts` 本身），前端消费方只有
  `chat-live-message-panel.tsx` 一处，**没有发现其他 provider 或调用方依赖这个契约**——
  这一点风险比预想的小，但 `no-tool-run-writeback.test.ts` 依赖枚举与 `pg_constraint` 的
  set equality，改枚举必须连带更新，漏改会让该测试直接红。
- 需要确认 `deep-research-model-provider.ts`（真实存在的 model provider 文件，`complete()`
  的实现方）本身不需要改——核实结果是**不需要**，"何时落库"的决定权在 `execute-run.ts`
  的编排层，不在 provider 层，provider 只负责单次模型调用。

### 路径 B：不改契约，转而调整判据本身

承认"只有终态可见"是当前可接受的产品行为，回到 `chat-ux-acceptance-criteria.md` 第 3 项
（第 49-50 行："界面上是否能看到『正在调用 XX』、调用参数摘要、成功/失败状态"）本身，
由人类判断是否要把"正在调用 XX"这半句拿掉或改写为"调用参数摘要、成功/失败状态"这两项
即可满足 P7，不再要求在途态。这条路径**不涉及代码改动**，只涉及判据文档本身的修订，
修订本身也要走人类裁决（判据文件不是 agent 可以单方面改的）。

## 七、建议的下一步

1. 人类 / coord-main 在路径 A / B 之间二选一。
2. 若选 A：进一步明确 append-only 触发器冲突的处理方式（本节"风险点"第一条的 (a)/(b)），
   再走 `AGENTS.md`「设计签核」流程（契约束的 `design-signoff.md`）。
3. 若选 B：由人类直接修订 `chat-ux-acceptance-criteria.md` 第 3 项文字，不需要动代码。
4. 无论选哪条，在裁决落地前，issue #728 当前分支上的其余工作按已授权范围继续推进，
   不应因这一条待裁决的提案而阻塞。

---

*本提案由 dev-chat-e2e worker（issue #728 分支 `worker/dev-chat-e2e-01-chat-main-fidelity`）
于 2026-08-09 核实 rev-uiux 评分意见后起草，未获任何架构裁决权。*
