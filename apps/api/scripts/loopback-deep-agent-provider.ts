#!/usr/bin/env node
/**
 * #728 P6/P7 —— 确定性的 `apps/deep-agent-service` 替身，供 chat-read e2e 用。
 *
 * ## 为什么不是起一个真的 `langgraph dev` 进程
 *
 * `apps/deep-agent-service` 本身在 `Dockerfile` 的头注里写死了：本仓从未在任何自动化
 * 路径（包括 `.harness/scripts/vm/deploy.sh`）里起过它，是人工在 VM 上启动的一个真实
 * Python/LangGraph 服务，且需要真实模型凭据才能让模型自己决定"要不要调工具"。
 * 在 e2e 里接一个从未被自动化过、还依赖真实模型凭据的外部服务，风险和工作量都不是
 * 一轮迭代该扛的。
 *
 * ## 这不是在 UI 层造假，是在同一条真实执行链路上换一个可预测的上游
 *
 * 和 `loopback-model-provider.ts` 同一套纪律（见那个文件的头注）：
 *   · 必须被**显式选中**——只有 `agent_versions.model_provider = "deep-agent"` 的 run
 *     才会打到这里；`DeepAgentModelProvider.startRun` 对不等于 `DEEP_AGENT_PROVIDER_NAME`
 *     的 run 直接拒绝，不存在"顺便"落到这个进程的路径。
 *   · 产品代码里仍然只有 `DeepAgentModelProvider` 一个实现在说话——本进程只是那个
 *     实现要打的 HTTP 上游，`execute-run.ts` 的 `completeWithProgress` 分支、
 *     `extractToolCallEvents` 的配对逻辑、`AgentRunToolCallSteps` 的渲染，一行都没有
 *     被绕过或替换，走的是真代码、真 HTTP、真状态机。
 *   · 缺席时不会有人替它兜底：`KERNEL_DEEP_AGENT_BASE_URL` 不设，run 就以
 *     `MODEL_PROVIDER_NOT_CONFIGURED` 诚实失败。
 *
 * ## 协议来源
 *
 * 严格照抄 `deep-agent-model-provider.ts` 自己文档的四个端点与消息形状（LangChain
 * `AIMessage`/`ToolMessage`），不是猜的：
 *   POST /threads                    -> { thread_id }
 *   POST /threads/:id/runs           -> { run_id }
 *   GET  /threads/:id/runs/:runId    -> { status: "pending" | "success" }
 *   GET  /threads/:id/state          -> { values: { messages: ThreadMessage[] } }
 *
 * 新线程在 POST runs 之前的 `state` 为空；默认剧本开始执行后返回「完整」的
 * 状态（计划句 + 一次工具调用 + 配对的工具结果 +
 * 最终回复），不做「过几轮才补全」的时序游戏——`completeWithProgress` 的轮询循环
 * 本来就会在 run 到终态后再补读一次，用不着靠人为延迟制造"中途态"，那样只会引入
 * e2e 里不必要的时序竞争。`status` 前一次答 `pending`、后一次答 `success`，只是为了
 * 让真实的轮询循环真的转一圈，不是首次调用就终态——这本身也是一种取证：证明轮询
 * 逻辑真的在工作，不是恰好一次到位。
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { PLAN_CONFIRMATION_TOOL_NAME } from "@repo/contracts/plan-control";
import { buildDeepAgentSkillCatalogBlock } from "../src/application/agent-run/skill-catalog";

const port = Number(process.env.LOOPBACK_DEEP_AGENT_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("LOOPBACK_DEEP_AGENT_PROVIDER_PORT must be a positive integer");
}

/**
 * 计划句 + 工具名 + 回显用户原文进结果里，三者都是"闭环真的穿过了整条链"的证据——
 * 同一纪律 `loopback-model-provider.ts` 头注里"为什么要回显用户原文"那段。
 */
const PLANNING_NOTE = process.env.LOOPBACK_DEEP_AGENT_PLANNING_NOTE ?? "我需要先查一下当前时间，再回答这个问题。";
const TOOL_NAME = process.env.LOOPBACK_DEEP_AGENT_TOOL_NAME ?? "lookup_time";
// UI 流式取证的时序旋钮（2026-08-23）：默认值保持既有行为（run ~1s 内完成），
// 取证 config 把两者调大让 run 拖到数秒——截图采样间隔 1.5s，窗口太短第一帧
// 就已终态，streaming 行永远拍不到（v4 取证实测教训）。真实模型是秒级往返，
// 慢速档模拟的才是真实时序，不是造假。
const STATUS_POLLS_BEFORE_DONE = Number(process.env.LOOPBACK_DEEP_AGENT_STATUS_POLLS ?? "2");
const STREAM_GAP_MS = Number(process.env.LOOPBACK_DEEP_AGENT_STREAM_GAP_MS ?? "80");
/**
 * 十步滚动剧本每个「半步」之间的间隔（20 个半步 = 10 对工具调用）。
 *
 * ⚠ 这个旋钮存在的理由，是 2026-09-08 的一次实测反转（issue #3069）。在此之前
 * 该剧本的推进游标是 `record.statusPolls`，而 `/stream` 在 EOF 时把 `statusPolls`
 * 直接推到 `Number.MAX_SAFE_INTEGER`——于是十对工具调用**从不按剧本推进**，而是在
 * 流结束后由 provider 的一次兜底 state 读**一次性全部吐出来**。基线 run
 * 34198904439 的 trace 逐字取证：整轮 776ms，十个 `tool_start` 挤在 135ms 内。
 *
 * 那让两条 spec 断言的是替身根本不具备的性质：
 *   · `agent-workbench-scroll-acceptance` 的「活动必须先于响应结束可见」；
 *   · `agent-workbench-steering-acceptance` 的「轮询要抓到一个进行中的工具」。
 * 两条都不是产品缺陷，是**替身的方言与上游不同**（同一类坑见
 * `.harness/instructions/static-trace-vs-live-fact.md` 的 CRLF 案例）。
 */
const SCROLL_STEP_MS = Number(process.env.LOOPBACK_DEEP_AGENT_SCROLL_STEP_MS ?? "300");
/** 十步剧本的半步总数：`index*2` 宣布第 index 个调用，`(index+1)*2` 落地它的回执。 */
const SCROLL_TOTAL_HALF_STEPS = 20;
/**
 * #742 Gap 1 取证旋钮——多步剧本默认（`STATUS_POLLS_BEFORE_DONE=2`）在第二次状态轮询
 * 就终态，`/state` 从第一次读起就是"完整"的（文件头注原话）：三次工具调用连同各自的
 * `ToolMessage` 结果同时出现，账本里 `in_progress` 行与终态行几乎在同一毫秒内落地，
 * 结构上**不给** `GET /agent-runs/:runId` 的轮询留一个能拍到 `in_progress` 徽标的窗口。
 * 这条旋钮只在多步触发词命中时把该 run 的终态推迟到至少这么多次状态轮询之后，`/state`
 * 按下面 `multistepStage()` 分阶段揭示——每个工具调用在被真正回答之前，先单独停留至少
 * 一轮，好让真实的 `in_progress` 记账行有机会被前端真的轮询到、真的渲染出来。
 * 不影响其它触发词/默认路径（读取时判空/判等）。
 */
// issue #3100 D6：剧本从三步（todos/search/read）变成四步（多了 spawn_async_task），
// 终稿落在第 8 个半步——阈值必须跟着抬，否则非流式路径会在终稿揭示之前就判终态。
const MULTISTEP_MIN_STATUS_POLLS = Number(process.env.LOOPBACK_DEEP_AGENT_MULTISTEP_MIN_POLLS ?? "8");
/** issue #3100 D6 —— 一次派发的子任务描述。**声明提前到这里**：下面 F5/C8 那个旋钮的
 *  `isSpawnedSubtaskRun` 要用它认出子任务那次模型调用（原先声明在 `/threads` 路由附近）。 */
const SPAWN_SUBTASK_DESCRIPTION = "并行核对 A.md 里引用的外部数据源，整理成一段可引用的结论。";

/**
 * 路径矩阵 **F5（取消传播到子任务）/ C8** 的取证旋钮 —— **让子任务自己那次模型调用
 * 停在"还在跑"上足够久**。
 *
 * ## 它要消除的是一个「窗口乘起来是 0」的构造性竞态
 *
 * 子任务的模型调用打的是本替身**同一个进程**（`SubtaskRunExecutor` 把父 run 的
 * `model_provider` 原样复制给子任务，deep-agent 就还是 deep-agent），`threadId` 是
 * `deriveRemoteThreadId(subtaskRunId)`，`userText` 以子任务 description 开头。它命不中
 * 任何触发词 ⇒ 走默认的 `STATUS_POLLS_BEFORE_DONE`（=2），也就是**一两次轮询就终态**。
 *
 * 于是「父取消 → 子任务不再产出」这条判据在默认配置下**永远命中不到**：等测试从
 * 界面点下取消，子任务早已 completed。这与矩阵 F3 那条「状态窗口 974ms 短于轮询周期
 * 3000ms，两层各自都对、乘起来是 0」是同一个形状的坑。
 *
 * 旋钮把子任务的终态推迟到至少这么多次状态轮询之后，取消动作因此**由构造**落在
 * 子任务仍在运行的窗口里，不是"跑得够快"。
 *
 * ⚠ 刻意做成**有限**的 hold，不是"挂到天荒地老"：没有取消时子任务会在这么多轮之后
 * 正常完成。F5 的断言因此可以等过这个点再复查一次——「取消没传播」的失效形态会以
 * 「子任务变成 completed / 有结果」现形，而不是靠"它一直没完成"这种弱信号。
 *
 * 未设置时恒为 `undefined`，这条分支短路，行为与改动前逐字节相同。
 */
const SUBTASK_HOLD_POLLS = process.env.LOOPBACK_DEEP_AGENT_SUBTASK_HOLD_POLLS === undefined
  ? undefined
  : Number(process.env.LOOPBACK_DEEP_AGENT_SUBTASK_HOLD_POLLS);
/** 子任务那次模型调用的 `user` 以 description 开头（`SubtaskRunExecutor` 拼的），据此认出它。 */
const isSpawnedSubtaskRun = (userText: string): boolean =>
  SUBTASK_HOLD_POLLS !== undefined && Number.isFinite(SUBTASK_HOLD_POLLS)
  && userText.startsWith(SPAWN_SUBTASK_DESCRIPTION);
/**
 * #728 P9 —— 确定性失败触发词。用户消息**逐字等于**这个值时，本进程让 run 走到
 * `error` 终态而不是 `success`，供取证脚本构造一次真实失败并截图——不是在前端
 * 伪造一个失败态组件，是让这条真实的 `DeepAgentModelProvider.pollToTerminal` 轮询
 * 循环真的读到 `error` 状态、真的抛 `ModelCallError`、真的让 `execute-run.ts` 把
 * run 落成 `failed`。触发词从环境变量读，唯一事实源在
 * `apps/web/e2e/chat-read-fixture.ts` 的 `deepAgentFailureTrigger`，两头不各写一份。
 */
const FAILURE_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_FAILURE_TRIGGER;
// UI 评分第 8 项取证：对这句触发词回 markdown 正文（标题/列表/代码块/行内 code）。
// 渲染是真实生产代码在跑——这是给渲染器喂已知输入，不是伪造输出。
const MARKDOWN_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_MARKDOWN_TRIGGER;
/**
 * UI 评分第 4 项取证（真实多步能力）：对这句触发词回一条**多步依赖链**剧本——
 * write_todos → search_documents → read_document → 终稿，其中 read_document 的
 * args.path 逐字来自 search_documents 的结果文本（`A.md`）。「第二步的参数可见地
 * 引用第一步的结果」正是「调用→看结果→定下一步」这条链在 UI 上的可判形态。
 * 触发词唯一事实源在 `apps/web/e2e/chat-read-fixture.ts` 的 `deepAgentMultiStepTrigger`。
 */
const MULTISTEP_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER;
/**
 * issue #3000 —— 「这一轮要真的跑一段时间」的触发词。
 *
 * `copilotkit-v2-run-restore-after-switch.spec.ts` 要验的是「切走时 run **还在途**、
 * 切回来时事件流不可用、恢复靠权威读收尾」。它此前借用多步触发词，理由写的是
 * 「多步剧本至少要 `MULTISTEP_MIN_STATUS_POLLS`(=6) 轮状态轮询才终态」——**这条理由
 * 在流式路径上不成立**：`KERNEL_DEEP_AGENT_STREAM_ENABLED=1` 时终态来自 `/stream` 的
 * EOF（下面那段把 `statusPolls` 直接推到 MAX），状态轮询那道闸根本不参与。实测证据
 * （run 34191848662 的 trace）：该 run `createdAt` 06:58:29.494、`chat_writeback`
 * 06:58:30.661 —— **1.2 秒**就跑完了，而"新建会话 → 等路由 → 切回来"要 2 秒以上，
 * 于是切回来时 run 早已终态、`findPendingRunId` 为 null，恢复路径一次都没被走到。
 *
 * 这里给的是一条**确定性的慢**：命中这个触发词时，`/stream` 先把响应头发出去（连接
 * 真的建立、真的在跑），再等 `SLOW_HOLD_MS` 才开始发正文片段。run 在这段时间里是真的
 * `running`（agent_run 行、`GET /agent-runs/:id` 都如实这么说），不是 sleep 出来的假象。
 * 单独一个触发词、不改多步剧本的时序：那条剧本上挂着别的用例的断言。
 */
const SLOW_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_SLOW_TRIGGER;
const SLOW_HOLD_MS = Number(process.env.LOOPBACK_DEEP_AGENT_SLOW_HOLD_MS ?? "12000");
const SCROLL_ACCEPTANCE_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_SCROLL_ACCEPTANCE_TRIGGER;
const SCROLL_ACCEPTANCE_REPLY = "十份文档已经逐一读取，十步滚动验收执行完成。";
/**
 * UX-9 D4 前端接入取证（gap 清单第 3 条）—— 对这句触发词，第一次到达状态阈值时回
 * `status: "interrupted"` 而不是 `"success"`：`DeepAgentModelProvider.completeWithProgress`
 * 见到 `"interrupted"` 会去读 state 找待批工具调用（`readPendingApproval`），run 落
 * `awaiting_tool_permission` ——这是让真实 HITL 链路（DA-07b/DA-07c）在确定性替身下也能被
 * 端到端取证的唯一入口，不是在前端伪造一个「正等待批准」的卡片。
 *
 * resume 之后（`createRun` 收到 `command.resume`）本进程记下裁决（approve/edit/reject
 * 三态之一），下一次状态轮询直接答 `success`，`state` 端点据裁决类型拼出不同的工具
 * 结果与终稿正文——`edit` 时终稿里能看到编辑后的参数值，供截图肉眼核对「提交的确实
 * 是编辑后的值」而不是原样通过。
 */
const APPROVAL_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_APPROVAL_TRIGGER;
const CLARIFICATION_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_CLARIFICATION_TRIGGER;
const CLARIFICATION_ARTIFACT_NAME = process.env.LOOPBACK_DEEP_AGENT_CLARIFICATION_ARTIFACT_NAME
  ?? "WorkspaceX-Agent-report.pdf";
const CONFIRM_INTENT_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_CONFIRM_INTENT_TRIGGER;
const CHOOSE_OPTION_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_CHOOSE_OPTION_TRIGGER;
/**
 * 路径矩阵 B1/B4/B5/B6 —— **同一条 run 里连着中断两次**的剧本（issue #3244 ① / #3212 / #3186）。
 *
 * ## 为什么必须新加一个触发词，而不是复用已有的
 *
 * 已有的每一个中断剧本（`APPROVAL_TRIGGER`、三个表单中断、`PLAN_CONFIRM_TRIGGER`）都由
 * `record.decision === null` 把关：**裁决一到就再也不中断**。于是「一条 run 里第二次中断」
 * 这个形状在本替身上**根本不可达**，而人类在 devapp 上报的三个真实缺陷全长在这个形状上：
 *
 * - #3186「审批弹窗点了没反应，用户被完全锁死」——真机理是「点击生效 → run 恢复 →
 *   引擎立刻又中断 → 弹出逐像素相同的新框」，与「点了没反应」在界面上分不开；
 * - #3212 修的是那个「逐像素相同」（第二次弹窗要说明这是第几次、上次选了哪档），
 *   同一提交还把审批组件的 `key` 从 `runId:seq` 收成 `runId`——带 seq 时同一条 run 的
 *   **第二次**中断会把组件整个重挂，它刚记下的次数随之清零；
 * - #3244 ①「HITL 确认卡片提交之后又在 chat 上出现了一次」——时序正是
 *   确认意图卡 → 补参窗口 → 提交，三步都在**同一条 run** 里。
 *
 * 三条的共同前提都是「一条 run 中断两次」。没有这个剧本，B 组无论怎么写断言都碰不到
 * 它们——这正是「B 组现有 spec 全绿却一个真实缺陷都没抓住」的机械原因。
 *
 * ## 它照的是真上游的方言，不是为了让断言好写
 *
 * 真实 deep_agent_service 的中断语义在本协议面上只有一个信号：**state 里存在一个没有配对
 * `ToolMessage` 的 tool_call**（`readPendingApproval` 就是这么找待批项的，见上面各剧本的
 * 头注）。本剧本第二次中断用的是同一个信号——把第一次那个 tool_call 配上回执，再放出
 * 第二个未配对的 tool_call，于是服务端**自己**生成一个新的 `permissionRequestId`。
 * 替身没有伪造任何 id，也没有替 TS 侧决定该不该问第二次。
 *
 * ⚠ 未设置这个环境变量时（默认），下面所有新增分支的判定第一项就是 `undefined !== 用户原文`
 * ⇒ 恒 false，走到的分支与改动前逐字节相同。
 */
const TWO_INTERRUPT_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_TRIGGER;
/**
 * 第一次裁决之后、第二次中断之前，这条 run 要**普通地跑**多少次状态轮询。
 *
 * ## 这个旋钮不是为了慢，是为了让判据可证伪
 *
 * #3244 ① 那句人类原话是「提交以后在 chat 上又看到了这个界面」——**看到**发生在
 * 「已经裁决了」与「下一个中断到来」之间那段窗口里。窗口宽度若由两次网络往返决定
 * （默认约 0），那么「提交后旧卡片又出现」这条断言就只能靠**赢一次赛跑**才采得到，
 * 采不到时给出的是假绿。F3 那条「974ms 窗口 vs 3000ms 轮询、两层各自都对乘起来是 0」
 * 与 F5 的 `SUBTASK_HOLD_POLLS` 是同一个教训。
 *
 * 所以把这段窗口**由构造撑开**：hold 期间 run 是普通的 `pending`（不是 interrupted、
 * 也不是终态），前端因此处在「没有任何待决请求」的状态——此时任何一张确认卡片都是
 * 陈旧重现，与时序无关。
 *
 * ⚠ 同样**有界**：hold 完就进第二次中断。无界的 hold 与「卡死」分不开。
 */
const TWO_INTERRUPT_HOLD_POLLS = Number.parseInt(process.env.LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_HOLD_POLLS ?? "8", 10);
/**
 * 路径矩阵 B4 —— **同一条 run 里连着请求两次「技能授权」**的剧本（issue #3186 / #3212）。
 *
 * 与上面那条二次中断剧本走的是**另一条**审批通路：那条走三个具名表单中断
 * （`InterruptDecisionDialog`），这条走 `call_skill` 的四选一授权卡
 * （`ToolPermissionCard` / `chat-tool-permission-dialog`）。人类报的「审批弹窗点了没反应」
 * 正是后者，两条不能互相替代。
 *
 * 两次请求**点名不同的技能**：#3212 的判据之一就是"用户看得出这次问的是哪个技能"，
 * 两次逐字相同的话，那条判据不可证伪。
 */
const TWO_APPROVAL_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_TWO_APPROVAL_TRIGGER;
const TWO_APPROVAL_FIRST_SKILL = "quarterly-report";
const TWO_APPROVAL_SECOND_SKILL = "persona-canvas";
const TWO_APPROVAL_FINAL_REPLY = "两次技能授权都已收到，任务执行完毕。";
/**
 * issue #3132（B7）—— 计划确认门的剧本触发词。
 *
 * 对这句话，替身在第一次到达状态阈值时回 `interrupted`，并在 `/state` 里放一个**未配对**
 * 的 `write_todos` 工具调用（args 是一份 3 步的提案计划）——与真实引擎被
 * `_write_todos_requires_plan_confirmation` 谓词拦下时**逐字同形**：同一个工具名、同一个
 * `{todos:[{content,status}]}` args 形状、同样是「宣布了但没有配对 ToolMessage」。
 *
 * ⚠ 工具名从契约 `PLAN_CONFIRMATION_TOOL_NAME` 取，**没有任何字面量兜底**（不写 `??` 默认值），
 * 也不吃环境变量覆盖——「替身的方言 ≠ 上游的方言」是 #2017 与 CRLF/LF 那两次的原话教训：
 * 替身与前端对齐、真实引擎却发另一个名字，结果是 e2e 恒绿、生产恒红。
 *
 * resume 之后（`record.decision` 非 null）走终态分支，`/state` 里补上配对的 ToolMessage
 * 与终稿——也就是「确认后这条 run 真的继续跑完」，而不是前端自己把卡片藏起来。
 */
const PLAN_CONFIRM_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_PLAN_CONFIRM_TRIGGER;

/**
 * 提案计划的步骤数可调（默认 3，>= 契约 `PLAN_CONFIRM_MIN_STEPS` 的 2）。
 * 判据 (b)「简单问答不加门槛」那条正向反证要造一份**只有 1 步**的计划来证明门不出现，
 * 靠的就是把这个值设成 1。
 */
const PLAN_CONFIRM_STEP_COUNT = Number.parseInt(
  process.env.LOOPBACK_DEEP_AGENT_PLAN_CONFIRM_STEPS ?? "3", 10,
);

/**
 * 计划确认之后，同一条 run 里**第二次** `write_todos`（把第一步标 `in_progress`）。
 * 这是「同一条 run 里第二次及以后的 write_todos 不得再次中断」那条专门反证的取证点：
 * 替身在 resume 后就把它连同配对的 ToolMessage 一起落进 state，run 一路走到 `success`
 * ——若引擎侧谓词错写成「每次 write_todos 都拦」，真实链路在这里会再停一次。
 */
const PLAN_CONFIRM_TOOL_NAME = PLAN_CONFIRMATION_TOOL_NAME;
/**
 * ⚠ **替身必须与真实引擎发同一个工具名**，所以这里从契约取，不再有
 * `?? "send_email"` 兜底，也不再吃 `LOOPBACK_DEEP_AGENT_APPROVAL_TOOL_NAME`
 * 环境变量覆盖（那个变量全仓从未被设过，唯一效果是让替身可以**悄悄**发一个与真实引擎
 * 不同的名字）。
 *
 * issue #2017 的根因就是这条：替身发 `send_email`、前端也认 `send_email`，两边对齐 ⇒
 * **e2e 恒绿**；真实引擎发 `call_skill` ⇒ **生产恒红**。替身的职责是让真实链路在确定性
 * 条件下可取证，不是让测试更容易通过——名字一旦允许分叉，这套 e2e 就退化成自证。
 */
const APPROVAL_TOOL_NAME = DEEP_AGENT_HITL_TOOL_NAME;
/**
 * DA-19g —— 测试基础设施增强（不是产品代码）：确定性"记得上一轮"分支。
 *
 * ## 为什么加这个，以及为什么这不是造假 UI
 *
 * `chat-ux-acceptance-criteria.md` 第 6 项判据是"连续对话时，agent 是否真的记得前几轮
 * 说了什么"。这个替身在设计上**从未能验证这条判据**——`RunRecord` 此前只有单个
 * `userText: string` 字段，`POST /threads/:id/runs` 每次整体覆盖它（见文件顶部头注
 * "state 从第一次读起就是完整的"一段），回复模板永远只回显*当前*这一句用户输入
 * （`根据查询结果回答你："${record.userText}"...`）——不管传输层有没有真的把完整历史
 * 送过来，这个替身自己从不使用历史，永远表现得"看起来忘了上文"，与传输层是否有 bug
 * 无关。DA-19g 排查已确认传输层本身在这条链路上有真实 bug（`copilotkit-v2-panel.tsx`
 * 此前从未回传 `forwardedProps.chatThreadId`，导致每轮开新 Chat 线程、`history` 永远
 * 为空——已在同一个 PR 里修），但即便传输层完全正确，这个替身自己也没有能力证明
 * "服务端确实拿到并利用了完整历史"——因为它压根不记。
 *
 * 这里新增的分支不改变默认行为（`FOLLOWUP_CONTEXT_TRIGGER` 未设置时，`conversationLog`
 * 仍然被写入但从不被读，行为与本次改动前逐字节相同）：只有显式命中这个新触发词时，
 * 才会去读「这条线程上一次收到的用户消息」并把它逐字嵌进回复——同一套纪律
 * `MARKDOWN_TRIGGER`/`MULTISTEP_TRIGGER`/`APPROVAL_TRIGGER` 已经在用（见各自头注：
 * 显式触发词命中才换分支，不影响默认路径），不是新发明一套哲学。
 *
 * ## 这证明什么，不证明什么
 *
 * 命中这个分支且回复里真的出现了上一轮原文，证明：① 传输层把「这条线程」的两轮请求
 * 都送到了同一个远端 thread（`deriveRemoteThreadId` 对同一个 Chat 线程稳定）；
 * ② 这个替身自己选择去读历史时是有历史可读的（`conversationLog` 非空）。它不证明
 * 「真实 deepagents 服务的模型会不会真的利用历史」——那需要真实模型凭据，见文件头注
 * "为什么不是起一个真的 langgraph dev 进程"，本次改动的范围边界与那里说的一致。
 */
const FOLLOWUP_CONTEXT_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_FOLLOWUP_CONTEXT_TRIGGER;
const FOLLOWUP_CONTEXT_ECHO_PREFIX = process.env.LOOPBACK_DEEP_AGENT_FOLLOWUP_CONTEXT_ECHO_PREFIX ?? "[remembered:]";
/** threadId → 该线程迄今为止收到过的用户消息，按到达顺序追加，从不覆盖（对照
 *  `RunRecord.userText` 每次整体覆盖的既有行为——两者刻意不同，见上面头注）。 */
const conversationLog = new Map<string, string[]>();
/**
 * issue #2020（差距清单第 3 项，v2 Skill 挂载）—— 与 `loopback-model-provider.ts` 的
 * `mountedSkillReachedModel` **同一条取证纪律**，搬到 deep-agent 协议面上：
 * 「挂载的 skill 是否真的进了模型输入」在浏览器侧没有任何别的可观察信号
 * （system prompt 不落表，`GET /agent-runs/:id` 只有 digest）。
 * `deep-agent-model-provider.ts` 的 `createRun` 把 `buildSystemPrompt` 拼好的
 * `input.system`（含全部 pinned skill 正文，见该文件头注 "`input.system` is still
 * sent"）作为一条 `role:"system"` 消息发进 `POST /threads/:id/runs`——本替身只在
 * **那条 system 消息**里真的看到哨兵时才回显（只扫 system、不扫会被回显污染的
 * user/history，理由逐字同 `loopback-model-provider.ts`）。两个开关默认关闭：
 * 未设置时 `skillSentinelSeen` 恒 `false`，所有既有剧本逐字节不变。
 */
const SKILL_SENTINEL = process.env.LOOPBACK_DEEP_AGENT_SKILL_SENTINEL || null;
const SKILL_ECHO_PREFIX = process.env.LOOPBACK_DEEP_AGENT_SKILL_ECHO_PREFIX || null;
/**
 * 路径矩阵 D4（skill 三态区分）—— **默认关闭**的第三个 skill 开关：
 * 「这个 skill 在 system prompt 的**目录**里被看见」这一态。
 *
 * 与上面 `SKILL_SENTINEL`（正文经 `config.configurable.org_skills` 到达）是**两个不同
 * 的信号**，#2534 之后在协议上就是两条独立通道：目录只有 `stable_name + 一行摘要`，
 * 全文只在 `org_skills` 里。此前只有后者被任何测试观察过——一个把目录条目当成"正文
 * 到了"的实现会全绿，而那正是这条路径要挡的混淆。
 *
 * 目录块的**头一行**从产品源码取（`buildDeepAgentSkillCatalogBlock`），不在这里抄第二份
 * 字面量：抄一份就等于给"目录格式变了但替身没跟着变"留一条静默假绿的路（同本文件
 * `APPROVAL_TOOL_NAME` 从契约取、不吃环境变量覆盖的既有教训）。
 */
const SKILL_CATALOG_STABLE_NAME = process.env.LOOPBACK_DEEP_AGENT_SKILL_CATALOG_STABLE_NAME || null;
const SKILL_CATALOG_ECHO_PREFIX = process.env.LOOPBACK_DEEP_AGENT_SKILL_CATALOG_ECHO_PREFIX || null;
const SKILL_CATALOG_HEADER_LINE = buildDeepAgentSkillCatalogBlock([]).split("\n")[0] ?? "";

/**
 * 路径矩阵 F7（上游断流）—— 命中这个触发词时，`/stream` 先正常发几片正文，然后
 * **直接销毁 socket**（不发 EOF、不把 `statusPolls` 推到终态），随后的状态轮询一律
 * 答 `error`。
 *
 * 与 `FAILURE_TRIGGER` 不是同一条路径：那条是"上游规规矩矩地报了一个失败终态"，
 * 走的是 `pollToTerminal` 读到 `error`；这条是"流在半路断了"，走的是
 * `deep-agent-model-provider.ts` 的 `tryStreamRun` catch 分支（注释原话「流中途断：
 * run 还在服务端跑，调用方落回轮询」）再由轮询读出真实终态。两条分支在产品代码里
 * 是两段不同的代码，一条绿不能替另一条作证。
 */
const STREAM_ABORT_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_STREAM_ABORT_TRIGGER;

/**
 * 路径矩阵 **C1/C5 · 一轮 run 分步产出多个画布**（issue #3243 / PR #3248 的真实形状）。
 *
 * ## 为什么已有的画布剧本证不了这件事
 *
 * `loopback-model-provider.ts` 的画布分支（C4 用的那条）产出的是**一条** AI 消息、
 * 里面并排两个围栏。而 #3243 人类实测那条缺陷只在**一轮里有多条顶层 AI 消息**时才
 * 存在：流式把本轮**每一条**顶层 AI 消息喂给 `onDelta`（画布就是这样一个一个画出来
 * 的），而落库此前只取**最后一条**非空 AI 消息——那条恰恰是纯文字总结，零个围栏。
 * 一条消息的剧本里「每一条」与「最后一条」是同一条，判据因此**无法被证伪**。
 *
 * 这条剧本刻意长成缺陷需要的那个形状：前 N 条 AI 消息各带一个围栏，**最后一条是
 * 零围栏的纯文字总结**。修复前落库正文里围栏数为 0、流式里为 N；修复后两处都是 N。
 *
 * ⚠ 默认关闭：未设触发词时下面每个判断恒 false，本文件行为逐字节等同改动前。
 */
const MULTI_CANVAS_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_MULTI_CANVAS_TRIGGER;
const MULTI_CANVAS_TEMPLATE_KEY = process.env.LOOPBACK_DEEP_AGENT_CANVAS_TEMPLATE_KEY || null;
const MULTI_CANVAS_HEADER_FIELD_NAME = process.env.LOOPBACK_DEEP_AGENT_CANVAS_HEADER_FIELD_NAME || null;
const MULTI_CANVAS_SECTION_NAME = process.env.LOOPBACK_DEEP_AGENT_CANVAS_SECTION_NAME || null;
const MULTI_CANVAS_COUNT = Number(process.env.LOOPBACK_DEEP_AGENT_MULTI_CANVAS_COUNT ?? "3");
/**
 * 最后那条总结**必须一个围栏都没有**——它就是 #3243 里那句「所有画布模板现已完整
 * 交付」：交付物确实产出过，只是从没被写进任何持久记录。带上围栏就等于把缺陷需要的
 * 那个形状抹掉，判据当场退化成恒真。
 */
const MULTI_CANVAS_SUMMARY = process.env.LOOPBACK_DEEP_AGENT_MULTI_CANVAS_SUMMARY
  ?? "以上画布模板现已完整交付，可以直接使用。";

/**
 * 围栏格式逐字照 `buildCanvasTemplateGuidance` 写给模型的那份说明产出，真实解析器
 * （`checkCanvasFence` / `ensureCanvasFenceTemplate`）拿它当真实模型产出解析，
 * 不为测试放宽任何格式。表头字段值带**本轮序号**：两个围栏内容相同时，「都挂出来了」
 * 与「同一个挂了两遍」在断言侧分不开，而后者正是这条路径要防的失效。
 */
function multiCanvasFence(index: number, userText: string): string {
  const value = `${userText.replace(/[`\n]/g, "").trim().slice(0, 60)} 第${index}张`;
  return [
    "```canvas",
    `模板: ${MULTI_CANVAS_TEMPLATE_KEY}`,
    ...(MULTI_CANVAS_HEADER_FIELD_NAME ? [`${MULTI_CANVAS_HEADER_FIELD_NAME}: ${value}`] : []),
    `## ${MULTI_CANVAS_SECTION_NAME}`,
    `- ${value}`,
    "```",
  ].join("\n");
}

/** 本轮**每一条**顶层 AI 消息的正文，按顺序。最后一条零围栏——见 `MULTI_CANVAS_SUMMARY`。 */
function multiCanvasBodies(userText: string): string[] {
  const count = Number.isFinite(MULTI_CANVAS_COUNT) && MULTI_CANVAS_COUNT > 0 ? MULTI_CANVAS_COUNT : 3;
  const fences = Array.from({ length: count }, (_, i) => multiCanvasFence(i + 1, userText));
  return [...fences, MULTI_CANVAS_SUMMARY];
}

const isMultiCanvasTurn = (record: RunRecord): boolean =>
  MULTI_CANVAS_TRIGGER !== undefined
  && MULTI_CANVAS_TEMPLATE_KEY !== null
  && record.userText === MULTI_CANVAS_TRIGGER;

/**
 * 路径矩阵 **D1 · 工具卡终态**——让**一次工具调用**真的失败（不是让整条 run 失败）。
 *
 * 与 `FAILURE_TRIGGER` 是两条完全不同的路径：那条把 run 的终态推成 `error`，走
 * `MODEL_CALL_FAILED`，一次 `tool_call` 步骤都不会落地；这条让 run **正常收尾**，
 * 只有其中一次工具调用的 ToolMessage 带 `status: "error"`——这正是
 * `deep-agent-model-provider.ts` 读 `ok: message.status !== "error"` 的那个字段，
 * 也是「外层折叠行写失败、内层工具卡发绿勾」那条缺陷唯一能被复现出来的形状。
 *
 * ⚠ 同一轮里**成功与失败各一次**：只有失败一次时，「卡片正确显示失败」与「卡片把
 * 所有调用都显示成失败」在断言侧分不开。
 */
const TOOL_FAILURE_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_TOOL_FAILURE_TRIGGER;
const TOOL_FAILURE_MESSAGE = process.env.LOOPBACK_DEEP_AGENT_TOOL_FAILURE_MESSAGE
  ?? "读取失败：目标文档不存在或没有权限。";
const TOOL_FAILURE_REPLY = process.env.LOOPBACK_DEEP_AGENT_TOOL_FAILURE_REPLY
  ?? "其中一份文档没能读到，我用能读到的那份作答。";

const isToolFailureTurn = (record: RunRecord): boolean =>
  TOOL_FAILURE_TRIGGER !== undefined && record.userText === TOOL_FAILURE_TRIGGER;

/**
 * 路径矩阵 **F1（失败成因可分辨）** —— 命中这个触发词时，run 的状态轮询一路答
 * `success`（**不是** `error`），但 `/threads/:id/state` 只回那条 human 消息、
 * **一条 assistant 消息都不给**。
 *
 * ## 为什么要第三个失败触发词
 *
 * `FAILURE_TRIGGER` 与 `STREAM_ABORT_TRIGGER` 在替身里是两段不同的代码，但它们
 * 落到产品面的**成因**是同一个：两条最终都把 run 的状态答成 `error`，于是
 * `deep-agent-model-provider.ts` 抛的 detail 都形如 `run ended with status ...`，
 * 经 `classifyModelCallFailureReason` 都分类成 `provider_rejected`。**两个触发词
 * 证不出"不同的失败在界面上说的是不同的话"**——而那正是 issue #3211 ① / PR #3229
 * 要修的那件事（四件可行动性完全不同的事共用「模型这次没能返回可用结果」一句话）。
 *
 * 这条走的是 `deep-agent-model-provider.ts:688` 那段：远端 run **成功**了，但
 * `readTurnReply` 读不出任何 assistant 正文 ⇒ 抛
 * `deep agent run succeeded but produced no assistant message` ⇒ 分类成
 * `provider_returned_empty`。与 `provider_rejected` 是**不同的枚举值、不同的那句话**，
 * 于是"可分辨"这条判据第一次有了可以被证伪的对象。
 *
 * ⚠ 刻意不用「让执行器抛异常」来造 `executor_defect`：那要在产品代码里埋一个只为
 * 测试存在的故障注入点，是把被测物改成替身。这条只用替身自己合法的响应形状
 * （`{ values: { messages: [...] } }`，与上面 `!record.started` 那支回空数组同形），
 * 产品侧一行都不用改。
 */
const EMPTY_REPLY_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_EMPTY_REPLY_TRIGGER;

/** system prompt 的 skill **目录**里真的出现了这个 stable_name 吗。开关未给全时恒 `false`。 */
function skillCatalogReachedUpstream(body: CreateRunBody): boolean {
  if (SKILL_CATALOG_STABLE_NAME === null || SKILL_CATALOG_ECHO_PREFIX === null) return false;
  const system = (body.input?.messages ?? []).find((m) => m.role === "system")?.content;
  if (typeof system !== "string") return false;
  return system.includes(SKILL_CATALOG_HEADER_LINE) && system.includes(`- ${SKILL_CATALOG_STABLE_NAME}:`);
}

/**
 * #2534 更新：哨兵改在 `config.configurable.org_skills[].content` 里看，**不再看
 * `role:"system"`**。deep-agent run 的 system prompt 现在只放目录（一行摘要），skill
 * 全文只经 `org_skills` 结构化送到远端由 `call_skill` 按需取——「skill 正文真的到了
 * 远端」的唯一可观察位置就是这里。仍只看**这一轮请求真实收到的字节**，不缓存跨轮。
 * ⚠ 顺带成为一条反证：若有人把全文又贴回 system prompt 而 `org_skills` 漏了，这里
 *   如实 `false`，e2e 红。
 */
function mountedSkillReachedUpstream(body: CreateRunBody): boolean {
  if (SKILL_SENTINEL === null || SKILL_ECHO_PREFIX === null) return false;
  const skills = body.config?.configurable?.org_skills ?? [];
  return skills.some((s) => typeof s.content === "string" && s.content.includes(SKILL_SENTINEL));
}

/** 见 `mountedSkillReachedUpstream`——`/stream` 与 `/state` 两个端点共用同一份拼接，
 *  不各自维护第二份（DA-19g「两个端点漂移」的真根因教训）。 */
function skillEcho(record: RunRecord): string {
  const catalog = record.skillCatalogSeen ? `${SKILL_CATALOG_ECHO_PREFIX}${SKILL_CATALOG_STABLE_NAME} ` : "";
  const body = record.skillSentinelSeen ? `${SKILL_ECHO_PREFIX}${SKILL_SENTINEL} ` : "";
  return `${catalog}${body}`;
}
const MARKDOWN_REPLY = [
  "## 分析结果",
  "",
  "根据你的要求，以下是三个要点：",
  "",
  "1. **第一点**：行内代码示例 `pnpm harness verify`",
  "2. *第二点*：斜体与 [链接示例](https://example.com)",
  "3. 第三点：见下方代码块",
  "",
  "```typescript",
  "export function demo(): string {",
  '  return "markdown 渲染取证";',
  "}",
  "```",
  "",
  "> 引用块：以上由确定性替身生成，用于验证渲染器。",
  "",
  // DA-19b 消息渲染迁移取证：加一段白名单内（`flowchart`，见
  // `apps/web/lib/mermaid-diagram-type.ts` 的 12 种白名单）的 mermaid 围栏，供
  // `copilotkit-v2-panel.tsx` 的 markdown 渲染断言真的挂出 `ChatDiagramFabric`
  // canvas，而不是灰底代码块。语法照抄 `chat-diagram-save-gate.test.tsx` 已验证
  // 过能通过 `mermaid.parse` 的最简写法（`flowchart TD\n  A --> B`），不是新猜的。
  "```mermaid",
  "flowchart TD",
  "  A --> B",
  "```",
].join("\n");

interface ApprovalDecision {
  readonly type: "approve" | "edit" | "reject";
  readonly editedArgs?: Record<string, unknown>;
}

interface RunRecord {
  /** Thread creation alone is not execution; initial state must contain no future tools. */
  readonly started: boolean;
  /** Per execution, retained by the existing resume branch and every state poll. */
  readonly scrollExecutionId?: string;
  /** 十步滚动剧本的推进游标（半步数，0..`SCROLL_TOTAL_HALF_STEPS`）。
   *  由 `/stream` 的定时器按 `SCROLL_STEP_MS` 推进，`/state` 只读它——**不再**复用
   *  `statusPolls`，见 `SCROLL_STEP_MS` 头注记录的那次反转。 */
  scrollHalfStep: number;
  readonly userText: string;
  /**
   * 这一轮请求里那条用户消息**真实带着的 id**（`wsx-turn:<runId>:user`），照原样记下来
   * 供 `/state` 回显——见 `CreateRunBody.input.messages[].id` 的头注。请求里没带 id
   * （不经 `execute-run` 的调用方）时是 `undefined`，`/state` 那侧就不挂 id，与改动前
   * 逐字节相同：不编一个对不上的锚点假装有据。
   */
  readonly userMessageId?: string;
  statusPolls: number;
  /** UX-9 D4：approve/edit/reject 触发词回合的既有原始参数值（提交前），供
   *  state 端点在裁决前展示待批参数、裁决后对照展示「原值 vs 编辑后的值」。 */
  approvalArgs?: Record<string, unknown>;
  /** resume 请求（`command.resume`）到达后记下的裁决——null = 还没被裁决过。 */
  decision: ApprovalDecision | null;
  /**
   * 这条 run 上**按到达次序**记下的每一次裁决。`decision` 保留为「最后一次裁决」，
   * 既有所有分支因此逐字节不变；只有需要分辨「这是第几次中断」的剧本读这个数组。
   *
   * ⚠ 不把 `decision` 直接换成数组：那会动到 5 个既有剧本的每一处 `record.decision === null`，
   * 而那些剧本正在别的车道上跑绿——本仓那条「范围纪律」。
   */
  decisions: ApprovalDecision[];
  /** 二次中断剧本：hold 窗口的结束轮次（`statusPolls` 超过它才放出第二次中断）。 */
  holdUntilPoll?: number;
  /** issue #2020 / #2534：这一轮的 `org_skills` 里真的出现了 skill 哨兵——
   *  见 `mountedSkillReachedUpstream`。开关未给全时恒 `false`。 */
  skillSentinelSeen?: boolean;
  /** 路径矩阵 D4：这一轮的 system prompt **目录**里真的出现了那个 stable_name——
   *  见 `skillCatalogReachedUpstream`。与上一行是两个独立信号，不许互相替代。 */
  skillCatalogSeen?: boolean;
  /**
   * issue #3100 D6 —— `spawn_async_task` 这一轮真的派发出去之后，TS 侧回给的那条
   * 子任务 run id（`POST /internal/subtask-runs` 响应体的 `subtaskRunId`）。
   * `null` = 这一轮没有派发（未命中剧本 / 没配通路 / 派发失败），`/state` 据此决定
   * 要不要揭示那半个工具调用——**没派成功就不揭示**，不编一个 id 骗前端。
   */
  spawnedSubtaskRunId?: string | null;
  /** 派发失败时真实工具会回的那句话（含异常类名），供 `/state` 原样当 ToolMessage 用。 */
  spawnFailureText?: string | null;
}

function approvalReply(record: RunRecord): string {
  if (record.decision === null) return "这一步需要人工批准后才能继续。";
  const args = record.decision.type === "edit" && record.decision.editedArgs !== undefined
    ? record.decision.editedArgs
    : { skill_stable_name: "quarterly-report", task: "取证：待批技能调用（原始参数，未编辑）" };
  return record.decision.type === "reject"
    ? "已按你的选择跳过这次技能调用，不会执行。"
    : record.decision.type === "edit"
      ? `已按你编辑后的参数执行：${JSON.stringify(args)}`
      : `已按原参数执行：${JSON.stringify(args)}`;
}

function isClarification(record: RunRecord): boolean {
  return CLARIFICATION_TRIGGER !== undefined && record.userText === CLARIFICATION_TRIGGER;
}

function isConfirmIntent(record: RunRecord): boolean {
  return CONFIRM_INTENT_TRIGGER !== undefined && record.userText === CONFIRM_INTENT_TRIGGER;
}

function isChooseOption(record: RunRecord): boolean {
  return CHOOSE_OPTION_TRIGGER !== undefined && record.userText === CHOOSE_OPTION_TRIGGER;
}

/**
 * 二次中断剧本的终稿正文。它**只在两次裁决都到齐之后**才会出现——spec 拿它当
 * 「这条 run 真的走完了、没有把用户锁死」的判据，而不是拿「弹窗消失了」当判据
 * （弹窗消失也可能是它被静默吞掉）。
 */
const TWO_INTERRUPT_FINAL_REPLY = "两次确认都已收到，任务按确认后的意图与资料执行完毕。";

/** 路径矩阵 B1/B4/B5/B6 —— 见 `TWO_INTERRUPT_TRIGGER` 头注。 */
function isTwoInterrupt(record: RunRecord): boolean {
  return TWO_INTERRUPT_TRIGGER !== undefined && record.userText === TWO_INTERRUPT_TRIGGER;
}

/** 路径矩阵 B4 —— 见 `TWO_APPROVAL_TRIGGER` 头注。 */
function isTwoApproval(record: RunRecord): boolean {
  return TWO_APPROVAL_TRIGGER !== undefined && record.userText === TWO_APPROVAL_TRIGGER;
}

/** 这条 run 已经收到过几次裁决——二次中断剧本唯一的推进依据。 */
function decisionCount(record: RunRecord): number {
  return record.decisions?.length ?? 0;
}

function needsFormDecision(record: RunRecord): boolean {
  return isClarification(record) || isConfirmIntent(record) || isChooseOption(record);
}

function clarificationReply(record: RunRecord): string {
  if (record.decision === null) return "生成前需要补充主题与内容来源。";
  const fields = record.decision.type === "edit" && Array.isArray(record.decision.editedArgs?.fields)
    ? record.decision.editedArgs.fields as Array<{ name?: unknown; value?: unknown }>
    : [];
  const topic = fields.find((field) => field.name === "topic")?.value;
  return `已根据你补充的${typeof topic === "string" ? `“${topic}”` : "主题"}生成中文 PDF。`;
}

function clarificationScript(): string {
  return [
    "已按 pdf-create 技能准备生成脚本。",
    "```run_script",
    "const fs = require('fs');",
    `fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/${CLARIFICATION_ARTIFACT_NAME}', '%PDF-1.4');`,
    "```",
  ].join("\n");
}

function confirmIntentReply(record: RunRecord): string {
  if (record.decision === null) return "执行前需要确认任务意图。";
  const assumptions = record.decision.type === "edit" && Array.isArray(record.decision.editedArgs?.assumptions)
    ? record.decision.editedArgs.assumptions.filter((item): item is string => typeof item === "string")
    : [];
  return assumptions.length > 0
    ? `已按修改后的假设继续：${assumptions.join("；")}`
    : "已按确认的任务意图继续执行。";
}

function chooseOptionReply(record: RunRecord): string {
  if (record.decision === null) return "执行前需要选择一个方案。";
  const selected = record.decision.type === "edit" && typeof record.decision.editedArgs?.selectedOptionId === "string"
    ? record.decision.editedArgs.selectedOptionId
    : "unknown";
  return `已选择方案：${selected}`;
}

const runs = new Map<string, RunRecord>();

function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * DA-19g 真根因修复 —— 单一事实源：`FOLLOWUP_CONTEXT_TRIGGER`/`MARKDOWN_TRIGGER` 两个
 * "特殊剧本"分支此前**只被加进了 `/state` 端点**（`finalReply` 里的
 * `followupContextReply`/`MARKDOWN_REPLY` 判断），`/stream` 端点（供 `TEXT_MESSAGE_CONTENT`
 * 逐片下发、真正变成用户看到的聊天气泡正文的那一份）从未同步更新，永远只判
 * `MULTISTEP_TRIGGER`、否则回落到通用模板——这正是 DA-19g 评分第 2 轮独立复核抓到的
 * "传输层/线程续接全部正确，但回复仍是通用模板"的真根因（wire 级实测：命中 `/state` 时
 * `record.userText` 与 `conversationLog` 完全正确、`followupContextReply` 的条件成立，
 * 但用户看到的聊天气泡文本来自 `/stream` 的独立计算，那份从未加过这两个分支；
 * markdown 触发词同理，`/stream` 从未判过 `MARKDOWN_TRIGGER`）。
 *
 * 这个函数只负责"特殊剧本命中时该回什么"，两个端点各自的**默认**回复措辞（未命中任何
 * 触发词时的通用模板）刻意保持各自原样、不在这里统一——`/state` 的默认模板里带
 * `toolResult`（"已查询：当前时间…用户原话…"），`/stream` 的默认模板措辞不同
 * （"已查询当前时间，详情见工具结果"），已有测试断言这两处**各自的**具体文案
 * （`copilotkit-v2-runtime-adapter.spec.ts` 断言 `/stream` 侧那句），统一措辞会造成
 * 不该有的行为变化——这不是本次要修的范围，本次只补齐两个特殊分支在两个端点间的一致性。
 */
function computeSpecialTurnReply(threadId: string, record: RunRecord): string | null {
  // DA-19g：命中「记得上文」触发词时，逐字引用这条线程上一次收到的用户消息——
  // 见 `conversationLog`/`FOLLOWUP_CONTEXT_TRIGGER` 自己的头注。`log` 至少两条
  // （当前这轮 + 上一轮）才有"上一轮"可引用；只有当前这一轮（首轮就发触发词）时
  // 如实说明没有上文可引用，不编造一个不存在的历史。
  if (FOLLOWUP_CONTEXT_TRIGGER !== undefined && record.userText === FOLLOWUP_CONTEXT_TRIGGER) {
    const log = conversationLog.get(threadId) ?? [];
    const previousUserText = log.length >= 2 ? log[log.length - 2] : null;
    return previousUserText === null
      ? `${FOLLOWUP_CONTEXT_ECHO_PREFIX} 这是本线程第一轮消息，没有上一轮可引用。`
      : `${FOLLOWUP_CONTEXT_ECHO_PREFIX} 你上一轮说的是："${previousUserText}"。`;
  }
  if (MARKDOWN_TRIGGER !== undefined && record.userText === MARKDOWN_TRIGGER) return MARKDOWN_REPLY;
  return null;
}

/**
 * issue #3100 D6 —— 多步剧本派发的那个子任务的目标与背景。两处用到（`POST /threads/:id/runs`
 * 真的派发时、`/state` 揭示工具 args 时），所以是模块常量而不是各写一份字面量。
 */
const SPAWN_SUBTASK_CONTEXT = "父任务已确认：检索命中 A.md/B.md/C.md，其中 A.md 最相关。";
/** 一次派发对应一个稳定的 tool_call id —— 真实工具把它当 `idempotencyKey` 用。 */
const spawnCallIdFor = (threadId: string): string => `spawn-${threadId}`;

/**
 * issue #3100 D6 —— `spawn_async_task` 的**真实派发动作**，逐字照
 * `apps/deep-agent-service/src/deep_agent_service/tools.py::spawn_async_task` 的线格式复写：
 *
 *   POST `<subtask_callback_base_url>/internal/subtask-runs`
 *   headers: `content-type: application/json` + `x-deep-agent-internal-key: <subtask_callback_key>`
 *            （key 为空串时**不带**这个头——真实工具就是这么判的）
 *   body:    `{orgId, parentRunId, description, context, idempotencyKey}`
 *   ok:      响应体 `{subtaskRunId}`，非空字符串才算派发成功
 *
 * 这里**不是**在替身里造一条假的子任务记录：它打的是 `apps/api` 真实的
 * `SubtaskRunController.enqueue`，落的是真实的 `subtask_runs` 行，随后由真实的
 * `SubtaskRunExecutor` 真的执行、真的把工具明细写回去。替身只负责"模型这一轮决定派发
 * 一个子任务"这一件事——与真实部署里 Python 侧承担的职责完全一致。
 *
 * 四个 configurable 键任一缺席 ⇒ 返回降级说明（与真实工具同一条判据、同一句措辞），
 * **不**静默假装派发成功。
 */
async function spawnAsyncTask(parsed: CreateRunBody, description: string, context: string | null,
  toolCallId: string): Promise<{ subtaskRunId: string } | { failure: string }> {
  const configurable = parsed.config?.configurable ?? {};
  const baseUrlRaw = configurable.subtask_callback_base_url;
  const orgId = configurable.org_id;
  const parentRunId = configurable.parent_run_id;
  if (typeof baseUrlRaw !== "string" || baseUrlRaw.trim() === ""
    || typeof orgId !== "string" || orgId.trim() === ""
    || typeof parentRunId !== "string" || parentRunId.trim() === "") {
    return {
      failure: "无法派发异步子任务：本次运行没有配置好异步派发通路"
        + "（缺少 subtask_callback_base_url/org_id/parent_run_id 之一）。"
        + "请改用 task 工具委托给具名子代理，或自己继续处理这个子任务。",
    };
  }
  const key = typeof configurable.subtask_callback_key === "string" ? configurable.subtask_callback_key : "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== "") headers["x-deep-agent-internal-key"] = key;
  try {
    const response = await fetch(`${baseUrlRaw.replace(/\/+$/, "")}/internal/subtask-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orgId, parentRunId, description, context, idempotencyKey: toolCallId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTPStatusError:${response.status}`);
    const body = (await response.json()) as { subtaskRunId?: unknown };
    const subtaskRunId = typeof body.subtaskRunId === "string" ? body.subtaskRunId.trim() : "";
    if (subtaskRunId === "") throw new Error("ValueError");
    return { subtaskRunId };
  } catch (error) {
    const name = error instanceof Error ? error.message.split(":")[0]! : "Exception";
    return { failure: `派发子任务失败（${name}），未能加入后台队列，请改为同步处理这个子任务。` };
  }
}

interface CreateRunBody {
  /**
   * ⚠ `id` **不是可选的装饰**：`deep-agent-model-provider.ts::buildBody` 给每条消息挂
   * `wsx-turn:<runId>:<slot>`（`turnMessageId`），真上游 `harness.py` **原样保留**它
   * （`test_harness.py` 逐字钉住那个字面量）。落库正文的本轮边界就靠这个锚点找
   * （`readTurnReply`）——替身不回显它，锚点必然落空，`readTurnReply` 静默退回
   * `readFinalReply`（只取最后一条 AI 消息）。本仓那条「替身的方言 ≠ 上游的方言」。
   */
  readonly input?: { readonly messages?: { readonly role?: string; readonly content?: unknown; readonly id?: unknown }[] };
  /** #2534：`deep-agent-model-provider.ts` 的 `toWireSkills` 形状——skill 全文只经这里到远端。 */
  readonly config?: {
    readonly configurable?: {
      readonly org_skills?: readonly { readonly content?: unknown }[];
      /**
       * issue #3100 D6 —— `spawn_async_task` 的异步派发通路。这四个键由
       * `deep-agent-model-provider.ts::subtaskConfig()` 写进 `configurable`，真实
       * `deep_agent_service/tools.py::_read_subtask_callback` 读的就是它们（同名、同大小写、
       * 同"四者任一缺席即降级"的判据）。本替身**从请求字节里读**，不从自己的环境变量
       * 另开一份事实源——「替身的方言 ≠ 上游的方言」那条纪律要求的正是这个。
       */
      readonly subtask_callback_base_url?: unknown;
      readonly subtask_callback_key?: unknown;
      readonly org_id?: unknown;
      readonly parent_run_id?: unknown;
    };
  };
  /** DA-07b resume 形状：`{decisions:[{type:"approve"|"edit"|"reject", edited_action?}]}`。
   *  只在裁决请求里出现——首次创建 run 不带 `command`。 */
  readonly command?: {
    readonly resume?: {
      readonly decisions?: readonly {
        readonly type?: string;
        readonly edited_action?: { readonly name?: string; readonly args?: unknown };
      }[];
    };
  };
}

const server = createServer((req, res) => {
  const url = req.url ?? "";

  if (req.method === "GET" && url === "/healthz") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && url === "/threads") {
    // DA-04：真实 LangGraph Platform 支持调用方指定 thread_id + if_exists 幂等创建，
    // provider 的 ensureThread 靠它做线程连续性。假上游必须镜像同一协议面——
    // 「loopback 假上游要与真上游同步改」是 dashscope realtime ASR 那次的教训原话。
    void readBody(req).then((raw) => {
      let requested: string | undefined;
      try {
        const parsed = raw === "" ? {} : (JSON.parse(raw) as { thread_id?: string });
        requested = typeof parsed.thread_id === "string" && parsed.thread_id !== "" ? parsed.thread_id : undefined;
      } catch {
        requested = undefined;
      }
      const threadId = requested ?? randomUUID();
      if (!runs.has(threadId)) runs.set(threadId, { started: false, userText: "", statusPolls: 0, scrollHalfStep: 0, decision: null, decisions: [] });
      sendJson(res, 200, { thread_id: threadId });
    });
    return;
  }

  const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
  if (req.method === "POST" && runsMatch) {
    const threadId = runsMatch[1]!;
    void readBody(req).then(async (raw) => {
      const existing = runs.get(threadId);
      if (!existing) { sendJson(res, 404, { error: "unknown thread" }); return; }
      let parsed: CreateRunBody;
      try {
        parsed = JSON.parse(raw) as CreateRunBody;
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }
      const resumeDecisionWire = parsed.command?.resume?.decisions?.[0];
      if (resumeDecisionWire !== undefined) {
        // DA-07b resume：既有 run 提交裁决，绝不重发用户输入、绝不重置 userText/statusPolls
        // ——那会丢掉「这是哪个触发词场景」的记账，且会让轮询重新走一遍 pending 阈值。
        const existingForResume = runs.get(threadId);
        if (existingForResume === undefined) { sendJson(res, 404, { error: "unknown thread" }); return; }
        const type = resumeDecisionWire.type === "approve" || resumeDecisionWire.type === "edit"
          || resumeDecisionWire.type === "reject" ? resumeDecisionWire.type : "reject";
        const editedArgs = type === "edit" && typeof resumeDecisionWire.edited_action?.args === "object"
          && resumeDecisionWire.edited_action.args !== null && !Array.isArray(resumeDecisionWire.edited_action.args)
          ? resumeDecisionWire.edited_action.args as Record<string, unknown>
          : undefined;
        existingForResume.decision = { type, editedArgs };
        // 追加记账（`decision` 仍是最后一次，既有分支不受影响）——「这是第几次裁决」
        // 是二次中断剧本唯一的推进依据。
        existingForResume.decisions = [...(existingForResume.decisions ?? []), { type, editedArgs }];
        if ((isTwoInterrupt(existingForResume) || isTwoApproval(existingForResume))
          && existingForResume.decisions.length === 1) {
          /*
           * 见 `TWO_INTERRUPT_HOLD_POLLS` 头注：窗口从**这次裁决之后**开始算。
           *
           * ⚠ 游标在这里**归零**（只对这两个剧本，其余剧本一行不动）。此前写的是
           * `statusPolls + HOLD_POLLS`，而第一条流 EOF 已经把 `statusPolls` 推成
           * `Number.MAX_SAFE_INTEGER`。真实机理是**追不上**，不是"那个 8 被吃掉"
           * （实测 `9007199254740991 + 8 === 9007199254741000`，加法没丢）：
           * `holdUntilPoll` 停在 `...741000`，而 `statusPolls` 每轮 `+1` 在
           * `9007199254740992` 就**饱和**（实测 `(M+1) + 1 === M+1`），永远走不到
           * `...741000`，于是 `statusPolls < holdUntilPoll` **恒真** —— 窗口永不结束，
           * 不是"由构造撑开的一段有界窗口"。
           *
           * 上面那句「resume 绝不重置 statusPolls」的理由是"别让轮询重新走一遍 pending
           * 阈值"——而这两个剧本要的**正是**一段 pending，重新走一遍就是它的定义。
           */
          existingForResume.statusPolls = 0;
          existingForResume.holdUntilPoll = Math.max(0, TWO_INTERRUPT_HOLD_POLLS);
        }
        sendJson(res, 200, { run_id: threadId });
        return;
      }
      const lastUserMessage = [...(parsed.input?.messages ?? [])].reverse().find((m) => m.role === "user");
      const lastUser = lastUserMessage?.content;
      const lastUserText = typeof lastUser === "string" ? lastUser : "";
      const lastUserId = typeof lastUserMessage?.id === "string" && lastUserMessage.id !== ""
        ? lastUserMessage.id : undefined;
      // DA-19g：追加进这条线程的历史记录，从不覆盖——见 `conversationLog` 自己的头注。
      if (lastUserText !== "") {
        const log = conversationLog.get(threadId) ?? [];
        log.push(lastUserText);
        conversationLog.set(threadId, log);
      }
      runs.set(threadId, {
        started: true,
        userText: lastUserText,
        userMessageId: lastUserId,
        scrollExecutionId: SCROLL_ACCEPTANCE_TRIGGER !== undefined && lastUserText === SCROLL_ACCEPTANCE_TRIGGER ? randomUUID() : undefined,
        scrollHalfStep: 0,
        statusPolls: 0,
        decision: null,
        decisions: [],
        // issue #2020：在**这一轮请求真实收到的字节**上判定，不缓存跨轮——挂载前的
        // 轮次 system 里没有哨兵、挂载后的轮次才有，前后对照正是 e2e 的判据。
        skillSentinelSeen: mountedSkillReachedUpstream(parsed),
        // 路径矩阵 D4：同一条纪律——只看这一轮请求真实收到的字节，不缓存跨轮。
        skillCatalogSeen: skillCatalogReachedUpstream(parsed),
      });
      /*
       * issue #3297 —— 多步剧本的 hold 窗口：让 `MULTISTEP_MIN_STATUS_POLLS` 真的生效。
       *
       * 那条旋钮的设计意图逐字写在它自己的头注里（本文件 :84-93）：「把该 run 的终态推迟到
       * 至少这么多次状态轮询之后，`/state` 按 `multistepStage()` 分阶段揭示」。它**一次也没
       * 生效过**：终态闸判的是 `record.statusPolls < requiredPolls`，而流 EOF 那段
       * （本文件 `record.statusPolls = Number.MAX_SAFE_INTEGER` 处）在
       * `(record.holdUntilPoll ?? 0) <= record.statusPolls` 恒真时把游标直接推到饱和——
       * 多步剧本没有 `holdUntilPoll`，`0 <= statusPolls` 恒真 ⇒ EOF 一到就饱和 ⇒
       * `statusPolls < requiredPolls` 恒假 ⇒ **EOF 后第一次状态轮询就落终态**。
       *
       * 这就是本文件头注 :70-79 自己记下的那个坑（「`/stream` 在 EOF 时把 `statusPolls`
       * 直接推到 MAX——于是十对工具调用从不按剧本推进」）。当时的修正只经 `holdUntilPoll`
       * 覆盖了二次中断/二次授权两个剧本，多步剧本漏在门外。
       *
       * 实测后果（run 34416935580 的 chat-path-coverage 证据包，F3 用例 trace.zip 里
       * `GET /plan-control/threads/:id/ledger` 的全部 50 次应答，去重后只有三态）：
       *   531142.5  runStatus=idle       phase=preparing  steps=0
       *   537129.9  runStatus=running    phase=executing  steps=0   ← `running` 只被采到 1 次
       *   540113.4  runStatus=succeeded  phase=done       steps=3
       * live 窗口 ≤ 一个前端账本轮询周期（3s），而 `chat-task-workbench-run-pause` 的渲染门是
       * `runLive`（`deriveRunControls`，终态恒 false）⇒ 那条断言在这个剧本下**结构上不可能变绿**，
       * 也不可能证伪任何产品行为。它红在前置上，F3 的两条业务判据一次都没被求值。
       *
       * ⚠ 只给多步触发词这一条剧本设，其余剧本一行不动：`holdUntilPoll` 的另外几处读取
       * （二次中断/二次授权的 `/state` 与状态闸）都各自带着 `isTwoInterrupt` / `isTwoApproval`
       * 前置，多步触发词不可能等于那两个触发词，因此够不到它们。
       */
      if (MULTISTEP_TRIGGER !== undefined && lastUserText === MULTISTEP_TRIGGER) {
        const record = runs.get(threadId);
        if (record !== undefined) record.holdUntilPoll = Math.max(STATUS_POLLS_BEFORE_DONE, MULTISTEP_MIN_STATUS_POLLS);
      }
      /*
       * issue #3100 D6 —— 多步剧本这一轮真的派发一个异步子任务。
       *
       * 时序照真实链路：`spawn_async_task` 是在**这一次模型运行内部**同步调用 TS 侧入队
       * 端点的（见 `tools.py` 里那段 `httpx.post`），所以这里也在 run 创建应答之前 await
       * 它——不是事后补一条。派发结果记进 record，`/state` 只在派发**真的成功**之后才把
       * 那半个工具调用揭示出来（失败时揭示的是失败那句话），替身不替 TS 侧编 id。
       */
      if (MULTISTEP_TRIGGER !== undefined && lastUserText === MULTISTEP_TRIGGER) {
        const outcome = await spawnAsyncTask(parsed, SPAWN_SUBTASK_DESCRIPTION, SPAWN_SUBTASK_CONTEXT,
          spawnCallIdFor(threadId));
        const record = runs.get(threadId);
        if (record !== undefined) {
          record.spawnedSubtaskRunId = "subtaskRunId" in outcome ? outcome.subtaskRunId : null;
          record.spawnFailureText = "failure" in outcome ? outcome.failure : null;
        }
      }
      // 用 thread id 直接当 run id：同一线程本进程不并发跑第二个 run，够用，
      // 不需要为了"看起来更像真服务"多维护一份映射。
      sendJson(res, 200, { run_id: threadId });
    });
    return;
  }

  const statusMatch = /^\/threads\/([^/]+)\/runs\/([^/]+)$/.exec(url);
  if (req.method === "GET" && statusMatch) {
    const threadId = statusMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown run" }); return; }
    record.statusPolls += 1;
    // The three generative-UI form tools interrupt as soon as their call is present in
    // thread state.  Unlike a normal model run, there is no useful extra "pending" poll
    // after the SSE join has ended: the production provider requires the joined run to
    // have reached a decisive state before it can persist mandatory Skill activity.
    // Resume keeps this same record/run and sets `decision`, so it falls through to the
    // ordinary terminal threshold below instead of interrupting a second time.
    /*
     * 二次中断剧本（B1/B4/B5/B6，见 `TWO_INTERRUPT_TRIGGER` 头注）：**裁决满两次之前一直
     * interrupted**。与下面那条表单分支的差别只有把关条件——那条是「有没有被裁决过」，
     * 这条是「被裁决过几次」。真实引擎恢复后立刻又中断，形状就是这个。
     *
     * ⚠ 它**有界**：第二次裁决之后落终态。「一直不终态」和「卡住了」在界面上分不开，
     * 那种替身会让「用户被锁死」这条判据变成不可证伪的（同 F5 那条 hold 旋钮的理由）。
     */
    if (isTwoInterrupt(record) && decisionCount(record) === 1
      && record.statusPolls < (record.holdUntilPoll ?? 0)) {
      // hold 窗口：第一次裁决已生效，第二次中断还没来——run 就是普通地在跑。
      sendJson(res, 200, { status: "pending" });
      return;
    }
    if (isTwoInterrupt(record) && decisionCount(record) < 2) {
      sendJson(res, 200, { status: "interrupted" });
      return;
    }
    if (needsFormDecision(record) && record.decision === null) {
      sendJson(res, 200, { status: "interrupted" });
      return;
    }
    // #742 Gap 1：多步剧本要求更多轮才终态——见 `MULTISTEP_MIN_STATUS_POLLS` 头注。
    const requiredPolls = isSpawnedSubtaskRun(record.userText)
      // 路径矩阵 F5/C8 —— 见 `SUBTASK_HOLD_POLLS` 头注。排在最前：子任务的正文不会
      // 逐字等于任何一个触发词，但把它排在后面只会让人误以为次序无关。
      ? Math.max(STATUS_POLLS_BEFORE_DONE, SUBTASK_HOLD_POLLS!)
      : SCROLL_ACCEPTANCE_TRIGGER !== undefined && record.userText === SCROLL_ACCEPTANCE_TRIGGER
      ? Math.max(STATUS_POLLS_BEFORE_DONE, 20)
      : MULTISTEP_TRIGGER !== undefined && record.userText === MULTISTEP_TRIGGER
      ? Math.max(STATUS_POLLS_BEFORE_DONE, MULTISTEP_MIN_STATUS_POLLS)
      : STATUS_POLLS_BEFORE_DONE;
    if (record.statusPolls < requiredPolls) { sendJson(res, 200, { status: "pending" }); return; }
    // UX-9 D4：审批触发词且还没被裁决过 → 停在 interrupted，让真实 DA-07b 轮询循环
    // 读到「等人裁决」而不是直接终态。裁决（resume）到达后 record.decision 非 null，
    // 之后的轮询一律走终态分支——不会无限停在 interrupted。
    if (APPROVAL_TRIGGER !== undefined && record.userText === APPROVAL_TRIGGER && record.decision === null) {
      sendJson(res, 200, { status: "interrupted" });
      return;
    }
    // 路径矩阵 B4 —— 二次技能授权剧本，判据是「被裁决过几次」而不是「有没有被裁决过」。
    // hold 窗口内如实回 `pending`：第一次授权已生效、第二次请求还没提出，run 就是在跑。
    if (isTwoApproval(record) && decisionCount(record) === 1
      && record.statusPolls < (record.holdUntilPoll ?? 0)) {
      sendJson(res, 200, { status: "pending" });
      return;
    }
    if (isTwoApproval(record) && decisionCount(record) < 2) {
      sendJson(res, 200, { status: "interrupted" });
      return;
    }
    // issue #3132（B7）：计划确认触发词且还没被裁决 → 停在 interrupted，让真实 DA-07b
    // 轮询循环把 run 落到 `awaiting_tool_permission`，`pending_tool_name` = write_todos。
    if (PLAN_CONFIRM_TRIGGER !== undefined && record.userText === PLAN_CONFIRM_TRIGGER && record.decision === null) {
      sendJson(res, 200, { status: "interrupted" });
      return;
    }
    // issue #2767 -- 这条状态轮询分支本身与裁决类型无关（走到这里说明 `record.decision`
    // 已非 null，`/threads/:id/runs/:runId/state` 那条分支才区分 approve/edit/reject 的
    // 内容），旧注释"reject 永远不会被观察到"只对旧 `decideAgentRun` 的 reject 成立
    // （那条直接 `failRun`，从不 resume）——F06 的 `deny`（`decideToolPermission`）会把
    // run 收回 `queued` 再 resume，真的会走到这里，见下方 state 分支的处理。
    // 第二次起终态——见头注。用户原话逐字等于失败触发词时终态是 error，不是 success。
    const isAbort = STREAM_ABORT_TRIGGER !== undefined && record.userText === STREAM_ABORT_TRIGGER;
    // F1：空回复那条**不进**这个三元——它的终态就是 `success`，失败发生在读正文那一步
    // （`readCompletion` 读不出 assistant 消息才抛）。把它答成 `error` 会让它与
    // `FAILURE_TRIGGER` 落到同一个成因，这条触发词就白加了。
    const status = (FAILURE_TRIGGER !== undefined && record.userText === FAILURE_TRIGGER) || isAbort ? "error" : "success";
    sendJson(res, 200, { status });
    return;
  }

  // DA-03 取证扩展：join 流端点（messages-tuple 形状，与真 LangGraph 一致）。
  // 逐片发 finalReply（每片 ~8 字符、间隔 80ms）——「相邻帧正文字数不同」是
  // UI 评分第 1 项的判据，整段一次性发等于白做。
  const streamMatch = /^\/threads\/([^/]+)\/runs\/([^/]+)\/stream$/.exec(url);
  if (req.method === "GET" && streamMatch) {
    const threadId = streamMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown thread" }); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const streamOpenedAt = Date.now();
    // 多步剧本的流式正文要与 state 的终稿同一口径——否则截图里会出现
    // 「已查询当前时间」这句与多步剧本（从不查时间）自相矛盾的话。
    // DA-19g 真根因修复：`FOLLOWUP_CONTEXT_TRIGGER`/`MARKDOWN_TRIGGER` 两个特殊分支改走
    // `computeSpecialTurnReply`——与 `/state` 单一事实源，见该函数自己的头注（此前这里
    // 从未判过这两个触发词，永远落到下面这句通用模板，是 DA-19g 评分第 2 轮抓到的真
    // 根因）。未命中任何触发词时的默认模板原样保留，不改措辞。
    const isApproval = APPROVAL_TRIGGER !== undefined && record.userText === APPROVAL_TRIGGER;
    const isClarifying = isClarification(record);
    const isConfirming = isConfirmIntent(record);
    const isChoosing = isChooseOption(record);
    const isTwoInterruptTurn = isTwoInterrupt(record);
    const isTwoApprovalTurn = isTwoApproval(record);
    const streamMessageId = SCROLL_ACCEPTANCE_TRIGGER !== undefined && record.userText === SCROLL_ACCEPTANCE_TRIGGER ? `scroll-${record.scrollExecutionId}:final` : isApproval ? `approval-${threadId}:${record.decision === null ? "pending" : "final"}` : isClarifying ? `clarification-${threadId}:${record.decision === null ? "pending" : "final"}` : isConfirming ? `confirm-intent-${threadId}:${record.decision === null ? "pending" : "final"}` : isChoosing ? `choose-option-${threadId}:${record.decision === null ? "pending" : "final"}` : isTwoInterruptTurn ? `two-interrupt-${threadId}:${decisionCount(record) < 2 ? "pending" : "final"}` : isTwoApprovalTurn ? `two-approval-${threadId}:${decisionCount(record) < 2 ? "pending" : "final"}` : undefined;
    const reply = SCROLL_ACCEPTANCE_TRIGGER !== undefined && record.userText === SCROLL_ACCEPTANCE_TRIGGER
      ? SCROLL_ACCEPTANCE_REPLY : isApproval ? approvalReply(record) : isClarifying ? clarificationReply(record) : isConfirming ? confirmIntentReply(record) : isChoosing ? chooseOptionReply(record) : isTwoInterruptTurn ? (decisionCount(record) < 2 ? "还需要你的确认才能继续。" : TWO_INTERRUPT_FINAL_REPLY) : isTwoApprovalTurn ? (decisionCount(record) < 2 ? "还需要你的批准才能继续。" : TWO_APPROVAL_FINAL_REPLY) : MULTISTEP_TRIGGER !== undefined && record.userText === MULTISTEP_TRIGGER
      ? "综合 3 份文档检索与 A.md 的内容，结论是：多步依赖链已完整执行——先搜索（命中 A.md/B.md/C.md），再读取搜索结果中最相关的 A.md，最后据其正文作答。"
      /*
       * 路径矩阵 C1 —— 流式正文 = 本轮**每一条**顶层 AI 消息正文按序拼起来，与
       * `/state` 里那 N+1 条是同一批事实（真实 LangGraph 的 messages-tuple 流正是
       * 逐条把它们喂出来的）。用户看见的 N 个围栏就出自这里；落库该不该也有这
       * N 个，是被测判据本身，不由替身决定。
       */
      : isMultiCanvasTurn(record)
      ? multiCanvasBodies(record.userText).join("\n\n")
      : isToolFailureTurn(record)
      ? TOOL_FAILURE_REPLY
      : computeSpecialTurnReply(threadId, record)
        // issue #2020：哨兵回显（开关未给全时 `skillEcho` 恒 ""，逐字节不变）——
        // 只拼在默认模板上：特殊剧本各有既有断言盯着措辞，不动它们。
        ?? `${skillEcho(record)}根据查询结果回答你："${record.userText}" —— 已查询当前时间，详情见工具结果。`;
    const pieces: string[] = [];
    for (let i = 0; i < reply.length; i += 8) pieces.push(reply.slice(i, i + 8));
    /*
     * 路径矩阵 F7 —— 断流点。发满这么多片之后直接销毁 socket：不 `res.end()`（那是
     * 正常 EOF），也**不**把 `statusPolls` 推到终态（那是"流正常读完"才有的语义）。
     * 取 2 片而不是 0 片：0 片等于"流根本没打开"，走的是 `tryStreamRun` 里另一条
     * 分支（HTTP 非 2xx / 连不上）；这条路径要证的是"已经发过正文、看起来在跑，然后
     * 半路断了"——它与"一开始就连不上"在 UI 上的表现本来就该不同。
     */
    const abortAfterPieces = STREAM_ABORT_TRIGGER !== undefined && record.userText === STREAM_ABORT_TRIGGER
      ? Math.min(2, pieces.length)
      : null;
    let idx = 0;
    // issue #3000：慢触发词——响应头已经发出（连接真的建立），正文推迟到 hold 之后再发。
    // 期间这一轮 run 真的停在 `running`，切走再切回时恢复路径才有东西可恢复。
    const holdMs = SLOW_TRIGGER !== undefined && record.userText === SLOW_TRIGGER ? SLOW_HOLD_MS : 0;
    const timer = setInterval(() => {
      if (holdMs > 0 && Date.now() < streamOpenedAt + holdMs) return;
      if (abortAfterPieces !== null && idx >= abortAfterPieces) {
        clearInterval(timer);
        res.destroy();
        return;
      }
      if (idx >= pieces.length) {
        // 十步滚动剧本：正文发完**流不结束**——真实 LangGraph 的 join 流在图还在跑
        // 工具节点时保持打开，工具落地逐个以 `event: updates` 的 `{"tools": ...}` patch
        // 发出来（形状锚点见 `deep-agent-model-provider.ts` `tryStreamRun` 头注引用的
        // `01-sse-stream.txt` 实测采集）。此前这里直接 EOF + 把 `statusPolls` 推到
        // MAX，十对调用于是全落到流后那一次兜底 state 读里一次性出现——见
        // `SCROLL_STEP_MS` 头注。
        if (SCROLL_ACCEPTANCE_TRIGGER !== undefined && record.userText === SCROLL_ACCEPTANCE_TRIGGER
          && record.scrollHalfStep < SCROLL_TOTAL_HALF_STEPS) {
          if (Date.now() < streamOpenedAt + holdMs + (record.scrollHalfStep + 1) * SCROLL_STEP_MS) return;
          record.scrollHalfStep += 1;
          // 半步为奇数 = 宣布第 index 个调用，偶数 = 它的回执落地。两者都是「tools
          // 节点更新了 messages」，都该发一帧——`emitNewToolEvents` 自己按 `emitted`
          // 去重，这里不替它判该不该记账。
          const index = Math.floor((record.scrollHalfStep - 1) / 2);
          const id = `scroll-${record.scrollExecutionId}-${index}`;
          const message = record.scrollHalfStep % 2 === 1
            ? { type: "ai", content: "", tool_calls: [{ id, name: "read_document", args: { path: `scroll-${index}.md` } }] }
            : { type: "tool", tool_call_id: id, content: `第 ${index + 1} 份文档的读取回执。` };
          res.write(`event: updates\ndata: ${JSON.stringify({ tools: { messages: [message] } })}\n\n`);
          return;
        }
        clearInterval(timer);
        // LangGraph's join stream closes only after the remote run has settled. Mirror that
        // contract: the provider performs one authoritative status read immediately after
        // EOF, which must observe a terminal state for ordinary runs. Form interrupts still
        // win in the status handler until a decision exists.
        /*
         * ⚠ **有 hold 窗口在跑时不推这个游标**（路径矩阵 A4/A5/B1/B4/B5/B6）。
         *
         * 二次中断 / 二次授权剧本的 hold 窗口判据是 `record.statusPolls < record.holdUntilPoll`
         * （`/state` 与状态轮询两处都读它）。恢复后的那条流一 EOF 就把游标推到 MAX，窗口
         * 当场被抹平——「第一次裁决已生效、第二次中断还没来」这段**由构造撑开**的状态
         * 在浏览器链路上宽度为 0，`TWO_INTERRUPT_HOLD_POLLS=8` 形同虚设，三条 spec 的
         * 被测状态不可达。
         *
         * 「流读完了」与「构造出来的那段窗口过去了」是两件事：前者说的是这一次 join 流
         * 结束了，后者由轮数推进。窗口还没走完就照实不推，让它按 `statusPolls` 自然走完
         * （每次状态轮询 +1，有界，走完照旧进第二次中断 → 终态）。
         */
        if ((record.holdUntilPoll ?? 0) <= record.statusPolls) record.statusPolls = Number.MAX_SAFE_INTEGER;
        res.end();
        return;
      }
      res.write(`event: messages\ndata: [${JSON.stringify({ id: streamMessageId, content: pieces[idx], type: "AIMessageChunk" })}, {}]\n\n`);
      idx += 1;
    }, STREAM_GAP_MS);
    req.on("close", () => clearInterval(timer));
    return;
  }

  const stateMatch = /^\/threads\/([^/]+)\/state$/.exec(url);
  if (req.method === "GET" && stateMatch) {
    const threadId = stateMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown thread" }); return; }
    if (!record.started) { sendJson(res, 200, { values: { messages: [] } }); return; }
    // F1（见 `EMPTY_REPLY_TRIGGER` 头注）：远端 run 成功收场，但这一轮没有任何
    // assistant 正文。排在所有剧本分支**之前**——否则下面任意一支都会先给出正文，
    // 这条触发词就永远到不了（C4 的「specific 判定被 ambient 判定永久遮住」同形）。
    if (EMPTY_REPLY_TRIGGER !== undefined && record.userText === EMPTY_REPLY_TRIGGER) {
      sendJson(res, 200, { values: { messages: [{ type: "human", content: record.userText }] } });
      return;
    }
    const toolCallId = `call-${threadId}`;
    // DA-06 取证扩展（#1749，UI 主卡第 2 项「规划步骤」）：剧本先发一次 write_todos
    // ——与真 deepagents TodoListMiddleware 的调用形状一致（args.todos 数组），
    // 让规划条（agent-plan-panel）在确定性替身下也能被真实渲染并被取证脚本拍到。
    // 三态齐全：completed/in_progress/pending，前端逐态图标都有得判。
    const todosCallId = `todos-${threadId}`;
    const todosArgs = {
      todos: [
        { content: "理解用户问题", status: "completed" },
        { content: "查询当前时间", status: "in_progress" },
        { content: "组织最终回答", status: "pending" },
      ],
    };
    // UI 评分第 4 项：多步依赖链剧本。第二个工具（read_document）的 args.path 逐字
    // 取自第一个工具（search_documents）结果里的文件名——链条本身就是证据。
    /*
     * 路径矩阵 C1 —— 一轮里**多条**顶层 AI 消息，前 N 条各带一个画布围栏，最后一条
     * 是零围栏的纯文字总结。形状说明见 `MULTI_CANVAS_TRIGGER` 头注。
     *
     * ⚠ 每条 AI 消息都是 `messages` 数组里**独立的一项**，不是拼进同一条的正文——
     * 「每一条」与「最后一条」必须真的不是同一条，否则被测缺陷无法被证伪。
     */
    if (isMultiCanvasTurn(record)) {
      /*
       * ⚠ 这条 human 消息**必须带上它进来时的那个 id**（`wsx-turn:<runId>:user`）。
       * 不带 id 时 `readTurnReply` 找不到本轮锚点 ⇒ 静默退回 `readFinalReply` ⇒ 落库正文
       * 只剩最后那条**零围栏**的纯文字总结，C1 的「收尾后画布数 3→0」于是恒红在替身的
       * 方言上，被测的 #3243 一次都没被求值。真上游 `harness.py` 保留这个 id，替身也必须。
       */
      const messages: unknown[] = [{ type: "human", content: record.userText, ...(record.userMessageId !== undefined ? { id: record.userMessageId } : {}) }];
      for (const body of multiCanvasBodies(record.userText)) {
        messages.push({ type: "ai", content: body });
      }
      sendJson(res, 200, { values: { messages } });
      return;
    }
    /*
     * 路径矩阵 D1 —— 同一轮里成功与失败的工具调用各一次。失败那条 ToolMessage 带
     * `status: "error"`，正是 `deep-agent-model-provider.ts` 读的
     * `ok: message.status !== "error"` 那个字段。run 本身**正常收尾**（不是
     * `FAILURE_TRIGGER` 那条把整条 run 推成 error 的路径）。
     */
    if (isToolFailureTurn(record)) {
      const okCallId = `toolok-${threadId}`;
      const failCallId = `toolfail-${threadId}`;
      sendJson(res, 200, {
        values: {
          messages: [
            { type: "human", content: record.userText },
            {
              type: "ai",
              content: "我先读第一份文档。",
              tool_calls: [{ id: okCallId, name: "read_document", args: { path: "ok.md" } }],
            },
            { type: "tool", tool_call_id: okCallId, content: "ok.md 内容：这一份读到了。" },
            {
              type: "ai",
              content: "再读第二份文档。",
              tool_calls: [{ id: failCallId, name: "read_document", args: { path: "missing.md" } }],
            },
            // ⚠ `status: "error"` 是这条剧本存在的全部理由——去掉它，这一轮就退化成
            //   两次普通成功调用，D1 的判据当场恒真。
            { type: "tool", tool_call_id: failCallId, content: TOOL_FAILURE_MESSAGE, status: "error" },
            { type: "ai", content: TOOL_FAILURE_REPLY },
          ],
        },
      });
      return;
    }
    if (SCROLL_ACCEPTANCE_TRIGGER !== undefined && record.userText === SCROLL_ACCEPTANCE_TRIGGER) {
      // Protocol-level fixture, like the three-step fixture below: production
      // polling, journal persistence and rendering must observe every receipt.
      const messages: unknown[] = [{ type: "human", content: record.userText }];
      for (let index = 0; index < 10; index += 1) {
        const id = `scroll-${record.scrollExecutionId}-${index}`;
        // 一个半步恰好落地一条新 message：奇数半步宣布第 index 个调用，紧接的偶数
        // 半步落地它的回执。于是「宣布了但还没回执」这个状态真的存在整整一个
        // `SCROLL_STEP_MS` 窗口——steering spec 的轮询要抓的正是它。此前的
        // `index*2` / `(index+1)*2` 让两件事挤在同一个半步上，那个窗口宽度是 0。
        if (record.scrollHalfStep >= index * 2 + 1) messages.push({ type: "ai", content: "", tool_calls: [{ id, name: "read_document", args: { path: `scroll-${index}.md` } }] });
        if (record.scrollHalfStep >= index * 2 + 2) messages.push({ type: "tool", tool_call_id: id, content: `第 ${index + 1} 份文档的读取回执。` });
      }
      if (record.scrollHalfStep >= SCROLL_TOTAL_HALF_STEPS) messages.push({ id: `scroll-${record.scrollExecutionId}:final`, type: "ai", content: SCROLL_ACCEPTANCE_REPLY });
      sendJson(res, 200, { values: { messages } });
      return;
    }
    if (MULTISTEP_TRIGGER !== undefined && record.userText === MULTISTEP_TRIGGER) {
      const searchCallId = `search-${threadId}`;
      const readCallId = `read-${threadId}`;
      const searchResult = "找到 3 份文档：A.md B.md C.md";
      const human = { type: "human", content: record.userText };
      const todosAnnounced = {
        type: "ai",
        content: "",
        tool_calls: [{
          id: todosCallId,
          name: "write_todos",
          args: {
            todos: [
              { content: "搜索相关文档", status: "in_progress" },
              { content: "读取最相关的一份", status: "pending" },
              { content: "综合结论作答", status: "pending" },
            ],
          },
        }],
      };
      const todosAnswered = { type: "tool", tool_call_id: todosCallId, content: "todos updated" };
      const searchAnnounced = {
        type: "ai",
        content: "我先搜索文档库，看有哪些相关材料。",
        tool_calls: [{ id: searchCallId, name: "search_documents", args: { query: record.userText } }],
      };
      const searchAnswered = { type: "tool", tool_call_id: searchCallId, content: searchResult };
      const readAnnounced = {
        type: "ai",
        content: "基于搜索结果，读取最相关的 A.md。",
        tool_calls: [{ id: readCallId, name: "read_document", args: { path: "A.md" } }],
      };
      const readAnswered = {
        type: "tool", tool_call_id: readCallId,
        content: "A.md 内容：多步执行取证样例正文——搜索命中的第一份文档。",
      };
      const finalReply = {
        type: "ai",
        content: "综合 3 份文档检索与 A.md 的内容，结论是：多步依赖链已完整执行——先搜索（命中 A.md/B.md/C.md），再读取搜索结果中最相关的 A.md，最后据其正文作答。",
      };
      /**
       * #742 Gap 1：按 `statusPolls` 分阶段揭示——每个工具调用先只有「宣布」那半
       * （对应账本里的 `in_progress` 行），停留至少一轮真实轮询，再补上「回答」那半
       * （对应终态行）。真实 `execute-run.ts` 的 `completeWithProgress` 循环会在这个
       * 过程中真的把 `in_progress` 行写进 `agent_run_steps`，前端真的有机会轮询到它。
       */
      /*
       * issue #3100 D6 —— 派发异步子任务这一步。args 形状逐字等于真实工具签名
       * （`description` + 可选 `context`），ToolMessage 正文逐字等于真实工具的返回串
       * （`tools.py::spawn_async_task` 的两条 return 分支），子任务 id 是 TS 侧
       * `POST /internal/subtask-runs` 真的回给的那一个——见 `spawnAsyncTask` 头注。
       *
       * ⚠ 没派成功（`spawnedSubtaskRunId` 为 null）时揭示的是**失败那句话**，不是
       * 一条编出来的成功回执：前端的后台任务面板此时也确实查不到任何子任务行，
       * 界面与账本两边一致。
       */
      const spawnCallId = spawnCallIdFor(threadId);
      const spawnAnnounced = {
        type: "ai",
        content: "这件事可以并行处理，我把它派发到后台去跑。",
        tool_calls: [{
          id: spawnCallId,
          name: "spawn_async_task",
          args: { description: SPAWN_SUBTASK_DESCRIPTION, context: SPAWN_SUBTASK_CONTEXT },
        }],
      };
      const spawnAnswered = {
        type: "tool",
        tool_call_id: spawnCallId,
        content: record.spawnedSubtaskRunId
          ? `子任务已派发（subtaskRunId=${record.spawnedSubtaskRunId}），正在后台异步执行，`
            + "不需要等待它完成，请继续处理对话的其它部分。"
          : record.spawnFailureText ?? "无法派发异步子任务：本次运行没有配置好异步派发通路"
            + "（缺少 subtask_callback_base_url/org_id/parent_run_id 之一）。"
            + "请改用 task 工具委托给具名子代理，或自己继续处理这个子任务。",
      };
      const polls = record.statusPolls;
      const messages: unknown[] = [human, todosAnnounced];
      if (polls >= 2) messages.push(todosAnswered, searchAnnounced);
      if (polls >= 4) messages.push(searchAnswered, spawnAnnounced);
      if (polls >= 6) messages.push(spawnAnswered, readAnnounced);
      if (polls >= 8) messages.push(readAnswered, finalReply);
      sendJson(res, 200, { values: { messages } });
      return;
    }
    // UX-9 D4 前端接入取证（gap 清单第 3 条）：审批触发词的剧本。原始参数（裁决前
    // `readPendingApproval` 读到、渲染进审批面板的那份）与裁决后落进 state 的工具结果
    // 是两件事——`editedArgs`（若有）必须能在终稿里被肉眼核对，不是「按了编辑就白按」。
    if (PLAN_CONFIRM_TRIGGER !== undefined && record.userText === PLAN_CONFIRM_TRIGGER) {
      const planCallId = `plan-confirm-${threadId}`;
      // 提案计划：形状逐字等于真实 `write_todos` 的 args（`{todos:[{content,status}]}`）。
      // 全部 `pending` —— 提案还没执行，一步都没跑。
      const proposedTodos = Array.from({ length: Math.max(1, PLAN_CONFIRM_STEP_COUNT) }, (_, i) => ({
        content: `提案步骤 ${i + 1}`,
        status: "pending",
      }));
      const planAnnounced = {
        id: `plan-confirm-${threadId}:pending`,
        type: "ai",
        content: "",
        tool_calls: [{ id: planCallId, name: PLAN_CONFIRM_TOOL_NAME, args: { todos: proposedTodos } }],
      };
      if (record.decision === null) {
        // 未裁决：工具调用**没有**配对的 ToolMessage —— `readPendingApproval` 靠这个
        // 找到「待决的那一个」，与真实 HumanInTheLoopMiddleware 的 interrupt 语义一致。
        sendJson(res, 200, {
          values: { messages: [{ type: "human", content: record.userText }, planAnnounced] },
        });
        return;
      }
      if (record.decision.type === "reject") {
        // UC-P6：取消 —— run 不直接失败，内核收到拒绝后自行收敛；账本仍为空（提案从未生效）。
        sendJson(res, 200, {
          values: {
            messages: [
              { type: "human", content: record.userText },
              planAnnounced,
              { type: "tool", tool_call_id: planCallId, content: "用户取消了这份计划，未执行。" },
              { id: `plan-confirm-${threadId}:final`, type: "ai", content: "已按你的要求取消，这份计划没有执行。" },
            ],
          },
        });
        return;
      }
      // UC-P2/UC-P7：确认（或改后确认）⇒ 同一条 run 继续跑。用的是裁决后的 args
      // ——`edit` 时终稿里能肉眼核对提交的确实是编辑后的值。
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? record.decision.editedArgs
        : { todos: proposedTodos };
      const usedTodos = Array.isArray((usedArgs as { todos?: unknown }).todos)
        ? (usedArgs as { todos: { content?: unknown }[] }).todos
        : proposedTodos;
      const secondCallId = `plan-confirm-${threadId}:progress`;
      sendJson(res, 200, {
        values: {
          messages: [
            { type: "human", content: record.userText },
            { ...planAnnounced, tool_calls: [{ id: planCallId, name: PLAN_CONFIRM_TOOL_NAME, args: usedArgs }] },
            { type: "tool", tool_call_id: planCallId, content: "todos updated" },
            // ⚠ 同一条 run 里的**第二次** `write_todos`（把第一步标 in_progress）。
            // 真实引擎在这里绝不能再停一次——见 `PLAN_CONFIRM_TOOL_NAME` 头注。
            {
              id: `plan-confirm-${threadId}:progress-ai`,
              type: "ai",
              content: "",
              tool_calls: [{
                id: secondCallId,
                name: PLAN_CONFIRM_TOOL_NAME,
                args: {
                  todos: usedTodos.map((t, i) => ({
                    content: typeof t.content === "string" ? t.content : `提案步骤 ${i + 1}`,
                    status: i === 0 ? "in_progress" : "pending",
                  })),
                },
              }],
            },
            { type: "tool", tool_call_id: secondCallId, content: "todos updated" },
            { id: `plan-confirm-${threadId}:final`, type: "ai", content: "计划已确认并执行完毕。" },
          ],
        },
      });
      return;
    }
    if (isTwoApproval(record)) {
      const human = { type: "human", content: record.userText };
      const firstCallId = `two-approval-a-${threadId}`;
      const secondCallId = `two-approval-b-${threadId}`;
      const firstArgs = { skill_stable_name: TWO_APPROVAL_FIRST_SKILL, task: "取证：第一次待批技能调用" };
      const secondArgs = { skill_stable_name: TWO_APPROVAL_SECOND_SKILL, task: "取证：第二次待批技能调用（新的请求）" };
      const firstPending = {
        id: `${firstCallId}:pending`, type: "ai", content: "这一步需要人工批准后才能继续。",
        tool_calls: [{ id: firstCallId, name: APPROVAL_TOOL_NAME, args: firstArgs }],
      };
      const decided = decisionCount(record);
      if (decided === 0) { sendJson(res, 200, { values: { messages: [human, firstPending] } }); return; }
      const firstSettled = [
        firstPending,
        { type: "tool", tool_call_id: firstCallId,
          content: record.decisions[0]!.type === "reject"
            ? "用户拒绝了这次技能调用，未执行。"
            : `已执行技能：${JSON.stringify(firstArgs)}` },
      ];
      const secondPending = {
        id: `${secondCallId}:pending`, type: "ai", content: "还有一步需要人工批准。",
        tool_calls: [{ id: secondCallId, name: APPROVAL_TOOL_NAME, args: secondArgs }],
      };
      if (decided === 1) {
        if (record.statusPolls < (record.holdUntilPoll ?? 0)) {
          // hold 窗口：没有任何未配对的 tool_call ⇒ 权威读 `pendingApproval` 为 null。
          sendJson(res, 200, { values: { messages: [human, ...firstSettled] } });
          return;
        }
        sendJson(res, 200, { values: { messages: [human, ...firstSettled, secondPending] } });
        return;
      }
      sendJson(res, 200, {
        values: {
          messages: [
            human, ...firstSettled, secondPending,
            { type: "tool", tool_call_id: secondCallId,
              content: record.decisions[1]!.type === "reject"
                ? "用户拒绝了这次技能调用，未执行。"
                : `已执行技能：${JSON.stringify(secondArgs)}` },
            { id: `two-approval-${threadId}:final`, type: "ai", content: TWO_APPROVAL_FINAL_REPLY },
          ],
        },
      });
      return;
    }
    if (APPROVAL_TRIGGER !== undefined && record.userText === APPROVAL_TRIGGER) {
      const approvalCallId = `approval-${threadId}`;
      // 形状必须是 `call_skill` 的真实参数（契约 `DeepAgentHitlToolArgs`），不是 send_email
      // 的 `{to, subject, body}`——审批卡照着契约 schema 渲染，形状不符就渲染不出字段。
      const originalArgs = {
        skill_stable_name: "quarterly-report",
        task: "取证：待批技能调用（原始参数，未编辑）",
      };
      record.approvalArgs = originalArgs;
      const pendingApprovalAi = {
        id: `approval-${threadId}:pending`,
        type: "ai",
        content: "这一步需要人工批准后才能继续。",
        tool_calls: [{ id: approvalCallId, name: APPROVAL_TOOL_NAME, args: originalArgs }],
      };
      if (record.decision === null) {
        // 还没被裁决：工具调用没有配对的 tool 消息——`readPendingApproval` 靠这个
        // 找到「待批的那一个」，与真实中间件的 interrupt_on 语义一致。
        sendJson(res, 200, {
          values: {
            messages: [
              { type: "human", content: record.userText },
              pendingApprovalAi,
            ],
          },
        });
        return;
      }
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? record.decision.editedArgs
        : originalArgs;
      // issue #2767 -- F06 的 `deny`（`decideToolPermission`）与旧 `decideAgentRun` 的
      // `reject` 现在共用同一条 `resume:{decision:"reject"}` wire 形状（`execute-run.ts`
      // 的 `pendingDecision.kind === "deny"` 分支），且真的会走到这里——旧注释"reject 在
      // 这里永远不会被观察到"只对旧 `decideAgentRun` 的 reject 成立（那条直接
      // `failRun`，从不 resume）；F06 的 deny 会把 run 收回 `queued` 再 resume，本替身
      // 因此必须诚实回应"没有执行"，不能沿用 approve/edit 那句"已执行技能"。
      const toolResultText = record.decision.type === "reject"
        ? "用户拒绝了这次技能调用，未执行。"
        : `已执行技能（${record.decision.type === "edit" ? "编辑后" : "原样"}参数）：` + JSON.stringify(usedArgs);
      const finalReplyText = approvalReply(record);
      sendJson(res, 200, {
        values: {
          messages: [
            { type: "human", content: record.userText },
            { ...pendingApprovalAi, tool_calls: [{ id: approvalCallId, name: APPROVAL_TOOL_NAME, args: usedArgs }] },
            { type: "tool", tool_call_id: approvalCallId, content: toolResultText },
            { id: `approval-${threadId}:final`, type: "ai", content: finalReplyText },
          ],
        },
      });
      return;
    }
    /*
     * 二次中断剧本的 state（B1/B4/B5/B6）—— 时序逐字照 #3244 ① 里人类写下的那三步：
     *   ① 「确认一下我的理解，再开始」（`confirm_task_intent`，未配对 ⇒ 服务端判为待决）
     *   ② 提交之后**同一条 run** 又要人输入资料（`fill_run_params`，新的未配对 tool_call
     *      ⇒ 服务端生成一个**新的** permissionRequestId）
     *   ③ 再提交，落终态。
     * 每一步的推进只看 `decisions.length`，不看时间——不依赖任何时序运气。
     */
    if (isTwoInterrupt(record)) {
      const confirmCallId = `two-interrupt-confirm-${threadId}`;
      const fillCallId = `two-interrupt-fill-${threadId}`;
      const confirmArgs = {
        requestId: `two-interrupt-confirm-request-${threadId}`,
        understanding: "生成一份用户画像，并按画像模板填好各分区",
        assumptions: ["以当前会话内容为唯一事实来源"],
      };
      const fillArgs = {
        requestId: `two-interrupt-fill-request-${threadId}`,
        fields: [
          { name: "persona_source", label: "用户画像资料", aiGuess: null, rationale: null, required: true, currentValue: null },
        ],
      };
      const human = { type: "human", content: record.userText };
      const confirmPending = {
        id: `${confirmCallId}:pending`, type: "ai", content: "请先确认我对任务的理解。",
        tool_calls: [{ id: confirmCallId, name: "confirm_task_intent", args: confirmArgs }],
      };
      const decided = decisionCount(record);
      if (decided === 0) {
        // 第一次中断：`confirm_task_intent` 没有配对回执。
        sendJson(res, 200, { values: { messages: [human, confirmPending] } });
        return;
      }
      const firstUsed = record.decisions[0]!.type === "edit" && record.decisions[0]!.editedArgs !== undefined
        ? record.decisions[0]!.editedArgs
        : confirmArgs;
      const confirmSettled = [
        { ...confirmPending, tool_calls: [{ id: confirmCallId, name: "confirm_task_intent", args: firstUsed }] },
        { type: "tool", tool_call_id: confirmCallId, content: `已确认任务意图：${JSON.stringify(firstUsed)}` },
      ];
      const fillPending = {
        id: `${fillCallId}:pending`, type: "ai", content: "还需要你提供用户画像的资料。",
        tool_calls: [{ id: fillCallId, name: "fill_run_params", args: fillArgs }],
      };
      if (decided === 1) {
        if (record.statusPolls < (record.holdUntilPoll ?? 0)) {
          // hold 窗口内：第一次那个已配对、**没有**任何未配对的 tool_call ⇒ 服务端权威读
          // 里 `pendingApproval` 为 null，这条 run 上此刻不存在任何待决请求。
          sendJson(res, 200, { values: { messages: [human, ...confirmSettled] } });
          return;
        }
        // 第二次中断：**同一条 run**，第一次那个已配对、这一个未配对。
        sendJson(res, 200, { values: { messages: [human, ...confirmSettled, fillPending] } });
        return;
      }
      const secondUsed = record.decisions[1]!.type === "edit" && record.decisions[1]!.editedArgs !== undefined
        ? record.decisions[1]!.editedArgs
        : fillArgs;
      sendJson(res, 200, {
        values: {
          messages: [
            human,
            ...confirmSettled,
            { ...fillPending, tool_calls: [{ id: fillCallId, name: "fill_run_params", args: secondUsed }] },
            { type: "tool", tool_call_id: fillCallId, content: `已收到资料：${JSON.stringify(secondUsed)}` },
            { id: `two-interrupt-${threadId}:final`, type: "ai", content: TWO_INTERRUPT_FINAL_REPLY },
          ],
        },
      });
      return;
    }
    if (isClarification(record)) {
      const fillCallId = `clarification-${threadId}`;
      const originalArgs = {
        requestId: `clarification-request-${threadId}`,
        fields: [
          { name: "topic", label: "主题", aiGuess: null, rationale: null, required: true, currentValue: null },
          { name: "content_source", label: "内容来源", aiGuess: null, rationale: null, required: true, currentValue: null },
          { name: "audience_or_purpose", label: "受众或用途", aiGuess: "团队内部评审", rationale: "生成适合当前工作台评审的一页说明", required: false, currentValue: null },
        ],
      };
      record.approvalArgs = originalArgs;
      const pending = {
        id: `clarification-${threadId}:pending`,
        type: "ai",
        content: "我需要先了解文档主题和内容来源。",
        tool_calls: [{ id: fillCallId, name: "fill_run_params", args: originalArgs }],
      };
      if (record.decision === null) {
        sendJson(res, 200, { values: { messages: [{ type: "human", content: record.userText }, pending] } });
        return;
      }
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? record.decision.editedArgs
        : originalArgs;
      const skillCallId = `clarification-skill-${threadId}`;
      sendJson(res, 200, {
        values: {
          messages: [
            { type: "human", content: record.userText },
            { ...pending, tool_calls: [{ id: fillCallId, name: "fill_run_params", args: usedArgs }] },
            { type: "tool", tool_call_id: fillCallId, content: `已收到补充参数：${JSON.stringify(usedArgs)}` },
            { type: "ai", content: "信息已齐全，开始生成 PDF。", tool_calls: [{ id: skillCallId, name: "call_skill", args: { skill_stable_name: "pdf-create", task: "生成一页中文产品说明 PDF" } }] },
            { type: "tool", tool_call_id: skillCallId, content: clarificationScript() },
            { id: `clarification-${threadId}:final`, type: "ai", content: clarificationReply(record) },
          ],
        },
      });
      return;
    }
    if (isConfirmIntent(record)) {
      const callId = `confirm-intent-${threadId}`;
      const originalArgs = {
        requestId: `confirm-intent-request-${threadId}`,
        understanding: "整理当前讨论并输出一份可供团队评审的执行建议",
        assumptions: ["以当前会话内容为唯一事实来源"],
      };
      const pending = { id: `${callId}:pending`, type: "ai", content: "请先确认我对任务的理解。", tool_calls: [{ id: callId, name: "confirm_task_intent", args: originalArgs }] };
      if (record.decision === null) {
        sendJson(res, 200, { values: { messages: [{ type: "human", content: record.userText }, pending] } });
        return;
      }
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? { ...originalArgs, ...record.decision.editedArgs }
        : originalArgs;
      sendJson(res, 200, { values: { messages: [
        { type: "human", content: record.userText },
        { ...pending, tool_calls: [{ id: callId, name: "confirm_task_intent", args: usedArgs }] },
        { type: "tool", tool_call_id: callId, content: `任务意图已确认：${JSON.stringify(usedArgs)}` },
        { id: `${callId}:final`, type: "ai", content: confirmIntentReply(record) },
      ] } });
      return;
    }
    if (isChooseOption(record)) {
      const callId = `choose-option-${threadId}`;
      const originalArgs = {
        requestId: `choose-option-request-${threadId}`,
        options: [
          { optionId: "fast", title: "快速生成初稿", effort: "低", timeToValue: "立即", expectedReturn: "先得到可评审版本" },
          { optionId: "thorough", title: "深入分析后生成", effort: "中", timeToValue: "稍后", expectedReturn: "得到依据更完整的版本" },
        ],
      };
      const pending = { id: `${callId}:pending`, type: "ai", content: "请选择更符合当前目标的执行方案。", tool_calls: [{ id: callId, name: "choose_execution_option", args: originalArgs }] };
      if (record.decision === null) {
        sendJson(res, 200, { values: { messages: [{ type: "human", content: record.userText }, pending] } });
        return;
      }
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? record.decision.editedArgs
        : originalArgs;
      sendJson(res, 200, { values: { messages: [
        { type: "human", content: record.userText },
        pending,
        { type: "tool", tool_call_id: callId, content: `执行方案已选择：${JSON.stringify(usedArgs)}` },
        { id: `${callId}:final`, type: "ai", content: chooseOptionReply(record) },
      ] } });
      return;
    }
    const toolResult = `已查询：当前时间 ${new Date().toISOString()}。用户原话："${record.userText}"`;
    // DA-19g 真根因修复：与 `/stream` 共用同一份"特殊分支"判断（`computeSpecialTurnReply`），
    // 未命中任何触发词时的默认模板原样保留——单一事实源，见该函数自己的头注。
    // issue #2020：与 `/stream` 同一份 `skillEcho` 拼接（单一事实源），开关未给全时恒 ""。
    const finalReply = computeSpecialTurnReply(threadId, record)
      ?? `${skillEcho(record)}根据查询结果回答你："${record.userText}" —— ${toolResult}`;
    sendJson(res, 200, {
      values: {
        messages: [
          { type: "human", content: record.userText },
          {
            type: "ai",
            content: "",
            tool_calls: [{ id: todosCallId, name: "write_todos", args: todosArgs }],
          },
          { type: "tool", tool_call_id: todosCallId, content: "todos updated" },
          {
            type: "ai",
            content: PLANNING_NOTE,
            tool_calls: [{ id: toolCallId, name: TOOL_NAME, args: { query: record.userText } }],
          },
          { type: "tool", tool_call_id: toolCallId, content: toolResult },
          { type: "ai", content: finalReply },
        ],
      },
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-deep-agent-provider] listening on 127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
