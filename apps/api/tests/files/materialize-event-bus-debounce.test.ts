/**
 * F40 -- uc-22-3 R4 A1 / R7 / V2: the conversation debounce half of the materialization
 * event bus. A 50-message conversation must materialize into ONE `messages.jsonl` version,
 * not fifty; `conversation.closed` must force an immediate final version regardless of any
 * open window; every non-conversation event kind must materialize on its own, undebounced.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { MaterializeEventBus } from "../../src/application/files/materialize-event-bus";
import { DEFAULT_CONVERSATION_DEBOUNCE_MS } from "../../src/domain/files/materialization-events";
import { FakeBacklogAlerter, FakeClock, FakeMaterializationQueue, SeqIds } from "../support/materialize-fakes";

const ORG = toOrgId("org-f40-debounce");

function makeBus(overrides?: { conversationDebounceMs?: number; backlogThreshold?: number }) {
  const queue = new FakeMaterializationQueue();
  const alerter = new FakeBacklogAlerter();
  const clock = new FakeClock();
  const ids = new SeqIds();
  const bus = new MaterializeEventBus({
    queue,
    alerter,
    clock,
    ids,
    conversationDebounceMs: overrides?.conversationDebounceMs,
    backlogThreshold: overrides?.backlogThreshold,
  });
  return { bus, queue, alerter, clock, ids };
}

describe("materialize event bus -- conversation debounce (uc-22-3 R4 A1, V2)", () => {
  it("coalesces a burst of conversation.message.appended into exactly ONE enqueued job, not one per message", async () => {
    const { bus, queue, clock } = makeBus({ conversationDebounceMs: 60_000 });

    for (let i = 0; i < 50; i += 1) {
      const result = await bus.handle({
        orgId: ORG,
        kind: "conversation.message.appended",
        sourceRef: "conv-1",
      });
      expect(result.enqueued).toBe(false);
    }
    expect(await queue.pendingCount(ORG)).toBe(0);
    expect(bus.openWindowCount).toBe(1);

    // Window has not elapsed yet -- nothing to flush.
    expect(await bus.flushDue()).toEqual([]);

    clock.advance(60_000);
    const flushed = await bus.flushDue();

    expect(flushed).toEqual(["conv-1"]);
    expect(await queue.pendingCount(ORG)).toBe(1);
    expect(bus.openWindowCount).toBe(0);
  });

  it("re-arms (extends), not stacks, the debounce window on each new message -- an append just before the deadline pushes the deadline out again", async () => {
    const { bus, queue, clock } = makeBus({ conversationDebounceMs: 100_000 });

    await bus.handle({ orgId: ORG, kind: "conversation.message.appended", sourceRef: "conv-2" });
    clock.advance(90_000); // 10s from the original deadline
    expect(await bus.flushDue()).toEqual([]); // not due yet

    await bus.handle({ orgId: ORG, kind: "conversation.message.appended", sourceRef: "conv-2" }); // re-arms
    clock.advance(90_000); // would have fired under the ORIGINAL deadline, but window was extended
    expect(await bus.flushDue()).toEqual([]);

    clock.advance(10_000); // now past the re-armed deadline
    expect(await bus.flushDue()).toEqual(["conv-2"]);
    expect(await queue.pendingCount(ORG)).toBe(1);
  });

  it("conversation.closed forces an immediate flush and cancels any open window for the same conversation (no double version)", async () => {
    const { bus, queue } = makeBus({ conversationDebounceMs: DEFAULT_CONVERSATION_DEBOUNCE_MS });

    await bus.handle({ orgId: ORG, kind: "conversation.message.appended", sourceRef: "conv-3" });
    expect(bus.openWindowCount).toBe(1);

    const result = await bus.handle({ orgId: ORG, kind: "conversation.closed", sourceRef: "conv-3" });

    expect(result.enqueued).toBe(true);
    expect(bus.openWindowCount).toBe(0); // the pending window was cancelled, not left to ALSO flush later
    expect(await queue.pendingCount(ORG)).toBe(1); // exactly one job, not two

    // Nothing left to flush from the cancelled window.
    expect(await bus.flushDue()).toEqual([]);
    expect(await queue.pendingCount(ORG)).toBe(1);
  });

  it("keeps independent debounce windows per sourceRef -- one conversation's burst does not flush another's", async () => {
    const { bus, clock, queue } = makeBus({ conversationDebounceMs: 60_000 });

    await bus.handle({ orgId: ORG, kind: "conversation.message.appended", sourceRef: "conv-a" });
    clock.advance(30_000);
    await bus.handle({ orgId: ORG, kind: "conversation.message.appended", sourceRef: "conv-b" });

    clock.advance(31_000); // conv-a's window (arms at t0, 60s) is due; conv-b's (arms at t30s) is not
    const flushed = await bus.flushDue();

    expect(flushed).toEqual(["conv-a"]);
    expect(bus.openWindowCount).toBe(1);
    expect(await queue.pendingCount(ORG)).toBe(1);
  });

  it.each([
    ["survey.response.submitted", "survey"],
    ["survey.closed", "survey"],
    ["interview.session.ended", "interview"],
    ["transcript.finalized", "interview"],
    ["workshop.recording.stopped", "workshop"],
    ["whiteboard.photo.uploaded", "workshop"],
    ["research.run.completed", "research"],
    ["canvas.saved", "canvas"],
    ["generation.completed", "generated"],
  ] as const)("%s materializes immediately, undebounced (R7: only conversation is high-frequency)", async (kind, expectedSourceType) => {
    const { bus, queue } = makeBus();

    const result = await bus.handle({ orgId: ORG, kind, sourceRef: `ref-${kind}` });

    expect(result.enqueued).toBe(true);
    expect(bus.openWindowCount).toBe(0);
    expect(await queue.pendingCount(ORG)).toBe(1);
    expect(queue.enqueuedLog.at(-1)?.sourceType).toBe(expectedSourceType);
  });

  it("carries agendaSegmentId through, never a design_facet_id / method_stage_id substitute (D-03a)", async () => {
    const { bus, queue } = makeBus();

    await bus.handle({
      orgId: ORG,
      kind: "canvas.saved",
      sourceRef: "canvas-1",
      agendaSegmentId: "seg-42",
    });

    const job = queue.enqueuedLog.at(-1)!;
    expect(job.agendaSegmentId).toBe("seg-42");
    expect(Object.keys(job)).not.toContain("design_facet_id");
    expect(Object.keys(job)).not.toContain("method_stage_id");
  });
});
