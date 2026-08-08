/**
 * `trimHistoryToBudget` (#709 multi-turn context) -- the pure character-budget trimming
 * function `execute-run.ts` applies to `AgentRunStore.readThreadHistory`'s result before
 * splicing it into a `ModelCallInput`. No database, no HTTP: this is application logic with
 * no external dependency, so a pure unit test is the honest level to prove it at (same
 * discipline `execute-run-streaming.test.ts`'s own file header states for this file's
 * neighbour).
 */
import { describe, expect, it } from "vitest";
import { trimHistoryToBudget } from "../../src/application/agent-run/execute-run";
import type { ThreadHistoryMessage } from "../../src/application/agent-run/ports";

const msg = (role: ThreadHistoryMessage["role"], content: string): ThreadHistoryMessage =>
  ({ role, content });

describe("trimHistoryToBudget", () => {
  it("keeps everything, in order, when the whole history fits the budget", () => {
    const history = [msg("user", "hi"), msg("assistant", "hello"), msg("user", "how are you")];
    expect(trimHistoryToBudget(history, 1000)).toEqual(history);
  });

  it("returns [] for an empty history regardless of budget", () => {
    expect(trimHistoryToBudget([], 1000)).toEqual([]);
  });

  it("drops the OLDEST messages first, keeping the most recent ones that fit", () => {
    const history = [
      msg("user", "a".repeat(5)),       // oldest
      msg("assistant", "b".repeat(5)),
      msg("user", "c".repeat(5)),        // newest
    ];
    // Budget for exactly the newest two (5 + 5 = 10).
    const trimmed = trimHistoryToBudget(history, 10);
    expect(trimmed).toEqual([msg("assistant", "b".repeat(5)), msg("user", "c".repeat(5))]);
  });

  it("stays chronologically ordered after trimming -- oldest of the KEPT suffix first", () => {
    const history = [msg("user", "1"), msg("assistant", "2"), msg("user", "3"), msg("assistant", "4")];
    const trimmed = trimHistoryToBudget(history, 2);
    expect(trimmed.map((m) => m.content)).toEqual(["3", "4"]);
  });

  it("keeps a single message whole even when it alone exceeds the budget", () => {
    const history = [msg("user", "x".repeat(50))];
    const trimmed = trimHistoryToBudget(history, 10);
    expect(trimmed).toEqual(history);
  });

  it("a lone over-budget newest message is kept, but nothing older is added alongside it", () => {
    const history = [msg("user", "older, would fit alone"), msg("assistant", "y".repeat(50))];
    const trimmed = trimHistoryToBudget(history, 10);
    expect(trimmed).toEqual([msg("assistant", "y".repeat(50))]);
  });

  it("maxChars <= 0 drops all history rather than keeping one oversized message", () => {
    expect(trimHistoryToBudget([msg("user", "hi")], 0)).toEqual([]);
    expect(trimHistoryToBudget([msg("user", "hi")], -5)).toEqual([]);
  });
});
