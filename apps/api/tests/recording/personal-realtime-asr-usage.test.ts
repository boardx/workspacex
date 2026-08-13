import { describe, expect, it } from "vitest";
import { pcm16MonoDurationSeconds, providerSessionUsageId } from "../../src/interface/ws/personal-realtime-asr.gateway";

describe("personal realtime ASR PCM usage", () => {
  it("meters mono 16 kHz PCM16 at exactly 32000 bytes per second", () => {
    expect(pcm16MonoDurationSeconds(0)).toBe(0);
    expect(pcm16MonoDurationSeconds(32_000)).toBe(1);
    expect(pcm16MonoDurationSeconds(48_000)).toBe(1.5);
  });

  it("uses an internal capture/provider-session idempotency key", () => {
    expect(providerSessionUsageId("capture-1", "provider-session-1"))
      .toBe("personal:capture-1:provider-session-1");
  });
});
