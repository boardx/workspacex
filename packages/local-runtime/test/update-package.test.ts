/**
 * 离线更新的三条不变量（#3872 R20）。
 *
 * 维度 8 此前 4 分，而「任一维 ≤5 则整体不得高于 6」——它是唯一的封顶项。
 * 自动更新通道要验签（没证书做不了），但**离线更新包、版本号前进式回滚**不需要证书。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  UPDATE_MANIFEST, compareVersions, inspectUpdate, verifyUpdatePayload, rollbackTargetOf,
  type UpdateManifest, type AppliedRecord,
} from "../src/update-package";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
function tmp(): string { return mkdtempSync(join(tmpdir(), "wsx-upd-")); }

/** 造一个形状真实的更新包。 */
function makePackage(dir: string, over: Partial<UpdateManifest> = {}, files: Record<string, string> = { "apps/web/x.ts": "hello" }): UpdateManifest {
  mkdirSync(join(dir, "payload", "apps", "web"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, "payload", rel, ".."), { recursive: true });
    writeFileSync(join(dir, "payload", rel), content);
  }
  const m: UpdateManifest = {
    formatVersion: 1, version: "0.3.0", createdAt: new Date().toISOString(),
    payload: "bundle",
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
    ...over,
  };
  writeFileSync(join(dir, UPDATE_MANIFEST), JSON.stringify(m));
  return m;
}

describe("版本比较", () => {
  it("按语义化版本比，不是按字符串", () => {
    // 字符串比较会说 "0.10.0" < "0.9.0"
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
  });
  it("读不出来就说读不出来，不猜", () => {
    expect(compareVersions("v0.3", "0.2.0")).toBeNull();
    expect(compareVersions("0.3.0-beta", "0.2.0")).toBeNull();
  });
});

describe("能不能装", () => {
  it("更新的版本更高 → 可以", async () => {
    const d = tmp(); makePackage(d);
    const v = await inspectUpdate(d, "0.2.0");
    expect(v.ok).toBe(true);
  });

  it("**拒绝降级，并指向回滚那条路**", async () => {
    const d = tmp(); makePackage(d, { version: "0.1.0" });
    const v = await inspectUpdate(d, "0.2.0");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain("降级");
      expect(v.reason, "拒绝的时候要告诉用户正确的那条路").toContain("回滚");
    }
  });

  it("同版本不装", async () => {
    const d = tmp(); makePackage(d, { version: "0.2.0" });
    const v = await inspectUpdate(d, "0.2.0");
    expect(v.ok).toBe(false);
  });

  it("不是更新包时说人话，不抛内部错误", async () => {
    const v = await inspectUpdate(tmp(), "0.2.0");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).not.toMatch(/ENOENT|JSON\.parse|undefined/);
  });

  it("**替换范围超出 bundle 时明说哪些东西这条路换不了**", async () => {
    const d = tmp(); makePackage(d, { payload: "shell" as unknown as "bundle" });
    const v = await inspectUpdate(d, "0.2.0");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/重新安装/);
      expect(v.reason, "要点名是哪三样").toMatch(/模型|Ollama|外壳/);
    }
  });

  it("空清单不算更新", async () => {
    const d = tmp(); makePackage(d, {}, {});
    expect((await inspectUpdate(d, "0.2.0")).ok).toBe(false);
  });
});

describe("装之前先验", () => {
  it("摘要全对 → 通过", async () => {
    const d = tmp(); const m = makePackage(d);
    const r = await verifyUpdatePayload(d, m);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(1);
  });

  it("**内容被改过就不通过**——同长度也不行", async () => {
    const d = tmp(); const m = makePackage(d, {}, { "apps/web/x.ts": "hello" });
    writeFileSync(join(d, "payload", "apps/web/x.ts"), "HELLO");   // 同长度不同内容
    const r = await verifyUpdatePayload(d, m);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.bad)).toEqual(["apps/web/x.ts"]);
  });

  it("清单里有、包里没有 → 指名那个文件", async () => {
    const d = tmp(); const m = makePackage(d);
    const m2 = { ...m, files: { ...m.files, "apps/web/missing.ts": sha("x") } };
    const r = await verifyUpdatePayload(d, m2);
    expect(r.ok).toBe(false);
    expect(r.bad["apps/web/missing.ts"]).toContain("包里没有");
  });

  it("**路径穿越要被拦**——更新包是外来数据", async () => {
    const d = tmp(); const m = makePackage(d);
    for (const evil of ["../../etc/passwd", "/etc/passwd", "apps/../../x"]) {
      const r = await verifyUpdatePayload(d, { ...m, files: { [evil]: sha("x") } });
      expect(r.ok, `${evil} 应该被拦下`).toBe(false);
      expect(r.bad[evil]).toContain("不合法");
    }
  });
});

describe("回滚是前进，不是把状态倒回去", () => {
  const rec = (kind: "update" | "rollback", from: string, to: string, kept: string | null): AppliedRecord =>
    ({ at: new Date().toISOString(), from, to, kind, keptAt: kept });

  it("回滚目标是最近一次「留了上一版」的更新的来源版本", () => {
    expect(rollbackTargetOf([rec("update", "0.1.0", "0.2.0", "/k1"), rec("update", "0.2.0", "0.3.0", "/k2")])).toBe("0.2.0");
  });

  it("没有留过上一版时说没有，不编一个版本号", () => {
    expect(rollbackTargetOf([])).toBeNull();
    expect(rollbackTargetOf([rec("update", "0.1.0", "0.2.0", null)])).toBeNull();
  });

  it("回滚记录本身不成为下一次回滚的目标——否则会在两版之间来回弹", () => {
    const h = [rec("update", "0.2.0", "0.3.0", "/k"), rec("rollback", "0.3.0", "0.2.0", null)];
    expect(rollbackTargetOf(h)).toBe("0.2.0");
  });
});
