/**
 * lint-local-zero-egress 这道门自己的门：真的接进了验证链、真的会红，空集不判绿，
 * 回环与写了理由的豁免不误报。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-local-zero-egress.mjs");

const made: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "local-zero-egress-"));
  made.push(root);
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), t);
  }
  return root;
}
const run = (root: string) => spawnSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("lint-local-zero-egress", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:local-zero-egress"]).toContain("lint-local-zero-egress.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:local-zero-egress");
  });

  it("当前仓库干净，且确实扫到了本地版源码", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    expect(out).toMatch(/违规 0 处/);
    expect(out).not.toMatch(/源码文件 0 个/);
  });

  it("对照组：回环地址、*.localhost、注释里的外部链接 ⇒ 绿", () => {
    const r = run(fixture({
      "packages/local-runtime/src/a.ts": [
        'const a = "http://127.0.0.1:11434";',
        "const b = `http://localhost:${port}`;",
        "const c = `http://downloads.localhost:3200`;",
        " * 参考 <https://sqlite.org/howtocorrupt.html>",
        "// see https://example.com",
      ].join("\n"),
    }));
    expect(r.status, r.stderr).toBe(0);
  });

  it("反例：本地运行时里写死一个外部地址 ⇒ 红，并指出文件与行号", () => {
    const r = run(fixture({
      "packages/local-runtime/src/a.ts": 'export const x = 1;\nawait fetch("https://telemetry.example.com/ping");\n',
    }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("packages/local-runtime/src/a.ts:2");
    expect(r.stderr).toContain("https://telemetry.example.com");
  });

  it("反例：桌面壳里写死外部地址 ⇒ 红", () => {
    const r = run(fixture({ "apps/desktop/src/main.ts": 'shell.openExternal("https://analytics.vendor.io/x");\n' }));
    expect(r.status).toBe(1);
  });

  it("豁免必须写理由：空理由 ⇒ 红，写了理由 ⇒ 绿", () => {
    const empty = run(fixture({ "apps/desktop/src/a.ts": 'const u = "https://registry.ollama.ai"; // egress-allowed:\n' }));
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain("豁免没写理由");
    const ok = run(fixture({
      "apps/desktop/src/a.ts": 'const u = "https://registry.ollama.ai"; // egress-allowed: 首次安装时用户点「下载模型」\n',
    }));
    expect(ok.status, ok.stderr).toBe(0);
  });

  it("空集不是全绿：一个本地版源码文件都扫不到 ⇒ 红", () => {
    const r = run(fixture({ "README.md": "nothing here\n" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("空集不是全绿");
  });
});
