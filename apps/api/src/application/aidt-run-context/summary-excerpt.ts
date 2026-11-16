import type { SharedStageValue } from "@repo/contracts/aidt-stages";

/** Internal deterministic excerpting only. This never verifies student claims or changes saved bytes. */
export type AidtSummaryExcerpt = { excerpt: string; omittedPaths: string[]; partialPaths: string[]; note: string };
type Cell = { path: (string | number)[]; value: unknown; priority: number };
const important = [
 "returnStep", "returnReason", "questionSnapshot", "iterationPrototypeReference", "prototypeReference",
 "afterTestBelief", "understandingChangeStatus", "understandingEvidence", "iterationChangeReason", "iterationFeedbackReference",
 "feedback", "reflection", "nextAction", "unresolvedQuestions", "verificationQuestion", "beforeTestBelief", "verificationBasis", "verificationLimits",
 "initial", "whyWorthStudying", "problemSources", "sourceDetails", "rewrittenTheme", "focus", "people", "scene", "activity", "assumptions", "sourceUncertainty", "surpriseStatus", "priorBelief", "surprisingFinding",
 "surpriseSourceDetails", "surpriseInterpretation", "surpriseCardIds", "persona", "hmw", "ideaClassificationTags", "ideaClassificationReasons",
 "version", "questions", "said", "did", "inference", "next", "newVersion", "guide", "adoptedGuide", "sources", "interpretation", "goal", "personaBehavior", "patterns", "insight", "evidence", "decision", "reason", "criteria", "idea", "type", "situation", "touchpoints", "operations", "task", "requirements",
];
const expanded = new Set(["questionSnapshot", "prototypeReference", "iterationPrototypeReference", "iterationPrototypeRelation", "ideaClassificationTags", "ideaClassificationReasons"]);
const repeatedConfirmation = new Set(["verificationQuestionConfirmation", "problemReflectionConfirmation", "ideaClassificationConfirmation"]);
const clip = (text: string, max: number) => { const value = text.slice(0, max); return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value; };
const pathName = (path: Cell["path"]) => path.map(part => typeof part === "number" ? `[${part}]` : part).join(".");
function put(target: Record<string, unknown>, path: Cell["path"], value: unknown): void {
 let cursor: Record<string | number, unknown> = target;
 for (let i = 0; i < path.length - 1; i++) {
  const key = path[i]!;
  // Numeric keys preserve original array positions without inventing null items for omitted cells.
  if (!Object.prototype.hasOwnProperty.call(cursor, key)) Object.defineProperty(cursor, key, { value: {}, enumerable: true, writable: true });
  cursor = cursor[key] as Record<string | number, unknown>;
 }
 Object.defineProperty(cursor, path[path.length - 1]!, { value, enumerable: true, writable: true, configurable: true });
}
/**
 * JSON-string reference fields are expanded as data, never executed or promoted to trusted evidence.
 * Full short teaching facts precede long/repeated metadata. Missing/partial paths are disclosed.
 * Exported so read-only QA can rebuild the projection from the exact authorized saved revision.
 */
export function projectAidtSummaryExcerpt(stage: SharedStageValue, maxChars: number): AidtSummaryExcerpt {
 const cells: Cell[] = [], policyOmitted: string[] = [];
 function visit(value: unknown, path: Cell["path"], priority: number): void {
  if (value !== null && typeof value === "object") {
   const entries = Array.isArray(value) ? value.map((item, index) => [index, item] as const) : Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
   if (entries.length) { for (const [key, item] of entries) visit(item, [...path, key], priority); return; }
  }
  cells.push({ path, value, priority });
 }
 for (const [key, raw] of Object.entries(stage.content.draft.fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
  const path = ["draft", "fields", key];
  if (repeatedConfirmation.has(key)) { policyOmitted.push(pathName(path)); continue; }
  const rank = important.indexOf(key), priority = rank < 0 ? 70 : rank;
  let value: unknown = raw;
  if (expanded.has(key)) { try { const decoded: unknown = JSON.parse(raw); if (decoded !== null && typeof decoded === "object") value = decoded; } catch { /* Keep malformed student data verbatim; do not repair or infer it. */ } }
  visit(value, path, priority);
 }
 visit(stage.sourceStageRevisions, ["sourceStageRevisions"], 45);
 for (const key of ["selectedIdeaId", "selectionReasons", "ideas", "discoveryCards", "unboundReason"] as const) if (stage.content.draft[key] !== undefined) visit(stage.content.draft[key], ["draft", key], key === "discoveryCards" ? 46 : 47);
 if (stage.content.summaryReport) visit(stage.content.summaryReport, ["studentReportDraft"], 100);
 cells.sort((a, b) => a.priority - b.priority || (pathName(a.path) < pathName(b.path) ? -1 : pathName(a.path) > pathName(b.path) ? 1 : 0));
 const included = new Map<Cell, unknown>();
 const render = () => {
  const result: Record<string, unknown> = { projection: "saved-field-excerpts-not-full-source" };
  for (const cell of cells) if (included.has(cell)) put(result, cell.path, included.get(cell));
  return JSON.stringify(result);
 };
 for (const cell of cells) { included.set(cell, cell.value); if (render().length > maxChars) included.delete(cell); }
 // Use remaining room for long student text only after every complete short fact had a chance.
 const partialPaths: string[] = [];
 for (const cell of cells) {
  if (included.has(cell) || typeof cell.value !== "string" || cell.value.length === 0) continue;
  let low = 0, high = cell.value.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); included.set(cell, clip(cell.value, mid)); if (render().length <= maxChars) low = mid; else high = mid - 1; }
  if (low >= 16) { included.set(cell, clip(cell.value, low)); partialPaths.push(pathName(cell.path)); } else included.delete(cell);
 }
 const omittedPaths = [...policyOmitted, ...cells.filter(cell => !included.has(cell)).map(cell => pathName(cell.path))].sort();
 const prefix = `字段摘录非全文；JSON引用展开，数组按原下标；未验证。省略${omittedPaths.length}路径；局部截断${partialPaths.length}路径${JSON.stringify(partialPaths)}；省略路径`;
 const details = prefix + JSON.stringify(omittedPaths);
 const excerpt = render().length <= maxChars ? render() : "";
 const note = (excerpt ? "" : "本源可见正文为空；") + (details.length <= 350 ? `${details}；完整原稿见所列精确修订。` : `${clip(details, 350)}…（路径清单亦截短；完整原稿见所列精确修订）`);
 return { excerpt, omittedPaths, partialPaths, note: clip(note, 400) };
}
