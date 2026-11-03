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
assert.deepStrictEqual(actual, JSON.parse(baselineBytes.toString("utf8")));
console.log(JSON.stringify({ equal: true, sections: Object.keys(actual), baselineSha256: createHash("sha256").update(baselineBytes).digest("hex"), baselineBytes: baselineBytes.length }));
