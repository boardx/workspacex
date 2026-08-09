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
} as const;
