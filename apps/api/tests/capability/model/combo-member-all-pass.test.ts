/**
 * F49 · 组合模型：成员各自过测 **且组合本身也过一次** (O-22③ / I-1).
 *
 * ## The assertion this file exists for
 *
 * "Every member is a tested, passing model" reads like a complete argument, and it is the
 * half that gets dropped. `agent-runtime.ts` states the other half twice -- on `ModelShape`
 * and again on `CompositeMember` -- precisely because one statement of it does not survive
 * implementation. `whisper ＋ sonnet` is a PIPELINE: the handoff between the two, the
 * combined context budget, and the behaviour of the chain under a tool call are properties
 * of neither member. A gate that accepted the conjunction of the members would never have
 * tested the thing that actually runs.
 *
 * So the load-bearing case here is **members all pass, composite has no verdicts of its own
 * -> REFUSED**, and it is asserted first.
 *
 * ## Why the counter-case is asserted too
 *
 * A gate that refused every composite would pass that assertion and be useless. Each
 * refusal below is paired with the input that must be ACCEPTED, and the accepted input
 * differs from the refused one by exactly the thing under test.
 */
import { describe, expect, it } from "vitest";
import {
  ADMISSION_TEST_ITEMS,
  ADMISSION_TESTS_INCOMPLETE,
  ADMISSION_ITEMS_UNDECLARED,
  compositeAdmissionGate,
  COMPOSITE_HAS_NO_MEMBERS,
  type AdmissionTestItem,
  type AdmissionVerdict,
  type StoredAdmissionTest,
} from "../../../src/domain/model/admission";
import { enableModel } from "../../../src/application/model/enable-model";
import type {
  AdmissionAuditSink,
  AdmissionTestRepository,
  ModelShapeReader,
  ModelStatusWriter,
} from "../../../src/application/model/ports";

const COMPOSITE = "m-whisper-plus-sonnet";
const WHISPER = "m-whisper";
const SONNET = "m-sonnet";

let seq = 0;
function judged(
  modelId: string,
  item: AdmissionTestItem,
  verdict: AdmissionVerdict,
): StoredAdmissionTest {
  seq += 1;
  return {
    recordId: `rec-${seq}`,
    modelId,
    item,
    verdict,
    evidence: `${modelId} / ${item} 判读证据`,
    judgedBy: "u-admin",
    judgedAt: new Date(1_760_000_000_000 + seq).toISOString(),
    seq,
  };
}

/** A full passing log for one model. */
const passingLog = (modelId: string): StoredAdmissionTest[] =>
  ADMISSION_TEST_ITEMS.map((item) => judged(modelId, item, "通过"));

/** A full log with exactly one item failing. */
const logFailing = (modelId: string, failing: AdmissionTestItem): StoredAdmissionTest[] =>
  ADMISSION_TEST_ITEMS.map((item) => judged(modelId, item, item === failing ? "不通过" : "通过"));

const members = (whisper: StoredAdmissionTest[], sonnet: StoredAdmissionTest[]) => [
  { modelId: WHISPER, records: whisper },
  { modelId: SONNET, records: sonnet },
];

describe("组合本身也要过一次 -- the half that gets dropped", () => {
  it("⚠ members all pass, the composite itself was never tested => REFUSED", () => {
    const gate = compositeAdmissionGate([], members(passingLog(WHISPER), passingLog(SONNET)));
    expect(gate.ok).toBe(false);
    if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
    // No member is at fault, and saying so matters: the admin must be sent to test the
    // CHAIN, not to re-test two models that already passed.
    expect(gate.blockedMembers).toEqual([]);
    // All five of the composite's own, as a set.
    expect([...gate.blocked.map((b) => b.item)].sort()).toEqual([...ADMISSION_TEST_ITEMS].sort());
    expect(gate.blocked.every((b) => b.reason === "never-judged")).toBe(true);
  });

  it("members all pass, the composite failed ONE of its own five => REFUSED, naming it", () => {
    for (const failing of ADMISSION_TEST_ITEMS) {
      const gate = compositeAdmissionGate(
        logFailing(COMPOSITE, failing),
        members(passingLog(WHISPER), passingLog(SONNET)),
      );
      expect(gate.ok).toBe(false);
      if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
      expect(gate.blocked.map((b) => b.item)).toEqual([failing]);
      expect(gate.blockedMembers).toEqual([]);
    }
  });

  it("the counter-case: composite passed its own five AND both members did => ACCEPTED", () => {
    // Without this, every assertion above is satisfied by a gate that refuses everything.
    const gate = compositeAdmissionGate(
      passingLog(COMPOSITE),
      members(passingLog(WHISPER), passingLog(SONNET)),
    );
    expect(gate).toEqual({ ok: true });
  });
});

describe("成员各自过测 -- each member, on its own", () => {
  for (const failingMember of [WHISPER, SONNET]) {
    it(`refuses when only 「${failingMember}」 has an outstanding item`, () => {
      const gate = compositeAdmissionGate(
        passingLog(COMPOSITE),
        members(
          failingMember === WHISPER ? logFailing(WHISPER, "中文表达") : passingLog(WHISPER),
          failingMember === SONNET ? logFailing(SONNET, "中文表达") : passingLog(SONNET),
        ),
      );
      expect(gate.ok).toBe(false);
      if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
      // Named, because "this composite is unavailable" is not actionable -- the admin has
      // to be told which member to go and re-test. Same reasoning as `compositeBlock`.
      expect(gate.blockedMembers.map((m) => m.modelId)).toEqual([failingMember]);
      expect(gate.blockedMembers[0]!.blocked.map((b) => b.item)).toEqual(["中文表达"]);
      // The composite's own five are fine here, and the result says so rather than
      // blaming everything at once.
      expect(gate.blocked).toEqual([]);
    });
  }

  it("an untested member is refused even though it has no failing verdict", () => {
    const gate = compositeAdmissionGate(
      passingLog(COMPOSITE),
      members(passingLog(WHISPER), []),
    );
    expect(gate.ok).toBe(false);
    if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
    expect(gate.blockedMembers.map((m) => m.modelId)).toEqual([SONNET]);
    expect(gate.blockedMembers[0]!.blocked.every((b) => b.reason === "never-judged")).toBe(true);
  });

  it("both members failing are both reported, not just the first", () => {
    const gate = compositeAdmissionGate(
      passingLog(COMPOSITE),
      members(logFailing(WHISPER, "连通性"), logFailing(SONNET, "工具调用")),
    );
    if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
    expect([...gate.blockedMembers.map((m) => m.modelId)].sort()).toEqual([SONNET, WHISPER].sort());
  });

  it("`不适用` on a member does not launder it into a pass", () => {
    const laundered = ADMISSION_TEST_ITEMS.map((item) =>
      judged(WHISPER, item, item === "工具调用" ? "不适用" : "通过"),
    );
    const gate = compositeAdmissionGate(
      passingLog(COMPOSITE),
      members(laundered, passingLog(SONNET)),
    );
    expect(gate.ok).toBe(false);
  });
});

describe("the vacuous conjunctions, refused rather than assumed away", () => {
  it("a composite with NO members is not a pass, however good its own five are", () => {
    // `for (member of []) { ... }` is satisfied by every requirement. A `shape: composite`
    // row with an empty pipeline is a misconfiguration -- 0019's trigger permits the state,
    // and `effectiveKind` reads it as closed-unknown -- so the gate must refuse it rather
    // than read "no members failed" as "all members passed".
    const gate = compositeAdmissionGate(passingLog(COMPOSITE), []);
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("wrong branch");
    expect(gate.code).toBe(COMPOSITE_HAS_NO_MEMBERS);
  });

  it("an empty required-item set is refused for a composite too", () => {
    const gate = compositeAdmissionGate([], members([], []), []);
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("wrong branch");
    // Not COMPOSITE_HAS_NO_MEMBERS and not "incomplete": the requirement itself is missing,
    // which is a different and worse thing than an untested model.
    expect(gate.code).toBe(ADMISSION_ITEMS_UNDECLARED);
  });
});

/* ─────────────────────── through the use case ─────────────────────── */

function fakes(logs: Record<string, readonly StoredAdmissionTest[]>, memberIds: readonly string[]) {
  const written: { modelId: string; status: string }[] = [];
  const audited: { code: string; detail: Record<string, unknown> }[] = [];
  const admissions: AdmissionTestRepository = {
    append: () => Promise.reject(new Error("not used")),
    listForModel: (_org, modelId) => Promise.resolve(logs[modelId] ?? []),
  };
  const models: ModelShapeReader = {
    read: (_org, modelId) =>
      Promise.resolve(modelId === COMPOSITE ? { shape: "composite" as const, memberIds } : null),
  };
  const status: ModelStatusWriter = {
    setStatus: (_org, modelId, s) => {
      written.push({ modelId, status: s });
      return Promise.resolve();
    },
  };
  const audit: AdmissionAuditSink = {
    enableRejected: (e) => {
      audited.push({ code: e.code, detail: e.detail as Record<string, unknown> });
      return Promise.resolve();
    },
  };
  return { deps: { admissions, models, status, audit }, written, audited };
}

describe("enableModel on a composite", () => {
  it("refuses and audits when the members pass but the chain was never tested", async () => {
    const f = fakes(
      { [WHISPER]: passingLog(WHISPER), [SONNET]: passingLog(SONNET) },
      [WHISPER, SONNET],
    );
    const r = await enableModel("org-1", COMPOSITE, "u-bypass", f.deps);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("wrong branch");
    expect(r.code).toBe(ADMISSION_TESTS_INCOMPLETE);
    expect([...r.blocked.map((b) => b.item)].sort()).toEqual([...ADMISSION_TEST_ITEMS].sort());
    expect(f.written).toEqual([]);
    expect(f.audited.map((a) => a.code)).toEqual([ADMISSION_TESTS_INCOMPLETE]);
  });

  it("refuses and audits when one member is short, naming the member", async () => {
    const f = fakes(
      {
        [COMPOSITE]: passingLog(COMPOSITE),
        [WHISPER]: passingLog(WHISPER),
        [SONNET]: logFailing(SONNET, "长上下文"),
      },
      [WHISPER, SONNET],
    );
    const r = await enableModel("org-1", COMPOSITE, "u-bypass", f.deps);
    if (r.ok) throw new Error("wrong branch");
    expect(r.blockedMembers.map((m) => m.modelId)).toEqual([SONNET]);
    expect(f.written).toEqual([]);
  });

  it("enables only when the chain and every member have each passed", async () => {
    const f = fakes(
      {
        [COMPOSITE]: passingLog(COMPOSITE),
        [WHISPER]: passingLog(WHISPER),
        [SONNET]: passingLog(SONNET),
      },
      [WHISPER, SONNET],
    );
    const r = await enableModel("org-1", COMPOSITE, "u-admin", f.deps);
    expect(r.ok).toBe(true);
    expect(f.written).toEqual([{ modelId: COMPOSITE, status: "已启用" }]);
    expect(f.audited).toEqual([]);
  });

  it("a single model is NOT put through the composite gate", async () => {
    // Non-vacuity in the other direction: if `enableModel` ran the composite gate on every
    // record, a perfectly tested single model would be refused for having no members, and
    // the three tests above would all still be green.
    const f = fakes({ "m-single": passingLog("m-single") }, []);
    const single: ModelShapeReader = {
      read: (_o, id) => Promise.resolve(id === "m-single" ? { shape: "single" as const, memberIds: [] } : null),
    };
    const r = await enableModel("org-1", "m-single", "u-admin", { ...f.deps, models: single });
    expect(r.ok).toBe(true);
    expect(f.written).toEqual([{ modelId: "m-single", status: "已启用" }]);
  });
});
