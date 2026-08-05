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
} as const;
