/**
 * F114 —— 支撑 `scripts/lint-permission-paths.mjs` 里 `pg-artifact-landing-repository.ts`
 * 那条豁免的静态断言（见该脚本 ALLOWLIST 里同名条目）。
 *
 * 豁免的有效期只在这条为真时成立：
 *   · `land-as-artifact.ts` / `list-thread-artifacts.ts` 在调用任何 `landings.` 方法前
 *     已经调用过 `resolveVisibility`；
 *   · `check-downstream-eligibility.ts` 的 `findByArtifactId` 天然要在 `resolveVisibility`
 *     之前跑（判定需要它给出的 `threadId`），但 `resolveVisibility` 必须在返回结果前
 *     被调用——不能读完落地记录就直接把结果交出去。
 *
 * 这里不跑数据库，纯字符串位置比较——与其余同类豁免（如
 * `ingestion-repo-metadata-only.test.ts`）同一种测法：解析源码，不依赖运行时。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../..", import.meta.url));

function read(relPath: string): string {
  return readFileSync(`${API}/${relPath}`, "utf8");
}

describe("F114 landings 三个调用方守规矩：读之前先过 resolveVisibility", () => {
  it("land-as-artifact.ts：resolveVisibility 出现在第一个 landings. 调用之前", () => {
    const src = read("src/application/chat/land-as-artifact.ts");
    const resolveIdx = src.indexOf("resolveVisibility(deps");
    const landingsIdx = src.indexOf("deps.landings.");
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(landingsIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeLessThan(landingsIdx);
  });

  it("list-thread-artifacts.ts：resolveVisibility 出现在第一个 landings. 调用之前", () => {
    const src = read("src/application/chat/list-thread-artifacts.ts");
    const resolveIdx = src.indexOf("resolveVisibility(deps");
    const landingsIdx = src.indexOf("deps.landings.");
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(landingsIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeLessThan(landingsIdx);
  });

  it("check-downstream-eligibility.ts：findByArtifactId 天然在 resolveVisibility 之前，"
    + "但 resolveVisibility 必须在函数返回结果之前被调用", () => {
    const src = read("src/application/chat/check-downstream-eligibility.ts");
    const findIdx = src.indexOf("deps.landings.findByArtifactId(");
    const resolveIdx = src.indexOf("resolveVisibility(deps");
    const returnIdx = src.indexOf("return { allowed: true");
    expect(findIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(-1);
    // 天然顺序：先取落地记录（拿 threadId），再判可见性。
    expect(findIdx).toBeLessThan(resolveIdx);
    // 但可见性判定必须在把结果交给调用方之前完成。
    expect(resolveIdx).toBeLessThan(returnIdx);
  });
});
