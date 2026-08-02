/**
 * F46 -- O-01 留存五参数「单点配置，多处消费」的结构性断言 (uc-22-4 R3.d 点 14, N-20,
 * `KNOWN_CONTRACT_GAPS.FS7`).
 *
 * ## Why a table, not `expect(...).toBe(180)`
 *
 * A single assertion against 180 is satisfied by `function resolveRetentionParams() {
 * return { materialDays: 180, ... } }` -- exactly the hardcode this feature exists to
 * forbid. This file runs the SAME resolution logic against a table of arbitrary values
 * (none of which is 180/30/1095, F78's own precedent for this discipline), so hardcoding
 * any one of the five real O-01 defaults back into `domain/files/retention-policy.ts` would
 * fail every OTHER row.
 *
 * ## Static check
 *
 * `domain/files/retention-policy.ts` -- the ONE file allowed to declare a resolution rule --
 * must not contain a bare day-count literal in its resolution logic. `files.
 * DEFAULT_RETENTION_PARAMS` (in `@repo/contracts`, imported and injected, never redeclared)
 * is the single source of the org-wide numbers; this file is checked separately.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertValidRetentionParams,
  isNearMaterialRetention,
  isPastMaterialRetention,
  mergeRetentionOverride,
  RetentionParamInvalidError,
  resolveRetentionParams,
  type RetentionParams,
} from "../../src/domain/files/retention-policy";

const DAY_VALUES = [1, 7, 45, 365, 4000] as const; // deliberately excludes 180/30/1095

function paramsAllSetTo(days: number): RetentionParams {
  return { materialDays: days, derivedDays: days, logDays: days, trashGraceDays: days, backupDays: days };
}

describe("F46 · retention params resolve from injected values, never a literal", () => {
  it.each(DAY_VALUES)("org default = %i for every field -> resolves to %i with no override", (days) => {
    const resolved = resolveRetentionParams(paramsAllSetTo(days), null);
    expect(resolved).toEqual(paramsAllSetTo(days));
  });

  it.each(DAY_VALUES)("project override on ONE field (materialDays = %i) wins over a DIFFERENT org default", (days) => {
    const orgDefault = paramsAllSetTo(days + 1);
    const resolved = resolveRetentionParams(orgDefault, { materialDays: days });
    expect(resolved.materialDays).toBe(days);
    // Every other field still inherits the org default -- a partial override must not
    // silently null out the fields it did not mention.
    expect(resolved.derivedDays).toBe(days + 1);
    expect(resolved.logDays).toBe(days + 1);
    expect(resolved.trashGraceDays).toBe(days + 1);
    expect(resolved.backupDays).toBe(days + 1);
  });

  it.each(DAY_VALUES)("all five fields overridden at once (= %i) -> resolved matches the override exactly", (days) => {
    const orgDefault = paramsAllSetTo(1);
    const resolved = resolveRetentionParams(orgDefault, paramsAllSetTo(days));
    expect(resolved).toEqual(paramsAllSetTo(days));
  });

  it("zero or negative resolved value throws RetentionParamInvalidError, for any field", () => {
    expect(() => resolveRetentionParams(paramsAllSetTo(30), { materialDays: 0 })).toThrow(RetentionParamInvalidError);
    expect(() => resolveRetentionParams(paramsAllSetTo(30), { trashGraceDays: -5 })).toThrow(RetentionParamInvalidError);
  });

  it("non-integer resolved value throws", () => {
    expect(() => resolveRetentionParams(paramsAllSetTo(30), { backupDays: 1.5 })).toThrow(RetentionParamInvalidError);
  });

  it("assertValidRetentionParams accepts a fully-valid record and rejects an invalid one", () => {
    expect(() => assertValidRetentionParams(paramsAllSetTo(90))).not.toThrow();
    expect(() => assertValidRetentionParams({ ...paramsAllSetTo(90), logDays: 0 })).toThrow(RetentionParamInvalidError);
  });

  it.each(DAY_VALUES)("mergeRetentionOverride patches one field and revalidates the WHOLE result (materialDays = %i)", (days) => {
    const current = paramsAllSetTo(50);
    const merged = mergeRetentionOverride(current, { materialDays: days });
    expect(merged.materialDays).toBe(days);
    expect(merged.derivedDays).toBe(50);
  });

  it("mergeRetentionOverride throws on a patch that produces an invalid result", () => {
    expect(() => mergeRetentionOverride(paramsAllSetTo(50), { backupDays: -1 })).toThrow(RetentionParamInvalidError);
  });
});

describe("F46 · material retention expiry / reminder are pure date arithmetic over an injected param", () => {
  it.each(DAY_VALUES)("isPastMaterialRetention: exactly at materialDays = %i -> past (>=)", (days) => {
    const materializedAt = new Date("2026-01-01T00:00:00.000Z");
    const params = paramsAllSetTo(days);
    const exactlyAtDeadline = new Date(materializedAt.getTime() + days * 24 * 60 * 60 * 1000);
    const beforeDeadline = new Date(exactlyAtDeadline.getTime() - 1000);
    expect(isPastMaterialRetention(materializedAt, exactlyAtDeadline, params)).toBe(true);
    expect(isPastMaterialRetention(materializedAt, beforeDeadline, params)).toBe(false);
  });

  it.each(DAY_VALUES)("isNearMaterialRetention: within the caller-supplied reminder window before materialDays = %i, but not after", (days) => {
    const materializedAt = new Date("2026-01-01T00:00:00.000Z");
    const params = paramsAllSetTo(days);
    const reminderDays = 3;
    const deadline = materializedAt.getTime() + days * 24 * 60 * 60 * 1000;
    const withinWindow = new Date(deadline - reminderDays * 24 * 60 * 60 * 1000 + 1000);
    const outsideWindow = new Date(deadline - (reminderDays + 1) * 24 * 60 * 60 * 1000);
    const afterExpiry = new Date(deadline + 1000);
    expect(isNearMaterialRetention(materializedAt, withinWindow, params, reminderDays)).toBe(true);
    expect(isNearMaterialRetention(materializedAt, outsideWindow, params, reminderDays)).toBe(false);
    // Already past retention -- "near" and "past" cannot both be true (past takes over).
    expect(isNearMaterialRetention(materializedAt, afterExpiry, params, reminderDays)).toBe(false);
  });
});

describe("F46 · no day-count literal in domain/files/retention-policy.ts's resolution logic", () => {
  it("the file's body contains no bare 180 / 30 / 1095 (O-01's own three headline numbers)", () => {
    const path = fileURLToPath(new URL("../../src/domain/files/retention-policy.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    // Strip comments first -- the header PROSE legitimately discusses "180"/"30"/"1095" as
    // examples; only the CODE must never declare them as computation inputs.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const forbidden of ["180", "30", "1095"]) {
      expect(codeOnly, `found bare literal ${forbidden} in retention-policy.ts's code`).not.toMatch(
        new RegExp(`(?<![\\w.])${forbidden}(?![\\w])`),
      );
    }
  });
});
