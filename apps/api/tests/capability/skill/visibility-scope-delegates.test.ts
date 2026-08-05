/**
 * #459 · **`isSkillVisibleTo` 必须委托 `decideCapabilityVisibility`，不得自己比字段。**
 *
 * coord-main 裁决 `decideCapabilityVisibility` 为可见性判定的单一事实源
 * （信息量单向可导 ＋ 它那侧有机械门控 `lint-permission-paths`）。本文件是那条裁决的
 * **机械门控**——没有脚本的规范条目视为未落地（AGENTS.md 逐字）。
 *
 * ## 三组断言
 *
 *   ① **行为等价**：穷举 `visibility × ownerTeamId × requesterTeamId` 全部组合，
 *      委托实现与改名前那三行的语义**逐点相同**。收敛不许顺手改语义。
 *   ② **结构**：`visibility-scope.ts` 里不再出现对那三个字段的比较。
 *   ③ **图可达性**：`decide()` 所在的模块从 `visibility-scope.ts` **可达**，
 *      且**最短距离恰好是 2**（经 `capability-listing.ts`）。
 *
 * ## ⚠ 为什么 ③ 要连「距离＝2」一起断言
 *
 * 一个只匹配**直接 import** 的断言，在本例里**照样会绿**（`visibility-scope.ts`
 * 确实直接 import 了 `capability-listing.ts`）。也就是说「它红了」并不能证明
 * 「它是传递闭包」——#465 的实现者当时特意做了**一跳与两跳两次反证**，就是为了
 * 排除这一点。本文件照做：下面 `反证` 一节用两个合成图证明走图器**真的会传递**，
 * 而不是在做直接 import 的字符串匹配。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSkillVisibleTo } from "../../../src/domain/skill/visibility-scope";

const SRC = join(process.cwd(), "src");
const SUBJECT = "domain/skill/visibility-scope.ts";
const DELEGATE = "domain/identity/capability-listing.ts";
/** `decide()` 的家。只能经 `capability-listing.ts` 到达，够不着就是没委托。 */
const DECISION_CORE = "domain/identity/permission-decision.ts";

/* ─────────────────────────── 走图器 ─────────────────────────── */

/** 一个模块 → 它 import 的本仓模块（相对 `src` 的路径）。 */
type Graph = ReadonlyMap<string, readonly string[]>;

/** 去掉注释——否则解释规则的那段注释会自己把门控点红（同 lint 脚本的既有豁免）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function localImportsOf(moduleId: string): readonly string[] {
  const source = stripComments(readFileSync(join(SRC, moduleId), "utf8"));
  const out: string[] = [];
  const re = /(?:from|import)\s*["']([^"']+)["']/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const spec = m[1];
    if (spec === undefined || !spec.startsWith(".")) continue; // 裸包名不进图
    const dir = moduleId.split("/").slice(0, -1);
    const parts = [...dir];
    for (const seg of spec.split("/")) {
      if (seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    out.push(`${parts.join("/")}.ts`);
  }
  return out;
}

/** 真实源码图（惰性展开，只走到得着的部分）。 */
function realGraph(entry: string): Graph {
  const graph = new Map<string, readonly string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (graph.has(id)) continue;
    let imports: readonly string[] = [];
    try {
      imports = localImportsOf(id);
    } catch {
      imports = []; // 解析不到的（.json / 目录索引）当叶子，不让走图器假装走过
    }
    graph.set(id, imports);
    queue.push(...imports);
  }
  return graph;
}

/**
 * **被测的那个走图器**：广度优先，返回 `模块 → 最短跳数`。
 *
 * ⚠ 下面 `反证` 一节喂给它两个合成图，证明它**传递**——
 *   一个只看 `graph.get(entry)` 的实现会在两跳那个 fixture 上失败。
 */
function reachable(graph: Graph, entry: string): ReadonlyMap<string, number> {
  const dist = new Map<string, number>([[entry, 0]]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = dist.get(id)!;
    for (const next of graph.get(id) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** 只看直接 import 的**参照实现**。它存在的唯一目的是被证明「不够用」。 */
function directImportsOnly(graph: Graph, entry: string): ReadonlySet<string> {
  return new Set(graph.get(entry) ?? []);
}

/* ─────────────── ① 行为等价：穷举，不抽样 ─────────────── */

/** 改名前 `visibility-scope.ts` 里那三行，逐字保留，作为等价性的**参照物**。 */
function legacyIsSkillVisibleTo(input: {
  visibility: "org-wide" | "team-only";
  ownerTeamId: string | null;
  requesterTeamId: string | null;
}): boolean {
  if (input.visibility === "org-wide") return true;
  if (input.ownerTeamId === null || input.requesterTeamId === null) return false;
  return input.ownerTeamId === input.requesterTeamId;
}

describe("① 委托后的语义与改名前逐点相同（穷举）", () => {
  const visibilities = ["org-wide", "team-only"] as const;
  const teams = [null, "team-a", "team-b"] as const;

  it("2 × 3 × 3 = 18 种组合全部一致", () => {
    let checked = 0;
    for (const visibility of visibilities) {
      for (const ownerTeamId of teams) {
        for (const requesterTeamId of teams) {
          const input = { visibility, ownerTeamId, requesterTeamId };
          expect(isSkillVisibleTo(input), JSON.stringify(input)).toBe(legacyIsSkillVisibleTo(input));
          checked += 1;
        }
      }
    }
    // 断言真的跑满了——空循环也会「全部通过」。
    expect(checked).toBe(18);
  });

  it("两个 null 不算同一个团队（配置错误不得意外放行）", () => {
    expect(isSkillVisibleTo({ visibility: "team-only", ownerTeamId: null, requesterTeamId: null })).toBe(
      false,
    );
  });

  it("org-wide 恒可见；team-only 仅同团队可见", () => {
    expect(isSkillVisibleTo({ visibility: "org-wide", ownerTeamId: null, requesterTeamId: null })).toBe(
      true,
    );
    expect(
      isSkillVisibleTo({ visibility: "team-only", ownerTeamId: "team-a", requesterTeamId: "team-a" }),
    ).toBe(true);
    expect(
      isSkillVisibleTo({ visibility: "team-only", ownerTeamId: "team-a", requesterTeamId: "team-b" }),
    ).toBe(false);
  });
});

/* ─────────────── ② 结构：文件里不再比那三个字段 ─────────────── */

/** 对那三个字段做比较的痕迹。⚠ 只算**比较**，不算赋值（`scope: input.visibility` 是合法的）。 */
const FIELD_COMPARISON =
  /(?:visibility|ownerTeamId|requesterTeamId)\s*(?:===|!==|==(?!=)|!=(?!=))|(?:===|!==|==(?!=)|!=(?!=))\s*\w*\.?(?:visibility|ownerTeamId|requesterTeamId)\b/;

function comparisonHits(source: string): boolean {
  return FIELD_COMPARISON.test(stripComments(source));
}

describe("② visibility-scope.ts 不得自己比可见性字段", () => {
  it("真实源码里没有那三个字段的比较", () => {
    const source = readFileSync(join(SRC, SUBJECT), "utf8");
    expect(comparisonHits(source), "判定必须委托给 decideCapabilityVisibility").toBe(false);
  });

  it("反证：把判定逻辑抄回去，这条断言必须变红", () => {
    // 改名前那三行的真身。断言从未在真实违规上红过的话，它与不存在无法区分。
    const reverted = `
      export function isSkillVisibleTo(input: VisibilityCheckInput): boolean {
        if (input.visibility === "org-wide") return true;
        if (input.ownerTeamId === null || input.requesterTeamId === null) return false;
        return input.ownerTeamId === input.requesterTeamId;
      }`;
    expect(comparisonHits(reverted), "抄回判定逻辑却没被抓到 ⇒ 这条门控是空的").toBe(true);
  });

  it("反证：仅仅**提到**字段名（赋值/传参）不该被误判成比较", () => {
    const delegating = `
      export function isSkillVisibleTo(input: VisibilityCheckInput): boolean {
        return decideCapabilityVisibility({
          decisionId: ID, orgRole: null,
          requesterTeamId: input.requesterTeamId,
          scope: input.visibility, ownerTeamId: input.ownerTeamId,
        }).scopeLayer.passed;
      }`;
    expect(comparisonHits(delegating), "委托实现被误判成违规 ⇒ 门控过紧，会逼人绕过它").toBe(false);
  });
});

/* ─────────────── ③ 图可达性 + 一跳/两跳反证 ─────────────── */

describe("③ decide() 从 visibility-scope.ts 可达（传递闭包，不是直接 import 匹配）", () => {
  const graph = realGraph(SUBJECT);
  const dist = reachable(graph, SUBJECT);

  it("委托目标是直接 import（一跳）", () => {
    expect(dist.get(DELEGATE)).toBe(1);
  });

  it("`decide()` 所在模块可达，且最短距离恰好是 2（只能经 capability-listing）", () => {
    expect(dist.get(DECISION_CORE), "decide() 够不着 ⇒ 根本没委托").toBe(2);
  });

  it("★ 反证：只看直接 import 的参照实现**够不着** decide() —— 证明上一条不是字符串匹配", () => {
    const direct = directImportsOnly(graph, SUBJECT);
    expect(direct.has(DELEGATE), "一跳：直接实现应当看得见").toBe(true);
    expect(
      direct.has(DECISION_CORE),
      "两跳：直接实现看不见 decide()。看得见就说明这个 fixture 区分不了两种实现，反证作废",
    ).toBe(false);
  });

  it("★ 反证：走图器在合成图上必须走满两跳（一跳 fixture 与两跳 fixture 都要对）", () => {
    const oneHop: Graph = new Map([
      ["a.ts", ["b.ts"]],
      ["b.ts", []],
    ]);
    const twoHop: Graph = new Map([
      ["a.ts", ["b.ts"]],
      ["b.ts", ["c.ts"]],
      ["c.ts", []],
    ]);

    // 一跳：两种实现都找得到 —— 所以**一跳变红不能证明传递性**，这正是要多做两跳的理由。
    expect(reachable(oneHop, "a.ts").get("b.ts")).toBe(1);
    expect(directImportsOnly(oneHop, "a.ts").has("b.ts")).toBe(true);

    // 两跳：走图器找得到，直接实现找不到 —— 这一对才把两种实现区分开。
    expect(reachable(twoHop, "a.ts").get("c.ts")).toBe(2);
    expect(directImportsOnly(twoHop, "a.ts").has("c.ts")).toBe(false);
  });

  it("★ 反证：断开中间那一跳，可达性必须消失（不是恒真）", () => {
    const severed = new Map(graph);
    severed.set(DELEGATE, []); // 把 capability-listing → permission-decision 那条边剪掉
    expect(reachable(severed, SUBJECT).has(DECISION_CORE)).toBe(false);
  });

  it("走图器不是在空图上空转（扫到的模块数是真的）", () => {
    expect(graph.size).toBeGreaterThan(2);
    expect(dist.size).toBeGreaterThan(2);
  });
});
