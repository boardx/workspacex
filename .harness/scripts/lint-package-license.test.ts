/**
 * 包许可证门控自己的门。每条规则一个反例；对照组证明干净的仓库判绿。
 * 夹具用真实的目录名（归属表按目录名登记），装在临时目录里。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-package-license.mjs");
const APACHE = readFileSync(join(ROOT, "packages/contracts/LICENSE"));

const made: string[] = [];
function repo(pkgs: Record<string, { license?: string; licenseFile?: Buffer | string | null }>): string {
  const root = mkdtempSync(join(tmpdir(), "pkg-license-"));
  made.push(root);
  for (const [dir, { license, licenseFile }] of Object.entries(pkgs)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name: dir, private: true, ...(license ? { license } : {}) }));
    if (licenseFile) writeFileSync(join(root, dir, "LICENSE"), licenseFile);
  }
  return root;
}
const CLEAN = {
  "packages/contracts": { license: "Apache-2.0", licenseFile: APACHE },
  "packages/maau-postinvest-report": { license: "UNLICENSED" },
  "packages/coord-protocol": { license: "UNLICENSED" },
  "apps/api": {},
};
const run = (root: string) => spawnSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("lint-package-license", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:package-license"]).toContain("lint-package-license.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:package-license");
  });

  it("真实仓库对账通过", () => {
    expect(execFileSync("node", [SCRIPT], { encoding: "utf8" })).toMatch(/问题 0 处/);
  });

  it("对照组：开源 Apache + 正文、售卖与运营面 UNLICENSED、未定不标 ⇒ 绿", () => {
    const r = run(repo(CLEAN));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("未定 apps/api");
  });

  it("① 新包没登记归属 ⇒ 红（不许默认继承某个许可证）", () => {
    const r = run(repo({ ...CLEAN, "packages/brand-new": { license: "Apache-2.0" } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("没有登记归属");
  });

  it("② 售卖内容被标成 Apache ⇒ 红", () => {
    const r = run(repo({ ...CLEAN, "packages/maau-postinvest-report": { license: "Apache-2.0" } }));
    expect(r.status).toBe(1);
  });

  it("③ 归属未定却写了许可证 ⇒ 红（替组织做了开源决策）", () => {
    const r = run(repo({ ...CLEAN, "apps/api": { license: "Apache-2.0" } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("替组织做了开源决策");
  });

  it("④ 开源包缺 LICENSE 正文 ⇒ 红；正文被改动 ⇒ 红", () => {
    expect(run(repo({ ...CLEAN, "packages/contracts": { license: "Apache-2.0" } })).status).toBe(1);
    const tampered = Buffer.concat([APACHE, Buffer.from("\n附加条款\n")]);
    const r = run(repo({ ...CLEAN, "packages/contracts": { license: "Apache-2.0", licenseFile: tampered } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不一致");
  });
});
