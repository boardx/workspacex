import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileRepositoryGraph } from "./graph-compiler";
import { loadGraphRegistry } from "./graph-registry";
import { serializeGraphSnapshot } from "./graph-stable";
import { validateGraph } from "./graph-validator";
import { REPO_ROOT } from "./paths";

describe("Graph Kernel real repository", () => {
  it("真实权威源可确定性编译且通过首阶段约束", () => {
    const first = compileRepositoryGraph(REPO_ROOT, "fixed-revision");
    const second = compileRepositoryGraph(REPO_ROOT, "fixed-revision");
    expect(serializeGraphSnapshot(first)).toBe(serializeGraphSnapshot(second));
    expect(first.nodes.length).toBeGreaterThan(1_000);
    expect(first.edges.length).toBeGreaterThan(1_000);
    expect(validateGraph(first, loadGraphRegistry(REPO_ROOT))).toEqual([]);
  });

  it("Graph Snapshot 缓存路径确实被 Git 排除", () => {
    const cachePath = join(REPO_ROOT, ".harness", "state", ".cache", "graph", "current.snapshot.json");
    const ignored = execFileSync("git", ["check-ignore", "--no-index", cachePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    expect(ignored).toBe(cachePath);
  });
});
