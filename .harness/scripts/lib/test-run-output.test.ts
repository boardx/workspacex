import { describe, expect, it } from "vitest";
import { TestRunOutput } from "./test-run-output";

describe("test-run output truthfulness", () => {
  it("rejects a successful zero-selection summary split across ANSI chunks", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "\u001b[32m Test Fi");
    output.observe("stdout", "les \u001b[0m no tests\n Tests no tests\n");
    expect(output.classify(0).code).toBe(1);
    expect(output.classify(0).diagnostic).toContain("cwd");
  });
  it("preserves setup failures and distinguishes them from a successful empty run", () => {
    const output = new TestRunOutput();
    output.observe("stderr", "globalSetup: connection refused\nTest Files no tests\n");
    expect(output.classify(7)).toMatchObject({ code: 7 });
    expect(output.classify(7).diagnostic).toContain("globalSetup");
  });
  it("does not combine unrelated stdout and stderr fragments into a summary", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "Test Fi");
    output.observe("stderr", "les no tests");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
  });
  it("keeps genuinely executed positive tests green and ordinary failures red", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "Test Files 1 passed (1)\nTests 2 passed (2)\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
    expect(output.classify(3)).toEqual({ code: 3, diagnostic: null });
  });
  it("explicitly identifies a pre-test webServer failure", () => {
    const output = new TestRunOutput();
    output.observe("stderr", "Error: Process from config.webServer was not able to start. Exit code: 1\n");
    expect(output.classify(1).diagnostic).toContain("零测试执行");
  });
});
