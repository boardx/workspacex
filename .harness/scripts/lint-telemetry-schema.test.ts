/**
 * 上报 schema 门控自己的门：它得真的被跑到，也得真的会红。
 *
 * 四条规则各造一个反例 schema，要求逐一判红；另测真实契约是干净的、叶子数不是 0。
 * 反例 schema 写在临时目录里，从契约包按绝对路径引入 zod（仓库根没有装 zod）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-telemetry-schema.mjs");
const ZOD = pathToFileURL(join(realpathSync(join(ROOT, "packages/contracts/node_modules/zod")), "index.js")).href;
const dir = mkdtempSync(join(tmpdir(), "telemetry-schema-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function check(body: string) {
  const file = join(dir, `s${n++}.mjs`);
  writeFileSync(file, `import { z } from "${ZOD}";\nexport const S = ${body};\n`);
  return spawnSync("pnpm", ["exec", "tsx", SCRIPT, "--module", file, "--export", "S"], { cwd: ROOT, encoding: "utf8" });
}

// 每条用例都起 tsx 子进程（约 0.9 秒一个），第 ② 条起四个；默认 5 秒超时在慢机器上会假红
describe("lint-telemetry-schema", { timeout: 30_000 }, () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:telemetry-schema"]).toMatch(/tsx .*lint-telemetry-schema\.mjs/);
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:telemetry-schema");
  });

  it("真实契约是干净的，且确实遍历到了叶子字段", () => {
    const out = execFileSync("pnpm", ["exec", "tsx", SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(out).toMatch(/违规 0 处/);
    expect(out).not.toMatch(/叶子字段 0 个/);
  });

  it("默认目标覆盖第一个价值时刻的两层 schema（backlog E1）", () => {
    const out = execFileSync("pnpm", ["exec", "tsx", SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(out).toMatch(/FirstValueLocalFact，叶子字段 [1-9]\d* 个，违规 0 处/);
    expect(out).toMatch(/FirstValueFunnelCounts，叶子字段 [1-9]\d* 个，违规 0 处/);
  });

  it("对照组：全是受约束字段的 strict 对象判绿", () => {
    expect(check(`z.object({ count: z.number().int(), code: z.string().regex(/^[A-Z]+$/), kind: z.enum(["a","b"]) }).strict()`).status).toBe(0);
  });

  it("① 不受约束的字符串 ⇒ 红（自由文本能装下客户的一句话）", () => {
    const r = check(`z.object({ errorCode: z.string().max(64) }).strict()`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("字符串不受约束");
  });

  it("② 字段名像个人信息 ⇒ 红（驼峰拆开后按词匹配）", () => {
    for (const key of ["userName", "contactEmail", "ownerPhone", "messageCount"]) {
      const r = check(`z.object({ ${key}: z.number() }).strict()`);
      expect(r.status, key).toBe(1);
    }
  });

  it("③ 对象没有 .strict() ⇒ 红（多出的字段会被悄悄丢掉）", () => {
    const r = check(`z.object({ count: z.number() })`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("未 .strict()");
  });

  it("③ Record 的键是任意字符串 ⇒ 红（等于没有白名单）", () => {
    expect(check(`z.object({ counts: z.record(z.number()) }).strict()`).status).toBe(1);
  });

  it("④ 数组没有上限 ⇒ 红", () => {
    const r = check(`z.object({ xs: z.array(z.number()) }).strict()`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("数组无上限");
  });

  it("嵌在 optional / superRefine / 数组里的违规也找得到", () => {
    const r = check(`z.object({ a: z.object({ xs: z.array(z.object({ note: z.number() }).strict()).max(3) }).strict().optional() }).strict().superRefine(() => {})`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.xs[].note");
  });
});
