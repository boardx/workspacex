export const CHAT_READ_E2E = {
  email: "chat-read-e2e@example.test",
  password: "Chat-read-E2E-only-405!",
  orgId: "org-chat-read-e2e",
  userId: "user-chat-read-e2e",
  projectId: "project-chat-read-e2e",
  threadId: "thread-chat-read-e2e",
  agentId: "agent-chat-read-e2e",
  /**
   * #467：**只在组织 agent 目录（`org_agents`）里、不在本线程编制里**的第二个 agent。
   *
   * 它存在的全部意义是让「把一个 agent 加进这个会话」构造得出来——`agentId` 那个
   * 一开始就在编制里，拿它做加入用例的话，一个什么都没做的实现也会绿。
   */
  catalogOnlyAgentId: "agent-chat-read-e2e-catalog-only",
  /**
   * #728 P6/P7 —— 确定性模型提供方的标识对（`agent_versions.model_provider`/`model_id`
   * 与 `KERNEL_MODEL_PROVIDER` 两头共用同一份字面量）。命名跟随
   * `fullstack-smoke-fixture.ts` 的 `agentModelProvider`/`agentModelId`/`agentReplyPrefix`
   * 同一套惯例，取自 chat-read 自己的隔离端口段，不与它撞名。
   *
   * ⚠ 两个字符串是任意值——`ConfiguredModelProvider` 只比对「run 快照里存的
   * model_provider」与「进程启动时 KERNEL_MODEL_PROVIDER」是否一致，不查真实
   * provider 注册表，所以这里不需要是 dashscope/openai 之类的真名字。
   */
  agentModelProvider: "chat-read-loopback",
  agentModelId: "loopback-echo",
  agentReplyPrefix: "[loopback]",
  /**
   * #728 P6/P7 —— 第二个 agent，专门走 `deep-agent` provider（真实的
   * `DeepAgentModelProvider` 代码路径，上游换成 `loopback-deep-agent-provider.ts`
   * 这个确定性替身，见那个脚本自己的头注）。取证要证明的是「计划句 + 工具调用步骤
   * 真的渲染出来」，这条 provider 的产品实现（`execute-run.ts` 的
   * `completeWithProgress` 分支、`extractToolCallEvents`）此前**从未被任何 e2e 走过**，
   * 只有单元测试覆盖过 HTTP 客户端本身——本条 agent 是这条路径第一次被端到端跑通。
   *
   * `deepAgentModelProvider` 必须逐字等于 `DEEP_AGENT_PROVIDER_NAME`
   * （`deep-agent-model-provider.ts` 导出的常量，值是 `"deep-agent"`）——它不是像
   * 上面 `agentModelProvider` 那样的任意字符串，`RoutingModelCallPort` 按这个值
   * 做**精确路由**（不是「碰巧配置成什么就是什么」，是这一个 provider 实现只服务
   * 这一个固定名字）。
   */
  deepAgentId: "agent-chat-read-e2e-deep",
  deepAgentDisplayName: "Deep Research Agent",
  deepAgentModelProvider: "deep-agent",
  deepAgentModelId: "deep-agent-loopback",
  /**
   * #728 P9 —— 失败态取证。用户消息逐字等于这个值时，`loopback-deep-agent-provider.ts`
   * 让 run 走到真实 `error` 终态，而不是本地伪造一个失败态组件。
   */
  deepAgentFailureTrigger: "取证：请让这次执行失败",
  /**
   * #728 P8 —— 麦克风实时转录取证。与 `fullstack-smoke-fixture.ts` 的
   * `asrTranscriptPrefix` 同一套惯例：确定性上游回一个带前缀的转录文本，
   * 断言方（这里是取证脚本自己，肉眼加截图）能确认转录确实来自这个进程，
   * 不是编造的。
   */
  asrTranscriptPrefix: "[loopback-asr]",
} as const;
