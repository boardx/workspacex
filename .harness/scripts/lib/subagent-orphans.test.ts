import { describe, it, expect } from "vitest";
import { findOrphanArtifacts } from "./subagent-orphans";

describe("findOrphanArtifacts", () => {
  it("源与生成物一一对应时没有发现", () => {
    expect(
      findOrphanArtifacts({
        expectedNames: ["rev-uiux", "coord-main"],
        claudeFiles: ["rev-uiux.md", "coord-main.md"],
        codexFiles: ["rev-uiux.toml", "coord-main.toml"],
      }),
    ).toEqual([]);
  });

  it("源 yaml 被删掉后，两种格式的残留生成物都被认成孤儿", () => {
    // 这正是 2026-09-09 实测到的漏洞现场：删掉 .harness/agents/rev-uiux.yaml，
    // 重新生成后 .claude/agents/rev-uiux.md 与 .codex/agents/rev-uiux.toml 仍在，
    // 而 `git diff --exit-code` 依旧干净。
    expect(
      findOrphanArtifacts({
        expectedNames: ["coord-main"],
        claudeFiles: ["rev-uiux.md", "coord-main.md"],
        codexFiles: ["rev-uiux.toml", "coord-main.toml"],
      }),
    ).toEqual([
      { path: ".claude/agents/rev-uiux.md", name: "rev-uiux" },
      { path: ".codex/agents/rev-uiux.toml", name: "rev-uiux" },
    ]);
  });

  it("不认领本生成器以外的扩展名，免得误删别人的文件", () => {
    expect(
      findOrphanArtifacts({
        expectedNames: [],
        claudeFiles: ["README.txt", ".gitkeep", "notes.json"],
        codexFiles: ["README.md"],
      }),
    ).toEqual([]);
  });

  it("生成目录为空时不报任何孤儿", () => {
    expect(
      findOrphanArtifacts({ expectedNames: ["a"], claudeFiles: [], codexFiles: [] }),
    ).toEqual([]);
  });
});
