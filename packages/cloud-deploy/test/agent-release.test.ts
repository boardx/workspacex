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
it("pins the actual CLI Python suffix and rejects unexpected bases or multi-stage drift", async () => {
  const { pinAgentDockerfile } = await import("../src/agent-release.js");
  const base = `langchain/langgraph-api@sha256:${"a".repeat(64)}`;
  expect(pinAgentDockerfile(`FROM ${base}:3.11\nRUN echo official`, base)).toBe(`FROM ${base}\nRUN echo official`);
  expect(pinAgentDockerfile(`FROM ${base}\n`, base)).toBe(`FROM ${base}\n`);
  expect(() => pinAgentDockerfile("FROM evil/image:latest\n", base)).toThrow("UNEXPECTED_AGENT_DOCKERFILE_BASE");
  expect(() => pinAgentDockerfile(`FROM ${base}\nFROM ${base}\n`, base)).toThrow("UNEXPECTED_AGENT_DOCKERFILE_BASE");
});
it("requires the generated dependency installation and consumes a hash lock", async () => {
  const { lockAgentDockerfile } = await import("../src/agent-release.js");
  const command = "uv pip install --system --no-cache-dir -c /api/constraints.txt -e .";
  const result = lockAgentDockerfile(`RUN ${command}`);
  expect(result).toContain("--require-hashes -r requirements.release.txt");
  expect(result).toContain("--no-deps -e .");
  expect(result).toContain("USER 1000:1000");
  expect(result).toContain("chmod 0444 /deps/*/requirements.release.txt");
  expect(() => lockAgentDockerfile("RUN arbitrary-installer")).toThrow("UNEXPECTED_AGENT_DEPENDENCY_INSTALL");
  expect(() => lockAgentDockerfile(`${command}\n${command}`)).toThrow("UNEXPECTED_AGENT_DEPENDENCY_INSTALL");
});
