/** Run from the repo root:
 * TSX_TSCONFIG_PATH=apps/web/tsconfig.json pnpm exec tsx evidence/i18n-recording-6214/compare-copy-source.ts
 * This is a one-time extraction receipt against a frozen baseline, not a fixture authority.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as rec from "../../apps/web/lib/mock/rec";
import * as v2 from "../../apps/web/lib/mock/rec-v2";
import { recordingProjectZhCN, recordingProjectEn } from "../../apps/web/lib/i18n/namespaces/recording-project";

const data = (module: Record<string, unknown>) => Object.fromEntries(Object.entries(module).filter(([, value]) => typeof value !== "function"));
const actual = JSON.parse(JSON.stringify({
  rec: data(rec), v2: data(v2),
  probes: [0, 1, 90, 180].map(days => ({ days, items: rec.consentItemsFor(days), notice: rec.CONSENT_RENDER.liveTemplate(days) })),
  zh: recordingProjectZhCN, en: recordingProjectEn,
}));
const baselineBytes = readFileSync("evidence/i18n-recording-6214/copy-baseline.json");
const expected = JSON.parse(baselineBytes.toString("utf8"));
// Four later fixed-state translations legitimately extend the dictionary. Every
// original dictionary value and all seed/probe data must still match the snapshot.
const addedCaptionKeys = ["rec.project.verify.uncertainSpeaker", "rec.project.verify.overlapHint", "rec.project.verify.painMarker", "rec.project.verify.reviewNeeded"].sort();
for (const locale of ["zh", "en"]) {
  const added = Object.keys(actual[locale]).filter(key => !Object.hasOwn(expected[locale], key)).sort();
  assert.deepStrictEqual(added, addedCaptionKeys);
  actual[locale] = Object.fromEntries(Object.keys(expected[locale]).map(key => [key, actual[locale][key]]));
}
assert.deepStrictEqual(actual, expected);
console.log(JSON.stringify({ equalBaselineValues: true, addedCaptionKeys, sections: Object.keys(actual), baselineSha256: createHash("sha256").update(baselineBytes).digest("hex"), baselineBytes: baselineBytes.length }));
