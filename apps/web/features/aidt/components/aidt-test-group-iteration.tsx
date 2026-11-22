"use client";
import * as React from "react";
import Link from "next/link";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AIDT_RETURN_STEPS, aidtReflectionMissingItems, isAidtReflectionConfirmed, isAidtIterationPrototypeRelated, readAidtReturnDecision, readAidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import { readAidtIterationPrototypeReference, readAidtPrototypeReference } from "../lib/aidt-prototype-reference";
import { readAidtTestGroups, isAidtTestGroupConfirmed, type AidtTestGroup } from "../lib/aidt-test-groups";
import { aidtTestGroupPublicationMatches, readAidtTestGroupRound, writeAidtTestGroupRound } from "../lib/aidt-test-group-round";
import { loadAidtTestResearchContext } from "../lib/aidt-test-prototype-context";
import { readAidtStage, readAidtStageRevision } from "../lib/live-aidt-stages";
import { listAidtConfirmedPrototypeEntities } from "../lib/aidt-prototype-handoff";
import { aidtPrototypeOutputMatchesText, readAidtPrototypeTextOutputBinding, readAidtPrototypeTextOutputBindings } from "../lib/aidt-prototype-text-state";
import { loadAidtBoundPrototypeTextSources } from "../lib/aidt-prototype-confirmed-text";
import { aidtSharedDraftSignature } from "../lib/use-aidt-shared-stages";
import { loadAidtPrototypeSnapshot } from "../lib/aidt-prototype-versions";
import { previewAidtPrototype } from "../lib/aidt-prototype-print-preview";
import { aidtHref } from "../lib/project-aidt";
import { AidtIterationPrototype } from "./aidt-iteration-prototype";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Props = { projectId: string; entityId: string; draft: AidtUiStageDraft; savedDraft?: AidtUiStageDraft; savedRevision?: number;
  readOnly: boolean; saveDraft?: (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean> };

/** Native, entity-scoped edit/save surface; returning never generates a prototype. */
export function AidtTestGroupIteration({ projectId, entityId, draft, savedDraft, savedRevision, readOnly, saveDraft }: Props) {
  const session = useOptionalSession()?.session;
  const group = readAidtTestGroups(draft.fields).find(item => item.id === entityId && !item.archived);
  const savedGroup = readAidtTestGroups(savedDraft?.fields ?? {}).find(item => item.id === entityId && !item.archived);
  const saved = savedDraft && readAidtTestGroupRound(savedDraft, entityId);
  const scope = JSON.stringify([projectId, entityId, session?.currentOrgId, session?.userId, session?.sessionToken, group, readOnly]);
  const current = React.useRef(scope); current.current = scope;
  const savedSignature = JSON.stringify(saved ?? null);
  const base = React.useRef({ revision: savedRevision, draft: savedDraft }); base.current = { revision: savedRevision, draft: savedDraft };
  const saveAction = React.useRef(saveDraft); saveAction.current = saveDraft;
  const publicationRevision = /^[1-9]\d*$/.test(saved?.fields.publicationRevision ?? "") ? Number(saved!.fields.publicationRevision) : null;
  const publicationKey = JSON.stringify([scope, savedSignature, publicationRevision]);
  const [publicationProof, setPublicationProof] = React.useState("");
  React.useEffect(() => {
    if (savedSignature === "null" || !publicationRevision || !Number.isSafeInteger(publicationRevision) || !session?.sessionToken) return;
    const controller = new AbortController();
    void readAidtStageRevision(projectId, 6, publicationRevision, session.sessionToken, controller.signal).then(stage => {
      if (!controller.signal.aborted && stage?.projectId === projectId && stage.revision === publicationRevision && aidtTestGroupPublicationMatches(stage, entityId)
        && JSON.stringify(readAidtTestGroupRound(stage.content.draft, entityId)) === savedSignature) setPublicationProof(publicationKey);
    }).catch(() => { /* Unverified history never produces a return link. */ });
    return () => controller.abort();
  }, [projectId, entityId, publicationKey, publicationRevision, savedSignature, session?.sessionToken]);
  const abort = React.useRef<AbortController | null>(null);
  const [expanded, setExpanded] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  const [local, setLocal] = React.useState<{ scope: string; round: AidtUiStageDraft; baseSignature: string } | null>(null);
  const round = local?.scope === scope ? local.round : saved ?? null;
  const staleLocal = local?.scope === scope && local.baseSignature !== savedSignature;
  React.useEffect(() => () => { abort.current?.abort(); if (current.current === scope) current.current = ""; }, [scope]);
  React.useEffect(() => {
    if (!expanded || round || !group || !session?.sessionToken || !session.userId) return;
    const controller = new AbortController(); const expected = scope;
    void loadAidtTestResearchContext({ projectId, sessionToken: session.sessionToken, userId: session.userId, signal: controller.signal }, group).then(context => {
      if (controller.signal.aborted || current.current !== expected) return;
      setLocal({ scope: expected, baseSignature: savedSignature, round: { fields: { questionSnapshot: JSON.stringify(context.question), version: context.question.prototypeRef,
        afterTestBelief: group.afterTestBelief || "", understandingChangeStatus: group.understandingChange || "",
        understandingEvidence: group.sourceLocation || "", unresolvedQuestions: group.evidenceGap || "", returnStep: "", returnReason: "", nextAction: "" }, ideas: [], selectedIdeaId: "" } });
    }).catch(() => { if (!controller.signal.aborted && current.current === expected) setError("无法读取本测试绑定的原问题与版本，未改用其他测试记录。"); });
    return () => controller.abort();
  }, [expanded, round, group, projectId, scope, savedSignature, session?.sessionToken, session?.userId]);
  const edit = (next: AidtUiStageDraft) => { if (!readOnly) { setLocal({ scope, round: next, baseSignature: local?.scope === scope ? local.baseSignature : savedSignature }); setError(""); } };
  async function validatedIteration(value: AidtUiStageDraft, original: AidtTestGroup, controller: AbortController) {
    const produced = readAidtIterationPrototypeReference(value);
    if (!produced) return value;
    const existing = saved && readAidtIterationPrototypeReference(saved);
    const same = existing?.designId === produced.designId && existing.versionId === produced.versionId;
    const revision = same && /^[1-9]\d*$/.test(saved?.fields.iterationSourceStageRevision ?? "") ? Number(saved!.fields.iterationSourceStageRevision) : null;
    const stage = revision ? await readAidtStageRevision(projectId, 5, revision, session!.sessionToken, controller.signal)
      : (await readAidtStage(projectId, 5, session!.sessionToken, controller.signal)).stage;
    const entry = stage && listAidtConfirmedPrototypeEntities(stage.content.draft).find(item => {
      const ref = readAidtPrototypeReference(item.draft);
      return ref?.designId === produced.designId && ref.versionId === produced.versionId
        && aidtPrototypeOutputMatchesText(item.draft, produced.designId, produced.versionId);
    });
    if (!stage || stage.projectId !== projectId || stage.stageId !== 5 || !entry || produced.designId === original.designId && produced.versionId === original.versionId)
      throw new Error("请先在第5步保存并确认一个新的原型及其文字设计版本，再关联本轮迭代。");
    const binding = [readAidtPrototypeTextOutputBinding(entry.draft), ...readAidtPrototypeTextOutputBindings(entry.draft)].find(item => item?.projectId === projectId && item.designId === produced.designId && item.versionId === produced.versionId);
    if (!binding || binding.textStageRevision > stage.revision) throw new Error("无法核对新版原型所绑定的确切文字稿，未关联或打印。");
    await loadAidtBoundPrototypeTextSources({ projectId, designId: produced.designId, sessionToken: session!.sessionToken, signal: controller.signal }, binding);
    await loadAidtPrototypeSnapshot({ projectId, sessionToken: session!.sessionToken, userId: session!.userId!, signal: controller.signal }, produced.designId, produced.versionId, "linked-reader");
    return { ...value, fields: { ...value.fields, iterationSourceStageRevision: String(stage.revision) } };
  }
  async function save(confirm: boolean) {
    if (!round || !group || readOnly || !saveAction.current || staleLocal || busy || !session?.sessionToken || !session.userId) return;
    const expected = scope, controller = new AbortController(); abort.current = controller; setBusy(true); setError("");
    try {
      if (JSON.stringify(group) !== JSON.stringify(savedGroup)) throw new Error("请先保存并核对本测试记录，再保存本轮行动。");
      const value = await validatedIteration({ ...round, fields: { ...round.fields, reflectionConfirmed: confirm ? "true" : "" } }, group, controller);
      if (confirm && (!isAidtTestGroupConfirmed(group) || aidtReflectionMissingItems(value).length)) throw new Error("先确认测试材料，再补齐本轮认识变化和下一步。");
      if (controller.signal.aborted || current.current !== expected) return;
      const fresh = (await readAidtStage(projectId, 6, session.sessionToken, controller.signal)).stage;
      if (!fresh || fresh.projectId !== projectId || fresh.stageId !== 6 || !base.current.draft
        || fresh.revision !== base.current.revision || aidtSharedDraftSignature(fresh.content.draft) !== aidtSharedDraftSignature(base.current.draft)
        || JSON.stringify(readAidtTestGroupRound(fresh.content.draft, entityId)) !== savedSignature) throw new Error("小组版本已更新，请重新读取保存基准；未覆盖你的输入。");
      const beforeSignature = aidtSharedDraftSignature(fresh.content.draft), beforeRevision = fresh.revision;
      const planned = writeAidtTestGroupRound(fresh.content.draft, group, value, confirm, confirm ? beforeRevision + 1 : undefined);
      if (controller.signal.aborted || current.current !== expected) return;
      const action = saveAction.current;
      if (!action) throw new Error("当前不能保存。");
      const success = await action(old => {
        if (base.current.revision !== beforeRevision || !base.current.draft
          || aidtSharedDraftSignature(base.current.draft) !== beforeSignature || aidtSharedDraftSignature(old) !== beforeSignature)
          throw new Error("保存基准已变化，未自动重放。");
        return writeAidtTestGroupRound(old, group, value, confirm, confirm ? beforeRevision + 1 : undefined);
      });
      if (controller.signal.aborted || current.current !== expected) return;
      if (!success) throw new Error("保存尚未确认，请刷新核对；不会自动重复写入。");
      const actual = await readAidtStageRevision(projectId, 6, beforeRevision + 1, session.sessionToken, controller.signal);
      const actualRound = actual && readAidtTestGroupRound(actual.content.draft, entityId);
      if (controller.signal.aborted || current.current !== expected) return;
      if (!actual || actual.projectId !== projectId || actual.revision !== beforeRevision + 1 || !actualRound
        || aidtSharedDraftSignature(actual.content.draft) !== aidtSharedDraftSignature(planned)
        || confirm && !aidtTestGroupPublicationMatches(actual, entityId, actualRound)) throw new Error("保存回执尚未核对，请刷新确认；不会重复写入。");
      setLocal({ scope: expected, round: actualRound, baseSignature: JSON.stringify(actualRound) });
    } catch (failure) { if (current.current === expected) setError(failure instanceof Error ? failure.message : "保存未完成，原记录保留。"); }
    finally { controller.abort(); if (abort.current === controller) { abort.current = null; setBusy(false); } }
  }
  async function print() {
    if (!saved || !savedGroup || !session?.sessionToken || !session.userId || busy || !savedRevision) return;
    const expected = scope, controller = new AbortController(); abort.current = controller; setBusy(true); setError("");
    let watch: ReturnType<typeof setTimeout> | undefined;
    try {
      const { stage } = await readAidtStage(projectId, 6, session.sessionToken, controller.signal);
      const fresh = stage && readAidtTestGroupRound(stage.content.draft, entityId);
      if (!stage || stage.revision !== savedRevision || !fresh || JSON.stringify(fresh) !== JSON.stringify(saved)
        || !isAidtReflectionConfirmed(fresh) || !isAidtIterationPrototypeRelated(fresh)) throw new Error("迭代关系尚未确认保存或来源版本已变化。");
      await validatedIteration(fresh, savedGroup, controller);
      const produced = readAidtIterationPrototypeReference(fresh)!;
      const snapshot = await loadAidtPrototypeSnapshot({ projectId, sessionToken: session.sessionToken, userId: session.userId, signal: controller.signal }, produced.designId, produced.versionId, "linked-reader");
      if (controller.signal.aborted || current.current !== expected) return;
      const recheck = async () => {
        try {
          const latest = (await readAidtStage(projectId, 6, session.sessionToken, controller.signal)).stage;
          if (!latest || latest.revision !== savedRevision || JSON.stringify(readAidtTestGroupRound(latest.content.draft, entityId)) !== JSON.stringify(saved)) throw new Error("SOURCE_CHANGED");
          await validatedIteration(fresh, savedGroup, controller);
          await loadAidtPrototypeSnapshot({ projectId, sessionToken: session.sessionToken, userId: session.userId!, signal: controller.signal }, produced.designId, produced.versionId, "linked-reader");
          if (!controller.signal.aborted && current.current === expected) watch = setTimeout(() => void recheck(), 5000);
        } catch { controller.abort(); }
      };
      watch = setTimeout(() => void recheck(), 5000);
      await previewAidtPrototype(snapshot, `迭代原型 · ${produced.designName} · V${produced.seq}（待测试）`, { defaultPaper: "A3", isCurrent: () => !controller.signal.aborted && current.current === expected });
    } catch (failure) { if (current.current === expected) setError(failure instanceof Error ? failure.message : "无法核对迭代原型，未打印。"); }
    finally { if (watch) clearTimeout(watch); controller.abort(); if (abort.current === controller) { abort.current = null; setBusy(false); } }
  }
  if (!group) return null;
  const decision = saved && readAidtReturnDecision(saved);
  const unchangedSaved = Boolean(saved && round && JSON.stringify(saved) === JSON.stringify(round));
  const ready = saved && savedGroup && isAidtTestGroupConfirmed(savedGroup) && JSON.stringify(savedGroup) === JSON.stringify(group) && isAidtReflectionConfirmed(saved) && publicationRevision && publicationProof === publicationKey;
  const returnHref = ready && decision?.kind === "selected" ? aidtHref(projectId, Number(decision.step), { tool: "outcome", returnRevision: String(publicationRevision) })
    + `&returnEntity=${encodeURIComponent(entityId)}` + (decision.step === "5" && group.prototypeEntity ? `&entity=${encodeURIComponent(group.prototypeEntity)}` : "") : null;
  return <section data-testid="aidt-test-group-iteration" className="space-y-3 border-t border-border pt-3">
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer text-13 font-medium">本轮反思与迭代</summary>
      <div className="mt-3 space-y-3">
        {!round ? <p role="status" className="text-12">正在读取本测试的原问题…</p> : <>
          <p className="text-13 font-medium">{readAidtQuestionSnapshot(round)?.question}</p>
          <p className="text-11 text-muted-foreground">被测版本：{readAidtQuestionSnapshot(round)?.prototypeRef} · 第5步 V{group.stage5Revision}</p>
          <p className="text-12 text-muted-foreground">测试前：{readAidtQuestionSnapshot(round)?.beforeTestBelief || "尚未记录"}。保留本次被测版本；返回前四步不需要制作新版。</p>
          {(group.researchPath === "virtual" || group.evidenceOrigin) && <p className="text-12 text-muted-foreground">本记录含模拟或合成软件测试材料，认识变化不代表真人用户验证。</p>}
          <label className="block text-12">测试后的认识<select className="mt-1 block w-full rounded-md border border-border p-2" value={round.fields.understandingChangeStatus ?? ""} disabled={readOnly || busy} onChange={event => edit({ ...round, fields: { ...round.fields, understandingChangeStatus: event.target.value, reflectionConfirmed: "" } })}><option value="">请选择</option><option value="changed">认识有变化</option><option value="unchanged">暂未改变</option><option value="insufficient">证据不足</option></select></label>
          {([["afterTestBelief", "测试后怎么看"], ["understandingEvidence", "材料依据"], ["unresolvedQuestions", "仍不确定的地方"]] as const).map(([key, label]) => <label className="block text-12" key={key}>{label}<Textarea rows={2} maxLength={2000} value={round.fields[key] ?? ""} disabled={readOnly || busy} onChange={event => edit({ ...round, fields: { ...round.fields, [key]: event.target.value, reflectionConfirmed: "" } })} /></label>)}
          <label className="block text-12">从哪一步重新入手<select className="mt-1 block w-full rounded-md border border-border p-2" value={round.fields.returnStep ?? ""} disabled={readOnly || busy} onChange={event => edit({ ...round, fields: { ...round.fields, returnStep: event.target.value, reflectionConfirmed: "" } })}><option value="">由小组选择</option>{AIDT_RETURN_STEPS.map(step => <option key={step.id} value={step.id}>第{step.id}步 · {step.label}</option>)}<option value="undecided">暂未决定</option></select></label>
          {([["returnReason", "选择理由"], ["nextAction", "下一步行动"]] as const).map(([key, label]) => <label className="block text-12" key={key}>{label}<Textarea rows={2} maxLength={2000} value={round.fields[key] ?? ""} disabled={readOnly || busy} onChange={event => edit({ ...round, fields: { ...round.fields, [key]: event.target.value, reflectionConfirmed: "" } })} /></label>)}
          {round.fields.returnStep === "5" && <details><summary className="cursor-pointer text-12">已有新版？关联迭代产出</summary><AidtIterationPrototype projectId={projectId} draft={round} readOnly={readOnly || busy} onChange={edit} /></details>}
          {!readOnly && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy || Boolean(staleLocal) || unchangedSaved} onClick={() => void save(false)}>保存反思草稿</Button><Button type="button" size="sm" disabled={busy || Boolean(staleLocal) || unchangedSaved && Boolean(saved && isAidtReflectionConfirmed(saved)) && publicationProof === publicationKey || !isAidtTestGroupConfirmed(group) || aidtReflectionMissingItems(round).length > 0} onClick={() => void save(true)}>确认并保存本轮反思与迭代</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setLocal(null); setExpanded(false); setError(""); }}>取消</Button></div>}
        </>}
      </div>
    </details>
    {returnHref && decision?.kind === "selected" && <Link className="inline-flex rounded-md border border-border px-3 py-2 text-12 font-medium" href={returnHref}>带着本轮反思，回到第{decision.step}步 · {decision.label}</Link>}
    {ready && saved && isAidtIterationPrototypeRelated(saved) && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void print()}>预览与打印迭代原型</Button>}
    {staleLocal && <div role="alert" className="space-y-2 text-12"><p>本测试记录已有更新。你的未保存输入仍保留，请先核对最新版。</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setLocal(null); setError(""); }}>读取本测试的已保存版本</Button></div>}
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
  </section>;
}
