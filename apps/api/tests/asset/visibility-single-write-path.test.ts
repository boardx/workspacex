/**
 * F135 -- 「可见性只有一条写入路径」(`uc-23-4` R7 rule 1, domain I-14). Pure test, no
 * Postgres (issue #74).
 *
 * `uc-23-4` domain I-14: a later automatic downgrade (`uc-23-6`'s 30-day-no-review path,
 * F138/F139 -- not built in this bundle) must write a visibility change through the SAME
 * server-side path a human editing the governance panel uses, not a second implementation
 * that happens to persist the same fields.
 *
 * ⚠ **The assertion is "the same function got called", not "the two writes look alike"**
 * (issue #252's own note): a result-shape comparison stays green right up until one of two
 * independently-written call sites forgets a side effect the other has (an audit write, a
 * cache bust, a search-index refresh). So this file does two things, mirroring the pattern
 * used for `routeModelCall`'s bypass guard (`no-model-call-bypasses-router.test.ts`):
 *
 *   ① Source-scan `src/application/asset` and `src/domain/asset`: exactly ONE file calls
 *      `.governance.set(` / `AssetGovernanceRepository`'s `set(...)` for a visibility write,
 *      and it is `write-asset-visibility.ts`. A second call site anywhere -- present or
 *      future -- is exactly the "second door" I-14 forbids.
 *   ② `setAssetGovernance` (today's one caller) delegates to `writeAssetGovernanceVisibility`
 *      rather than writing `deps.governance.set(...)` inline itself.
 *
 * This is deliberately a lock-in / regression guard, not a test of a downgrade feature that
 * does not exist yet (F138/F139 are separate, not-started features) -- it makes the future
 * downgrade call site structurally have nowhere else to go but through the one function this
 * feature carves out.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setAssetGovernance } from "../../src/application/asset/set-asset-governance";
import { writeAssetGovernanceVisibility } from "../../src/application/asset/write-asset-visibility";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";

function tsFilesUnder(root: string): string[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(p);
    }
  })(root);
  return files;
}

function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
}

const ASSET_APPLICATION_ROOT = join(__dirname, "..", "..", "src", "application", "asset");
const ASSET_DOMAIN_ROOT = join(__dirname, "..", "..", "src", "domain", "asset");

describe("① 源码扫描：governance.set(...) 只有一处调用点，且是 write-asset-visibility.ts", () => {
  it("application/asset 与 domain/asset 目录非空（防止目录读错导致下面恒真）", () => {
    const files = [...tsFilesUnder(ASSET_APPLICATION_ROOT), ...tsFilesUnder(ASSET_DOMAIN_ROOT)];
    expect(files.length).toBeGreaterThan(5);
  });

  it("除 write-asset-visibility.ts 外，没有第二处调用 governance.set(...)", () => {
    const files = [...tsFilesUnder(ASSET_APPLICATION_ROOT), ...tsFilesUnder(ASSET_DOMAIN_ROOT)].filter(
      (f) => !/write-asset-visibility\.ts$/.test(f),
    );
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      // Matches `deps.governance.set(`, `this.governance.set(`, or a bare `governance.set(`.
      if (/(?:^|[.\s])governance\.set\(/.test(code)) {
        offenders.push(f);
      }
    }
    expect(offenders, `这些文件绕过 writeAssetGovernanceVisibility 自己调用了 governance.set：\n  ${offenders.join("\n  ")}`).toEqual(
      [],
    );
  });

  it("write-asset-visibility.ts 自身确实调用了 governance.set（防止上一条断言在「哪都不调用」时也绿）", () => {
    const src = stripComments(readFileSync(join(ASSET_APPLICATION_ROOT, "write-asset-visibility.ts"), "utf8"));
    expect(src).toMatch(/deps\.governance\.set\(/);
  });
});

describe("② setAssetGovernance 委托给 writeAssetGovernanceVisibility，不内联重写一遍", () => {
  it("set-asset-governance.ts 源码里调用了 writeAssetGovernanceVisibility(...)", () => {
    const src = stripComments(readFileSync(join(ASSET_APPLICATION_ROOT, "set-asset-governance.ts"), "utf8"));
    expect(src).toMatch(/writeAssetGovernanceVisibility\(/);
    // 反证：函数体内没有自己再调一次 deps.governance.set —— 那会是第二份实现。
    expect(src).not.toMatch(/deps\.governance\.set\(/);
  });

  it("行为层面：setAssetGovernance 的落库效果与直接调用 writeAssetGovernanceVisibility 一致（同一函数、同一副作用）", async () => {
    const store = new Map<string, AssetGovernanceRecord>();
    const repo: AssetGovernanceRepository = {
      get: async (assetKind, assetId) => store.get(`${assetKind}:${assetId}`) ?? null,
      set: async (assetKind, assetId, governance) => void store.set(`${assetKind}:${assetId}`, governance),
    };
    const orgId = toOrgId("org-1");
    const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };

    // Caller A: the manual path (setAssetGovernance, F134).
    await setAssetGovernance(
      { repo: { findOrgMembership: async () => member }, governance: repo },
      {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "a1",
        draft: {
          visibility: "whole-org",
          teamIds: [],
          editableBy: ["u-owner"],
          ownerId: "u-owner",
          reviewCycle: "12m",
        },
      },
    );
    const viaManualPath = store.get("skill:a1");

    // Caller B: a stand-in for the future automatic downgrade (F139 does not exist yet) --
    // calling the exact same shared function directly, the only shape a real downgrade caller
    // could take given assertion ① above (there is nowhere else to write from).
    store.clear();
    const record: AssetGovernanceRecord = {
      visibility: "whole-org",
      teamIds: [],
      editableBy: ["u-owner"],
      ownerId: "u-owner",
      reviewCycle: "12m",
    };
    const { requiresCosign } = await writeAssetGovernanceVisibility(
      { governance: repo },
      "skill",
      "a1",
      record,
    );
    const viaSharedFunction = store.get("skill:a1");

    expect(viaManualPath).toEqual(viaSharedFunction);
    expect(requiresCosign).toBe(true);
  });
});
