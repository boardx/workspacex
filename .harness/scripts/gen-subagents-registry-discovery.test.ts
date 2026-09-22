import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { HARNESS_DIR } from "./lib/paths";
import { selectAgentSpecs, type AgentSpecDocument } from "./gen-subagents";

const AGENTS_DIR = join(HARNESS_DIR, "agents");

function realAgentDocuments(): AgentSpecDocument[] {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((file) => ({ file, parsed: parse(readFileSync(join(AGENTS_DIR, file), "utf8")) as unknown }));
}

/**
 * issue #399 的反证测试：`.harness/agents/` 里 registry.yaml 与真实 agent 规格
 * 躺在同一个目录，生成器按扩展名收文件就会把注册表当成一份 agent spec 解析，
 * 每次生成打一条假的「registry.yaml 缺少 name 字段，跳过」。
 *
 * 用真实目录（而不是自造 fixture）做数据平面：注册表哪天改名或多出一份非
 * agent 规格的 yaml，这条测试仍然钉得住——它钉的是"按 schema 选型"，不是
 * "排除某个文件名"。
 */
describe("gen-subagents 的 agent 规格选型（issue #399）", () => {
  it("真实 .harness/agents 目录里，registry.yaml 不产生任何警告", () => {
    const selection = selectAgentSpecs(realAgentDocuments());
    expect(selection.warnings).toEqual([]);
    expect(selection.skipped.map((s) => s.file)).toContain("registry.yaml");
  });

  it("registry.yaml 之外的每一份 yaml 仍然被认成 agent 规格（两种格式都照常生成）", () => {
    const documents = realAgentDocuments();
    const selection = selectAgentSpecs(documents);
    const skippedFiles = new Set(selection.skipped.map((s) => s.file));
    expect(selection.specs.map((s) => s.file)).toEqual(
      documents.map((d) => d.file).filter((f) => !skippedFiles.has(f)),
    );
    // 目录里确实同时存在注册表与真实规格，否则这条测试是空跑。
    expect(selection.specs.length).toBeGreaterThan(0);
    expect(skippedFiles.size).toBeGreaterThan(0);
    for (const { spec } of selection.specs) {
      expect(typeof spec.name === "string" && spec.name.length > 0).toBe(true);
    }
  });

  it("注册表混在 agent 规格中间时，只跳过注册表，真正缺 name 的规格仍然警告", () => {
    const selection = selectAgentSpecs([
      { file: "code-reviewer.yaml", parsed: { name: "code-reviewer", role: "code-reviewer" } },
      { file: "registry.yaml", parsed: { version: 1, developers: [], agents: [{ id: "coord-main" }] } },
      { file: "broken.yaml", parsed: { role: "worker" } },
    ]);
    expect(selection.specs.map((s) => s.file)).toEqual(["code-reviewer.yaml"]);
    expect(selection.skipped).toEqual([{ file: "registry.yaml", kind: "registry" }]);
    expect(selection.warnings).toEqual(["broken.yaml 缺少 name 字段，跳过"]);
  });
});
