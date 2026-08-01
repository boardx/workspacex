import { describe, expect, it } from "vitest";
import {
  INGESTION_PIPELINE,
  INGESTION_STATE_META,
  isTerminal,
  legalNextStates,
  originalDownloadableIn,
  retrievableIn,
} from "../../src/domain/files/ingestion-pipeline";
import { DOWNLOADABLE_STATES, RETRIEVABLE_STATES } from "../../src/domain/files/ingestion-visibility";
import { artifact } from "@repo/contracts";

/**
 * F36 -- uc-22-2 R7/R8/V2: every state that ever occurs has a non-empty `label` and a
 * non-empty `exits` array. "无出口的非终态=黑洞不允许" -- and R8 pushes this further than
 * the usual reading of that rule: even the ONE terminal state (`READY`) must carry exits,
 * because the black-hole failure mode is really "a state the user can do nothing about",
 * and a finished-but-inert screen fails that the same way an inert intermediate one does.
 *
 * Pure, no PostgreSQL -- this is the structural fact about the state machine's own
 * declaration, not about any particular run through it.
 */
describe("九态状态机：每个出现过的状态都有非空 label 与非空 exits（V2）", () => {
  it("契约枚举 ≡ 本模块声明的十态，一一对应，不多不少", () => {
    const contractStates = artifact.IngestionStatus.options;
    const declared = INGESTION_PIPELINE.map((s) => s.key);
    expect(declared.sort()).toEqual([...contractStates].sort());
    expect(declared).toHaveLength(10);
  });

  it.each(INGESTION_PIPELINE)("$key: label 非空", (s) => {
    expect(s.label.trim().length).toBeGreaterThan(0);
    // 失败态统一三段式，不显示裸错误码：label 不得就是枚举成员名本身。
    expect(s.label).not.toBe(s.key);
  });

  it.each(INGESTION_PIPELINE)("$key: exits 非空数组（无出口的非终态=黑洞不允许；READY 同样不例外）", (s) => {
    expect(Array.isArray(s.exits)).toBe(true);
    expect(s.exits.length).toBeGreaterThan(0);
    for (const exit of s.exits) expect(exit.trim().length).toBeGreaterThan(0);
  });

  it("COUNTER-PROOF：一个空 exits 的状态确实会被上面那条断言抓到", () => {
    const blackHole = { key: "STORED" as const, label: "已入库", exits: [] as string[], meaning: "x" };
    expect(() => expect(blackHole.exits.length).toBeGreaterThan(0)).toThrow();
  });
});

describe("九态的合法子序列（V2 的另一半：不是任意跳转）", () => {
  it("除 READY 外，每个状态都至少有一个合法出口", () => {
    for (const s of INGESTION_PIPELINE) {
      if (s.key === "READY") continue;
      expect(legalNextStates(s.key).length, `${s.key} has no legal successor`).toBeGreaterThan(0);
    }
  });

  it("READY 是唯一的终态", () => {
    const terminals = INGESTION_PIPELINE.filter((s) => isTerminal(s.key)).map((s) => s.key);
    expect(terminals).toEqual(["READY"]);
  });

  it("INDEXED 是唯一的岔路（分叉到 REVIEW_PENDING 或 READY 两个合法出口）", () => {
    const forks = INGESTION_PIPELINE.filter((s) => legalNextStates(s.key).length > 1).map((s) => s.key);
    expect(forks).toEqual(["INDEXED"]);
  });

  it("从 RECEIVED 沿合法边走，能到达 STORED、EXTRACTED…直至 READY（可达性，不是断头路）", () => {
    const visited = new Set<string>();
    let frontier: string[] = ["RECEIVED"];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const s of frontier) {
        if (visited.has(s)) continue;
        visited.add(s);
        next.push(...legalNextStates(s as never));
      }
      frontier = next;
    }
    expect(visited.has("READY")).toBe(true);
    expect(visited.size).toBe(10);
  });
});

describe("单一事实源：originalDownloadable / retrievable 不在本文件重复声明", () => {
  it("N-7：pipeline 侧的两个便捷函数与 ingestion-visibility.ts 的集合逐态一致", () => {
    for (const s of INGESTION_PIPELINE) {
      expect(originalDownloadableIn(s.key)).toBe(DOWNLOADABLE_STATES.includes(s.key));
      expect(retrievableIn(s.key)).toBe(RETRIEVABLE_STATES.includes(s.key));
    }
  });

  it("REVIEW_PENDING：可下载但不可召回（N-7 在这条流水线上仍然成立）", () => {
    expect(originalDownloadableIn("REVIEW_PENDING")).toBe(true);
    expect(retrievableIn("REVIEW_PENDING")).toBe(false);
  });
});

describe("INGESTION_STATE_META 与 INGESTION_PIPELINE 是同一份数据的两个视角", () => {
  it("按 key 索引取到的是同一个对象", () => {
    for (const s of INGESTION_PIPELINE) {
      expect(INGESTION_STATE_META[s.key]).toBe(s);
    }
  });
});
