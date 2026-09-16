/**
 * The production ASR provider (`ConfiguredRealtimeAsrProvider`, DashScope realtime wire
 * protocol) talking to the local gateway (`@repo/local-asr-gateway`) with a fake engine:
 * proves the desktop build needs NO change on the API side -- only `KERNEL_ASR_*` env.
 * Unit lane (`vitest.local-desktop-unit.config.ts`): no DB, no Redis, no model.
 */
import { FakeEngine, startGateway, type GatewayHandle } from "@repo/local-asr-gateway";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfiguredRealtimeAsrProvider } from "../../src/infrastructure/recording/configured-realtime-asr-provider";
import type { AsrTranscript } from "../../src/application/recording/asr-ports";

let gateway: GatewayHandle;
beforeAll(async () => {
  gateway = await startGateway({ engine: new FakeEngine({ endpointAfterSamples: 3200 }), port: 0, tickMs: 20 });
});
afterAll(async () => { await gateway.close(); });

function frame(samples: number): Uint8Array {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) buf.writeInt16LE(Math.round(Math.sin(i / 7) * 6000), i * 2);
  return new Uint8Array(buf);
}

function provider(): ConfiguredRealtimeAsrProvider {
  return new ConfiguredRealtimeAsrProvider({
    provider: "local-gateway", baseUrl: gateway.url, apiKey: "local", model: "fake-zipformer", turnDetectionSilenceMs: 800,
  });
}

describe("ConfiguredRealtimeAsrProvider ↔ local ASR gateway", () => {
  it("server_vad: partials, endpoint final, then finish() resolves on the flushed final", async () => {
    const partials: AsrTranscript[] = [];
    const finals: AsrTranscript[] = [];
    const errors: string[] = [];
    let closed = false;
    const session = await provider().open(
      { onPartial: (t) => partials.push(t), onFinal: (t) => finals.push(t), onError: (r, d) => errors.push(`${r}: ${d}`), onClosed: () => { closed = true; } },
      { sampleRate: 16_000, channels: 1, encoding: "pcm16le" },
    );
    session.pushAudio(frame(1600));
    await new Promise((r) => setTimeout(r, 120));
    expect(partials.length).toBeGreaterThan(0);
    expect(partials[0]!.text).toBe("heard 1600 @16000"); // text + stash concatenated, as with DashScope
    session.pushAudio(frame(1600)); // crosses the fake endpoint → final
    await new Promise((r) => setTimeout(r, 120));
    expect(finals.map((f) => f.text)).toEqual(["final 3200 of 3200"]);
    expect(finals[0]!.itemId).toMatch(/^item_/);
    session.pushAudio(frame(400));
    await session.finish();
    expect(finals.map((f) => f.text)).toEqual(["final 3200 of 3200", "final 400 of 3600"]);
    session.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toEqual([]);
    expect(closed).toBe(true);
  });

  it("manual turn detection: commit() cuts segments, finish() completes via session.finished", async () => {
    const finals: string[] = [];
    const errors: string[] = [];
    const session = await provider().open(
      { onPartial: () => undefined, onFinal: (t) => finals.push(t.text), onError: (r, d) => errors.push(`${r}: ${d}`), onClosed: () => undefined },
      { sampleRate: 16_000, channels: 1, encoding: "pcm16le" },
      { turnDetection: "manual" },
    );
    session.pushAudio(frame(5000)); // beyond the fake endpoint, but manual mode must NOT auto-cut
    await new Promise((r) => setTimeout(r, 100));
    expect(finals).toEqual([]);
    session.commit();
    await new Promise((r) => setTimeout(r, 100));
    expect(finals).toEqual(["final 5000 of 5000"]);
    session.pushAudio(frame(300));
    await session.finish();
    expect(finals).toEqual(["final 5000 of 5000", "final 300 of 5300"]);
    expect(errors).toEqual([]);
  });
});
