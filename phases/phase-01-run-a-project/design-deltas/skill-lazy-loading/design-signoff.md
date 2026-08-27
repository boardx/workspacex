---
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: skill-lazy-loading
base_bundle: skills   # 与 skill-model-a-b-convergence/skill-office-docs-node-runtime 同一挂靠
  # 理由：改的是"skill 内容怎么送进模型"这件事本身，不是新开一个契约束。
scope: progressive-disclosure-for-non-deep-agent-chat-runs-catalog-plus-on-demand-full-content
covers: []   # 待人类/harness 回填 F 号（同 F979 先例）
confirmed_by: usamshen
confirmed_at: 2026-08-27T08:46:59+00:00
confirmed_via: "手工——chat 里对签核清单①②③④逐条打包确认后回复「i confirm」"
---

# design delta 签核 · Skill 渐进式加载（吸取 Claude Code / Codex Agent Skills 三层披露经验）

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类要求"吸取 Codex/Claude Code 的 skill 经验优化当前体验，端到端测试结果质量"。
调研 Anthropic/Codex 官方 Agent Skills 标准后确认一处真实、可验证的差距：两家都用
三层渐进式披露（先给 name+description，模型判断相关才展开全文），workspacex 当前
是"挂了就无条件全文塞进每一轮 system prompt"——`configured-model-provider.ts` 里
已经有一段 2026-08-07 的真实生产超时记录印证这个根因（详见 `contract.md` §0）。

**这是一份等待人类正式签核的提案**，不是已批准的设计——下面每一条打勾都需要你
显式确认；在 `status: confirmed` 之前，不会有任何代码改动（`execute-run.ts` 一行
不改）。

## 签核前请重点确认

- [ ] **① 范围边界**：只改 `run.modelProvider !== DEEP_AGENT_PROVIDER_NAME` 这一条
      路径（自定义 agent、纯 OpenAI 兼容 provider）。**不碰**"通用助手"走的
      `DeepAgentModelProvider`/远端 `deepagents` 编排图——那条路径已经有自己的
      真实工具调用机制（`call_skill`），且现在"system 全文 + 结构化 org_skills
      同时发"是文档记录过的故意设计，不是本 delta 要修的缺陷（`contract.md` §1）。
      也不碰试跑类流程（skill 试跑/agent 试跑/快速访谈）——那些场景用户预期看到
      完整行为，渐进式披露没有意义。

- [ ] **② 机制本身：新增一个 `read_skill` 文本标记，不是重新引入 #741 下线的工具
      调用**。#741 删的是通用 OpenAI `tools[]`/`tool_calls` wire 协议（模型能调用
      任意工具的编排能力，与 deep-agent 职责重叠）；本 delta 加的是一个硬编码、
      单一用途的围栏文本块，与存活至今、经过 #1624/#1747/#660 验证的 `run_script`
      标记同一种形状——正则解析纯文本，不经过任何 wire 协议层。`contract.md` §2
      有完整的正面论证，请重点确认这条区分站得住。

- [ ] **③ 换来的代价是什么**：用得上 skill 的那些请求会多至少一次模型往返（目录→
      判断相关→请求全文→拿到全文→继续），意味着**更高延迟、更高调用次数计费**。
      换来的是"不相关的挂载 skill 不再占满 system prompt、不再有超时风险"。这是
      一个权衡，不是纯收益——如果你认为当前 60s→180s 的超时上限提升已经够用、
      这个延迟代价不值得付，应该直接否决本 delta，而不是签了之后再来回退。

- [ ] **④ 目录摘要不新增字段**：从已经在读的 `SKILL.md` 正文里自动摘取首段作为
      目录里的一行描述（`contract.md` §2.1），不新增 `description` 数据库字段、
      不改 `skills`/`skill_versions` 表结构。如果你希望未来 skill 作者能显式填写
      一条独立于正文的 description（更贴近 Claude Code 官方标准的字段设计），
      那是另一条需要 schema 迁移的 delta，本次不做。

## 与既有已签内容的关系

- **不改** `skill-office-docs-node-runtime`（covers F979）/`skill-sandbox-execution`
  （covers F962）已签的沙箱执行、隔离边界、失败码、重试循环——三个 skill 的正文
  内容与执行方式一个字不变，只改"什么时候把正文送进 system prompt"。
- **不改** `skill-model-a-b-convergence` 已签的模型 A（`skills.ts` 声明式契约）
  单一权威结论——目录摘要只从既有 `content` 字段派生，不新增第二个内容来源。
- **不动** `DeepAgentModelProvider`/`deep-agent-model-provider.ts` 任何一行——见①。
