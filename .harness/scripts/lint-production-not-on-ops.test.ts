/**
 * 这道门自己的门：它得真的被跑到，也得真的会红。
 * 四种违规各造一个反例；另外证明**新加的应用默认受检**——名单只列运营平面一侧，
 * 默认值必须落在严格的那一侧，这是本门的设计要点，所以单独测。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-production-not-on-ops.mjs");

const made: string[] = [];
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
/** 一个最小仓库：两个运营平面包 + 一个干净的生产应用。extra 追加或覆盖文件。 */
function repo(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "prod-ops-"));
  made.push(root);
  const files: Record<string, string> = {
    "apps/coord-gateway/package.json": JSON.stringify({ name: "@repo/coord-gateway" }),
    "apps/coord-gateway/src/index.ts": 'const x = env.COORD_TOKEN;\n',
    "packages/coord-protocol/package.json": JSON.stringify({ name: "@repo/coord-protocol" }),
    "packages/coord-protocol/src/index.ts": "export const v = 1;\n",
    "apps/api/package.json": JSON.stringify({ name: "@repo/api", dependencies: { zod: "^3" } }),
    "apps/api/src/main.ts": 'import { z } from "zod";\n',
    ...extra,
  };
  for (const [p, t] of Object.entries(files)) put(root, p, t);
  return root;
}
const run = (root: string) => spawnSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("lint-production-not-on-ops", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:production-not-on-ops"]).toContain("lint-production-not-on-ops.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:production-not-on-ops");
  });

  it("当前仓库是干净的，且确实扫到了文件", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    expect(out).toMatch(/违规 0 处/);
    expect(out).not.toMatch(/、0 个源码文件/);
  });

  it("对照组：运营平面自己读 COORD_* 不算违规", () => {
    expect(run(repo()).status).toBe(0);
  });

  it("① 生产的 package.json 依赖运营平面包 ⇒ 红", () => {
    const r = run(repo({ "apps/api/package.json": JSON.stringify({ name: "@repo/api", dependencies: { "@repo/coord-protocol": "workspace:*" } }) }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("@repo/coord-protocol");
  });

  it("② 生产源码 import 运营平面包（含子路径）⇒ 红", () => {
    const r = run(repo({ "apps/api/src/a.ts": 'import { Lease } from "@repo/coord-protocol/types";\n' }));
    expect(r.status).toBe(1);
  });

  it("② 相对路径伸进运营平面目录 ⇒ 红", () => {
    const r = run(repo({ "apps/api/src/a.ts": 'import { v } from "../../../packages/coord-protocol/src/index";\n' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("伸进了运营平面目录");
  });

  it("③ 生产读 COORD_* 环境变量 ⇒ 红（运行时依赖，不经过 import）", () => {
    const r = run(repo({ "apps/api/src/a.ts": "const url = process.env.COORD_GATEWAY_URL;\n" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("COORD_GATEWAY_URL");
  });

  it("新加的应用没登记任何名单，也默认受检", () => {
    const r = run(repo({
      "apps/brand-new/package.json": JSON.stringify({ name: "@repo/brand-new" }),
      "apps/brand-new/src/x.ts": 'import "@repo/coord-gateway";\n',
    }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("apps/brand-new");
  });
});
