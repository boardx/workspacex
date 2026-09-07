import { describe, it, expect, vi } from "vitest";
import { maybeRunSkillScript } from "../../src/application/agent-run/run-skill-script";
import type { ObjectStore } from "../../src/application/artifact/ports";

describe("script cancellation boundaries", () => {
  for (const during of ["script", "regenerate"] as const) it(`does not start another script after cancel during ${during}`, async () => {
    let cancelled = false;
    const sandbox = { run: vi.fn(async () => {
      if (during === "script") cancelled = true;
      return { exitCode: 1, stdout: "", stderr: "actual failure", files: [], timedOut: false, durationMs: 1 };
    }) };
    const regenerate = vi.fn(async () => { cancelled = true; return "```js\nconsole.log('retry')\n```"; });
    const result = await maybeRunSkillScript({ sandbox, objects: {} as ObjectStore,
      regenerate, cancelAtCheckpoint: async () => cancelled, log: () => {} },
      { runId: "run", pinnedSkillCount: 1, reply: "```js\nconsole.log('first')\n```" });
    expect(result.kind).toBe("cancelled");
    expect(sandbox.run).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledTimes(during === "script" ? 0 : 1);
  });
});
