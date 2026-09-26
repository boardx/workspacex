/**
 * 本地形态 ↔ 云端形态的配置平价门控（parity.ts 的文件头写了它为什么存在）。
 *
 * 这四条断言合起来的效果是：**没有人能在不回答「本地版怎么办」的前提下，给 API 新加一个
 * 环境变量**。第一版没有这个门控，代价是 `SKILL_STARTER_PACK_ROOT` 在本地版整整缺了一轮
 * ——pack 导入面全 404，而没有任何东西会红。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { apiEnv, asrEnv, paths, resolveLocalConfig } from "../src/config";
import { LOCAL_ENV_PARITY, parityIndex, parityReport, scanEnvNames } from "../src/parity";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "wsx-parity-")); dirs.push(d); return d; }

function suppliedNames(): readonly string[] {
  const c = resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: join(tmp(), "d") });
  return [...Object.keys(apiEnv(c)), ...Object.keys(asrEnv(c))];
}

describe("local/cloud env parity", () => {
  it("classifies every environment variable the API reads", () => {
    const report = parityReport({
      scanned: scanEnvNames([join(REPO_ROOT, "apps", "api", "src")]),
      supplied: suppliedNames(),
    });
    // 一条都不许漏：新增的变量要么由 config.ts 供给，要么在 parity.ts 里说明本地为什么不需要。
    expect(report.unclassified).toEqual([]);
    // 归类了又供给 = 两处打架，读的人不知道信哪个。
    expect(report.classifiedButSupplied).toEqual([]);
    // 清单必须跟着代码缩：源码里已经没人读的名字，留在清单里只会假装它仍是个决定。
    expect(report.stale).toEqual([]);
    expect(report.duplicated).toEqual([]);
  });

  it("keeps the NODE_ENV!==production escape hatches unset", () => {
    const index = parityIndex();
    const supplied = new Set(suppliedNames());
    const mustStayUnset = [...index].filter(([, s]) => s === "must-stay-unset").map(([n]) => n);
    expect(mustStayUnset.length).toBeGreaterThan(0);
    for (const name of mustStayUnset) expect(supplied.has(name)).toBe(false);
  });

  it("ships the signed skill starter packs the import surface reads", () => {
    const c = resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: join(tmp(), "d") });
    // `FileSkillStarterPackSource` has no fallback root: unset means every pack is NOT_FOUND.
    expect(apiEnv(c).SKILL_STARTER_PACK_ROOT).toBe(paths.skillStarterPacks(c));
    expect(scanEnvNames([join(REPO_ROOT, "apps", "api", "src")])).toContain("SKILL_STARTER_PACK_ROOT");
  });

  it("moves the isolated download origin with the API port, and keeps it a distinct host", () => {
    const c = resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: join(tmp(), "d"), ports: { api: 4200 } });
    const origin = apiEnv(c).WORKSPACEX_DOWNLOAD_ORIGIN;
    expect(origin).toBe("http://downloads.localhost:4200");
    // the whole point of the variable: NOT the origin the session lives on
    expect(origin).not.toBe(`http://127.0.0.1:${c.ports.api}`);
  });

  it("gives every parity group a reason a reader can act on", () => {
    for (const g of LOCAL_ENV_PARITY) {
      expect(g.names.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(40);
    }
  });
});
