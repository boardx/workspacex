/**
 * F40 -- uc-22-3 R4 E5 / R9: the shared persistent queue's priority ordering and backlog
 * alerting.
 *
 * ⚠ "共用持久队列" is a claim about the queue a materialization job and a user's upload job
 * BOTH end up in. This test therefore exercises `MaterializationQueueRepository` directly
 * with both priorities present (`FakeMaterializationQueue.enqueueUpload` stands in for
 * whatever F35's upload path enqueues into the same table in production), not just the bus
 * in isolation -- the bus itself only ever enqueues `"materialization"`-priority jobs; the
 * cross-priority ordering is the queue's contract, and this is where it is proven.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { MaterializeEventBus } from "../../src/application/files/materialize-event-bus";
import { FakeBacklogAlerter, FakeClock, FakeMaterializationQueue, SeqIds } from "../support/materialize-fakes";

const ORG = toOrgId("org-f40-backpressure");

describe("shared persistent queue -- priority (uc-22-3 R9) and backpressure (R4 E5)", () => {
  it("an upload-priority job claims BEFORE materialization jobs already sitting in the queue (materialization priority is lower)", async () => {
    const queue = new FakeMaterializationQueue();
    const clock = new FakeClock();

    // Ten materialization jobs land first...
    for (let i = 0; i < 10; i += 1) {
      await queue.enqueue({
        id: `mat-${i}`,
        orgId: ORG,
        sourceType: "survey",
        sourceRef: `survey-${i}`,
        agendaSegmentId: null,
        priority: "materialization",
        enqueuedAt: clock.now(),
      });
      clock.advance(1_000);
    }
    // ...then a user's upload arrives LAST.
    await queue.enqueueUpload(ORG, "upload-1", clock.now());

    const claimed = await queue.claimNext(ORG);

    expect(claimed?.sourceRef).toBe("upload-1");
    expect(claimed?.priority).toBe("upload");
  });

  it("within the same priority, claims are FIFO by enqueue time", async () => {
    const queue = new FakeMaterializationQueue();
    const clock = new FakeClock();

    for (const ref of ["first", "second", "third"]) {
      await queue.enqueue({
        id: ref,
        orgId: ORG,
        sourceType: "conversation",
        sourceRef: ref,
        agendaSegmentId: null,
        priority: "materialization",
        enqueuedAt: clock.now(),
      });
      clock.advance(1_000);
    }

    expect((await queue.claimNext(ORG))?.sourceRef).toBe("first");
    expect((await queue.claimNext(ORG))?.sourceRef).toBe("second");
    expect((await queue.claimNext(ORG))?.sourceRef).toBe("third");
    expect(await queue.claimNext(ORG)).toBeNull();
  });

  it("crossing the backlog threshold raises a visible alert but keeps enqueuing every event -- nothing is dropped (E5)", async () => {
    const queue = new FakeMaterializationQueue();
    const alerter = new FakeBacklogAlerter();
    const clock = new FakeClock();
    const bus = new MaterializeEventBus({ queue, alerter, clock, ids: new SeqIds(), backlogThreshold: 5 });

    const TOTAL = 20;
    for (let i = 0; i < TOTAL; i += 1) {
      const result = await bus.handle({
        orgId: ORG,
        kind: "research.run.completed",
        sourceRef: `run-${i}`,
      });
      expect(result.enqueued).toBe(true); // every single one lands -- none silently skipped
    }

    expect(queue.enqueuedLog.length).toBe(TOTAL); // the "storm" produced exactly TOTAL jobs, not fewer
    expect(await queue.pendingCount(ORG)).toBe(TOTAL);

    // The alert fired at least once (once the 5th pending job made the 6th enqueue see a
    // backlog >= threshold), and every fired alert reports honest, growing counts -- never
    // silence about how deep the backlog actually is.
    expect(alerter.raised.length).toBeGreaterThan(0);
    for (const a of alerter.raised) {
      expect(a.orgId).toBe(ORG);
      expect(a.threshold).toBe(5);
      expect(a.pendingCount).toBeGreaterThanOrEqual(5);
    }
  });

  it("does NOT alert while the backlog is under threshold", async () => {
    const queue = new FakeMaterializationQueue();
    const alerter = new FakeBacklogAlerter();
    const clock = new FakeClock();
    const bus = new MaterializeEventBus({ queue, alerter, clock, ids: new SeqIds(), backlogThreshold: 100 });

    for (let i = 0; i < 10; i += 1) {
      await bus.handle({ orgId: ORG, kind: "canvas.saved", sourceRef: `canvas-${i}` });
    }

    expect(alerter.raised).toEqual([]);
    expect(queue.enqueuedLog.length).toBe(10);
  });

  it("a materialization storm never blocks a concurrently-arriving upload job from being enqueued or claimed first", async () => {
    const queue = new FakeMaterializationQueue();
    const alerter = new FakeBacklogAlerter();
    const clock = new FakeClock();
    const bus = new MaterializeEventBus({ queue, alerter, clock, ids: new SeqIds(), backlogThreshold: 3 });

    for (let i = 0; i < 15; i += 1) {
      await bus.handle({ orgId: ORG, kind: "generation.completed", sourceRef: `gen-${i}` });
    }
    await queue.enqueueUpload(ORG, "urgent-upload", clock.now());

    const claimed = await queue.claimNext(ORG);
    expect(claimed?.sourceRef).toBe("urgent-upload");
    // The other 15 are all still there -- not evicted to make room for the priority job.
    expect(await queue.pendingCount(ORG)).toBe(15);
  });
});
