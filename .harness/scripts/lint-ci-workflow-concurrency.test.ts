import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const workflows = ["harness-verify", "backend-gates"];
type Context = { event_name: string; ref: string; run_id: number; run_attempt: number };

// These workflow expressions use only string equality, &&, ||, and format.
// Evaluate the checked-in expressions (not a duplicate policy implementation).
// This is deliberately not a general GitHub expression-language interpreter.
function evaluate(expression: string | boolean, github: Context): unknown {
  if (typeof expression === "boolean") return expression;
  const source = expression.trim();
  expect(source.startsWith("${{") && source.endsWith("}}")).toBe(true);
  const format = (template: string, ...values: unknown[]) =>
    template.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));
  return new Function("github", "format", `return (${source.slice(3, -2)});`)(github, format);
}

for (const name of workflows) {
  describe(`${name} admission boundaries`, () => {
    const workflow = parse(readFileSync(join(ROOT, `.github/workflows/${name}.yml`), "utf8"));
    const policy = workflow.concurrency;
    const context = (event_name: string, ref: string, run_id: number): Context => ({ event_name, ref, run_id, run_attempt: 1 });
    const group = (event: string, ref: string, run: number) => evaluate(policy.group, context(event, ref, run));

    it("same PR shares a group, different PRs cannot cancel each other", () => {
      expect(group("pull_request", "refs/pull/1/merge", 10)).toBe(group("pull_request", "refs/pull/1/merge", 11));
      expect(group("pull_request", "refs/pull/1/merge", 10)).not.toBe(group("pull_request", "refs/pull/2/merge", 12));
      expect(policy.group).not.toMatch(/head_ref|ref_name/);
    });

    it("only automatic main regression shares a group across commits", () => {
      const first = group("push", "refs/heads/main", 10);
      const next = group("push", "refs/heads/main", 11);
      if (name === "harness-verify") expect(first).toBe(next);
      else expect(first).not.toBe(next); // backend contains deployment: preserve each run
      expect(policy.queue ?? "single").toBe("single");
    });

    it.each([
      ["workflow_dispatch", "refs/heads/main"],
      ["workflow_dispatch", "refs/heads/qa/proof"],
      ["push", "refs/tags/v1.0.0"],
      ["push", "refs/heads/other"],
      ["schedule", "refs/heads/main"],
    ])("explicit or other event %s on %s keeps every run", (event, ref) => {
      expect(group(event, ref, 10)).not.toBe(group(event, ref, 11));
      expect(group(event, ref, 10)).not.toBe(group("push", "refs/heads/main", 12));
      expect(evaluate(policy["cancel-in-progress"], context(event, ref, 10))).toBe(false);
    });

    it("native rerun preserves explicit verification outside automatic main admission", () => {
      const rerun = { ...context("push", "refs/heads/main", 10), run_attempt: 2 };
      expect(evaluate(policy.group, rerun)).not.toBe(group("push", "refs/heads/main", 11));
      expect(evaluate(policy["cancel-in-progress"], rerun)).toBe(false);
    });

    it("new main candidate never interrupts the running regression", () => {
      expect(evaluate(policy["cancel-in-progress"], context("push", "refs/heads/main", 10))).toBe(false);
      expect(evaluate(policy["cancel-in-progress"], context("pull_request", "refs/pull/1/merge", 11))).toBe(true);
    });
  });
}
