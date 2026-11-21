"use client";
import * as React from "react";
import { StageContent } from "@repo/contracts/aidt-stages";
import { ApiError } from "@/lib/api-client";
import { aidtUiReportMarkdown, aidtUiStageSummary, emptyAidtUiDrafts, type AidtUiDrafts, type AidtUiStageDraft } from "./aidt-ui-drafts";
import { readAidtStage, saveAidtStage, type AidtSharedStage } from "./live-aidt-stages";

import { readAidtDefinitionEvidenceRevision } from "./aidt-definition";
import { parseAidtSurpriseReflection, readAidtSurpriseSourceRevision } from "./aidt-surprise-reflection";
import { readAidtIdeaHmwSource } from "./aidt-idea-handoff";
import { readAidtQuestionSnapshot } from "./aidt-verification-loop";

type Scope = { projectId: string; orgId: string; userId: string; sessionToken: string };
type Source = AidtSharedStage["sourceStageRevisions"][number];
type ReadState = { key: string; phase: "loading" | "ready" | "error"; stages: Record<number, AidtSharedStage>; error?: string };
type WriteState = { key: string; phase: "idle" | "saving" | "saved" | "error" | "conflict"; stage?: AidtSharedStage; error?: string; signature?: string };
export type AidtSharedReportController = {
  available: boolean; loading: boolean; saving: boolean; canSave: boolean;
  serverRevision: number | null; serverMarkdown: string | null; savedAt: string | null; savedBy: string | null;
  confirmedAtRevision?: number; canConfirm?: boolean; confirm?: () => Promise<void>;
  matchesServer: boolean; conflict: boolean; needsBaseReview: boolean; error: string | null; loadError: string | null;
  availableSources?: Source[]; selectedSources?: Source[]; chooseSources?: (sources: Source[]) => void;
  sourceStageRevisions?: NonNullable<AidtSharedStage["content"]["summaryReport"]>["sourceStageRevisions"];
  save: () => Promise<void>; reload: () => void; restore: () => void; reviewBase: () => void;
};
export function aidtSharedDraftSignature(value: AidtUiStageDraft): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
function readGroupReport(stage: AidtSharedStage | undefined, entityId?: string) {
  return entityId ? stage?.content.reports?.[entityId] : stage?.content.summaryReport;
}
function aidtReportSignature(report: AidtSharedStage["content"]["summaryReport"]) {
  return JSON.stringify(report && [report.markdown, report.sourceStageRevisions, report.confirmedAtRevision]);
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
/** Server working drafts, never a completion/confirmation flag. Reads never replace an edited form. */
function resolveDraftSources(stageId: number | null, draft: AidtUiStageDraft | undefined, chosenSourceStageRevisions: Source[]) {
  // A captured test question stays attached to the historical saved prototype
  // revision, even if the fifth-stage head advances. The API checks it exists.
  const questionRevision = stageId === 6 && draft ? readAidtQuestionSnapshot(draft)?.sourceStageRevision : null;
  const surpriseRevisionValue = draft ? readAidtSurpriseSourceRevision(draft) : null;
  const surprise = stageId === 3 && draft ? parseAidtSurpriseReflection(draft) : null;
  const surpriseRevision = surprise?.status === "found" && surprise.cardIds.length > 0 && !surprise.invalidCardIds && draft?.fields.surpriseConfirmed === "true" && surpriseRevisionValue !== null && Number.isSafeInteger(surpriseRevisionValue) && surpriseRevisionValue > 0 ? surpriseRevisionValue : null;
  const definitionRevision = (stageId === 3 && draft ? readAidtDefinitionEvidenceRevision(draft.fields) : null) ?? surpriseRevision;
  const ideaHmwRevision = stageId === 4 && draft ? readAidtIdeaHmwSource(draft)?.revision : null;
  const lockedSourceStage = ideaHmwRevision ? { stageId: 3, revision: ideaHmwRevision }
    : questionRevision ? { stageId: 5, revision: questionRevision }
    : definitionRevision ? { stageId: 2, revision: definitionRevision }
    : null;
  const sourceStageRevisions = lockedSourceStage
    ? [...chosenSourceStageRevisions.filter(source => source.stageId !== lockedSourceStage.stageId), lockedSourceStage].sort((a, b) => a.stageId - b.stageId)
    : chosenSourceStageRevisions;
  return { questionRevision, lockedSourceStage, sourceStageRevisions };
}

export function useAidtSharedStages({ enabled, scope, lifecycleKey, stageId, drafts, canWrite, onHydrate, reportText = null, onHydrateReport, reportEntityId }: {
  enabled: boolean; scope: Scope | null; lifecycleKey: string; stageId: number | null;
  drafts: AidtUiDrafts; canWrite: boolean; onHydrate: (stageId: number, draft: AidtUiStageDraft) => void;
  reportText?: string | null; onHydrateReport?: (markdown: string) => void; reportEntityId?: string;
}) {
  const actorScope = JSON.stringify([enabled, scope, lifecycleKey, canWrite, reportEntityId]);
  const lifecycle = React.useRef({ actorScope, generation: 0 });
  if (lifecycle.current.actorScope !== actorScope) lifecycle.current = { actorScope, generation: lifecycle.current.generation + 1 };
  const key = JSON.stringify([actorScope, lifecycle.current.generation]);
  const writeKey = JSON.stringify([key, stageId]);
  const reportKey = JSON.stringify([key, "summary-report"]);
  const editScope = JSON.stringify([lifecycleKey, scope?.projectId, scope?.orgId, scope?.userId, reportEntityId]);
  const editLifecycle = React.useRef({ scope: editScope, generation: 0 });
  if (editLifecycle.current.scope !== editScope) editLifecycle.current = { scope: editScope, generation: editLifecycle.current.generation + 1 };
  const editKey = JSON.stringify([editScope, editLifecycle.current.generation]);
  const draftChanges = React.useRef<{ key: string; entries: Record<number, { signature: string; changes: number }> }>({ key: editKey, entries: {} });
  if (draftChanges.current.key !== editKey) draftChanges.current = { key: editKey, entries: {} };
  for (const [id, value] of Object.entries(drafts)) {
    const number = Number(id), signature = aidtSharedDraftSignature(value), previous = draftChanges.current.entries[number];
    draftChanges.current.entries[number] = { signature, changes: previous ? previous.changes + Number(previous.signature !== signature) : 0 };
  }
  const latest = React.useRef({ key, writeKey, drafts, canWrite, onHydrate, reportText, onHydrateReport }); latest.current = { key, writeKey, drafts, canWrite, onHydrate, reportText, onHydrateReport };
  const available = Boolean(enabled && scope);
  const [read, setRead] = React.useState<ReadState | null>(null);
  const [write, setWrite] = React.useState<WriteState | null>(null);
  const [reportWrite, setReportWrite] = React.useState<WriteState | null>(null);
  const [reloadCount, setReloadCount] = React.useState(0);
  const [baseChoice, setBaseChoice] = React.useState<{ key: string; revision: number } | null>(null);
  const [reportSourceChoice, setReportSourceChoice] = React.useState<{ key: string; sources: Source[] } | null>(null);
  const [reportBase, setReportBase] = React.useState<{ key: string; revision: number } | null>(null);
  const [sources, setSources] = React.useState<{ key: string; stages: Record<number, Source[]> } | null>(null);
  const attempt = React.useRef<{ key: string; signature: string; operationId: string } | null>(null);
  const reportAttempt = React.useRef<{ key: string; signature: string; operationId: string } | null>(null);
  const inFlight = React.useRef<{ key: string; controller: AbortController } | null>(null);
  const currentRead = read?.key === key ? read : null;
  const currentWrite: WriteState = write?.key === writeKey ? write : { key: writeKey, phase: "idle" };
  const currentReportWrite: WriteState = reportWrite?.key === reportKey ? reportWrite : { key: reportKey, phase: "idle" };
  const stages = currentRead?.stages ?? {};
  const server = stageId ? stages[stageId] : undefined;
  const draft = stageId ? drafts[stageId] : undefined;
  const signature = draft ? aidtSharedDraftSignature(draft) : "";
  const chosenSourceStageRevisions = stageId && sources?.key === editKey && sources.stages[stageId] !== undefined ? sources.stages[stageId]! : server?.sourceStageRevisions ?? [];
  const { questionRevision, lockedSourceStage, sourceStageRevisions } = resolveDraftSources(stageId, draft, chosenSourceStageRevisions);
  const conflicted = currentWrite.phase === "conflict";
  const needsBaseReview = conflicted && baseChoice?.key !== writeKey;
  const expectedRevision = baseChoice?.key === writeKey ? baseChoice.revision : server?.revision ?? 0;
  const canWriteDraft = available && canWrite && currentRead?.phase === "ready" && currentWrite.phase !== "saving" && currentReportWrite.phase !== "saving" && !needsBaseReview;
  const canSave = canWriteDraft && Boolean(stageId && draft && (server || aidtUiStageSummary(stageId, draft)));
  const matchesServer = Boolean(server && draft && aidtSharedDraftSignature(server.content.draft) === signature && JSON.stringify(server.sourceStageRevisions) === JSON.stringify(sourceStageRevisions));

  React.useEffect(() => {
    if (!available || !scope) return;
    const cancellation = new AbortController(), capturedScope = { ...scope };
    const original = Object.fromEntries(Object.entries(draftChanges.current.entries).map(([id, value]) => [id, value.changes]));
    const previousStages = read?.key === key ? read.stages : {};
    const originalReport = latest.current.reportText;
    let active = true;
    setRead(old => ({ key, phase: "loading", stages: old?.key === key ? old.stages : {} }));
    void Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtStage(capturedScope.projectId, id, capturedScope.sessionToken, cancellation.signal))).then(results => {
      if (!active || latest.current.key !== key) return;
      const loaded: Record<number, AidtSharedStage> = {};
      for (const result of results) {
        const item = result.stage;
        if (!item) continue;
        if (item.projectId !== capturedScope.projectId) throw new Error("stage scope mismatch");
        loaded[item.stageId] = item;
      }
      setRead({ key, phase: "ready", stages: loaded });
      for (const item of Object.values(loaded)) {
        const current = latest.current.drafts[item.stageId];
        // Re-entry recovers untouched empty forms. Refresh may update a clean prior server
        // projection; edited forms, including deliberately cleared forms, always win.
        const unchanged = original[item.stageId] === draftChanges.current.entries[item.stageId]?.changes;
        const untouchedEmpty = current && !aidtUiStageSummary(item.stageId, current) && original[item.stageId] === 0;
        const previous = previousStages[item.stageId];
        const cleanServerProjection = current && previous && aidtSharedDraftSignature(current) === aidtSharedDraftSignature(previous.content.draft);
        if (current && unchanged && (untouchedEmpty || cleanServerProjection) && aidtSharedDraftSignature(current) !== aidtSharedDraftSignature(item.content.draft)) latest.current.onHydrate(item.stageId, clone(item.content.draft));
      }
      const report = readGroupReport(loaded[6], reportEntityId);
      const previousReport = readGroupReport(previousStages[6], reportEntityId);
      if (report && latest.current.reportText === originalReport && report.markdown !== latest.current.reportText && (originalReport === null || originalReport === previousReport?.markdown)) latest.current.onHydrateReport?.(report.markdown);
    }).catch(() => { if (active && latest.current.key === key) setRead(old => ({ key, phase: "error", stages: old?.key === key ? old.stages : {}, error: "小组成果读取失败。本页内容仍保留，请重试。" })); });
    return () => { active = false; cancellation.abort(); };
    // All identity values are captured in key; equal DTOs must not restart the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, available, reloadCount]);
  React.useEffect(() => () => {
    if (inFlight.current?.key === writeKey) {
      inFlight.current.controller.abort();
      inFlight.current = null;
      setWrite(previous => previous?.key === writeKey && previous.phase === "saving" ? { ...previous, phase: "error", error: "已离开本步，保存回执尚未确认。草稿仍保留，可刷新核对或重试。" } : previous);
    }
  }, [writeKey]);
  React.useEffect(() => () => { if (inFlight.current?.key === reportKey) { inFlight.current.controller.abort(); inFlight.current = null; } }, [reportKey]);

  function reload() { if (latest.current.key === key && !inFlight.current) setReloadCount(value => value + 1); }
  const currentSnapshot = React.useRef(currentRead);
  currentSnapshot.current = currentRead;
  const stageRefresh = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => stageRefresh.current?.abort(), [writeKey]);
  async function refreshCurrentStage() {
    if (!scope || !stageId || latest.current.writeKey !== writeKey) return;
    stageRefresh.current?.abort();
    const controller = new AbortController();
    stageRefresh.current = controller;
    try {
      const { stage } = await readAidtStage(scope.projectId, stageId, scope.sessionToken, controller.signal);
      if (controller.signal.aborted || latest.current.writeKey !== writeKey || !stage || stage.projectId !== scope.projectId || stage.stageId !== stageId) return;
      const previous = currentSnapshot.current?.stages[stageId];
      if (previous && previous.revision >= stage.revision) return;
      const local = latest.current.drafts[stageId];
      if (local && (previous ? aidtSharedDraftSignature(local) === aidtSharedDraftSignature(previous.content.draft) : !aidtUiStageSummary(stageId, local))) latest.current.onHydrate(stageId, clone(stage.content.draft));
      setRead(old => old?.key === key && (old.stages[stageId]?.revision ?? 0) < stage.revision ? { ...old, stages: { ...old.stages, [stageId]: stage } } : old);
    } catch {
      if (!controller.signal.aborted && latest.current.writeKey === writeKey) reload();
    }
  }
  function setStageSources(values: Source[]) {
    if (!stageId) return;
    setSources(previous => ({ key: editKey, stages: { ...(previous?.key === editKey ? previous.stages : {}), [stageId]: values } }));
  }
  function chooseSource(id: number, selected: boolean) {
    if (lockedSourceStage?.stageId === id) return;
    if (latest.current.writeKey !== writeKey || !latest.current.canWrite || !stages[id] || !stageId || id >= stageId) return;
    const next = sourceStageRevisions.filter(value => value.stageId !== id);
    if (selected) next.push({ stageId: id, revision: stages[id]!.revision });
    setStageSources(next.sort((a, b) => a.stageId - b.stageId));
  }
  function reviewServerBase() { if (latest.current.writeKey === writeKey && latest.current.canWrite && currentRead?.phase === "ready") setBaseChoice({ key: writeKey, revision: server?.revision ?? 0 }); }
  function restoreServer() {
    if (latest.current.writeKey !== writeKey || !latest.current.canWrite || !server) return;
    latest.current.onHydrate(server.stageId, clone(server.content.draft));
    setStageSources(clone(server.sourceStageRevisions));
    setBaseChoice({ key: writeKey, revision: server.revision });
  }
  async function saveCurrent() {
    await saveDraft();
  }
  async function saveDraft(change?: (old: AidtUiStageDraft) => AidtUiStageDraft): Promise<boolean> {
    if (latest.current.writeKey !== writeKey || !latest.current.canWrite || !canWriteDraft || !scope || !stageId || !draft || inFlight.current) return false;
    // An explicit directory action writes against the saved head. Other edits in the local form stay local.
    const base = change ? server?.content.draft ?? emptyAidtUiDrafts()[stageId]! : draft;
    const next = change ? change(base) : base;
    if ((change && next === base) || (!change && !server && !aidtUiStageSummary(stageId, next))) return false;
    const nextSignature = change ? aidtSharedDraftSignature(next) : signature;
    const revision = change ? server?.revision ?? 0 : expectedRevision;
    const legacyReport = server?.content.summaryReport;
    const content = { schemaVersion: 1 as const, draft: clone(next), ...(legacyReport ? { summaryReport: legacyReport } : {}) };
    const refs = clone(change ? resolveDraftSources(stageId, next, server?.sourceStageRevisions ?? []).sourceStageRevisions : sourceStageRevisions);
    const requestSignature = JSON.stringify([scope.projectId, stageId, revision, nextSignature, refs, legacyReport]);
    if (attempt.current?.key !== writeKey || attempt.current.signature !== requestSignature) attempt.current = { key: writeKey, signature: requestSignature, operationId: crypto.randomUUID() };
    const controller = new AbortController(); inFlight.current = { key: writeKey, controller };
    setWrite({ key: writeKey, phase: "saving", signature: nextSignature });
    try {
      const result = await saveAidtStage({ projectId: scope.projectId, stageId, operationId: attempt.current.operationId, expectedRevision: revision, content: StageContent.parse(content), sourceStageRevisions: refs }, scope.sessionToken, controller.signal);
      if (latest.current.writeKey !== writeKey || !latest.current.canWrite || controller.signal.aborted) return false;
      if (result.stage.projectId !== scope.projectId || result.stage.stageId !== stageId) throw new Error("stage scope mismatch");
      setRead(old => ({ key, phase: "ready", stages: { ...(old?.key === key ? old.stages : {}), [stageId]: result.stage } }));
      if (change) {
        const current = latest.current.drafts[stageId]!;
        const changedFields = { ...current.fields };
        for (const [field, value] of Object.entries(next.fields)) if (value !== base.fields[field]) changedFields[field] = value;
        const merged = { ...current, fields: changedFields };
        if (next.ideas !== base.ideas) {
          const previous = new Map(base.ideas.map(idea => [idea.id, idea]));
          const local = new Map(current.ideas.map(idea => [idea.id, idea]));
          merged.ideas = next.ideas.map(idea => idea === previous.get(idea.id) ? local.get(idea.id) ?? idea : idea);
          merged.ideas.push(...current.ideas.filter(idea => !previous.has(idea.id) && !merged.ideas.some(item => item.id === idea.id)));
        }
        if (next.selectedIdeaId !== base.selectedIdeaId) merged.selectedIdeaId = next.selectedIdeaId;
        latest.current.onHydrate(stageId, merged);
      }
      setWrite({ key: writeKey, phase: "saved", stage: result.stage, signature: nextSignature });
      setBaseChoice({ key: writeKey, revision: result.stage.revision });
      if (stageId === 6 && currentReportWrite.phase !== "conflict") setReportBase({ key: reportKey, revision: result.stage.revision });
      return true;
    } catch (error) {
      if (latest.current.writeKey !== writeKey || controller.signal.aborted) return false;
      if (error instanceof ApiError && error.status === 409) {
        setBaseChoice(null);
        try {
          const result = await readAidtStage(scope.projectId, stageId, scope.sessionToken, controller.signal);
          if (latest.current.writeKey !== writeKey || controller.signal.aborted) return false;
          if (result.stage && (result.stage.projectId !== scope.projectId || result.stage.stageId !== stageId)) throw new Error("stage scope mismatch");
          setRead(old => { const values = { ...(old?.key === key ? old.stages : {}) }; if (result.stage) values[stageId] = result.stage; else delete values[stageId]; return { key, phase: "ready", stages: values }; });
          setWrite({ key: writeKey, phase: "conflict", error: "另一位成员已更新本步。本页内容保留，请比较服务器版本后再决定。", signature });
          if (change && latest.current.drafts[stageId] === draft && (matchesServer || (!server && !aidtUiStageSummary(stageId, draft)))) {
            setBaseChoice({ key: writeKey, revision: result.stage?.revision ?? 0 });
            latest.current.onHydrate(stageId, clone(result.stage?.content.draft ?? emptyAidtUiDrafts()[stageId]!));
          }
        } catch { if (latest.current.writeKey === writeKey) { setRead(old => ({ key, phase: "error", stages: old?.key === key ? old.stages : {}, error: "检测到版本冲突，但最新版本读取失败。请重试读取后再保存。" })); setWrite({ key: writeKey, phase: "conflict", error: "本页内容保留，尚未覆盖服务器版本。", signature }); } }
      } else setWrite({ key: writeKey, phase: "error", error: "尚未确认保存成功。本页内容保留，可重试；图片请使用已上传材料引用。", signature });
      return false;
    } finally { if (inFlight.current?.controller === controller) inFlight.current = null; }
  }
  const reportServer = stages[6], serverReport = readGroupReport(reportServer, reportEntityId);
  const discoveryCardsRevision = stages[2] && aidtSharedDraftSignature(stages[2].content.draft) === aidtSharedDraftSignature(drafts[2]!) ? stages[2].revision : undefined;
  const assembledReport = aidtUiReportMarkdown(drafts, { discoveryCardsRevision });
  const reportMarkdown = reportText ?? assembledReport;
  const matchedReportRefs = Object.values(stages).filter(item => drafts[item.stageId] && aidtSharedDraftSignature(item.content.draft) === aidtSharedDraftSignature(drafts[item.stageId]!)).map(item => ({ stageId: item.stageId, revision: item.revision })).sort((a, b) => a.stageId - b.stageId);
  // Provenance follows the report, never whichever stage heads happen to be open
  // when Save is clicked. A manually edited/extended report keeps its original
  // references; an unknown initial manuscript has no inferred saved sources.
  const reportSources = React.useRef<{ key: string; markdown: string; refs: Source[] } | null>(null);
  const previousReportSources = reportSources.current?.key === editKey ? reportSources.current : null;
  if (reportText === null) reportSources.current = { key: editKey, markdown: reportMarkdown, refs: clone(matchedReportRefs) };
  else if (serverReport?.markdown === reportText) reportSources.current = { key: editKey, markdown: reportText, refs: clone(serverReport.sourceStageRevisions) };
  else if (!previousReportSources || previousReportSources.markdown !== reportText) reportSources.current = {
    key: editKey, markdown: reportText,
    refs: clone(previousReportSources ? reportText === assembledReport ? matchedReportRefs : previousReportSources.refs : []),
  };
  const reportRefs = clone(reportSourceChoice?.key === editKey
    ? reportSourceChoice.sources
    : reportSources.current?.key === editKey ? reportSources.current.refs : []);
  const availableReportRefs = Object.values(stages).map(({ stageId, revision }) => ({ stageId, revision })).sort((a, b) => a.stageId - b.stageId);
  const sameRefs = (left: Source[], right: Source[]) =>
    left.length === right.length && left.every(ref => right.some(item => item.stageId === ref.stageId && item.revision === ref.revision));
  const reportMatchesServer = Boolean(serverReport && serverReport.markdown === reportMarkdown && sameRefs(serverReport.sourceStageRevisions, reportRefs));
  const reportNeedsBaseReview = currentReportWrite.phase === "conflict" && reportBase?.key !== reportKey;
  const reportCanSave = available && canWrite && stageId === 6 && currentRead?.phase === "ready" && currentReportWrite.phase !== "saving" && currentWrite.phase !== "saving" && !reportNeedsBaseReview && reportMarkdown.trim().length > 0 && !reportMatchesServer;
  function restoreReport() {
    if (latest.current.key !== key || !latest.current.canWrite || !serverReport) return;
    setReportSourceChoice(null);
    latest.current.onHydrateReport?.(serverReport.markdown);
    setReportBase({ key: reportKey, revision: reportServer!.revision });
  }
  function reviewReportBase() { if (latest.current.key === key && latest.current.canWrite && currentRead?.phase === "ready") setReportBase({ key: reportKey, revision: reportServer?.revision ?? 0 }); }
  const reportCanConfirm = available && canWrite && stageId === 6 && currentRead?.phase === "ready"
    && currentReportWrite.phase !== "saving" && currentWrite.phase !== "saving"
    && !reportNeedsBaseReview && reportMatchesServer && Boolean(reportMarkdown.trim())
    && serverReport?.confirmedAtRevision === undefined;
  async function writeReport(confirming: boolean) {
    if (latest.current.key !== key || !latest.current.canWrite || !(confirming ? reportCanConfirm : reportCanSave) || !scope || inFlight.current) return;
    const expectedRevision = reportBase?.key === reportKey ? reportBase.revision : reportServer?.revision ?? 0;
    const content = {
      schemaVersion: 1 as const,
      draft: clone(reportServer?.content.draft ?? (reportEntityId ? { fields: {}, ideas: [], selectedIdeaId: "" } : emptyAidtUiDrafts()[6]!)),
      summaryReport: {
        markdown: reportMarkdown,
        sourceStageRevisions: confirming && serverReport ? clone(serverReport.sourceStageRevisions) : reportRefs,
        ...(confirming ? { confirmedAtRevision: expectedRevision + 1 } : {}),
      },
    };
    const refs = clone(reportServer?.sourceStageRevisions ?? []);
    const signature = JSON.stringify([expectedRevision, content, refs]);
    if (reportAttempt.current?.key !== reportKey || reportAttempt.current.signature !== signature) reportAttempt.current = { key: reportKey, signature, operationId: crypto.randomUUID() };
    const controller = new AbortController(); inFlight.current = { key: reportKey, controller };
    setReportWrite({ key: reportKey, phase: "saving", signature: reportMarkdown });
    try {
      const result = await saveAidtStage({ projectId: scope.projectId, stageId: 6, expectedRevision, operationId: reportAttempt.current.operationId, content: StageContent.parse(content), sourceStageRevisions: refs, ...(reportEntityId ? { reportEntityId } : {}) }, scope.sessionToken, controller.signal);
      if (latest.current.key !== key || !latest.current.canWrite || controller.signal.aborted) return;
      if (result.stage.projectId !== scope.projectId || result.stage.stageId !== 6
        || aidtReportSignature(readGroupReport(result.stage, reportEntityId)) !== aidtReportSignature(content.summaryReport)) {
        throw new Error("report save not confirmed");
      }
      setRead(old => ({ key, phase: "ready", stages: { ...(old?.key === key ? old.stages : {}), 6: result.stage } }));
      setReportWrite({ key: reportKey, phase: "saved", stage: result.stage, signature: reportMarkdown });
      setReportBase({ key: reportKey, revision: result.stage.revision });
      if (stageId === 6 && currentWrite.phase !== "conflict") setBaseChoice({ key: writeKey, revision: result.stage.revision });
      // Freeze the saved assembled preview only if no newer local report edits exist.
      if (latest.current.reportText === reportText && (reportText !== null || aidtUiReportMarkdown(latest.current.drafts) === reportMarkdown)) latest.current.onHydrateReport?.(reportMarkdown);
    } catch (error) {
      if (latest.current.key !== key || controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 409) {
        setReportBase(null);
        try {
          const result = await readAidtStage(scope.projectId, 6, scope.sessionToken, controller.signal);
          if (latest.current.key !== key || controller.signal.aborted) return;
          if (result.stage && (result.stage.projectId !== scope.projectId || result.stage.stageId !== 6)) throw new Error("report scope mismatch");
          setRead(old => { const values = { ...(old?.key === key ? old.stages : {}) }; if (result.stage) values[6] = result.stage; else delete values[6]; return { key, phase: "ready", stages: values }; });
          setReportWrite({ key: reportKey, phase: "conflict", error: "成员已更新小组报告或第六步。本页报告保留，请比较服务器内容后重试。", signature: reportMarkdown });
        } catch { if (latest.current.key === key && !controller.signal.aborted) { setRead(old => ({ key, phase: "error", stages: old?.key === key ? old.stages : {}, error: "报告保存冲突，最新版本读取失败。请重试读取，本页内容保留。" })); setReportWrite({ key: reportKey, phase: "conflict", error: "报告尚未保存，本页修改保留。", signature: reportMarkdown }); } }
      } else setReportWrite({ key: reportKey, phase: "error", error: "报告保存未确认。本页编辑保留，可重试；不会自动覆盖小组报告。", signature: reportMarkdown });
    } finally { if (inFlight.current?.controller === controller) inFlight.current = null; }
  }
  const report: AidtSharedReportController = { available, loading: available && (!currentRead || currentRead.phase === "loading"), saving: currentReportWrite.phase === "saving", canSave: reportCanSave, serverRevision: serverReport ? reportServer!.revision : null, serverMarkdown: serverReport?.markdown ?? null, savedAt: serverReport ? reportServer!.updatedAt : null, savedBy: serverReport ? reportServer!.updatedBy : null, matchesServer: reportMatchesServer, sourceStageRevisions: clone(serverReport?.sourceStageRevisions ?? []), conflict: currentReportWrite.phase === "conflict", needsBaseReview: reportNeedsBaseReview, error: currentReportWrite.error ?? null, loadError: currentRead?.phase === "error" ? currentRead.error ?? "读取失败" : null, availableSources: availableReportRefs, selectedSources: reportRefs,
    chooseSources: (sources) => { if (latest.current.key === key && latest.current.canWrite) setReportSourceChoice({ key: editKey, sources }); },
    confirmedAtRevision: serverReport?.confirmedAtRevision, canConfirm: reportCanConfirm, confirm: () => writeReport(true), save: () => writeReport(false), reload, restore: restoreReport, reviewBase: reviewReportBase };
  return { key, writeKey, available, read: currentRead, write: currentWrite, stages, server, sourceStageRevisions, questionRevision, lockedSourceStage, expectedRevision, needsBaseReview, canSave, matchesServer, reload, refreshCurrentStage, chooseSource, reviewServerBase, restoreServer, saveCurrent, saveDraft, report };
}
