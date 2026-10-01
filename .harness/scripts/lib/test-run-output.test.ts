import { describe, expect, it } from "vitest";
import { TestRunOutput } from "./test-run-output";

describe("test-run output truthfulness", () => {
  it("keeps ANSI and colon-script task identities at every chunk boundary", () => {
    const transcript = "\u001b[32m@repo/web:test:unit: \u001b[0m RUN v2.1.9 /tmp/web\n"
      + "@repo/web:test:unit: No test files found in logged example\n"
      + "@repo/web:test:unit: Test Files 1 passed (1)\n"
      + "@repo/web:test:unit: Tests 1 passed (1)";
    for (let cut = 0; cut <= transcript.length; cut++) {
      const output = new TestRunOutput();
      output.observe("stdout", transcript.slice(0, cut));
      output.observe("stdout", transcript.slice(cut));
      expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
      output.observe("stderr", "api:test: Test Files no tests");
      expect(output.classify(0).code).toBe(1);
    }
    const output = new TestRunOutput();
    for (const char of transcript) output.observe("stdout", char);
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
  });

  it("does not commit a diagnostic from an unfinished line when previewed", () => {
    const output = new TestRunOutput();
    output.observe("stdout", " RUN v2.1.9 /tmp/web\nNo test files found");
    expect(output.classify(0).code).toBe(1);
    output.observe("stdout", "ation report\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
  });

  it("retains task identity through oversized lines and recognizes later summaries", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "web:test: " + "x".repeat(8192));
    output.observe("stdout", "Test Files no tests\nweb:test: Tests 1 passed (1)\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
    output.observe("stderr", "api:test: Test Files no tests\n");
    expect(output.classify(0).code).toBe(1);
  });

  it("classifies the exact retained-tail counterexample identically across chunk boundaries", () => {
    const prefix = "web:test: ";
    const phrase = "Test Files no tests\n";
    const chunks = [
      prefix + " RUN v2.1.9 /tmp/web\n",
      prefix + phrase + prefix + "x".repeat(4096 - phrase.length - prefix.length),
      "\nweb:test: Test Files 1 passed (1)\nweb:test: Tests 1 passed (1)\n",
    ];
    const whole = new TestRunOutput();
    whole.observe("stdout", chunks.join(""));
    const split = new TestRunOutput();
    for (const chunk of chunks) split.observe("stdout", chunk);
    expect(whole.classify(0)).toEqual({ code: 0, diagnostic: null });
    expect(split.classify(0)).toEqual(whole.classify(0));
  });
  it("rejects a real Turbo-prefixed empty runner even when another task passed", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "empty-selection:test:  RUN  v2.1.9 /tmp/test\nempty-selection:test: No test files found, exiting with code 0\n");
    output.observe("stdout", "web:test:  RUN  v2.1.9 /tmp/web\nweb:test: Test Files 1 passed (1)\nweb:test: Tests 1 passed (1)\n");
    expect(output.classify(0)).toEqual({ code: 1, diagnostic: expect.stringContaining("零测试执行") });
  });
  it("keeps task-local positive summaries authoritative over their own empty-phrase logs", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "web:test:  RUN  v2.1.9 /tmp/web\nweb:test: No test files found\nweb:test: Test Files no tests\nweb:test: Test Files 1 passed (1)\nweb:test: Tests 1 passed (1)\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
  });
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
  it("ignores embedded phrases and gives executed summaries precedence across streams", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "application says No test files found\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
    output.observe("stderr", "No test files found\nTest Files no tests\n");
    output.observe("stdout", " Tests 1 passed (1)\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
    expect(output.classify(9).code).toBe(9);
  });

  it("explicitly identifies a pre-test webServer failure", () => {
    const output = new TestRunOutput();
    output.observe("stderr", "Error: Process from config.webServer was not able to start. Exit code: 1\n");
    expect(output.classify(1).diagnostic).toContain("零测试执行");
  });
  it("uses the final selected summary rather than a test's logged empty-run message", () => {
    const output = new TestRunOutput();
    output.observe("stdout", " RUN v2.1.9\nstdout | selected test\nNo test files found\n");
    output.observe("stdout", "Test Files 1 passed (1)\nTests 1 passed (1)\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
  });
  it("does not classify arbitrary non-Vitest command prose as empty selection", () => {
    const output = new TestRunOutput();
    output.observe("stdout", "No test files found in the archived report\n");
    expect(output.classify(0)).toEqual({ code: 0, diagnostic: null });
  });
});
