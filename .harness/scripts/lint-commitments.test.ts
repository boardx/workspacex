/**
 * 承诺登记表对账门控自己的门。
 *
 * 这道门存在的起因是：方案里那张「承诺与门控对照表」自己就过时了——R2、R3 建好的门控
 * 在表里仍写着「未建」。所以第一条反例就是那个形状：脚本已存在、状态仍写未建，必须判红。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, ".harness/scripts/lint-commitments.mjs");
const dir = mkdtempSync(join(tmpdir(), "commitments-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SIX_OK = ["入口", "第一个价值时刻", "最大卡点", "承诺", "度量", "谁负责"].map((k) => `| ${k} | 有内容 |`).join("\n");
function doc(tableRows: string, personas: string): string {
  return `### 承诺与门控对照表\n\n| 承诺 | 门控 | 状态 |\n|---|---|---|\n${tableRows}\n\n## 4\n\n${personas}\n`;
}
let n = 0;
function run(md: string) {
  const f = join(dir, `d${n++}.md`);
  writeFileSync(f, md);
  return spawnSync("node", [SCRIPT, "--doc", f], { encoding: "utf8" });
}
const persona = (body = SIX_OK) => `### 4.1 某角色\n\n| 格 | 内容 |\n|---|---|\n${body}\n`;
// 用真实存在与真实不存在的脚本名，门控查的是 .harness/scripts 下是否有这个文件
const BUILT = "lint-vocabulary";
const MISSING = "lint-does-not-exist-anywhere";

describe("lint-commitments", () => {
  it("package.json 里有这条脚本，且接进了 verify:harness:raw", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint:commitments"]).toContain("lint-commitments.mjs");
    expect(pkg.scripts["verify:harness:raw"]).toContain("lint:commitments");
  });

  it("真实方案文档对账通过", () => {
    expect(execFileSync("node", [SCRIPT], { encoding: "utf8" })).toMatch(/问题 0 处/);
  });

  it("对照组：状态与脚本一致、六格齐全 ⇒ 绿", () => {
    expect(run(doc(`| a | \`${BUILT}\` | 已建 |\n| b | \`${MISSING}\` | 未建 |`, persona())).status).toBe(0);
  });

  it("① 表过时：脚本已存在，状态仍写未建 ⇒ 红（本门控存在的起因）", () => {
    const r = run(doc(`| a | \`${BUILT}\` | 未建 |`, persona()));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("表过时");
  });

  it("① 虚报：状态写已建，脚本不存在 ⇒ 红", () => {
    const r = run(doc(`| a | \`${MISSING}\` | 已建 |`, persona()));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("虚报");
  });

  it("① 没写脚本名却声称已建 ⇒ 红（无从核对）；不声称已建的放行", () => {
    expect(run(doc("| a | 边界检查 | 已建 |", persona())).status).toBe(1);
    expect(run(doc("| a | 自动统计 | 不可阻断，只能统计 |", persona())).status).toBe(0);
  });

  it("② 缺一格 ⇒ 红", () => {
    const r = run(doc(`| a | \`${BUILT}\` | 已建 |`, persona(SIX_OK.split("\n").slice(0, 5).join("\n"))));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("缺「谁负责」");
  });

  it("② 写「待定」⇒ 红；写「未定（理由）」⇒ 放行并计为显式缺口", () => {
    const blank = SIX_OK.replace("| 谁负责 | 有内容 |", "| 谁负责 | 待定 |");
    expect(run(doc(`| a | \`${BUILT}\` | 已建 |`, persona(blank))).status).toBe(1);
    const explicit = SIX_OK.replace("| 谁负责 | 有内容 |", "| 谁负责 | 未定（组织决策，待人指定） |");
    const r = run(doc(`| a | \`${BUILT}\` | 已建 |`, persona(explicit)));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/显式缺口 1 处/);
  });

  it("② 格名带括注仍算数：「承诺（对内）」即「承诺」", () => {
    const withNote = SIX_OK.replace("| 承诺 | 有内容 |", "| 承诺（对内） | 有内容 |");
    expect(run(doc(`| a | \`${BUILT}\` | 已建 |`, persona(withNote))).status).toBe(0);
  });

  it("② 整节显式暂缓 ⇒ 放行并计数", () => {
    const r = run(doc(`| a | \`${BUILT}\` | 已建 |`, "### 4.1 H2 角色\n\n> 六格暂不设计：H2 才进入\n"));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/显式暂缓 1/);
  });

  it("空表 / 没有角色 ⇒ 不许判绿", () => {
    expect(run(doc("", persona())).status).toBe(1);
    expect(run(doc(`| a | \`${BUILT}\` | 已建 |`, "")).status).toBe(1);
  });
});
