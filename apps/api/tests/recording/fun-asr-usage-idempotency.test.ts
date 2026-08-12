import { describe, expect, it } from "vitest";
import { InMemoryAsrUsageMeter } from "../../src/infrastructure/recording/in-memory-asr-usage-meter";

describe("Fun-ASR usage metering", () => {
  it("records one provider task once", async () => {
    const meter = new InMemoryAsrUsageMeter();
    const event = { providerTaskId: "task", orgId: "org" as never, ownerUserId: "user",
      captureId: "capture", model: "fun-asr-realtime", durationSeconds: 8 };
    expect(await meter.record(event)).toBe(true);
    expect(await meter.record(event)).toBe(false);
    expect(meter.events).toEqual([event]);
  });
});
