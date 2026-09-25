/**
 * 「缺什么能力」这件事只有一份事实源，而且它与 `parity.ts` 咬合。
 *
 * 最后一条是关键：`parity.ts` 里凡是被归进 `unavailable-locally` 的环境变量，都必须被某条
 * 能力认领。少了这条咬合，两份清单会各自演化——而用户看到的那一份（能力）恰恰是更容易
 * 被忘记更新的那一份。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_CAPABILITY_BASELINE, capabilityNotices, localCapabilities,
  overclaimedEnv, unclaimedUnavailableEnv,
} from "../src/capabilities";
import { DEFAULT_ASR_MODEL } from "../src/config";
import { runDoctor } from "../src/doctor";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "wsx-cap-")); dirs.push(d); return d; }

describe("local capability list", () => {
  it("claims every env var parity.ts calls 'unavailable-locally', and claims nothing else", () => {
    expect(unclaimedUnavailableEnv()).toEqual([]);
    expect(overclaimedEnv()).toEqual([]);
  });

  it("gives every entry a user-facing reason and a next step", () => {
    for (const cap of LOCAL_CAPABILITY_BASELINE) {
      expect(cap.because.length).toBeGreaterThan(8);
      expect(cap.remedy.length).toBeGreaterThan(4);
      // 不引术语：面向用户的那两句里不该出现环境变量名
      expect(`${cap.because}${cap.remedy}`).not.toMatch(/[A-Z]{4,}_[A-Z_]+/);
    }
    const ids = LOCAL_CAPABILITY_BASELINE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("flips the installable ones once the thing is actually on disk", () => {
    const dataDir = tmp();
    const before = localCapabilities({ repoRoot: REPO_ROOT, dataDir }, { chatModel: false });
    expect(before.find((c) => c.id === "live-transcription")?.available).toBe(false);
    expect(before.find((c) => c.id === "chat-model")?.available).toBe(false);

    mkdirSync(join(dataDir, "asr-models", DEFAULT_ASR_MODEL), { recursive: true });
    writeFileSync(join(dataDir, "asr-models", DEFAULT_ASR_MODEL, "tokens.txt"), "");
    const after = localCapabilities({ repoRoot: REPO_ROOT, dataDir }, { chatModel: true });
    expect(after.find((c) => c.id === "live-transcription")?.available).toBe(true);
    expect(after.find((c) => c.id === "chat-model")?.available).toBe(true);
    // 装了东西以后，这条就不该再出现在给用户的提示里
    expect(capabilityNotices(after).join("\n")).not.toContain("实时转写");
  });
});

describe("doctor", () => {
  it("decides ok from hardware only, not from the wording of a finding", () => {
    // 缺 Ollama / venv / 转写模型时，机器仍然能跑；此前 ok 是靠 findings 的字符串前缀判的，
    // 改一句提示语就会改变程序会不会拒绝启动。
    const report = runDoctor({ repoRoot: REPO_ROOT, dataDir: join(tmp(), "never-created") });
    expect(report.ok).toBe(report.memoryGb >= 8 && report.freeDiskGb >= 12);
    expect(report.findings.some((f) => f.includes("实时转写"))).toBe(true);
    expect(report.capabilities.length).toBeGreaterThan(LOCAL_CAPABILITY_BASELINE.length);
  });

  it("does not write anything into the data dir -- a self-check must be read-only", () => {
    const dataDir = join(tmp(), "fresh");
    runDoctor({ repoRoot: REPO_ROOT, dataDir });
    // resolveLocalConfig 会生成 secrets.json；doctor 不该走那条路
    expect(() => rmSync(join(dataDir, "secrets.json"))).toThrow();
  });
});
