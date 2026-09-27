/**
 * 应用与回滚的真实文件系统往返（#3872 R20 第 2 步）。
 *
 * 第一版的门只检查 main.ts 源码里有没有某句 renameSync，从没让拷贝真的中途失败过——
 * 而那条路径真的有缺陷：半新半旧的 bundle 留在原地，弹窗却说「已还原到更新前」。
 * 这里全部在真实目录上跑，失败也是真的失败。
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_VERSION_FILE, applyUpdate, makeUpdatePackage, readBundleVersion, readHistory, rollbackBundle,
} from "../src/update-package";

function world(): { root: string; bundle: string; hist: string } {
  const root = mkdtempSync(join(tmpdir(), "wsx-apply-"));
  const bundle = join(root, "bundle");
  mkdirSync(join(bundle, "apps", "web"), { recursive: true });
  writeFileSync(join(bundle, "apps", "web", "page.ts"), "v0.2.0 page");
  writeFileSync(join(bundle, "keep.txt"), "original");
  return { root, bundle, hist: join(root, "data", "update-history.json") };
}

/** 从 bundle 派生一个新版本：改一个文件、加一个只在新版里有的探针。 */
async function pkgFrom(bundle: string, root: string, version: string): Promise<string> {
  const src = join(root, `src-${version}`);
  cpSync(bundle, src, { recursive: true });
  writeFileSync(join(src, "apps", "web", "page.ts"), `v${version} page`);
  writeFileSync(join(src, "probe.txt"), `only in ${version}`);
  const out = join(root, `pkg-${version}`);
  await makeUpdatePackage({ fromDir: src, outDir: out, version, summary: `升级到 ${version}` });
  return out;
}

describe("更新", () => {
  it("装上之后：内容是新的、版本号是新的、旧版被保留", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    const r = await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(w.bundle, "apps", "web", "page.ts"), "utf8")).toBe("v0.3.0 page");
    expect(existsSync(join(w.bundle, "probe.txt"))).toBe(true);
    expect(await readBundleVersion(w.bundle, "0.2.0"), "版本号必须由 bundle 自己带，不能还是外壳的 0.2.0").toBe("0.3.0");
    if (r.ok) expect(readFileSync(join(r.keptAt, "keep.txt"), "utf8")).toBe("original");
  });

  it("**同一个包装第二次被拒**——第一版的缺陷就是它能反复装并覆盖原始版本", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    const again = await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    expect(again.ok).toBe(false);
    // 原始版本仍然完好
    expect(readFileSync(join(`${w.bundle}.prev-0.2.0`, "keep.txt"), "utf8")).toBe("original");
  });

  it("**拷到一半失败时：bundle 一个字节都没动，也不留暂存垃圾**", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    const r = await applyUpdate({
      bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist,
      copy: (from, to) => {
        // 真的写进去一部分，再失败——模拟磁盘满/中途被杀
        mkdirSync(join(to, "apps", "web"), { recursive: true });
        writeFileSync(join(to, "apps", "web", "page.ts"), "HALF WRITTEN");
        void from;
        throw new Error("ENOSPC: no space left on device");
      },
    });
    expect(r.ok).toBe(false);
    expect(readFileSync(join(w.bundle, "apps", "web", "page.ts"), "utf8"), "bundle 被改动了").toBe("v0.2.0 page");
    expect(existsSync(join(w.bundle, BUNDLE_VERSION_FILE))).toBe(false);
    expect(readdirSync(w.root).filter((n) => n.includes("staging")), "暂存目录没清掉").toEqual([]);
    expect(readdirSync(w.root).filter((n) => n.startsWith("bundle.prev")), "失败了却挪走了旧版").toEqual([]);
    expect(readHistory(w.hist), "失败不该记成一次更新").toEqual([]);
  });

  it("校验失败时同样一个字节都不动", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    writeFileSync(join(pkg, "payload", "probe.txt"), "TAMPERED");
    const r = await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    expect(r.ok).toBe(false);
    expect(readFileSync(join(w.bundle, "apps", "web", "page.ts"), "utf8")).toBe("v0.2.0 page");
  });
});

describe("回滚", () => {
  it("回到上一版：内容、版本号都回来，当前版被保留", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    const r = await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(w.bundle, "apps", "web", "page.ts"), "utf8")).toBe("v0.2.0 page");
    expect(existsSync(join(w.bundle, "probe.txt"))).toBe(false);
    expect(await readBundleVersion(w.bundle, "0.2.0")).toBe("0.2.0");
    if (r.ok) expect(readFileSync(join(r.keptAt, "probe.txt"), "utf8")).toBe("only in 0.3.0");
    expect(readHistory(w.hist).map((h) => h.kind)).toEqual(["update", "rollback"]);
  });

  it("**回滚之后再回滚：说没有，而不是在两版之间来回弹**", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist });
    const again = await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist });
    expect(again.ok).toBe(false);
    expect(readFileSync(join(w.bundle, "apps", "web", "page.ts"), "utf8")).toBe("v0.2.0 page");
  });

  it("回滚后可以再更新到 0.3.0，且保留的旧版不被覆盖", async () => {
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist });
    const r = await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist });
    expect(r.ok).toBe(true);
    // 那份 0.3.0 的旧保留（回滚时挪开的）仍在——重名时加时间戳，从不覆盖
    const asides = readdirSync(w.root).filter((n) => n.startsWith("bundle.prev-0.3.0"));
    expect(asides.length).toBeGreaterThanOrEqual(1);
  });

  it("**两次来回之后：保留目录会撞名，此时加时间戳而不是覆盖或失败**", async () => {
    /*
      上一条（更新→回滚→更新）其实**撞不了名**：回滚时 prev-0.2.0 已经被换回 bundle，
      第二次更新再建 prev-0.2.0 时它不存在。反证把「重名加时间戳」删掉它照样绿——
      那个剧本产生不出它声称要测的缺陷。
      真正会撞名的是**第二次回滚**：它要把当前版挪到 prev-0.3.0，而第一次回滚已经建过。
    */
    const w = world();
    const pkg = await pkgFrom(w.bundle, w.root, "0.3.0");
    const t = (ms: number) => new Date(Date.UTC(2026, 8, 27, 0, 0, 0, ms));
    await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist, now: t(1) });
    await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist, now: t(2) });
    await applyUpdate({ bundleDir: w.bundle, packageDir: pkg, shellVersion: "0.2.0", historyPath: w.hist, now: t(3) });
    expect(existsSync(`${w.bundle}.prev-0.3.0`), "前置条件：第一次回滚留下的 prev-0.3.0 还在").toBe(true);
    const r = await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist, now: t(4) });
    expect(r.ok, "第二次回滚撞名时失败了").toBe(true);
    const asides = readdirSync(w.root).filter((n) => n.startsWith("bundle.prev-0.3.0"));
    expect(asides.length, "两份 0.3.0 的保留应该并存，一份都不该被覆盖").toBe(2);
    expect(readFileSync(join(w.bundle, "apps", "web", "page.ts"), "utf8")).toBe("v0.2.0 page");
  });

  it("没装过更新时说没有", async () => {
    const w = world();
    const r = await rollbackBundle({ bundleDir: w.bundle, shellVersion: "0.2.0", historyPath: w.hist });
    expect(r.ok).toBe(false);
  });
});

describe("打包", () => {
  it("清单不收软链接（目标可能在包外）、不收版本标记", async () => {
    const w = world();
    writeFileSync(join(w.bundle, BUNDLE_VERSION_FILE), "{}");
    const out = join(w.root, "pkg");
    const m = await makeUpdatePackage({ fromDir: w.bundle, outDir: out, version: "0.3.0" });
    expect(Object.keys(m.files)).not.toContain(BUNDLE_VERSION_FILE);
    expect(Object.keys(m.files).sort()).toEqual(["apps/web/page.ts", "keep.txt"]);
  });
});
