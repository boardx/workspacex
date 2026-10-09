import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AGENT_STABLE_NAME } from "../../../packages/contracts/src/agent-defaults";
import { defaultAgentE2eCandidates, defaultAgentE2eIdentity } from "./chat-default-agent-e2e-identity";

const shared = Object.freeze({ orgId: "org-fixture", userId: "user-fixture", projectId: "project-fixture",
  email: "fixture@example.test", agentId: "agent-fixture", deepAgentId: "agent-fixture-deep" });
test("默认解析反证使用独立组织、登录身份和目录；不修改共享夹具", () => {
  const original = { ...shared };
  const isolated = defaultAgentE2eIdentity(shared);
  for (const key of Object.keys(shared) as (keyof typeof shared)[]) assert.notEqual(isolated[key], shared[key]);
  assert.deepEqual(shared, original);
  assert.deepEqual(defaultAgentE2eIdentity(shared), isolated);
});
test("无通用助手的独立目录同时保留两个 provider 候选，避免单候选假通过", () => {
  const isolated = defaultAgentE2eIdentity(shared);
  const candidates = defaultAgentE2eCandidates(isolated, {
    provider: "chat-read-loopback", model: "contrast", deepProvider: "deep-agent", deepModel: "deep-contrast",
  });
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(([stableName]) => stableName !== DEFAULT_AGENT_STABLE_NAME));
  assert.equal(candidates[0][0], isolated.agentId);
  assert.equal(candidates[1][0], isolated.deepAgentId);
  assert.notEqual(candidates[0][1], candidates[1][1]);
  assert.equal(candidates[1][1], "deep-agent");
});
test("无效登录邮箱拒绝而非默默复用共享用户", () => {
  assert.throws(() => defaultAgentE2eIdentity({ ...shared, email: "invalid" }), /DEFAULT_AGENT_FIXTURE_EMAIL_INVALID/);
});
