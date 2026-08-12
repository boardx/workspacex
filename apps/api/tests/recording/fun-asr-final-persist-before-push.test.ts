import { describe, expect, it } from "vitest";
import { persistThenPublishFinal } from "../../src/application/recording/personal-realtime-asr";

describe("personal ASR final ordering", () => {
  it("publishes only after durable persistence returns", async () => {
    const order: string[] = [];
    await persistThenPublishFinal(async () => { order.push("persist"); return { segmentId: "s", ordinal: 1 }; },
      (stored) => { order.push(`publish:${stored.segmentId}`); });
    expect(order).toEqual(["persist", "publish:s"]);
  });
});
