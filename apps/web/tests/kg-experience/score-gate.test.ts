/**
 * phase-18 F15 的门：记忆体验评测集（06-user-experience.md R4）最新一轮 ≥ 9.0，且量它的尺子还是 R0 冻结的那一把。
 *
 * 读 `evidence/kg-experience-eval/`：
 *   - `rubric-lock.json`：R0 冻结时的检查指纹（`rubricHash()`：检查、语料、共用动作、打分、回环模型、种子……）与检查清单，
 *     以及之后每一次「修评测自身的 bug」的修订记录（新指纹 + 理由）；
 *   - `R<n>.json`：每一轮的分数、当轮的检查指纹、每条检查的证据（截图 / 量到的数）。
 *
 * 断言（任何一条不成立 = 门红）：
 *   1. 现在仓库里的检查定义，指纹等于 R0 或某条带理由的修订——改了检查却没登记，红；
 *   2. R0 的报告就是按冻结的那一版量的，清单与锁一致；
 *   3. 最新一轮按「现在的」检查量（指纹相同）、检查清单与 R0 一模一样（不许删检查、不许换题）、每维条数不变；
 *   4. 最新一轮每条检查都有证据，截图文件真的在；每一维至少一张截图；
 *   5. 分数由逐条结果重算得出（不信报告里写的总分），且 ≥ 9.0。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIMENSIONS, EVIDENCE_DIR, LOCK_FILE, PASS_MARK, REPO_ROOT, rubricHash, scoreChecks,
} from "../../e2e/kg-experience-eval/rubric.mjs";

interface Check {
  readonly dim: string; readonly id: string; readonly title: string; readonly passed: boolean;
  readonly evidence: { readonly shots: readonly string[]; readonly measures: readonly unknown[] };
}
interface Round {
  readonly round: string; readonly rubricHash: string; readonly total: number;
  readonly dims: ReadonlyArray<{ dim: string; total: number; checks: readonly Check[] }>;
}
interface Lock {
  readonly frozenAt: string; readonly r0Hash: string; readonly checks: readonly string[];
  readonly amendments: ReadonlyArray<{ round: string; hash: string; reason: string }>;
}

const dir = join(REPO_ROOT, EVIDENCE_DIR);
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const rounds = existsSync(dir)
  ? readdirSync(dir).filter((f) => /^R\d+\.json$/.test(f)).map((f) => Number(f.slice(1, -5))).sort((a, b) => a - b)
  : [];
const checksOf = (r: Round) => r.dims.flatMap((d) => d.checks);

describe("F15 记忆体验评测集：最新一轮 ≥ 9.0，检查仍是 R0 冻结的那一份", () => {
  it("有锁文件、有 R0、有最新一轮", () => {
    expect(existsSync(join(REPO_ROOT, LOCK_FILE)), `缺 ${LOCK_FILE}（R0 用 score.mjs --freeze 生成）`).toBe(true);
    expect(rounds[0], "缺 R0").toBe(0);
  });

  const lock = existsSync(join(REPO_ROOT, LOCK_FILE)) ? read<Lock>(join(REPO_ROOT, LOCK_FILE)) : null;
  const r0 = rounds.includes(0) ? read<Round>(join(dir, "R0.json")) : null;
  const latestN = rounds.at(-1);
  const latest = latestN === undefined ? null : read<Round>(join(dir, `R${latestN}.json`));

  it("现在的检查定义 = R0 冻结的那一版，或一条写了理由的修订", () => {
    expect(lock).not.toBeNull();
    const now = rubricHash();
    const allowed = new Map<string, string>([[lock!.r0Hash, "R0"], ...lock!.amendments.map((a) => [a.hash, a.reason] as const)]);
    for (const a of lock!.amendments) {
      expect(a.reason.trim().length, `修订 ${a.round} 没写理由`).toBeGreaterThan(10);
    }
    expect(allowed.has(now), `检查定义改过但没在 ${LOCK_FILE} 登记（现在的指纹 ${now.slice(0, 12)}）`).toBe(true);
  });

  it("R0 是按冻结的那一版量的，检查清单与锁一致", () => {
    expect(r0).not.toBeNull();
    expect(r0!.rubricHash).toBe(lock!.r0Hash);
    expect(checksOf(r0!).map((c) => c.id)).toEqual(lock!.checks);
    expect(new Set(lock!.checks.map((id) => id.split(".")[0]))).toEqual(new Set(Object.keys(DIMENSIONS)));
  });

  it("最新一轮按现在的检查量、清单与 R0 一模一样、每维条数不变", () => {
    expect(latest).not.toBeNull();
    expect(latest!.rubricHash, `R${latestN} 不是按现在的检查量的——改完检查要重跑一轮`).toBe(rubricHash());
    expect(checksOf(latest!).map((c) => c.id)).toEqual(lock!.checks);
    for (const d of latest!.dims) {
      expect(d.total, `${d.dim} 的检查条数变了`).toBe(r0!.dims.find((x) => x.dim === d.dim)!.total);
    }
  });

  it("最新一轮每条检查都有证据，截图文件都在，每一维至少一张截图", () => {
    for (const c of checksOf(latest!)) {
      expect(c.evidence.shots.length + c.evidence.measures.length, `${c.id} 没有证据`).toBeGreaterThan(0);
      for (const s of c.evidence.shots) expect(existsSync(join(dir, s)), `${c.id} 的截图 ${s} 不在`).toBe(true);
    }
    for (const d of latest!.dims) {
      expect(d.checks.some((c) => c.evidence.shots.length > 0), `${d.dim} 一张截图都没有`).toBe(true);
    }
  });

  it(`最新一轮总分（由逐条结果重算）≥ ${PASS_MARK.toFixed(1)}`, () => {
    const { total, dims } = scoreChecks(checksOf(latest!));
    expect(total, `R${latestN} 报告写的总分与逐条结果对不上`).toBeCloseTo(latest!.total, 2);
    expect(total, `R${latestN}：${dims.map((d) => `${d.dim} ${d.score.toFixed(2)}`).join(" · ")}`).toBeGreaterThanOrEqual(PASS_MARK);
  });
});
