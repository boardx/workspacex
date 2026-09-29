/**
 * EV05 测试夹具：给某 Skill 的「当前版本」直接落一条门状态记录（绕过 HTTP 回写，只用于准备前置状态；
 * 回写路径本身由 gate-status-writeback.test.ts 覆盖）。
 */
import { asApp } from "../../support/db";

const GATES = ["G0", "G1", "G2", "G3", "G4", "G5"] as const;

export type G5Outcome = "pass" | "tie" | "no-baseline" | "must-pass-failed";

export function gateStatus(stableId: string, digest: string, g5: G5Outcome) {
  const g5Gate = {
    pass: { gate: "G5", outcome: "pass", reasonCode: "OK", reason: "7/10 > 5/10" },
    tie: { gate: "G5", outcome: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE", reason: "6/10 ≤ 6/10 (tie fails)" },
    "no-baseline": { gate: "G5", outcome: "fail", reasonCode: "NO_BASELINE", reason: "no baseline (E5)" },
    "must-pass-failed": { gate: "G5", outcome: "fail", reasonCode: "MUST_PASS_CASE_FAILED", reason: "E3 failed (E6)" },
  }[g5];
  const counts = { pass: [7, 5], tie: [6, 6], "no-baseline": [7, null], "must-pass-failed": [8, 5] }[g5];
  return {
    stableId,
    subjectVersionDigest: digest,
    gates: GATES.map((gate) => (gate === "G5" ? g5Gate : { gate, outcome: "pass", reasonCode: "OK", reason: "ok" })),
    evidenceReportPath: `evals/work-stack/${stableId}/reports/run-1.json`,
    subjectPassed: counts[0],
    baselinePassed: counts[1],
    deterministicTotal: 10,
    decidedAt: "2026-09-29T01:02:03.000Z",
    scriptVersion: "lint-work-stack-gates@1",
  };
}

/** 当前（最新 published）版本的 id 与 `sha256:` digest。 */
export async function currentVersion(orgId: string, skillId: string): Promise<{ id: string; digest: string }> {
  return asApp(orgId, async (c) => {
    const row = (await c.query<{ id: string; content_digest: string }>(
      `SELECT id, content_digest FROM skill_versions WHERE org_id=$1 AND skill_id=$2 AND published
        ORDER BY created_at DESC, id DESC LIMIT 1`, [orgId, skillId])).rows[0]!;
    return { id: row.id, digest: `sha256:${row.content_digest}` };
  });
}

export async function seedGateRecord(orgId: string, skillId: string, stableId: string, g5: G5Outcome, writtenBy: string): Promise<void> {
  const v = await currentVersion(orgId, skillId);
  const status = gateStatus(stableId, v.digest, g5);
  await asApp(orgId, (c) => c.query(
    `INSERT INTO skill_gate_records
       (org_id, skill_id, skill_version_id, subject_version_digest, status, decided_at, written_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now(),now())
     ON CONFLICT (org_id, skill_version_id) DO UPDATE SET status = EXCLUDED.status`,
    [orgId, skillId, v.id, v.digest, JSON.stringify(status), status.decidedAt, writtenBy]));
}
