/**
 * lint-work-stack-graph.mjs 的反证套件（#4534）。
 *
 * 每条判定先证明会红，再证明合规写法是绿；空集（读不到 / 0 行）必须红。
 * fixture 用 2/1/1 的缩小规模：EXPECTED 由调用方覆盖不现实，所以 fixture 生成完整 ID 段。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明
import { lint, parseVerdict, PACKAGE_DIR, EXPECTED } from "./lint-work-stack-graph.mjs";

const pad = (n: number) => String(n).padStart(3, "0");
const range = (p: string) => Array.from({ length: (EXPECTED as Record<string, number>)[p] }, (_, i) => `${p}${pad(i + 1)}`);

function fixture(opts: { dropW?: string; badRef?: boolean; files?: Record<string, string>; noManifest?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "wsg-"));
  const dir = join(root, PACKAGE_DIR);
  mkdirSync(dir, { recursive: true });
  const all = [...range("S"), ...range("W"), ...range("D")];
  if (!opts.noManifest) {
    writeFileSync(join(dir, "AUTHORING-TASK-MANIFEST.json"), JSON.stringify({
      counts: { skills: 200, workflows: 60, digitalHumans: 60 },
      authorTaskIds: all.map((e) => ({ task: `AUTHOR-${e}`, entity: e })),
    }));
  }
  const w = range("W").filter((id) => id !== opts.dropW)
    .map((id) => `| ${id} | X | Shared | S002${opts.badRef && id === "W001" ? ", S999" : ""} |`).join("\n");
  writeFileSync(join(dir, "WORKFLOW-SKILL-MATRIX.md"), `| ID | Workflow | Domain | Exact Skills |\n|---|---|---|---|\n${w}\n`);
  const d = range("D").map((id) => `| ${id} | R | W001 | S003 | — |`).join("\n");
  writeFileSync(join(dir, "DIGITALHUMAN-COMPOSITION-MATRIX.md"), `| ID | DH | W | S | gaps |\n|---|---|---|---|---|\n${d}\n`);
  for (const [rel, body] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return root;
}

describe("lint-work-stack-graph", () => {
  it("合规 fixture 为绿，并报告孤儿 Skill 但不判红", () => {
    const r = lint(fixture());
    expect(r.errors).toEqual([]);
    expect(r.orphans).toContain("S001");
    expect(r.orphans).not.toContain("S002");
  });

  it("清单缺失 ⇒ 红（空集防线）", () => {
    expect(lint(fixture({ noManifest: true })).errors.join()).toMatch(/缺少 .*AUTHORING-TASK-MANIFEST/);
  });

  it("Workflow 缺行 ⇒ 红", () => {
    expect(lint(fixture({ dropW: "W007" })).errors.join()).toMatch(/缺少 W007 的行/);
  });

  it("引用不存在的 Skill ⇒ 红", () => {
    expect(lint(fixture({ badRef: true })).errors.join()).toMatch(/W001 引用不存在的 S999/);
  });

  it("已作者化但没有消费者的 Skill ⇒ 红", () => {
    const r = lint(fixture({ files: { "skills/S001-profile.md": "# S001" } }));
    expect(r.errors.join()).toMatch(/S001-profile\.md：Skill 在组合图上没有/);
  });

  it("评审缺 verdict 或实体文档不存在 ⇒ 红；合法评审计入", () => {
    const bad = lint(fixture({ files: { "reviews/S002.review.md": "no verdict" } }));
    expect(bad.errors.join()).toMatch(/实体文档不存在/);
    expect(bad.errors.join()).toMatch(/缺少合法 verdict/);
    const good = lint(fixture({ files: { "skills/S002-x.md": "# S002", "reviews/S002.review.md": "Verdict: PASS\n" } }));
    expect(good.errors).toEqual([]);
    expect(good.verdicts.get("S002")).toBe("PASS");
  });

  it("parseVerdict 只认五种结论", () => {
    expect(parseVerdict("**Verdict**: REWRITE")).toBe("REWRITE");
    expect(parseVerdict("verdict: MAYBE")).toBeNull();
  });
});
