import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";

interface RegistryEntry {
  id: string;
  active: boolean;
  kind: string;
  owner?: string;
  areas?: string[];
  reports_to?: string;
  directory_agent_id?: string;
  required_for?: string[];
  emits?: string;
}

interface Registry {
  agents: RegistryEntry[];
  reviewers: RegistryEntry[];
}

const registry = parse(
  readFileSync(join(REPO_ROOT, ".harness", "agents", "registry.yaml"), "utf8"),
) as Registry;

const workerIds = ["dev-platform-baseline", "dev-auth", "dev-ai-runtime", "dev-chat-e2e"];
const reviewerIds = ["rev-feature", "rev-e2e"];
const owner = "2325074+usamshen@users.noreply.github.com";

const COORDINATOR_KINDS = new Set(["coordinator", "module-coordinator", "architecture-coordinator"]);
const allEntries = () => [...registry.agents, ...registry.reviewers];
const byId = (id: string) => allEntries().find((entry) => entry.id === id);

/**
 * 汇报链解析：从 `id` 沿 reports_to 一路向上，返回走过的节点 id。
 * 环会被 seen 截断（返回值里不会出现重复 id），由调用方断言链尾是 coord-main。
 */
function reportingChain(id: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = byId(cursor)?.reports_to;
  }
  return chain;
}

describe("#407 minimal integration team registry projection", () => {
  it("projects four Directory-backed identities as workers without review or merge authority", () => {
    for (const id of workerIds) {
      const entry = registry.agents.find((candidate) => candidate.id === id);
      expect(entry, id).toMatchObject({ active: true, kind: "worker", owner });
      expect(entry?.directory_agent_id, id).toMatch(/^agt_[0-9A-Z]+$/);
      expect(entry?.required_for, id).toBeUndefined();
      expect(entry?.emits, id).toBeUndefined();
    }
  });

  /**
   * 2026-08-04 修订（原文硬编码 `reports_to: "coord-main"`）。
   *
   * 原断言把 #407 的**扁平**拓扑钉死，导致引入 module-coordinator 时必然撞红。
   * 直接删掉那半句是拆门；这里改为断言拓扑的**实质不变量**，比原来更强：
   *   ① worker 的 reports_to 必须解析到一个真实存在、且 kind 属协调者的条目
   *      （原断言只比对字符串，写个不存在的 id 也照样绿）；
   *   ② 上级若是 module-coordinator，它的 areas 必须覆盖该 worker 的 areas
   *      —— 防止把 worker 挂到一个管不着它的模块协调者下面；
   *   ③ 汇报链必须**收敛到 coord-main**，不允许环、不允许悬空
   *      —— 这才是「合并权唯一把关人」不变量的真正内容（SOP 二级架构章节：
   *      module-coordinator 无合并权，全绿 PR 转交 coord-main）。
   */
  it("resolves every worker's reporting chain to coord-main through covering coordinators", () => {
    for (const id of workerIds) {
      const entry = byId(id);
      const parentId = entry?.reports_to;
      expect(parentId, `${id} 必须有 reports_to`).toBeTruthy();

      const parent = byId(parentId!);
      expect(parent, `${id} 的上级 "${parentId}" 必须是 registry 里真实存在的条目`).toBeDefined();
      expect(COORDINATOR_KINDS.has(parent!.kind), `${id} 的上级 "${parentId}" kind=${parent!.kind} 不是协调者`).toBe(true);

      if (parent!.kind === "module-coordinator") {
        for (const area of entry!.areas ?? []) {
          expect(parent!.areas ?? [], `${parentId} 的 areas 必须覆盖下属 ${id} 的 "${area}"`).toContain(area);
        }
      }

      const chain = reportingChain(id);
      expect(chain.at(-1), `${id} 的汇报链必须收敛到 coord-main，实得 ${chain.join(" → ")}`).toBe("coord-main");
    }
  });

  it("keeps reviewers in the reviewer route and preserves one coordinator", () => {
    for (const id of reviewerIds) {
      const entry = registry.reviewers.find((candidate) => candidate.id === id);
      expect(entry, id).toMatchObject({ active: true, kind: "reviewer", owner, reports_to: "coord-main" });
      expect(entry?.directory_agent_id, id).toMatch(/^agt_[0-9A-Z]+$/);
      expect(entry?.required_for?.length, id).toBeGreaterThan(0);
      expect(entry?.emits, id).toMatch(/^review:/);
    }

    const all = [...registry.agents, ...registry.reviewers];
    expect(all.filter((entry) => entry.kind === "coordinator").map((entry) => entry.id)).toEqual(["coord-main"]);
    expect(new Set(all.flatMap((entry) => entry.directory_agent_id ?? [])).size).toBe(6);
  });

  it("reuses exactly the eight neutral agent specs", () => {
    const specs = readdirSync(join(REPO_ROOT, ".harness", "agents"))
      .filter((file) => file.endsWith(".yaml") && file !== "registry.yaml")
      .sort();
    expect(specs).toEqual([
      "code-reviewer.yaml",
      "codebase-researcher.yaml",
      "e2e-verifier.yaml",
      "feature-evaluator.yaml",
      "quality-auditor.yaml",
      "requirement-author.yaml",
      "test-runner.yaml",
      "ui-prototyper.yaml",
    ]);
  });
});
