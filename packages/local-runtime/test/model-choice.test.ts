import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_MODEL, DEFAULT_META_MODEL, UPGRADED_CHAT_MODEL, preferredChatModel, preferredMetaModel } from "../src/config";

describe("preferredChatModel (#3749 B2.3)", () => {
  it("upgrades only when the default is configured, RAM ≥ 16 GB and the 9B is already present", () => {
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 16, present: [UPGRADED_CHAT_MODEL, DEFAULT_CHAT_MODEL] })).toBe(UPGRADED_CHAT_MODEL);
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 8, present: [UPGRADED_CHAT_MODEL] })).toBe(DEFAULT_CHAT_MODEL);
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 32, present: [DEFAULT_CHAT_MODEL] })).toBe(DEFAULT_CHAT_MODEL);
    expect(preferredChatModel({ configured: "qwen3.5:2b", memoryGb: 32, present: [UPGRADED_CHAT_MODEL] })).toBe("qwen3.5:2b");
  });
});

describe("preferredMetaModel (#3749 B2.2)", () => {
  it("uses the 2B only with ≥24 GB and the model present; otherwise the chat model (no swapping)", () => {
    const base = { configured: DEFAULT_META_MODEL, chatModel: DEFAULT_CHAT_MODEL };
    expect(preferredMetaModel({ ...base, memoryGb: 16, present: [DEFAULT_META_MODEL] })).toBe(DEFAULT_CHAT_MODEL);
    expect(preferredMetaModel({ ...base, memoryGb: 32, present: [DEFAULT_META_MODEL] })).toBe(DEFAULT_META_MODEL);
    expect(preferredMetaModel({ ...base, memoryGb: 32, present: [] })).toBe(DEFAULT_CHAT_MODEL);
  });
});

describe("preferredChatModel: MLX runner (#3749 R9)", () => {
  const base = { memoryGb: 16, appleSilicon: true };
  it("prefers the -mlx build of whatever size was chosen, when it is in the store", () => {
    expect(preferredChatModel({ ...base, configured: DEFAULT_CHAT_MODEL, present: [DEFAULT_CHAT_MODEL, `${DEFAULT_CHAT_MODEL}-mlx`] })).toBe(`${DEFAULT_CHAT_MODEL}-mlx`);
    // size preference first, then runner: 9B present ⇒ 9B, and its -mlx build wins if there
    expect(preferredChatModel({ ...base, configured: DEFAULT_CHAT_MODEL, present: [UPGRADED_CHAT_MODEL, `${UPGRADED_CHAT_MODEL}-mlx`] })).toBe(`${UPGRADED_CHAT_MODEL}-mlx`);
  });
  it("never picks MLX off Apple Silicon, and never invents a tag that is not in the store", () => {
    expect(preferredChatModel({ configured: DEFAULT_CHAT_MODEL, memoryGb: 16, appleSilicon: false, present: [DEFAULT_CHAT_MODEL, `${DEFAULT_CHAT_MODEL}-mlx`] })).toBe(DEFAULT_CHAT_MODEL);
    expect(preferredChatModel({ ...base, configured: DEFAULT_CHAT_MODEL, present: [DEFAULT_CHAT_MODEL] })).toBe(DEFAULT_CHAT_MODEL);
  });
  it("leaves an explicitly configured -mlx model alone", () => {
    expect(preferredChatModel({ ...base, configured: "qwen3.5:4b-mlx", present: ["qwen3.5:4b-mlx"] })).toBe("qwen3.5:4b-mlx");
  });
});

describe("startup pulls (#3749)", () => {
  it("the meta model is never in the pull list: it is an optimisation, not a requirement", () => {
    const up = readFileSync(new URL("../src/up.ts", import.meta.url), "utf8");
    const line = up.split("\n").find((l) => l.includes("for (const model of ["));
    expect(line, "the pull loop must exist").toBeTruthy();
    expect(line).toContain("c.chatModel");
    expect(line).toContain("c.embeddingModel");
    // it was here once, and every first start then pulled 2.6 GB for a model the machine
    // would decline to use (user-visible: 7 minutes stuck on 「检查本地模型」)
    expect(line).not.toContain("c.metaModel");
  });
});
