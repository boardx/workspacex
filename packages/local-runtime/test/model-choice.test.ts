import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_MODEL, UPGRADED_CHAT_MODEL, preferredChatModel } from "../src/config";

describe("preferredChatModel (#3749 B2.3)", () => {
  it("upgrades only when the default is configured, RAM ≥ 16 GB and the 9B is already present", () => {
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 16, present: [UPGRADED_CHAT_MODEL, DEFAULT_CHAT_MODEL] })).toBe(UPGRADED_CHAT_MODEL);
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 8, present: [UPGRADED_CHAT_MODEL] })).toBe(DEFAULT_CHAT_MODEL);
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 32, present: [DEFAULT_CHAT_MODEL] })).toBe(DEFAULT_CHAT_MODEL);
    expect(preferredChatModel({ configured: "qwen3.5:2b", memoryGb: 32, present: [UPGRADED_CHAT_MODEL] })).toBe("qwen3.5:2b");
  });
});
