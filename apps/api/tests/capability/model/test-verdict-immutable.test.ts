/**
 * F49 · 判读不可删、改判留双份 (I-7), asserted against a real database.
 *
 * ## What this file refuses to accept as evidence
 *
 * "`AdmissionTestRepository` has no delete method" and "the contract has no
 * `deleteAdmissionTest`" are both true and both worthless on their own: they say the
 * convenient path offers no deletion, not that deletion is impossible. 0013's header
 * records the stronger version -- a GRANT -- being measured as bypassable:
 *
 *     app_rw: UPDATE provenance_events            -> permission denied
 *     app_rw: DELETE FROM provenance_events       -> permission denied
 *     app_rw: DELETE FROM organizations WHERE ... -> DELETE 1, and every row was GONE
 *
 * `model_admission_tests` hangs off `organizations` AND off `models`, so it has TWO cascade
 * doors. Every assertion below therefore attacks the table from the OUTSIDE, in raw SQL, as
 * the role that serves traffic and as the owner -- never through the repository class.
 *
 * ## Both halves, always
 *
 * A blanket denial would satisfy every "cannot" below and would also mean verdicts cannot
 * be RECORDED. So the file asserts what must still work: a second judgement appends, both
 * records read back, and the owner's tenant teardown still functions. Immutability and
 * paralysis have to be distinguishable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { appConfig, migrationConfig } from "../../../src/infrastructure/db/pg-config";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../../support/db";
import { PgDatabase } from "../../../src/infrastructure/db/pg-database";
import { PgAdmissionTestRepository } from "../../../src/infrastructure/model/pg-admission-test-repository";
import { verdictHistory, latestVerdicts, admissionGate } from "../../../src/domain/model/admission";

const ORG = "org-f49-immutable";
const PROJECT = "proj-f49-immutable";
const MODEL = "m-f49-immutable";

let db: PgDatabase;
let repo: PgAdmissionTestRepository;

/** Run a statement as app_rw and return the error message, or null when it SUCCEEDED. */
async function appDenies(orgId: string, sql: string, params: unknown[] = []): Promise<string | null> {
  const c = new pg.Client(appConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    await c.query(sql, params);
    await c.query("ROLLBACK");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  } finally {
    await c.end();
  }
}

/** Same, as the OWNER -- the role a migration or a psql session runs as. */
async function ownerDenies(sql: string, params: unknown[] = []): Promise<string | null> {
  const c = new pg.Client(migrationConfig());
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    await c.query("ROLLBACK");
    return null;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  } finally {
    await c.end();
  }
}

const countVerdicts = async (): Promise<number> =>
  asApp(ORG, async (c) => {
    const r = await c.query<{ n: string }>("SELECT count(*) AS n FROM model_admission_tests");
    return Number(r.rows[0]!.n);
  });

async function seedModel(): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO models
         (id, org_id, kind, shape, vendor, display_name, capability_tags,
          context_window, unit_price, compliance_attrs, status)
       VALUES ($1, $2, 'self-hosted', 'single', '自托管', 'f49-fixture', '{}', 128000, 0.06, '{}', '待测试')`,
      [MODEL, ORG],
    ),
  );
}

let firstRecordId: string;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAdmissionTestRepository(db);
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedModel();
  // Written through the real writer, not a raw INSERT: the row under attack has to be one
  // the production path produces, or the assertions are about a row nothing creates.
  const first = await repo.append({
    orgId: ORG,
    modelId: MODEL,
    item: "工具调用",
    verdict: "不通过",
    evidence: "第一次判读：函数名被截断，见 evidence/tool-call-1.log",
    judgedBy: "u-admin",
  });
  firstRecordId = first.recordId;
});

describe("I-7: nothing serving traffic can rewrite a verdict", () => {
  it("app_rw cannot UPDATE a verdict", async () => {
    const err = await appDenies(ORG, "UPDATE model_admission_tests SET verdict = '通过'");
    // `?? "<SUCCEEDED>"` and not a bare `err`: a null here means the attack WORKED, and the
    // assertion message should say so rather than "expected string, got null".
    expect(err ?? "<SUCCEEDED>").toMatch(/permission denied|ADMISSION_LOG_APPEND_ONLY/);
    expect(await countVerdicts()).toBe(1);
  });

  it("app_rw cannot UPDATE the evidence either", async () => {
    // Separate from the verdict: rewriting the justification while leaving the conclusion
    // alone is the subtler forgery, and a column-scoped GRANT could permit exactly it.
    const err = await appDenies(ORG, "UPDATE model_admission_tests SET evidence = '看起来没问题'");
    expect(err ?? "<SUCCEEDED>").toMatch(/permission denied|ADMISSION_LOG_APPEND_ONLY/);
  });

  it("app_rw cannot DELETE a verdict", async () => {
    const err = await appDenies(ORG, "DELETE FROM model_admission_tests WHERE record_id = $1", [
      firstRecordId,
    ]);
    expect(err ?? "<SUCCEEDED>").toMatch(/permission denied|ADMISSION_LOG_APPEND_ONLY/);
    expect(await countVerdicts()).toBe(1);
  });

  it("the GRANT states the intent: app_rw has SELECT+INSERT and neither UPDATE nor DELETE", async () => {
    const c = new pg.Client(migrationConfig());
    await c.connect();
    const r = await c.query<{ priv: string; has: boolean }>(
      `SELECT p AS priv, has_table_privilege('app_rw', 'model_admission_tests', p) AS has
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`,
    );
    await c.end();
    const granted = r.rows.filter((x) => x.has).map((x) => x.priv).sort();
    // Set equality, not a count: an added TRUNCATE would keep any count of two wrong-footed.
    expect(granted).toEqual(["INSERT", "SELECT"]);
  });
});

describe("I-7: the cascade doors, which is where the GRANT does not reach", () => {
  it("deleting the MODEL does not take its verdicts with it", async () => {
    // `model_id REFERENCES models(id) ON DELETE CASCADE` is a door the GRANT cannot guard:
    // a referential action skips the privilege check on the child table. As the OWNER, who
    // has every privilege, so the only thing that can refuse this is the trigger.
    const err = await ownerDenies("DELETE FROM models WHERE id = $1", [MODEL]);
    expect(err ?? "<SUCCEEDED>").toContain("ADMISSION_LOG_APPEND_ONLY");
    expect(await countVerdicts()).toBe(1);
  });

  it("app_rw cannot reach the verdicts through the organization either", async () => {
    const err = await appDenies(ORG, "DELETE FROM organizations WHERE id = $1", [ORG]);
    expect(err ?? "<SUCCEEDED>").toMatch(/permission denied|ADMISSION_LOG_APPEND_ONLY/);
    expect(await countVerdicts()).toBe(1);
  });

  it("the owner cannot remove a single verdict while its tenant is still there", async () => {
    const err = await ownerDenies("DELETE FROM model_admission_tests WHERE record_id = $1", [
      firstRecordId,
    ]);
    expect(err ?? "<SUCCEEDED>").toContain("ADMISSION_LOG_APPEND_ONLY");
  });

  it("...but removing the whole organization still works (the stated residual)", async () => {
    // Non-vacuity for everything above: the rule is "no single verdict can be removed
    // without removing its entire tenant", not "this table is undeletable". A blanket refusal
    // would make `resetOrgs` -- and any future retention job -- impossible, and every
    // assertion in this file would still be green.
    const err = await ownerDenies("DELETE FROM organizations WHERE id = $1", [ORG]);
    expect(err).toBeNull();
  });
});

describe("改判留双份: both judgements survive and the later one is identifiable", () => {
  it("a re-judgement appends a second row; the first is still readable", async () => {
    const second = await repo.append({
      orgId: ORG,
      modelId: MODEL,
      item: "工具调用",
      verdict: "通过",
      evidence: "复测：升级 SDK 后函数名完整，见 evidence/tool-call-2.log",
      judgedBy: "u-admin",
    });

    const stored = await repo.listForModel(ORG, MODEL);
    const history = verdictHistory(stored, "工具调用");
    // Both, in order, with their own evidence intact -- the first judgement's reasoning is
    // what a re-judgement is most tempting to erase.
    expect(history.map((r) => r.verdict)).toEqual(["不通过", "通过"]);
    expect(history.map((r) => r.recordId)).toEqual([firstRecordId, second.recordId]);
    expect(history[0]!.evidence).toContain("函数名被截断");

    // ...and which is the later one is answerable, not guessed.
    expect(history[0]!.seq).toBeLessThan(history[1]!.seq);
    expect(latestVerdicts(stored).get("工具调用")!.recordId).toBe(second.recordId);
  });

  it("`seq` orders two judgements written inside the same millisecond", async () => {
    // The reason `seq` exists at all. Two appends in one transaction share `now()` exactly,
    // so a timestamp-only ordering has nothing to work with -- and the coin it tosses
    // decides whether the model may be enabled.
    const a = await repo.append({
      orgId: ORG, modelId: MODEL, item: "长上下文", verdict: "不通过",
      evidence: "128k 处截断", judgedBy: "u-admin",
    });
    const b = await repo.append({
      orgId: ORG, modelId: MODEL, item: "长上下文", verdict: "通过",
      evidence: "复测通过", judgedBy: "u-admin",
    });
    const stored = await repo.listForModel(ORG, MODEL);
    const history = verdictHistory(stored, "长上下文");
    expect(history.map((r) => r.recordId)).toEqual([a.recordId, b.recordId]);
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(latestVerdicts(stored).get("长上下文")!.verdict).toBe("通过");
  });

  it("the gate reads the same log the history does", async () => {
    // Recording all five as 通过 -- through the writer, one at a time, as a human would.
    for (const item of ["连通性", "结构化输出", "工具调用", "长上下文", "中文表达"] as const) {
      await repo.append({
        orgId: ORG, modelId: MODEL, item, verdict: "通过",
        evidence: `${item} 复测通过`, judgedBy: "u-admin",
      });
    }
    const stored = await repo.listForModel(ORG, MODEL);
    // The 工具调用 不通过 from beforeEach is still in there -- superseded, not deleted.
    expect(stored.filter((r) => r.verdict === "不通过")).not.toEqual([]);
    expect(admissionGate(stored).ok).toBe(true);
  });

  it("the store refuses a verdict with blank evidence (O-35 has no score to fall back on)", async () => {
    const err = await appDenies(
      ORG,
      `INSERT INTO model_admission_tests (record_id, model_id, org_id, item, verdict, evidence, judged_by)
       VALUES ('rec-blank', $1, $2, '中文表达', '通过', '   ', 'u-admin')`,
      [MODEL, ORG],
    );
    // NOT NULL alone would accept '   '. Without a score, the evidence IS the judgement.
    expect(err ?? "<SUCCEEDED>").toMatch(/violates check constraint/);
  });

  it("the store refuses an item the contract never declared", async () => {
    const err = await appDenies(
      ORG,
      `INSERT INTO model_admission_tests (record_id, model_id, org_id, item, verdict, evidence, judged_by)
       VALUES ('rec-sixth', $1, $2, '响应速度', '通过', '证据', 'u-admin')`,
      [MODEL, ORG],
    );
    expect(err ?? "<SUCCEEDED>").toMatch(/violates check constraint/);
  });
});

describe("tenant isolation applies to verdicts like every other row", () => {
  it("another organization cannot see this one's judgements", async () => {
    const OTHER = "org-f49-immutable-other";
    await resetOrgs(OTHER);
    await seedOrg({ orgId: OTHER, projectId: `${OTHER}-p` });
    try {
      const seen = await asApp(OTHER, async (c) => {
        const r = await c.query<{ n: string }>("SELECT count(*) AS n FROM model_admission_tests");
        return Number(r.rows[0]!.n);
      });
      expect(seen).toBe(0);
      // ...and the row it cannot see is really there. Otherwise this passes on an empty table.
      expect(await countVerdicts()).toBe(1);
    } finally {
      await resetOrgs(OTHER);
    }
  });

  it("with no tenant context the table is fail-closed", async () => {
    const c = new pg.Client(appConfig());
    await c.connect();
    try {
      const r = await c.query<{ n: string }>("SELECT count(*) AS n FROM model_admission_tests");
      expect(Number(r.rows[0]!.n)).toBe(0);
    } finally {
      await c.end();
    }
  });
});
