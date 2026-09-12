import { expect, it } from "vitest";
import { validateAgentServerEnvironment } from "../src/agent-release.js";
it("requires self-hosted runtime backing services without a commercial license", () => {
  expect(() => validateAgentServerEnvironment({})).toThrow("DATABASE_URI, REDIS_URI");
  expect(validateAgentServerEnvironment({ DATABASE_URI: "postgresql://db/agent", REDIS_URI: "redis://redis/1" })).toEqual({ configured: true, runtime: "self-hosted" });
  expect(() => validateAgentServerEnvironment({ DATABASE_URI: "secret", REDIS_URI: "redis://redis" })).toThrow("AGENT_DATABASE_URI_INVALID");
});
