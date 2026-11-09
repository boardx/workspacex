import { expect, it } from "vitest";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";

it("publishes every official role against the requested Qwen 3.8 model", () => {
  const pack = buildOfficialAgentRolePack();
  expect(pack.agents.length).toBeGreaterThan(0);
  for (const role of pack.agents) expect(role.modelId).toBe("qwen3.8-max");
});
