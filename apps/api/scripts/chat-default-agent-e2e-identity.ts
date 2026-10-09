/** 独立租户隔离默认解析第②级，不改变主 chat-read 夹具的通用助手。 */
export function defaultAgentE2eIdentity(input: { orgId: string; userId: string; projectId: string; email: string; agentId: string; deepAgentId: string }) {
  const at = input.email.lastIndexOf("@");
  if (at <= 0) throw new Error("DEFAULT_AGENT_FIXTURE_EMAIL_INVALID");
  const suffix = "-default-resolution";
  return {
    orgId: input.orgId + suffix, userId: input.userId + suffix,
    projectId: input.projectId + suffix,
    email: input.email.slice(0, at) + "+default-resolution" + input.email.slice(at),
    agentId: input.agentId + suffix, deepAgentId: input.deepAgentId + suffix,
  };
}

export function defaultAgentE2eCandidates(identity: ReturnType<typeof defaultAgentE2eIdentity>, models: {
  provider: string; model: string; deepProvider: string; deepModel: string;
}) {
  return [
    [identity.agentId, models.provider, models.model, "Controlled default resolver loopback contrast."],
    [identity.deepAgentId, models.deepProvider, models.deepModel, "Controlled default resolver deep-agent fixture."],
  ] as const;
}
