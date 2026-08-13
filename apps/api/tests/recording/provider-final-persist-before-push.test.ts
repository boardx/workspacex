import { describe, expect, it } from "vitest";
import { persistThenPublishFinal } from "../../src/application/recording/personal-realtime-asr";

describe("shared provider final ordering", () => {
  it("does not publish a final event until persistence has completed", async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const pending = persistThenPublishFinal(async () => {
      order.push("persist:start");
      await blocked;
      order.push("persist:done");
      return "stored";
    }, (stored) => order.push(`publish:${stored}`));

    await Promise.resolve();
    expect(order).toEqual(["persist:start"]);
    release();
    await pending;
    expect(order).toEqual(["persist:start", "persist:done", "publish:stored"]);
  });
});
