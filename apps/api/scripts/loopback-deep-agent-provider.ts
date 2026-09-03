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
 * `state` 从第一次读起就是「完整」的（计划句 + 一次工具调用 + 配对的工具结果 +
 * 最终回复），不做「过几轮才补全」的时序游戏——`completeWithProgress` 的轮询循环
 * 本来就会在 run 到终态后再补读一次，用不着靠人为延迟制造"中途态"，那样只会引入
 * e2e 里不必要的时序竞争。`status` 前一次答 `pending`、后一次答 `success`，只是为了
 * 让真实的轮询循环真的转一圈，不是首次调用就终态——这本身也是一种取证：证明轮询
 * 逻辑真的在工作，不是恰好一次到位。
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";

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
 * #742 Gap 1 取证旋钮——多步剧本默认（`STATUS_POLLS_BEFORE_DONE=2`）在第二次状态轮询
 * 就终态，`/state` 从第一次读起就是"完整"的（文件头注原话）：三次工具调用连同各自的
 * `ToolMessage` 结果同时出现，账本里 `in_progress` 行与终态行几乎在同一毫秒内落地，
 * 结构上**不给** `GET /agent-runs/:runId` 的轮询留一个能拍到 `in_progress` 徽标的窗口。
 * 这条旋钮只在多步触发词命中时把该 run 的终态推迟到至少这么多次状态轮询之后，`/state`
 * 按下面 `multistepStage()` 分阶段揭示——每个工具调用在被真正回答之前，先单独停留至少
 * 一轮，好让真实的 `in_progress` 记账行有机会被前端真的轮询到、真的渲染出来。
 * 不影响其它触发词/默认路径（读取时判空/判等）。
 */
const MULTISTEP_MIN_STATUS_POLLS = Number(process.env.LOOPBACK_DEEP_AGENT_MULTISTEP_MIN_POLLS ?? "6");
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
 * UX-9 D4 前端接入取证（gap 清单第 3 条）—— 对这句触发词，第一次到达状态阈值时回
 * `status: "interrupted"` 而不是 `"success"`：`DeepAgentModelProvider.completeWithProgress`
 * 见到 `"interrupted"` 会去读 state 找待批工具调用（`readPendingApproval`），run 落
 * `awaiting_approval` ——这是让真实 HITL 链路（DA-07b/DA-07c）在确定性替身下也能被
 * 端到端取证的唯一入口，不是在前端伪造一个「正等待批准」的卡片。
 *
 * resume 之后（`createRun` 收到 `command.resume`）本进程记下裁决（approve/edit/reject
 * 三态之一），下一次状态轮询直接答 `success`，`state` 端点据裁决类型拼出不同的工具
 * 结果与终稿正文——`edit` 时终稿里能看到编辑后的参数值，供截图肉眼核对「提交的确实
 * 是编辑后的值」而不是原样通过。
 */
const APPROVAL_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_APPROVAL_TRIGGER;
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
  return record.skillSentinelSeen ? `${SKILL_ECHO_PREFIX}${SKILL_SENTINEL} ` : "";
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
  readonly userText: string;
  statusPolls: number;
  /** UX-9 D4：approve/edit/reject 触发词回合的既有原始参数值（提交前），供
   *  state 端点在裁决前展示待批参数、裁决后对照展示「原值 vs 编辑后的值」。 */
  approvalArgs?: Record<string, unknown>;
  /** resume 请求（`command.resume`）到达后记下的裁决——null = 还没被裁决过。 */
  decision: ApprovalDecision | null;
  /** issue #2020 / #2534：这一轮的 `org_skills` 里真的出现了 skill 哨兵——
   *  见 `mountedSkillReachedUpstream`。开关未给全时恒 `false`。 */
  skillSentinelSeen?: boolean;
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

interface CreateRunBody {
  readonly input?: { readonly messages?: { readonly role?: string; readonly content?: unknown }[] };
  /** #2534：`deep-agent-model-provider.ts` 的 `toWireSkills` 形状——skill 全文只经这里到远端。 */
  readonly config?: { readonly configurable?: { readonly org_skills?: readonly { readonly content?: unknown }[] } };
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
      if (!runs.has(threadId)) runs.set(threadId, { userText: "", statusPolls: 0, decision: null });
      sendJson(res, 200, { thread_id: threadId });
    });
    return;
  }

  const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
  if (req.method === "POST" && runsMatch) {
    const threadId = runsMatch[1]!;
    void readBody(req).then((raw) => {
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
        sendJson(res, 200, { run_id: threadId });
        return;
      }
      const lastUser = [...(parsed.input?.messages ?? [])].reverse().find((m) => m.role === "user")?.content;
      const lastUserText = typeof lastUser === "string" ? lastUser : "";
      // DA-19g：追加进这条线程的历史记录，从不覆盖——见 `conversationLog` 自己的头注。
      if (lastUserText !== "") {
        const log = conversationLog.get(threadId) ?? [];
        log.push(lastUserText);
        conversationLog.set(threadId, log);
      }
      runs.set(threadId, {
        userText: lastUserText,
        statusPolls: 0,
        decision: null,
        // issue #2020：在**这一轮请求真实收到的字节**上判定，不缓存跨轮——挂载前的
        // 轮次 system 里没有哨兵、挂载后的轮次才有，前后对照正是 e2e 的判据。
        skillSentinelSeen: mountedSkillReachedUpstream(parsed),
      });
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
    // #742 Gap 1：多步剧本要求更多轮才终态——见 `MULTISTEP_MIN_STATUS_POLLS` 头注。
    const requiredPolls = MULTISTEP_TRIGGER !== undefined && record.userText === MULTISTEP_TRIGGER
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
    // ⚠ reject 在这里**永远不会**被观察到：`decide-agent-run.ts` 对 reject 直接
    // `failRun("HITL_REJECTED")`，从不向 provider 发 resume——服务端就是唯一权威，
    // 本替身没有、也不该有 reject 分支（写一个够不到的分支是「同一事实两处声明」）。
    // 第二次起终态——见头注。用户原话逐字等于失败触发词时终态是 error，不是 success。
    const status = FAILURE_TRIGGER !== undefined && record.userText === FAILURE_TRIGGER ? "error" : "success";
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
    // 多步剧本的流式正文要与 state 的终稿同一口径——否则截图里会出现
    // 「已查询当前时间」这句与多步剧本（从不查时间）自相矛盾的话。
    // DA-19g 真根因修复：`FOLLOWUP_CONTEXT_TRIGGER`/`MARKDOWN_TRIGGER` 两个特殊分支改走
    // `computeSpecialTurnReply`——与 `/state` 单一事实源，见该函数自己的头注（此前这里
    // 从未判过这两个触发词，永远落到下面这句通用模板，是 DA-19g 评分第 2 轮抓到的真
    // 根因）。未命中任何触发词时的默认模板原样保留，不改措辞。
    const reply = MULTISTEP_TRIGGER !== undefined && record.userText === MULTISTEP_TRIGGER
      ? "综合 3 份文档检索与 A.md 的内容，结论是：多步依赖链已完整执行——先搜索（命中 A.md/B.md/C.md），再读取搜索结果中最相关的 A.md，最后据其正文作答。"
      : computeSpecialTurnReply(threadId, record)
        // issue #2020：哨兵回显（开关未给全时 `skillEcho` 恒 ""，逐字节不变）——
        // 只拼在默认模板上：特殊剧本各有既有断言盯着措辞，不动它们。
        ?? `${skillEcho(record)}根据查询结果回答你："${record.userText}" —— 已查询当前时间，详情见工具结果。`;
    const pieces: string[] = [];
    for (let i = 0; i < reply.length; i += 8) pieces.push(reply.slice(i, i + 8));
    let idx = 0;
    const timer = setInterval(() => {
      if (idx >= pieces.length) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(`event: messages\ndata: [{"content": ${JSON.stringify(pieces[idx])}, "type": "AIMessageChunk"}, {}]\n\n`);
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
      const polls = record.statusPolls;
      const messages: unknown[] = [human, todosAnnounced];
      if (polls >= 2) messages.push(todosAnswered, searchAnnounced);
      if (polls >= 4) messages.push(searchAnswered, readAnnounced);
      if (polls >= 6) messages.push(readAnswered, finalReply);
      sendJson(res, 200, { values: { messages } });
      return;
    }
    // UX-9 D4 前端接入取证（gap 清单第 3 条）：审批触发词的剧本。原始参数（裁决前
    // `readPendingApproval` 读到、渲染进审批面板的那份）与裁决后落进 state 的工具结果
    // 是两件事——`editedArgs`（若有）必须能在终稿里被肉眼核对，不是「按了编辑就白按」。
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
      // 文案跟着工具语义走：现在待批的是 `call_skill`（执行一个技能），不是发邮件。
      const toolResultText = `已执行技能（${record.decision.type === "edit" ? "编辑后" : "原样"}参数）：`
        + JSON.stringify(usedArgs);
      const finalReplyText = record.decision.type === "edit"
        ? `已按你编辑后的参数执行：${JSON.stringify(usedArgs)}`
        : `已按原参数执行：${JSON.stringify(usedArgs)}`;
      sendJson(res, 200, {
        values: {
          messages: [
            { type: "human", content: record.userText },
            { ...pendingApprovalAi, tool_calls: [{ id: approvalCallId, name: APPROVAL_TOOL_NAME, args: usedArgs }] },
            { type: "tool", tool_call_id: approvalCallId, content: toolResultText },
            { type: "ai", content: finalReplyText },
          ],
        },
      });
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
