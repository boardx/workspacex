/**
 * #785 -- `lint-permission-paths` 白名单条目
 * `src/infrastructure/asset/pg-asset-file-repository.ts` 的**守卫测试**。
 *
 * 同 `edit-skill-version-repo-guard.test.ts` / `url-import-repo-guard.test.ts` 同一条纪律：
 * 白名单条目声称「这个文件只命名三张已知表、从不绕过 RLS、且它的每一个调用方都先判过
 * org 成员资格才会调用它」，本文件把这句声明变成机械事实——条目依赖的任何一个前提
 * 破掉，这里当场红。
 *
 * ⛔ **若本文件被删除，`scripts/lint-permission-paths.mjs` 里对应的白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL("../../src/infrastructure/asset/pg-asset-file-repository.ts", import.meta.url);
const USE_CASES = {
  getAssetDirectory: new URL("../../src/application/asset/get-asset-directory.ts", import.meta.url),
  readAssetFile: new URL("../../src/application/asset/read-asset-file.ts", import.meta.url),
  writeAssetFile: new URL("../../src/application/asset/write-asset-file.ts", import.meta.url),
  deleteAssetFile: new URL("../../src/application/asset/delete-asset-file.ts", import.meta.url),
  renameAssetFile: new URL("../../src/application/asset/rename-asset-file.ts", import.meta.url),
};

const repoSource = readFileSync(REPO, "utf8");

/** 本仓储**允许**命名的租户表。多一张就说明这个文件长出了新的读面。 */
const ALLOWED_TABLES = new Set(["skills", "skill_versions", "skill_version_files"]);

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("白名单条目的前提：仓储侧", () => {
  it("只命名允许的三张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("skill_versions")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  /** `withoutTenant` 会绕过 RLS 的租户隔离，本文件永远不该出现它。 */
  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

describe("白名单条目的前提：每一条调用路径都先判 org 成员资格，再调用仓储", () => {
  it.each(Object.entries(USE_CASES))("%s：findOrgMembership 排在第一次 deps.assets. 调用之前", (_name, url) => {
    const source = readFileSync(url, "utf8");
    const authAt = source.indexOf("findOrgMembership");
    const firstAssetsCallAt = source.indexOf("deps.assets.");
    expect(authAt).toBeGreaterThan(-1);
    expect(firstAssetsCallAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(firstAssetsCallAt);
  });

  it("五个用例文件里，非成员一律得到 AssetOrgScopeDeniedError（同一个折叠出口，不是各写各的）", () => {
    for (const url of Object.values(USE_CASES)) {
      const source = readFileSync(url, "utf8");
      expect(source).toContain("AssetOrgScopeDeniedError");
    }
  });
});
