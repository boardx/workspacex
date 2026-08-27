# contract · Skill 渐进式加载（progressive disclosure）——补齐 chat 执行路径与 Claude Code / Codex Agent Skills 标准的一处真实差距

> 规范唯一来源。签核口径见同目录 `design-signoff.md`，验收口径见 `verification.md`。
> 触发缘由：人类要求"吸取 Codex/Claude Code 的 skill 经验优化当前体验，端到端测试"。

## §0 调研结论（与 Claude Code / Codex Agent Skills 开放标准的差距）

实测/查阅官方文档确认（[Anthropic Agent Skills 工程博客](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)、[Codex Skills 文档](https://learn.chatgpt.com/docs/build-skills)）：两家的 Agent Skills 都是**三层渐进式披露**——① 所有已安装 skill 的 `name`+`description`（极短）常驻 system prompt；② 只有模型判定当前任务与某个 skill 相关时，才把该 skill 的 `SKILL.md` 全文读进上下文；③ skill 绑定的脚本/参考文件更晚才按需读取，且脚本**作为工具调用执行、只把结果读回上下文**，脚本源码本身从不进上下文。

**workspacex 当前实现**（`execute-run.ts` 的 `buildSystemPrompt`）：每一轮对话，**每个挂载的 skill 的 `SKILL.md` 全文无条件拼进 system prompt**，与这一轮消息是否用得上无关。这不是理论推测——`configured-model-provider.ts` 里已经有一段实测记录（2026-08-07 devapp）：**多 skill 挂载的 agent 已经真实触发过 60s 超时**，最终靠把超时上限从 60s 提到 180s"绕过"，没有解决系统提示词随挂载 skill 数线性膨胀这个根因。

## §1 范围：只动"纯 provider"这一条路径，不碰 deep-agent

`execute-run.ts` 现在只有**一条**执行形状（#741 已把并存的 TS 工具调用循环 `executeToolLoop` 整个下线，理由是"避免两套通用助手执行路径并存"）。但 `run.modelProvider` 仍然分两种运行时行为：

- **`DEEP_AGENT_PROVIDER_NAME`（"通用助手"，远端 `deepagents` 编排图）**：`deep-agent-model-provider.ts` 头注明确记录——`input.system`（含全文）与结构化 `org_skills`（同样含全文）**同时**发给远端，是**故意的**设计（"the model gets the content as context immediately AND a real way to invoke it for a focused execution"），远端图自己的 `system_prompt` 会引导模型优先用 `call_skill` 工具而不是凭记忆的正文回答。**这条路径已经有自己的"按需执行"机制（真实工具调用），本 delta 不碰，`toWireSkills`/`deep-agent-model-provider.ts` 一行不改。**
- **`ConfiguredModelProvider`（其余自定义 agent，纯 OpenAI 兼容 `/chat/completions`，无编排图）**：**这条才是本 delta 要修的**——它没有任何工具调用机制（#741 已下线），skill 内容能不能被"按需"用上，完全取决于 system prompt 里写了什么。这也正是上面 60s 超时那条实测命中的路径。

判据：`run.modelProvider !== DEEP_AGENT_PROVIDER_NAME`。

## §2 设计：目录 + 按需请求，不是重新引入 #741 的工具调用

⚠ **这里必须正面回应一个显而易见的疑问**：#741 刚把"模型请求执行某个 skill → TS 侧再调一次模型"这类循环整个下线过，本 delta 现在又要加一个"模型请求 skill 全文 → 再调一次模型"的循环，是不是在重新造 #741 删掉的轮子？

**不是，理由是两者的形状本质不同，不是措辞不同**：

- #741 删的是**通用工具调用**——`ToolDefinition`/`ToolCallRequest`/`ToolExchangeTurn`，OpenAI wire 协议的 `tools[]`/`tool_calls` 字段，模型可以调用**任意数量、任意语义**的工具，是一整套编排能力，与 `DeepAgentModelProvider` 的职责重叠。
- 本 delta 加的是**一个硬编码、单一用途的文本标记**，与已经存活、已经过 #1624/#1747/#660 反复验证的 `run_script` 标记（`SCRIPT_FENCE_RE`/`tryExtractScript`，`run-script-with-retries.ts`）**同一种形状**：模型在回复里写一个固定格式的围栏块，`execute-run.ts` 用正则抠出来，不经过任何 wire 协议层，不是"工具"，是"文本约定"。`run_script` 没有因为 #741 被下线，因为它从来不是那套工具调用机制的一部分；本 delta 的 `read_skill` 标记与它是同一类东西，不是被下线又复活的那类东西。

### §2.1 目录（Layer 1）

`buildSystemPrompt` 对非 deep-agent 的 run，把每个挂载 skill 的全文替换成一行目录条目：

```
- <stable_name>：<从 SKILL.md 正文自动摘取的首段，截断到 200 字符>
```

首段摘取规则：取 `SKILL.md` 里第一个 H1 标题（`# ...`）之后、第一个空行分隔出的段落，去除 Markdown 标记。**不新增 `description` 字段、不改 `skills`/`skill_versions` 表结构**——摘取逻辑是纯函数，输入已经是 `readPinnedSkills` 已经在读的 `content` 字符串，零额外查询。三份新 skill（docx/xlsx/pdf-create，F979）的 `SKILL.md` 已经是"H1 + 摘要段落"的形状，摘取结果可读；旧 skill（pptx-create 等）若首段不够精炼，效果打折但不报错——摘取失败（找不到 H1/首段）时退化成"取全文前 200 字符"，不是空字符串，不是抛错。

### §2.2 按需请求（Layer 2）

system prompt 附加协议说明（与 `RUN_SCRIPT_PROTOCOL_PROMPT` 同一种拼接方式，追加在目录之后）：

```
Skills you have are listed above by name and a one-line summary only — you have NOT
been shown their full instructions yet. Before using a skill, request its full
instructions with exactly this fenced block:

```read_skill
<stable_name>
```

You will receive its full instructions in the next turn. Only request skills you
actually need for this task.
```

`execute-run.ts` 解析回复里的 `read_skill` 围栏块（`READ_SKILL_FENCE_RE`，与 `SCRIPT_FENCE_RE` 同一形状），若命中且请求的 `stable_name` 在这次 run 挂载的 skill 集合内：把该 skill 的**全文**追加进 system prompt（目录条目本身保留，不删除，模型仍能看到"还有哪些没读"），再调一次 `complete()`。**每次 round 只处理模型这次回复里的第一个 `read_skill` 请求**（与 `run_script` 一次只认一个块同一条纪律），要读多个 skill 需要多轮，由下面的轮数上限兜底。

### §2.3 轮数上限：独立于 `MAX_SCRIPT_ATTEMPTS`

`MAX_READ_SKILL_ROUNDS = 3`（挂载 skill 上限本身没有硬性约束，但三次读取轮数覆盖"一次问题涉及 2-3 个 skill"这个现实场景；超过后**不报错**，直接把当前已经拿到的目录+已展开内容原样送进最后一次 `complete()`，让模型基于已有信息作答——降级行为，不是失败）。这是一个**独立的、新的计数器**，不与 `run_script` 的 `MAX_SCRIPT_ATTEMPTS`（=3，覆盖脚本失败重试）共用或叠加——两件事发生在流程的不同阶段（先决定读哪些 skill，再决定脚本对不对），混在一起数会让"这次到底是内容请求耗尽还是脚本重试耗尽"无法从计数上区分。

### §2.4 未挂任何 skill / 只挂 1 个 skill 时的行为

- 未挂 skill：目录为空，不追加"Skills you have..."协议段——与今天**逐字节相同**（T2 纪律，`run-skill-script.ts` 已有的同一条原则在这里延续）。
- 只挂 1 个 skill：目录仍然只给摘要，仍然需要一次 `read_skill` 才能拿到全文——**不做"只有一个就干脆直接给全文"这种特例**。理由：特例会让"要不要展开"这件事有两条不同规则，且极大多数场景不会只挂 1 个（默认 agent 常见挂 2-3 个来源不同的能力），为一个不常见的子场景引入分支不值得，两回合的开销（一次目录、一次全文）本身就很小。

## §3 明确不做（防止范围蔓延）

- 不碰 `DeepAgentModelProvider`/`toWireSkills`/远端 `deepagents` 图——§1 已说明这条路径有自己的机制，且是签核过的设计。
- 不碰 `execute-trial-run.ts`（skill 试跑）/`trial-run-agent.ts`（agent 试跑）/`quick-digital-interview.ts`——这些是"验证单个 skill/agent 能不能用"的一次性检查流程，用户预期就是看到完整行为，渐进式披露对这类场景没有意义，反而会让试跑多一轮不必要的往返。
- 不新增 `description` 字段、不改数据库 schema——见 §2.1。
- 不引入真实的 OpenAI `tools[]`/`tool_calls` wire 协议——见 §2 对 #741 的正面回应。
- 不改变 `run_script` 协议本身的任何行为——两个标记（`read_skill`/`run_script`）各自独立解析、独立计数，互不影响。

## §4 预期效果（供 §0 的问题对照）

- 未挂 skill 或本轮用不上任何 skill：system prompt 只多几行目录（几十到一两百 token），不再是每个挂载 skill 几百到上千 token的全文——直接针对 60s 超时那条实测记录的根因。
- 用得上 skill 时：多一次模型往返（目录判断相关 → 请求全文 → 拿到全文继续），换来的是"不相关的挂载 skill 不再占用上下文"，这正是 Claude Code/Codex 三层披露要解决的同一个问题。
