import { expect, it } from "vitest";
import { agentReleaseConfig, validateAgentServerEnvironment } from "../src/agent-release.js";
it("preserves source routing without baking developer env or mutable base image", () => {
  const source = { dependencies: ["."], graphs: { Deep: "./graph.py:graph" }, http: { app: "service:app" }, env: ".env" };
  const result = agentReleaseConfig(source, `langchain/langgraph-server@sha256:${"a".repeat(64)}`, "b".repeat(40));
  expect(result.graphs).toEqual(source.graphs);
  expect(result).not.toHaveProperty("env");
  expect(() => agentReleaseConfig(source, "langchain/langgraph-server:latest", "b".repeat(40))).toThrow("DIGEST_REQUIRED");
});
it("requires production server backing services and license without exposing values", () => {
  expect(() => validateAgentServerEnvironment({})).toThrow("LANGGRAPH_CLOUD_LICENSE_KEY");
  expect(validateAgentServerEnvironment({ DATABASE_URI: "postgresql://db/agent", REDIS_URI: "redis://redis/1", LANGGRAPH_CLOUD_LICENSE_KEY: "private" })).toEqual({ configured: true, licenseVerified: false });
  expect(() => validateAgentServerEnvironment({ DATABASE_URI: "secret", REDIS_URI: "redis://redis", LANGGRAPH_CLOUD_LICENSE_KEY: "private" })).toThrow("AGENT_DATABASE_URI_INVALID");
});
