/** Read-only QA checks. Rebuilding a projection is supplemented by independent saved-value checks. */
import { aidtContextCanonicalJson } from '@repo/contracts/aidt-run-context';
import type { SharedStageValue } from '@repo/contracts/aidt-stages';
import { projectAidtSummaryExcerpt } from '../../src/application/aidt-run-context/summary-excerpt';

const marker = 'saved-field-excerpts-not-full-source';
// Kept independent of the production projector: arbitrary JSON-looking fields must stay strings.
const expandedReferences = new Set(['questionSnapshot', 'prototypeReference', 'iterationPrototypeReference', 'iterationPrototypeRelation', 'ideaClassificationTags', 'ideaClassificationReasons']);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(value: unknown, code: string): asserts value { if (!value) throw Error(code); }
function decodedField(key: string, raw: string): unknown {
  if (expandedReferences.has(key)) {
    try { const value: unknown = JSON.parse(raw); if (value !== null && typeof value === 'object') return value; } catch { /* malformed saved text stays verbatim */ }
  }
  return raw;
}
function savedPayload(stage: SharedStageValue) {
  return { draft: stage.content.draft, ...(stage.content.summaryReport ? { studentReportDraft: stage.content.summaryReport } : {}), sourceStageRevisions: stage.sourceStageRevisions };
}
function projectedObject(excerpt: string): Record<string, unknown> {
  let parsed: unknown; try { parsed = JSON.parse(excerpt); } catch { throw Error('AUDIT_SUMMARY_PROJECTION_JSON_INVALID'); }
  need(record(parsed) && parsed.projection === marker, 'AUDIT_SUMMARY_PROJECTION_MARKER_INVALID');
  return parsed;
}
export type AidtAuditExcerptResult = { format: 'raw-canonical-prefix' | 'summary-field-projection'; independentlyCheckedLeaves: number; partialPaths: string[] };
export function verifyAidtAuditExcerpt(input: { stage: SharedStageValue; excerpt: string; truncated: boolean; purpose: 'stage' | 'summary'; payload?: unknown }): AidtAuditExcerptResult {
  const { stage, excerpt, truncated } = input, payload = input.payload ?? savedPayload(stage), full = aidtContextCanonicalJson(payload);
  if (full.startsWith(excerpt)) {
    need(truncated || excerpt === full, 'AUDIT_RAW_EXCERPT_TRUNCATION_MISMATCH');
    return { format: 'raw-canonical-prefix', independentlyCheckedLeaves: 0, partialPaths: [] };
  }
  need(input.purpose === 'summary' && input.payload === undefined && truncated, 'AUDIT_SUMMARY_PROJECTION_SCOPE_MISMATCH');
  const projected = projectedObject(excerpt), partialPaths: string[] = []; let leaves = 0;
  function check(value: unknown, actual: unknown, path: string[]): void {
    if (record(value) && Object.keys(value).length > 0) {
      need(actual !== null && typeof actual === 'object', 'AUDIT_PROJECTED_PATH_NOT_SAVED');
      for (const [key, item] of Object.entries(value)) {
        need(!Array.isArray(actual) || /^(0|[1-9]\d*)$/.test(key), 'AUDIT_PROJECTED_ARRAY_INDEX_INVALID');
        need(own(actual, key), 'AUDIT_PROJECTED_PATH_NOT_SAVED');
        check(item, (actual as Record<string, unknown>)[key], [...path, key]);
      }
      return;
    }
    leaves++;
    if (typeof value === 'string' && typeof actual === 'string') {
      need(actual.startsWith(value), 'AUDIT_PROJECTED_VALUE_NOT_SAVED_PREFIX');
      if (value !== actual) partialPaths.push(path.join('.'));
    } else need(aidtContextCanonicalJson(value) === aidtContextCanonicalJson(actual), 'AUDIT_PROJECTED_VALUE_NOT_SAVED');
  }
  // Resolve roots and expand only approved JSON reference strings independently of the projector.
  const expected = savedPayload(stage);
  const normalized = { ...expected, draft: { ...expected.draft, fields: Object.fromEntries(Object.entries(expected.draft.fields).map(([key, value]) => [key, decodedField(key, value)])) } };
  for (const [key, value] of Object.entries(projected)) {
    if (key === 'projection') continue;
    need(own(normalized, key), 'AUDIT_PROJECTED_ROOT_NOT_SAVED');
    check(value, normalized[key as keyof typeof normalized], [key]);
  }
  // The cap is reconstructed from the actual serialized excerpt size, not a selected-source count.
  need(projectAidtSummaryExcerpt(stage, excerpt.length).excerpt === excerpt, 'AUDIT_SUMMARY_PROJECTION_REBUILD_MISMATCH');
  return { format: 'summary-field-projection', independentlyCheckedLeaves: leaves, partialPaths };
}

/** Encoding counts from legacy raw prefixes are not comparable with expanded JSON values. */
export function readAidtAuditFieldVisibility(stage: SharedStageValue, excerpt: string, key: string, format: AidtAuditExcerptResult['format']) {
  const value = stage.content.draft.fields[key];
  if (value === undefined) return { savedFieldExists: false as const };
  const encoded = JSON.stringify(key) + ':' + JSON.stringify(value);
  if (format === 'raw-canonical-prefix') {
    const full = aidtContextCanonicalJson(savedPayload(stage)), start = full.indexOf(encoded);
    need(start >= 0, 'AUDIT_FIELD_SERIALIZATION_MISSING');
    const visible = Math.max(0, Math.min(encoded.length, excerpt.length - start));
    return { savedFieldExists: true as const, fieldRepresentation: 'raw-canonical-prefix', fieldStartVisible: visible > 0, entireSavedValueVisible: visible === encoded.length, entireEncodedFieldVisible: visible === encoded.length, encodedFieldCharactersVisible: visible, encodedFieldCharactersTotal: encoded.length };
  }
  const parsed = projectedObject(excerpt), fields = record(parsed.draft) && record(parsed.draft.fields) ? parsed.draft.fields : {};
  const present = own(fields, key), expected = decodedField(key, value), expanded = typeof expected !== 'string';
  const complete = present && aidtContextCanonicalJson(fields[key]) === aidtContextCanonicalJson(expected);
  const encodedVisible = present && !expanded ? (JSON.stringify(key) + ':' + JSON.stringify(fields[key])).length : present ? null : 0;
  return { savedFieldExists: true as const, fieldRepresentation: expanded ? 'expanded-json-reference' : 'saved-field-value', fieldStartVisible: present, entireSavedValueVisible: complete, entireEncodedFieldVisible: !expanded && complete, encodedFieldCharactersVisible: encodedVisible, encodedFieldCharactersTotal: encoded.length, projectedFieldCharacters: present ? (JSON.stringify(key) + ':' + JSON.stringify(fields[key])).length : 0 };
}
