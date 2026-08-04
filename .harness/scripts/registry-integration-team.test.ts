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
  /**
   * 2026-08-04 人类裁决：六个 worker/reviewer 条目**没有任何在跑的会话**，
   * 全部标为 `active: false`。原断言写死 `active: true`，直接撞红。
   *
   * **没有把 true 改成 false 了事**——那只是把一个写死的值换成另一个写死的值，
   * 门控强度不变。改为：形态断言与「在编」解耦（不论在不在编，Directory 绑定
   * 与无审查/合并权这些形态约束都必须成立），另立一条**显式在编名单**断言，
   * 让任何启用/停用都必须是一次经过 review 的刻意改动，而不是随手翻个 flag。
   */
  it("keeps every Phase-01 identity well-formed whether or not it is currently staffed", () => {
    for (const id of workerIds) {
      const entry = registry.agents.find((candidate) => candidate.id === id);
      expect(entry, id).toMatchObject({ kind: "worker", owner });
      expect(typeof entry?.active, `${id} 的 active 必须是布尔值`).toBe("boolean");
      expect(entry?.directory_agent_id, id).toMatch(/^agt_[0-9A-Z]+$/);
      expect(entry?.required_for, id).toBeUndefined();
      expect(entry?.emits, id).toBeUndefined();
    }
  });

  /**
   * 在编名单是单一事实源：改它必须过 review。
   * 这条比原来的 `active: true` 强——原断言只管四个 worker 是不是 true，
   * 有人新增一个 active 条目、或悄悄停用某个协调者，它都不会红。
   */
  it("pins the staffed roster so activation is always a reviewed decision", () => {
    const staffed = allEntries().filter((entry) => entry.active).map((entry) => entry.id).sort();
    expect(staffed, `在编名单变了就必须在 PR 里说明理由，实得 ${staffed.join(", ")}`).toEqual([
      "coord-agent-auth",
      "coord-architecture",
      "coord-chat-e2e",
      "coord-main",
    ]);
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
    // 2026-08-04 第三版：校验集合不再硬编码 `workerIds`。reviewer 实测——新增一条
    // `dev-rogue`（kind: worker, reports_to: no-such-coordinator）不在硬编码列表里，
    // 于是**完全不受任何检查**（5 passed）。本用例声称的是 registry 级不变量，
    // 就不能只对四个写死的 id 成立。改为动态遍历所有 kind==="worker" 的条目。
    // （`workerIds` 仍保留给上一个用例，那条断言的是「#407 最小团队这四位必须存在
    //   且形态正确」，是另一件事，不该合并。）
    // 2026-08-04 第四版。第三版遍历「所有 kind==='worker' 的条目」，在**扁平拓扑**
    // 下留了一个真洞：没有任何 worker 挂在 coord-agent-auth 下面之后，就没有任何
    // 链会经过它，于是**协调者自己的 reports_to 永远不被校验**。
    // 反证 F（coord-agent-auth.reports_to → dev-auth，制造一个环）在第三版下 7 passed。
    // 改为遍历**每一个有 reports_to 的条目**——这才是「所有汇报边都合法」的
    // 完整不变量，与拓扑形状（扁平/多级）无关。
    const everyReportingId = allEntries().filter((e) => e.reports_to).map((e) => e.id);
    expect(everyReportingId, "除 coord-main 外每个条目都应有 reports_to").toEqual(
      expect.arrayContaining(allEntries().filter((e) => e.id !== "coord-main").map((e) => e.id)),
    );

    for (const id of everyReportingId) {
      const chain = reportingChain(id);
      expect(chain.at(-1), `${id} 的汇报链必须收敛到 coord-main，实得 ${chain.join(" → ")}`).toBe("coord-main");

      // 2026-08-04 第三版。前两版都只检查 `parent` 这**一跳**，链上其余各跳仅被
      // 「链尾是 coord-main」覆盖 —— 于是可以把一个 kind: worker 插进链中段而全绿
      // （反证 E：coord-agent-auth.reports_to → dev-ai-runtime，链
      //  dev-auth → coord-agent-auth → dev-ai-runtime → coord-main，第二版 4 passed）。
      // 本用例的名字写的就是 "through covering coordinators"——复数、链级，
      // 实现却是单跳。现改为逐跳校验：chain 里每一个**非终点**节点都必须
      // 是协调者，且其 areas 必须覆盖它下面那一跳的 areas。
      for (let hop = 0; hop < chain.length - 1; hop += 1) {
        const childId = chain[hop]!;
        const supervisorId = chain[hop + 1]!;
        const child = byId(childId)!;
        const supervisor = byId(supervisorId);

        expect(supervisor, `${childId} 的上级 "${supervisorId}" 必须是 registry 里真实存在的条目`).toBeDefined();
        expect(
          COORDINATOR_KINDS.has(supervisor!.kind),
          `汇报链 ${chain.join(" → ")} 的中段 "${supervisorId}" kind=${supervisor!.kind} 不是协调者`,
        ).toBe(true);

        // 覆盖检查按 areas 本身判定，不按 kind —— 第一版写成
        // `if (kind === "module-coordinator")`，于是 architecture-coordinator
        // 虽然 areas 有界却完全不受约束（反证 ④：dev-chat-e2e → coord-architecture，
        // 原断言红、第一版绿 ⇒ 净变弱）。只有全域协调者（areas 含 "*"）豁免。
        const supervisorAreas = supervisor!.areas ?? [];
        if (!supervisorAreas.includes("*")) {
          for (const area of child.areas ?? []) {
            expect(
              supervisorAreas,
              `${supervisorId}（kind=${supervisor!.kind}）的 areas 必须覆盖下属 ${childId} 的 "${area}"`,
            ).toContain(area);
          }
        }
      }
    }
  });

  /**
   * reviewer 建议项，一并堵上：`reportingChain` 用 `seen` 截断环后取链尾，
   * 对「**不含** coord-main 的环」会红（链尾非 coord-main），但对「**含**
   * coord-main 的病态环」（有人把 coord-main.reports_to 指回某个 worker）
   * 链尾恰好是 coord-main，会漏判为绿。原断言同样漏（它根本不校验 coord-main
   * 自身），故不算本次回退，但顶点悬空是廉价且确定的检查，顺手做掉。
   */
  it("keeps the coordination vertex rootless so coord-main cannot be pulled into a cycle", () => {
    const root = byId("coord-main");
    expect(root, "coord-main 必须存在").toBeDefined();
    expect(root!.kind, "coord-main 必须是顶层 coordinator").toBe("coordinator");
    expect(root!.reports_to, "coord-main 是汇报链顶点，reports_to 必须为空").toBeUndefined();
  });

  /**
   * reviewer 方向 2：覆盖检查对 `areas` 含 `"*"` 的上级一律豁免（这是对的——
   * 全域协调者本就管所有人）。但**谁有资格是全域**此前没有门控：把
   * `coord-architecture.areas` 改成 `["*"]`，它就能豁免覆盖任何下属。
   * 全域是「合并权唯一把关人」的同位概念，只能属于 coord-main。
   */
  it("reserves the wildcard area for coord-main alone", () => {
    const wildcards = allEntries().filter((e) => (e.areas ?? []).includes("*")).map((e) => e.id);
    expect(wildcards, `areas 含 "*" 的只能是 coord-main，实得 ${wildcards.join(", ") || "（无）"}`).toEqual(["coord-main"]);
  });

  it("keeps reviewers in the reviewer route and preserves one coordinator", () => {
    for (const id of reviewerIds) {
      const entry = registry.reviewers.find((candidate) => candidate.id === id);
      // 同上：形态与「在编」解耦。reviewer 停用与否由上面的在编名单断言把关，
      // 这里只管它一旦存在就必须形态正确（reviewer 路由、直报 coord-main、有 verdict 出口）。
      expect(entry, id).toMatchObject({ kind: "reviewer", owner, reports_to: "coord-main" });
      expect(typeof entry?.active, `${id} 的 active 必须是布尔值`).toBe("boolean");
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
