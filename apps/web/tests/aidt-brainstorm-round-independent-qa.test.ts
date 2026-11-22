import { expect, it } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtBrainstormRoundCompletion, aidtBrainstormRoundSelectionKey, aidtBrainstormRoundCompletionKey, readAidtBrainstormRoundCompletion, readAidtBrainstormRoundSelection, readAidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { confirmAidtBrainstormCompletion, confirmAidtBrainstormSelection,
  readAidtBrainstormSelectionForSession, readAidtConfirmedBrainstormRounds } from "@/features/aidt/lib/aidt-brainstorm";
import { readAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";
import { readAidtIdeaHandoff } from "@/features/aidt/lib/aidt-idea-handoff";
import { parseAidtResearchMaterial } from "@/features/aidt/lib/aidt-research-material-reference";
import { projectId, empty, source, prepared, completed } from "./aidt-round-fixture-independent-qa";

it("retains A and B's three formal sheets, HMW and independent classification after both rounds complete", () => {
  const a = completed(empty(), "a");
  const frozenA = a.draft.fields[aidtBrainstormRoundCompletionKey(a.sessionId)];
  const b = completed(a.draft, "b");
  expect(b.draft.fields[aidtBrainstormRoundCompletionKey(a.sessionId)]).toBe(frozenA);
  const rounds = readAidtConfirmedBrainstormRounds(b.draft, projectId);
  expect(rounds.map(round => round.sessionId)).toEqual([a.sessionId, b.sessionId]);
  for (const [index, value] of [a, b].entries()) {
    const formal = rounds[index]!;
    expect(formal.sheetIds).toEqual(value.ids); expect(formal.ideas.map(idea => idea.id)).toEqual(value.ids);
    expect(formal.source).toEqual(source(index === 0 ? "a" : "b"));
    expect(formal.selectedIds).toEqual([value.ids[0]]);
    expect(readAidtIdeaClassification(formal.classificationDraft)).toMatchObject({ confirmed: true, tags: Object.fromEntries(value.ids.map(id => [id, [index === 0 ? "easy" : "fun"]])) });
    expect(readAidtIdeaHandoff(formal.draft, projectId)).toMatchObject({ sheetIds: value.ids, selectedIds: [value.ids[0]] });
    expect(formal.ideas.some(idea => (index === 0 ? b.ids : a.ids).includes(idea.id))).toBe(false);
  }
  expect(readAidtBrainstormSelectionForSession(b.draft, a.sessionId)?.selectedIds).toEqual([a.ids[0]]);
  expect(readAidtBrainstormSelectionForSession(b.draft, b.sessionId)?.selectedIds).toEqual([b.ids[0]]);
});

it("keeps formal A unchanged when its pending selection or unconfirmed text/classification is edited", () => {
  const a = completed(empty(), "a"); const before = readAidtConfirmedBrainstormRounds(a.draft, projectId, { sessionId: a.sessionId })[0]!;
  const pending = confirmAidtBrainstormSelection(a.draft, a.sessionId, [a.ids[1]!]);
  const changed = { ...pending, ideas: pending.ideas.map(idea => idea.id === a.ids[0] ? { ...idea, title: "尚未确认的新标题", description: "新一轮想法。尚未审阅。" } : idea),
    fields: { ...pending.fields, ideaClassificationConfirmed: "", ideaClassificationTags: "{}", ideaClassificationReasons: "{}" } };
  const after = readAidtConfirmedBrainstormRounds(changed, projectId, { sessionId: a.sessionId })[0]!;
  expect(after).toEqual(before);
  expect(readAidtBrainstormSelectionForSession(changed, a.sessionId)?.selectedIds).toEqual([a.ids[1]]);
  expect(confirmAidtBrainstormCompletion(changed, a.sessionId, a.ids, projectId)).toBe(changed);
});

it("creates no formal result from only selection or classification, and keeps the old serialized stage frozen", () => {
  const ready = prepared(empty(), "a");
  expect(readAidtConfirmedBrainstormRounds(ready.draft, projectId)).toEqual([]);
  const oldStageBytes = JSON.stringify(ready.draft);
  const saved = confirmAidtBrainstormCompletion(ready.draft, ready.sessionId, ready.ids, projectId);
  expect(readAidtConfirmedBrainstormRounds(saved, projectId)).toHaveLength(1);
  expect(JSON.stringify(ready.draft)).toBe(oldStageBytes);
  expect(readAidtConfirmedBrainstormRounds(JSON.parse(oldStageBytes), projectId)).toEqual([]);
});

it.each(["two-sheets", "image-missing", "unreviewed", "wrong-hmw", "classification-unconfirmed"] as const)("does not promote incomplete round data: %s", fault => {
  const ready = prepared(empty(), "a"); let changed = ready.draft; let ids = ready.ids;
  if (fault === "two-sheets") ids = ready.ids.slice(0, 2);
  if (fault === "image-missing") { const fields = { ...changed.fields }; delete fields[`ideaFile:${ready.ids[2]}`]; changed = { ...changed, fields }; }
  if (fault === "unreviewed") { const fields = { ...changed.fields }; delete fields[`ideaChatConfirmation:${ready.ids[2]}`]; changed = { ...changed, fields }; }
  if (fault === "wrong-hmw") changed = { ...changed, fields: { ...changed.fields, [`ideaBrainstorm:${ready.sessionId}`]: JSON.stringify({ ...readAidtBrainstorm(changed.fields, ready.sessionId), source: source("b") }) } };
  if (fault === "classification-unconfirmed") {
    const own = readAidtBrainstormRoundSelection(changed.fields, ready.sessionId)!;
    const { classification: _classification, ...selectionOnly } = own;
    changed = { ...changed, fields: { ...changed.fields, [aidtBrainstormRoundSelectionKey(ready.sessionId)]: JSON.stringify(selectionOnly), ideaClassificationConfirmed: "" } };
  }
  expect(confirmAidtBrainstormCompletion(changed, ready.sessionId, ids, projectId)).toBe(changed);
  expect(readAidtBrainstormRoundCompletion(changed.fields, ready.sessionId)).toBeNull();
});

it("returns the original draft at the 100-field capacity boundary rather than claiming a new formal save", () => {
  const ready = prepared(empty(), "a"); const fields = { ...ready.draft.fields };
  for (let n = 0; Object.keys(fields).length < 100; n++) fields[`qa-filler-${n}`] = "synthetic capacity fixture";
  const full = StageDraft.parse({ ...ready.draft, fields });
  expect(Object.keys(full.fields)).toHaveLength(100);
  expect(confirmAidtBrainstormCompletion(full, ready.sessionId, ready.ids, projectId)).toBe(full);
  expect(readAidtBrainstormRoundCompletion(full.fields, ready.sessionId)).toBeNull();
  expect(Object.keys(full.fields)).toHaveLength(100);
});

it("refuses an over-6000 formal snapshot while retaining valid image references and the student's pending decision", () => {
  const ready = prepared(empty(), "a", true);
  expect(readAidtBrainstormRoundSelection(ready.draft.fields, ready.sessionId)?.classification?.confirmed).toBe(true);
  expect(Object.values(ready.draft.fields).every(value => value.length <= 6000)).toBe(true);
  expect(ready.ids.every(id => parseAidtResearchMaterial(ready.draft.fields[`ideaFile:${id}`])?.projectId === projectId)).toBe(true);
  const selection = readAidtBrainstormRoundSelection(ready.draft.fields, ready.sessionId)!;
  const raw = AidtBrainstormRoundCompletion.parse({ schemaVersion: 1, status: "confirmed", sessionId: ready.sessionId, projectId, title: "合成 A 轮", source: source("a"), method: "scamper", selectedIds: selection.selectedIds,
    sheets: ready.ids.map(id => ({ ...ready.draft.ideas.find(idea => idea.id === id)!, imageMaterial: ready.draft.fields[`ideaFile:${id}`] })),
    classification: { tags: selection.classification!.tags, reasons: selection.classification!.reasons, titles: Object.fromEntries(ready.draft.ideas.map(idea => [idea.id, idea.title])), confirmed: true } });
  expect(JSON.stringify(raw).length).toBeGreaterThan(6000);
  expect(confirmAidtBrainstormCompletion(ready.draft, ready.sessionId, ready.ids, projectId)).toBe(ready.draft);
  expect(readAidtBrainstormRoundSelection(ready.draft.fields, ready.sessionId)?.selectedIds).toEqual([ready.ids[0]]);
});

it.each(["json", "unknown-field", "duplicate-sheet", "unknown-category", "overlong", "foreign-project"] as const)("rejects a damaged own completion without borrowing a valid global fallback: %s", fault => {
  const a = completed(empty(), "a"); const key = aidtBrainstormRoundCompletionKey(a.sessionId);
  const record = JSON.parse(a.draft.fields[key]!);
  const legacy = { ...a.draft, fields: { ...a.draft.fields } }; delete legacy.fields[key];
  expect(readAidtConfirmedBrainstormRounds(legacy, projectId, { sessionId: a.sessionId })[0]?.legacy).toBe(true);
  if (fault === "unknown-field") record.unrecognized = true;
  if (fault === "duplicate-sheet") record.sheets[2] = record.sheets[0];
  if (fault === "unknown-category") record.classification.tags[a.ids[0]!] = ["made-up-category"];
  if (fault === "foreign-project") record.projectId = "another-project";
  const raw = fault === "json" ? "{broken" : fault === "overlong" ? " ".repeat(6001) : JSON.stringify(record);
  const damaged = { ...legacy, fields: { ...legacy.fields, [key]: raw } };
  expect(readAidtConfirmedBrainstormRounds(damaged, projectId, { sessionId: a.sessionId })).toEqual([]);
});
