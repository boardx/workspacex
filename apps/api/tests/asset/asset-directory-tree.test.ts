/**
 * F141 -- `buildAssetDirectory` (`uc-23-3` R3 步骤 2, R12-1/2/4).
 *
 * Pure function, no Postgres -- safe to run in full locally (issue #74).
 *
 * `SK_TREE` / `AG_TREE` below are the prototype's two file lists, verbatim path order
 * (`uc-23-3` R3 步骤 2 的表；同一份路径清单也是 `FixtureAssetFileRepository` 用的那份，
 * 这里不复述其字节数，只断言**形状**：目录节点、深度、`isRoot`、徽标）。
 */
import { describe, expect, it } from "vitest";
import { buildAssetDirectory, type AssetFileEntry } from "../../src/domain/asset/asset-directory";

const SK_TREE: readonly AssetFileEntry[] = [
  { path: "SKILL.md", sizeBytes: 2150 },
  { path: "references/output-schema.md", sizeBytes: 800 },
  { path: "references/question-bank.md", sizeBytes: 1400 },
  { path: "assets/tree-template.canvas.md", sizeBytes: 600 },
  { path: "scripts/validate.py", sizeBytes: 1200 },
];

const AG_TREE: readonly AssetFileEntry[] = [
  { path: "AGENT.md", sizeBytes: 1800 },
  { path: "prompts/system.md", sizeBytes: 3200 },
  { path: "prompts/reflection.md", sizeBytes: 900 },
  { path: "tools/tools.json", sizeBytes: 1100 },
  { path: "evals/regression.jsonl", sizeBytes: 2600 },
];

describe("buildAssetDirectory -- Skill (SK_TREE, R12-1)", () => {
  const out = buildAssetDirectory("SKILL.md", SK_TREE);

  it("5 个文件、3 个目录节点（references / assets / scripts）", () => {
    const fileNodes = out.tree.filter((n) => n.kind === "file");
    const dirNodes = out.tree.filter((n) => n.kind === "dir");
    expect(fileNodes.length).toBe(5);
    expect(dirNodes.map((n) => n.path).sort()).toEqual(["assets", "references", "scripts"]);
  });

  it("files 集合逐一等于输入路径（不多不少）", () => {
    expect(out.files.map((f) => f.path).sort()).toEqual([...SK_TREE.map((e) => e.path)].sort());
  });

  it("R12-4：目录行（本函数没有 sizeBytes 字段可比）不出现在 files 里；文件行都带 sizeBytes", () => {
    // `files` is file-only by construction -- there is no dir-with-a-size to accidentally emit.
    for (const f of out.files) expect(typeof f.sizeBytes).toBe("number");
    expect(out.tree.filter((n) => n.kind === "dir").length).toBeGreaterThan(0);
  });

  it("SKILL.md 是 rootFile 且 isRoot=true；其余四个 isRoot=false", () => {
    const root = out.files.find((f) => f.path === "SKILL.md")!;
    expect(root.isRoot).toBe(true);
    expect(out.files.filter((f) => f.isRoot).length).toBe(1);
    expect(out.rootFile).toBe("SKILL.md");
  });

  it("徽标：.py → PY，其余四个 .md → MD（R7 规则 4）", () => {
    const badgeOf = (p: string) => out.files.find((f) => f.path === p)!.badge;
    expect(badgeOf("scripts/validate.py")).toBe("PY");
    expect(badgeOf("SKILL.md")).toBe("MD");
    expect(badgeOf("references/output-schema.md")).toBe("MD");
    expect(badgeOf("assets/tree-template.canvas.md")).toBe("MD");
  });

  it("目录节点深度为 0（顶层目录），文件深度按其所在目录层数", () => {
    const referencesDir = out.tree.find((n) => n.kind === "dir" && n.path === "references")!;
    expect(referencesDir.depth).toBe(0);
    const nestedFile = out.tree.find((n) => n.path === "references/output-schema.md")!;
    expect(nestedFile.depth).toBe(1);
    const rootFileNode = out.tree.find((n) => n.path === "SKILL.md")!;
    expect(rootFileNode.depth).toBe(0);
  });
});

describe("buildAssetDirectory -- Agent (AG_TREE, R12-2)", () => {
  const out = buildAssetDirectory("AGENT.md", AG_TREE);

  it("5 个文件、3 个目录节点（prompts / tools / evals）", () => {
    const fileNodes = out.tree.filter((n) => n.kind === "file");
    const dirNodes = out.tree.filter((n) => n.kind === "dir");
    expect(fileNodes.length).toBe(5);
    expect(dirNodes.map((n) => n.path).sort()).toEqual(["evals", "prompts", "tools"]);
  });

  it("AGENT.md 是唯一 root；tools.json/regression.jsonl 徽标为 JSON/JSONL", () => {
    expect(out.files.filter((f) => f.isRoot).map((f) => f.path)).toEqual(["AGENT.md"]);
    expect(out.files.find((f) => f.path === "tools/tools.json")!.badge).toBe("JSON");
    expect(out.files.find((f) => f.path === "evals/regression.jsonl")!.badge).toBe("JSONL");
  });

  it("prompts/ 目录下恰有两个文件（system.md, reflection.md）", () => {
    const underPrompts = out.files.filter((f) => f.path.startsWith("prompts/"));
    expect(underPrompts.map((f) => f.path).sort()).toEqual(["prompts/reflection.md", "prompts/system.md"]);
  });
});

describe("buildAssetDirectory -- 反证套件", () => {
  it("R-1 空目录（只有根文件）：0 个目录节点，1 个文件节点", () => {
    const out = buildAssetDirectory("SKILL.md", [{ path: "SKILL.md", sizeBytes: 10 }]);
    expect(out.tree.filter((n) => n.kind === "dir")).toEqual([]);
    expect(out.tree.filter((n) => n.kind === "file").length).toBe(1);
  });

  it("R-2 两层嵌套目录各自只登记一次，即使多个文件共享同一祖先目录", () => {
    const out = buildAssetDirectory("SKILL.md", [
      { path: "SKILL.md", sizeBytes: 10 },
      { path: "references/a.md", sizeBytes: 1 },
      { path: "references/b.md", sizeBytes: 1 },
      { path: "references/nested/c.md", sizeBytes: 1 },
    ]);
    const dirPaths = out.tree.filter((n) => n.kind === "dir").map((n) => n.path);
    expect(dirPaths).toEqual(["references", "references/nested"]);
  });

  it("R-3 若把某个真实文件漏进 files（模拟一个只多显示了几个文件的实现），5≠6 会被这条断言抓到", () => {
    const out = buildAssetDirectory("SKILL.md", SK_TREE);
    // A "list shows one extra phantom file" bug would make this fail, catching exactly the
    // shortfall the contract's I-6 note warns about (over-reporting the served set).
    expect(out.files.length).toBe(SK_TREE.length);
  });
});
