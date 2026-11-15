import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiEnv, paths, resolveLocalConfig, webEnv, type LocalProfile } from "../src/config";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
function config(profile?: LocalProfile) {
  const dataDir = mkdtempSync(join(tmpdir(), "wsx-aidt-config-")); dirs.push(dataDir);
  return resolveLocalConfig({ repoRoot: root, dataDir, ...(profile ? { profile } : {}) });
}
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("explicit AIDT Local profile", () => {
  it("leaves ordinary Local explicitly off on both API and browser", () => {
    const c = config();
    expect(c.profile).toBe("default");
    expect(apiEnv(c)).toMatchObject({ ENABLE_AIDT_MODULE: "0", ENABLE_PROJECT_MEMBER_CHAT: "0" });
    expect(webEnv(c)).toMatchObject({ NEXT_PUBLIC_ENABLE_AIDT: "0", NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT: "0" });
    expect(webEnv(c).NEXT_DIST_DIR).toBeUndefined();
  });
  it("cannot inherit a host's teaching/module opt-in into default Local", () => {
    for (const name of ["ENABLE_AIDT_MODULE", "ENABLE_PROJECT_MEMBER_CHAT", "NEXT_PUBLIC_ENABLE_AIDT", "NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT"]) vi.stubEnv(name, "1");
    const c = config("default");
    expect(apiEnv(c).ENABLE_AIDT_MODULE).toBe("0");
    expect(apiEnv(c).ENABLE_PROJECT_MEMBER_CHAT).toBe("0");
    expect(webEnv(c).NEXT_PUBLIC_ENABLE_AIDT).toBe("0");
    expect(webEnv(c).NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT).toBe("0");
  });
  it("enables exactly the approved four feature switches for aidt", () => {
    const c = config("aidt");
    expect(apiEnv(c)).toMatchObject({ ENABLE_AIDT_MODULE: "1", ENABLE_PROJECT_MEMBER_CHAT: "1" });
    expect(webEnv(c)).toMatchObject({ NEXT_PUBLIC_ENABLE_AIDT: "1", NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT: "1" });
    expect(webEnv(c).NEXT_DIST_DIR).toBe(".next-aidt-local");
    expect(apiEnv(c).WORKSPACEX_EDITION).toBe("local");
    expect(apiEnv(c).KERNEL_NATIVE_RUNTIME).toBe("0");
    expect(apiEnv(c).KERNEL_ASR_BASE_URL).toBeUndefined();
    expect(apiEnv(c).KERNEL_MODEL_PROVIDER).toBe("ollama");
  });
  it("keeps data paths and persisted credentials stable across restart/profile changes", () => {
    const first = config("aidt");
    const secretsBefore = readFileSync(join(first.dataDir, "secrets.json"), "utf8");
    const again = resolveLocalConfig({ repoRoot: root, dataDir: first.dataDir, profile: "aidt" });
    const ordinary = resolveLocalConfig({ repoRoot: root, dataDir: first.dataDir });
    expect(again.secrets).toEqual(first.secrets);
    expect(ordinary.secrets).toEqual(first.secrets);
    expect(paths.pgData(again)).toBe(paths.pgData(first));
    expect(paths.sessions(again)).toBe(paths.sessions(first));
    expect(paths.objects(again)).toBe(paths.objects(first));
    expect(readFileSync(join(first.dataDir, "secrets.json"), "utf8")).toBe(secretsBefore);
  });
});
