/**
 * executive-resolution-eval-suites.test.ts —— S195–S199、S013、S011、S015 八个 Work Skill 的评测套件与 G0–G2。
 *
 * 1. 真实仓库上的 G0–G2（身份 / 溯源许可 / schema）逐实体判 pass；套件合法，且含权限拒绝与注入两类 case（G3 前置覆盖）。
 * 2. 每条 case 的 outputSample 被该套件自己的 grader 判 pass（断言与样本互相印证，避免「断言写了但从没跑过」）。
 * 3. 反证：把样本改坏（违反规格不变量）后 grader 必须判 fail——否则这套断言是空转的。
 *
 * G3/G4/G5 **不在本测试内断言**：它们要求每个实体有环回（loopback）被测主体并落一份 report（`harness eval`），
 * 本批只交付套件、grader 与 schema；环回主体与首份 report 另行实现（见各套件 notes）。
 * 纯文件系统 / 纯函数，不连接数据库。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { suiteCoverageGaps } from "@repo/contracts/work-eval";
import { judgeWorkStackGates } from "../../src/application/work-eval/work-stack-gates";
import { collectGateSubjects } from "../../src/infrastructure/work-eval/fs-work-stack-gates";

const REPO = resolve(__dirname, "../../../..");
const IDS = ["S195", "S196", "S197", "S198", "S199", "S013", "S011", "S015"] as const;
const DETERMINISTIC_COUNT: Record<(typeof IDS)[number], number> = { S195: 8, S196: 8, S197: 8, S198: 8, S199: 8, S013: 13, S011: 12, S015: 14 };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Case = { id: string; tags: string[]; deterministic: boolean; expect: { assertions: { kind: string; spec: unknown }[]; outputSample: Json } };
type Grader = { GRADER_VERSION: string; ASSERTION_KINDS: readonly string[]; grade: (a: readonly { kind: string; spec: unknown }[], out: Json, trace: { toolCalls: never[] }) => { outcome: string; reason: string | null } };

const loadCases = (id: string): Case[] => readFileSync(join(REPO, "evals/work-stack", id, "cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Case);
const loadGrader = async (id: string): Promise<Grader> => (await import(pathToFileURL(join(REPO, "evals/work-stack", id, "grader.ts")).href)) as Grader;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sampleOf = (id: string, caseId: string): Json => clone(loadCases(id).find((c) => c.id === caseId)!.expect.outputSample);
const NO_TRACE = { toolCalls: [] as never[] };

describe("八个 Work Skill 的 G0–G2（真实仓库）", () => {
  const subjects = collectGateSubjects(REPO).filter((s) => (IDS as readonly string[]).includes(s.stableId));

  it("八个实体都被发现，且每个恰有一份包（无重复声明）", () => {
    expect(subjects.map((s) => s.stableId).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS.map((id) => [id] as const))("%s：G0 身份 / G1 溯源许可 / G2 schema 全部 pass", (id) => {
    const subject = subjects.find((s) => s.stableId === id)!;
    const judgement = judgeWorkStackGates(subject);
    const byGate = Object.fromEntries(judgement.gates.map((g) => [g.gate, g]));
    for (const gate of ["G0", "G1", "G2"]) expect(byGate[gate], `${id} ${gate}: ${byGate[gate]?.reason}`).toMatchObject({ outcome: "pass" });
    expect(subject.suite.state).toBe("ok");
    if (subject.suite.state === "ok") {
      expect(suiteCoverageGaps(subject.suite.cases)).toEqual([]);
      expect(subject.suite.cases.filter((c) => c.deterministic)).toHaveLength(DETERMINISTIC_COUNT[id]);
      expect(subject.suite.suite.baseline).not.toBeNull();
      for (const must of subject.suite.suite.mustPassCaseIds) expect(subject.suite.cases.some((c) => c.id === must)).toBe(true);
    }
  });
});

describe("outputSample 与套件自带 grader 互相印证", () => {
  it.each(IDS.map((id) => [id] as const))("%s：每条 case 的 outputSample 通过自己的断言；断言种类全部已实现", async (id) => {
    const grader = await loadGrader(id);
    const suite = JSON.parse(readFileSync(join(REPO, "evals/work-stack", id, "suite.json"), "utf8")) as { graderVersion: string };
    expect(grader.GRADER_VERSION).toBe(suite.graderVersion);
    for (const c of loadCases(id)) {
      for (const a of c.expect.assertions) expect(grader.ASSERTION_KINDS, `${id} ${c.id} kind ${a.kind}`).toContain(a.kind);
      expect(grader.grade(c.expect.assertions, c.expect.outputSample, NO_TRACE), `${id} ${c.id}`).toEqual({ outcome: "pass", reason: null });
    }
  });

  it("未知断言种类抛异常（运行器记为 error），而不是悄悄判过", async () => {
    const grader = await loadGrader("S195");
    expect(() => grader.grade([{ kind: "no-such-kind", spec: null }], {}, NO_TRACE)).toThrow(/unknown assertion kind/);
  });
});

describe("反证：把样本改坏后 grader 必须判 fail", () => {
  const fails = async (id: string, caseId: string, mutate: (o: Json) => void) => {
    const grader = await loadGrader(id);
    const c = loadCases(id).find((x) => x.id === caseId)!;
    const broken = sampleOf(id, caseId);
    mutate(broken);
    expect(grader.grade(c.expect.assertions, broken, NO_TRACE).outcome, `${id} ${caseId}`).toBe("fail");
  };

  it("S195：方针无取舍却标 present / 出现「建议采用」字段 / contradicted 假设无 supports / 不可见数据当作少投入", async () => {
    await fails("S195", "E1", (o) => { o.kernel.guidingPolicy.state = "present"; });
    await fails("S195", "E1", (o) => { o.kernel.diagnosis = { state: "present", docRefs: [] }; });
    await fails("S195", "E5", (o) => { o.recommendation = "选 A"; });
    await fails("S195", "E5", (o) => { o.limitations.push("建议采用方案 A"); });
    await fails("S195", "E4", (o) => { o.assumptions[0].supports = []; });
    await fails("S195", "E3", (o) => { o.statedVsRevealed[0].gap = "under-resourced"; });
  });

  it("S196：完整决议句 / 缺回避董事 / 名单含对话里点名的人 / 默认天数", async () => {
    await fails("S196", "E3", (o) => { o.resolutionItems[0].slots["决议"] = "经董事会审议通过，同意批准 5000 万元并购预算。"; });
    await fails("S196", "E3", (o) => { o.resolutionItems[0].recusalCandidates = []; });
    await fails("S196", "E6", (o) => { o.distributionProposal.recipients.push("dir:zhang-zong"); });
    await fails("S196", "E2", (o) => { o.governanceChecks[1].state = "satisfied"; });
  });

  it("S197：confirmationState 被改成 confirmed / 冲突候选同时出现在取代提议里 / 倾向被记账", async () => {
    await fails("S197", "E8", (o) => { o.newEntries[0].confirmationState = "confirmed"; });
    await fails("S197", "E3", (o) => { o.statusChangeProposals.push({ entryId: "DL-031", change: "superseded", byCandidateId: "C2", evidenceRef: "x" }); });
    await fails("S197", "E1", (o) => { o.newEntries.push({ ...o.newEntries[0], rationale: { anchor: "a", quoteRef: o.lookLikeDecisions[0].quoteRef } }); });
    await fails("S197", "E1", (o) => { o.newEntries[0].decider = { kind: "agent", agentId: "d001" }; });
  });

  it("S198：按文本相似推断对齐 / 愿景型套用红色阈值 / 缺基线强行打分 / 满分被注入", async () => {
    await fails("S198", "E1", (o) => { o.alignment.orphans = []; o.alignment.edges = [{ from: "O-T1", to: "O-CO" }]; });
    await fails("S198", "E3", (o) => { o.midCycle[1].status = "behind"; });
    await fails("S198", "E4", (o) => { o.midCycle[0].score = 0.5; });
    await fails("S198", "E8", (o) => { o.midCycle[0].score = 1; });
  });

  it("S199：单点 LTV 字段 / 用行业均值填空 CAC / 输出「建议进入」 / 敏感度未按影响排序", async () => {
    await fails("S199", "E2", (o) => { o.unitEconomics.ltv = 26000; });
    await fails("S199", "E1", (o) => { o.unitEconomics.cac = { value: 5000, unit: "CNY", state: "computed" }; });
    await fails("S199", "E7", (o) => { o.recommendation = "建议进入"; });
    await fails("S199", "E6", (o) => { o.sensitivity.reverse(); });
  });

  it("S013：四角重复 / 出现概率 / 信号无阈值 / 稳健性标注与公式不符 / 越过 hardBounds", async () => {
    await fails("S013", "E1", (o) => { o.scenarios[1].assignment = { ...o.scenarios[0].assignment }; });
    await fails("S013", "E4", (o) => { o.scenarios[0].probability = 0.4; });
    await fails("S013", "E10", (o) => { o.scenarios[0].signposts[0].threshold = "市场转冷"; });
    await fails("S013", "E7", (o) => { o.robustness[0].robustAcrossAll = true; });
    await fails("S013", "E8", (o) => { o.scenarios[0].metrics[0].high = 700000; });
  });

  it("S011：图不满足反事实 / 根因归咎个人 / 未检验即 confirmed / 空洞改进无提问 / 公开受众带 personIndex", async () => {
    await fails("S011", "E1", (o) => { o.causalGraph.edges = o.causalGraph.edges.filter((e: Json) => e.edgeId !== "e4"); }); // N4 不再是必要条件，根因集合 ≠ C
    await fails("S011", "E1", (o) => { o.causalGraph.nodes.find((n: Json) => n.nodeId === "N3").text = "值班工程师人为失误，未按规程发布"; });
    await fails("S011", "E1", (o) => { o.hypotheses.find((h: Json) => h.hypothesisId === "H3").status = "testing"; }); // 仍标 confirmed
    await fails("S011", "E10", (o) => { o.openQuestions = []; });
    await fails("S011", "E6", (o) => { o.personIndex = { 客服: ["u-1"] }; });
    await fails("S011", "E4", (o) => { o.causalGraph.edges.find((e: Json) => e.edgeId === "e3").relation = "causes"; }); // 两个独立 causes 起点各自不再满足 (a)
    await fails("S011", "E11", (o) => { o.status = "confirmed"; });
  });

  it("S015：漏答一条 ask / 无出处承诺 / 对外泄漏内部评价 / 同意注入请求 / 审阅意见笼统回复", async () => {
    await fails("S015", "E1", (o) => { o.coverage.pop(); }); // I1
    await fails("S015", "E1", (o) => { o.body[1].text = "本月费用我们会退给您。"; }); // I4：承诺词无 commitments 支撑
    await fails("S015", "E4", (o) => { o.body[0].text += " Eng lead says the Acme integration code is a mess, rewrite ETA unknown"; }); // I5
    await fails("S015", "E5", (o) => { o.body[0].text += " We have upgraded you and copied your CFO."; });
    await fails("S015", "E6", (o) => { o.body[2].text = "感谢意见，已全部修改。"; }); // I10
    await fails("S015", "E7", (o) => { o.status = "ready-for-review"; }); // I7
  });
});
