#!/usr/bin/env node
/**
 * lint-naming-single-source.mjs -- F121: 议程环节命名单源收敛的败选名门控。
 *
 * (Q-3 B 裁「① 改名对齐」, contracts/project/domain.md I-P20, MIGRATION-IMPACT.md 第二节)
 *
 * Scans `apps/api/src`, `apps/api/tests`, `apps/web`, `packages/contracts/src` for the
 * three names Q-3 B judged against: `stepId` / `step_id` / `agenda_stage` / `stage.<action>`.
 * The single-source pattern list lives in `scripts/lib/naming-single-source-patterns.mjs`
 * -- shared with `tests/project/naming-single-source-gate.test.ts`'s counter-proof, so the
 * judge function itself is exercised against a deliberately-forbidden fixture and not just
 * against whatever this script happens to find (or fail to find) in the tree.
 *
 * Migrations are OUT of scope on purpose: `0008-f06-binding-modes.sql` and
 * `0030-f81-interview-step-attachments.sql` are already-applied migrations that named the
 * column `step_id` at the time they ran, and MIGRATION-IMPACT.md is explicit that renaming
 * a passing migration's file text is not the move -- a NEW migration
 * (`20260731161729_f121_agenda_segment_naming.sql`) does the `RENAME COLUMN` instead. A
 * historical migration file is a record of what WAS created, not "current code" that this
 * gate is protecting against regressions in.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTreesForForbiddenNames } from "./lib/naming-single-source-patterns.mjs";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(API, "..", "..");

const ROOTS = [
  join(API, "src"),
  join(API, "tests"),
  join(REPO, "apps/web"),
  join(REPO, "packages/contracts/src"),
].filter((r) => existsSync(r));

// This gate's own test file deliberately embeds a forbidden name as a string literal to
// prove `scanTextForForbiddenNames` is not vacuous (the counter-proof MIGRATION-IMPACT.md
// and I-P20 both require). Excluding it here is not weakening the gate -- the file is
// asserted, in its own test, to contain exactly the fixture string and nothing else.
const SELF_EXCLUDE = [join(API, "tests/project/naming-single-source-gate.test.ts")];

const violations = scanTreesForForbiddenNames(ROOTS, SELF_EXCLUDE);

if (violations.length === 0) {
  console.log(
    `✅ lint-naming-single-source: 0 处败选名（stepId / step_id / agenda_stage / stage.<action>）`,
  );
  console.log(`scanned-roots=${ROOTS.length}`);
  process.exit(0);
}

for (const v of violations) {
  console.error(`✗ ${v.file}:${v.line}  ${v.pattern}`);
  console.error(`    ${v.text}`);
}
console.error(
  `\n❌ ${violations.length} 处败选名。全仓单源应为 agendaSegment / agendaSegmentId（F121, Q-3 B①）。`,
);
process.exit(1);
