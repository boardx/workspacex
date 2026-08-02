/**
 * F143 -- domain I-6 (`uc-23-3` R7 rule 1 / R12-11): 发布后运行时装载的文件集合，
 * 与 `GetAssetDirectory` 返回的集合**必须逐一相等（双向）**。
 *
 * Pure application/domain-layer test, no Postgres (issue #74).
 *
 * 🔴 **The whole point of this suite is that the check is bidirectional.** Each adversarial
 * case below is constructed so that ONE of the two single-direction subset checks would stay
 * green on it -- proving that only asserting BOTH directions (i.e. set equality) catches
 * either kind of drift. If either half of `computeRuntimeLoadSetDiff` were dropped, one of
 * these two cases would silently pass.
 */
import { describe, expect, it } from "vitest";
import { computeRuntimeLoadSetDiff } from "../../src/domain/asset/runtime-load-set";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { DirectoryBackedAssetRuntimeLoader } from "../../src/infrastructure/asset/directory-backed-asset-runtime-loader";
import {
  verifyRuntimeLoadSet,
  AssetRuntimeLoadSetNotFoundError,
} from "../../src/application/asset/verify-runtime-load-set";
import type { AssetKind, AssetRuntimeLoaderPort } from "../../src/application/asset/ports";

describe("computeRuntimeLoadSetDiff -- 纯函数，双向断言 (I-6)", () => {
  it("两个集合逐一相等 -> equal: true，两侧差集皆空", () => {
    const diff = computeRuntimeLoadSetDiff(["SKILL.md", "a.md", "b.md"], ["SKILL.md", "a.md", "b.md"]);
    expect(diff.equal).toBe(true);
    expect(diff.onlyInDirectory).toEqual([]);
    expect(diff.onlyInRuntime).toEqual([]);
  });

  it("目录比运行时多一个文件（『编辑器改了但运行时不读』的那种 bug）-> 单向「装载的都在列表里」是绿的，但双向判 equal: false", () => {
    const directoryPaths = ["SKILL.md", "a.md", "b.md"]; // 列表里多出 b.md
    const runtimePaths = ["SKILL.md", "a.md"]; // 运行时从没读过 b.md

    // 单向断言「每个被装载的文件都在目录列表里」(loaded ⊆ directory) -- 在这个 bug 上仍然为真，
    // 这正是 issue notes 里说的「在一个『列表多显示了几个文件』的实现上也是绿的」。
    const loadedSubsetOfDirectory = runtimePaths.every((p) => directoryPaths.includes(p));
    expect(loadedSubsetOfDirectory).toBe(true);

    // 双向比较必须抓到它。
    const diff = computeRuntimeLoadSetDiff(directoryPaths, runtimePaths);
    expect(diff.equal).toBe(false);
    expect(diff.onlyInDirectory).toEqual(["b.md"]);
    expect(diff.onlyInRuntime).toEqual([]);
  });

  it("运行时比目录多读了一个文件（『运行时偷读了列表外的文件』的那种 bug）-> 反方向的单向断言是绿的，但双向判 equal: false", () => {
    const directoryPaths = ["SKILL.md", "a.md"];
    const runtimePaths = ["SKILL.md", "a.md", "secret.md"]; // 运行时多读了一个不在目录里的文件

    // 单向断言「目录列表里的每个文件都被装载了」(directory ⊆ loaded) -- 在这个 bug 上仍然为真。
    const directorySubsetOfLoaded = directoryPaths.every((p) => runtimePaths.includes(p));
    expect(directorySubsetOfLoaded).toBe(true);

    const diff = computeRuntimeLoadSetDiff(directoryPaths, runtimePaths);
    expect(diff.equal).toBe(false);
    expect(diff.onlyInDirectory).toEqual([]);
    expect(diff.onlyInRuntime).toEqual(["secret.md"]);
  });
});

describe("verifyRuntimeLoadSet -- 接真实端口 (F141 的 fixture 仓储 + F143 的运行时装载器)", () => {
  it("skill 资产：目录集合与运行时装载集合逐一相等（真实端口，非 mock 断言）", async () => {
    const assets = new FixtureAssetFileRepository();
    const runtime = new DirectoryBackedAssetRuntimeLoader(assets);
    const diff = await verifyRuntimeLoadSet({ assets, runtime }, { assetKind: "skill", assetId: "sk-1" });
    expect(diff.equal).toBe(true);
  });

  it("agent 资产：同上", async () => {
    const assets = new FixtureAssetFileRepository();
    const runtime = new DirectoryBackedAssetRuntimeLoader(assets);
    const diff = await verifyRuntimeLoadSet({ assets, runtime }, { assetKind: "agent", assetId: "ag-1" });
    expect(diff.equal).toBe(true);
  });

  it("编辑器里删除一个非根文件后，目录集合与运行时装载集合（同一份底层数据）仍然相等 -- 因为两者读的是同一个仓储，不是两份会漂移的拷贝", async () => {
    const assets = new FixtureAssetFileRepository();
    const runtime = new DirectoryBackedAssetRuntimeLoader(assets);
    await assets.deleteFile("skill", "sk-1", "scripts/validate.py");
    const diff = await verifyRuntimeLoadSet({ assets, runtime }, { assetKind: "skill", assetId: "sk-1" });
    expect(diff.equal).toBe(true);
    expect(diff.onlyInDirectory).toEqual([]);
    expect(diff.onlyInRuntime).toEqual([]);
  });

  it("未知 assetId -> AssetRuntimeLoadSetNotFoundError（与 getDirectory 的 null 同一个「不存在」出口）", async () => {
    const assets = new FixtureAssetFileRepository();
    const runtime = new DirectoryBackedAssetRuntimeLoader(assets);
    await expect(
      verifyRuntimeLoadSet({ assets, runtime }, { assetKind: "model", assetId: "m-1" }),
    ).rejects.toBeInstanceOf(AssetRuntimeLoadSetNotFoundError);
  });

  it("对抗性运行时端口——若装载器与目录端口不共用同一份数据，两者出现漂移会被 verifyRuntimeLoadSet 抓到", async () => {
    const assets = new FixtureAssetFileRepository();
    // 一个刻意「漏读」了一个文件的对抗性运行时端口 -- 模拟「运行时缓存了旧的文件列表，
    // 编辑器已经改了但运行时从没重新装载」这种 bug，而不是重用 DirectoryBackedAssetRuntimeLoader。
    const staleRuntime: AssetRuntimeLoaderPort = {
      async loadedFilePaths(assetKind: AssetKind, assetId: string) {
        const directory = await assets.getDirectory(assetKind, assetId);
        if (directory === null) return null;
        return directory.entries.map((e) => e.path).filter((p) => p !== "scripts/validate.py");
      },
    };
    const diff = await verifyRuntimeLoadSet({ assets, runtime: staleRuntime }, { assetKind: "skill", assetId: "sk-1" });
    expect(diff.equal).toBe(false);
    expect(diff.onlyInDirectory).toEqual(["scripts/validate.py"]);
    expect(diff.onlyInRuntime).toEqual([]);
  });
});
