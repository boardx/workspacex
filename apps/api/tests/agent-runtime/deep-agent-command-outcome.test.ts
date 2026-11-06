import { expect, it } from "vitest";
import { deepAgentToolResultSucceeded } from "../../src/infrastructure/agent-run/deep-agent-command-outcome";
it.each([1, 7, 127, null, undefined, "0"])("execute transport success is not command success for exit %s", (exit_code) => {
  expect(deepAgentToolResultSucceeded("execute", { status: "success", artifact: { exit_code } })).toBe(false);
});
it("requires a confirmed zero exit and keeps outer errors authoritative", () => {
  expect(deepAgentToolResultSucceeded("execute", { status: "success", artifact: { exit_code: 0 } })).toBe(true);
  expect(deepAgentToolResultSucceeded("execute", { status: "error", artifact: { exit_code: 0 } })).toBe(false);
  expect(deepAgentToolResultSucceeded("execute", { status: "success" })).toBe(false);
  expect(deepAgentToolResultSucceeded("call_skill", { status: "success", artifact: { exit_code: 127 } })).toBe(true);
});
