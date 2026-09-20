import { describe, expect, it } from "vitest";
import { chooseOllama, compareVersions, parseOllamaVersion } from "../src/ollama-version";

describe("ollama version choice", () => {
  it("parses and compares versions numerically", () => {
    expect(parseOllamaVersion("ollama version is 0.32.15\nWarning: client version is 0.34.1")).toBe("0.32.15");
    expect(compareVersions("0.34.1", "0.34.0")).toBe(1);
    expect(compareVersions("0.32.15", "0.34.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.9")).toBe(1);
  });
  it("starts our own when nothing runs; reuses a new enough server; sidesteps an old one when the bundle is newer", () => {
    expect(chooseOllama({ running: null, binary: "0.34.1", port: 11434 })).toMatchObject({ reuse: false, port: 11434 });
    // a new-enough server on the port is still NOT reused when we have a bundle: server settings must be ours (#3749 B1.1)
    expect(chooseOllama({ running: "0.34.1", binary: "0.34.1", port: 11434 })).toMatchObject({ reuse: false, port: 11435 });
    expect(chooseOllama({ running: "0.34.1", binary: null, port: 11434 })).toMatchObject({ reuse: true, port: 11434 });
    expect(chooseOllama({ running: "0.32.15", binary: "0.34.1", port: 11434 })).toMatchObject({ reuse: false, port: 11435 });
    // our own earlier instance still on the alternate port (crashed app / previous run): reuse it
    expect(chooseOllama({ running: "0.32.15", binary: "0.34.1", port: 11434, runningOnAlternate: "0.34.1" })).toMatchObject({ reuse: true, port: 11435 });
    // no newer binary to fall back to: reuse and say why replies will be slow
    const r = chooseOllama({ running: "0.32.15", binary: "0.32.15", port: 11434 });
    expect(r).toMatchObject({ reuse: true, port: 11434 });
    expect(r.reason).toMatch(/thinking cannot be switched off/);
  });
});
