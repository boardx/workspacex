import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIGITAL_INTERVIEW_REPORT_EVIDENCE_ELIGIBILITY } from "../src/interview";

/**
 * The SQL migration's `DEFAULT` clause is a literal that can't reference this TS constant,
 * so it is the one copy AGENTS.md's "same fact must not be declared in two places" allows —
 * but only if a mechanical check keeps it byte-for-byte in sync. Every other application-code
 * fallback (the domain eligibility deriver, the repository's no-report-row fallback) must
 * import `DEFAULT_DIGITAL_INTERVIEW_REPORT_EVIDENCE_ELIGIBILITY` instead of retyping this.
 */
describe("digital interview report evidence eligibility default — single source", () => {
  it("keeps the migration's column default byte-identical to the application constant", () => {
    const migrationPath = fileURLToPath(
      new URL("../../../apps/api/migrations/20260925090000_digital_interview_report_evidence.sql", import.meta.url),
    );
    const migration = readFileSync(migrationPath, "utf8");
    const match = /review_state jsonb NOT NULL DEFAULT '(.+?)'::jsonb/.exec(migration);
    expect(match, "migration's review_state DEFAULT clause not found").not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual(DEFAULT_DIGITAL_INTERVIEW_REPORT_EVIDENCE_ELIGIBILITY);
  });
});
