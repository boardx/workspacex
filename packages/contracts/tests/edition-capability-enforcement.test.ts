/**
 * 2026-09-22 —— 能力矩阵的**落地门控**的反证。
 *
 * 断言「脚本退出 0」是没有价值的（本仓 `arch-gate.test.ts` 头注写过同一条教训：
 * 一个什么都没扫的门控也退出 0）。这里断言的是它**抓到了什么**：
 *   ① 把一个 gated 行的 ref 改成搜不到的字符串 ⇒ 必须红，且说出是哪一行；
 *   ② 已知缺口变多 ⇒ 必须红（缺口允许存在，但不许悄悄变多）；
 *   ③ 原样跑 ⇒ 绿，且把已知缺口逐条打印出来。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GATE = join(ROOT, ".harness/scripts/lint-edition-capabilities.mjs");
const CONTRACT = join(ROOT, "packages/contracts/src/deployment.ts");
const original = readFileSync(CONTRACT, "utf8");

afterEach(() => writeFileSync(CONTRACT, original));

function run(): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("node", [GATE], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

it("passes on the real matrix and names every known gap", () => {
  const r = run();
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain("已知缺口");
  for (const id of ["collaboration", "outbound-notifications", "export-to-organization"]) {
    expect(r.out).toContain(id);
  }
});

it("rejects a gated row whose enforcementRef cannot be found in the implementation", () => {
  writeFileSync(CONTRACT, original.replace(
    'enforcementRef: "select-image-provider-does-not-mention-this"',
    "IMPOSSIBLE",
  ).replace('enforcementRef: "image-generation"', 'enforcementRef: "no-such-symbol-anywhere-in-this-repo"'));
  const r = run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("image-generation");
  expect(r.out).toContain("搜不到");
});

it("rejects a new known gap that nobody accounted for", () => {
  // 把一个 gated 行降级成 declared-only：缺口从 4 变 5
  writeFileSync(CONTRACT, original.replace(
    '    enforcement: "gated",\n    enforcementRef: "error-log-ai-summary",',
    '    enforcement: "declared-only",\n    enforcementRef: null,',
  ));
  const r = run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("已知缺口数从 3 变成 4");
});

it("rejects a non-gated row that carries a ref nobody checks", () => {
  writeFileSync(CONTRACT, original.replace(
    '    enforcement: "by-construction",\n    enforcementRef: null,',
    '    enforcement: "by-construction",\n    enforcementRef: "KERNEL_MODEL_BASE_URL",',
  ));
  const r = run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("不该带 enforcementRef");
});
