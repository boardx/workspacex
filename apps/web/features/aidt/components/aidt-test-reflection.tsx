"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AIDT_RETURN_STEPS, aidtTestPrototypeMismatch, aidtQuestionSnapshotMatches, aidtReflectionMissingItems, createAidtQuestionSnapshot, isAidtReflectionConfirmed, readAidtQuestionSnapshot, readAidtReturnDecision, updateAidtReflectionField, type AIDT_REFLECTION_FIELDS } from "@/features/aidt/lib/aidt-verification-loop";

export function AidtTestReflection({ draft, onChange, readOnly = false, previousPrototype, previousPrototypeRevision }: {
  draft: AidtUiStageDraft; onChange: (draft: AidtUiStageDraft) => void; readOnly?: boolean;
  previousPrototype?: AidtUiStageDraft; previousPrototypeRevision?: number;
}) {
  const id = React.useId();
  const snapshot = readAidtQuestionSnapshot(draft);
  const incoming = previousPrototype ? createAidtQuestionSnapshot(previousPrototype, previousPrototypeRevision) : null;
  const decision = readAidtReturnDecision(draft);
  const missing = aidtReflectionMissingItems(draft);
  const confirmed = isAidtReflectionConfirmed(draft);
  const changedSource = snapshot && previousPrototype && !aidtQuestionSnapshotMatches(draft, previousPrototype, previousPrototypeRevision);
  const versionMismatch = aidtTestPrototypeMismatch(draft, snapshot);
  const update = (field: (typeof AIDT_REFLECTION_FIELDS)[number], text: string) => {
    if (!readOnly) onChange(updateAidtReflectionField(draft, field, text));
  };
  return <section aria-label="本轮认识变化与下一步" className="space-y-4" data-testid="aidt-test-reflection">
    <div><h4 className="text-14 font-semibold">这轮测试，让你们学到了什么？</h4><p className="mt-1 text-12 text-muted-foreground">回看同一个问题，再决定下一步。不必总是修改原型。</p></div>
    {snapshot ? <div className="rounded-lg border border-border bg-muted p-4" data-testid="aidt-bound-question"><p className="text-11 text-muted-foreground">本轮原问题 · {snapshot.prototypeRef}{snapshot.sourceStageRevision ? ` · 第5步共享 V${snapshot.sourceStageRevision}` : " · 尚无共享版本回执"}</p><p className="mt-1 break-words text-14 font-medium">{snapshot.question}</p><p className="mt-2 whitespace-pre-wrap break-words text-12">测试前看法：{snapshot.beforeTestBelief || "尚未记录，不推测"}</p><details className="mt-2 text-12"><summary className="cursor-pointer text-muted-foreground">回看依据与验证范围</summary><p className="mt-2 whitespace-pre-wrap break-words">依据：{snapshot.verificationBasis || "未记录"}</p><p className="mt-1 whitespace-pre-wrap break-words">范围：{snapshot.verificationLimits || "尚待明确；静态意向不能证明真实行为。"}</p></details></div> : draft.fields.questionSnapshot ? <p role="alert" className="rounded-lg border border-border p-3 text-12">本轮问题记录无法读取。已保留原稿，请先核对保存的版本；不会自动替换为第5步的新问题。</p> : <div className="rounded-lg border border-dashed border-border p-4"><Button type="button" size="sm" variant="outline" disabled={readOnly || !incoming?.ok} onClick={() => {
      if (readOnly || !incoming?.ok || draft.fields.questionSnapshot) return;
      const next = updateAidtReflectionField(draft, "questionSnapshot", incoming.serialized);
      onChange({ ...next, fields: { ...next.fields, version: draft.fields.version?.trim() ? draft.fields.version : incoming.snapshot.prototypeRef } });
    }}>带入本轮验证问题</Button><p className="mt-2 text-12 text-muted-foreground">{incoming?.ok ? "请核对第5步的已确认问题与实际被测原型版本，带入后保留本轮原始预期。" : incoming && !incoming.ok ? incoming.reason : "先保存第5步的问题卡与被测原型版本。"}</p></div>}
    {changedSource && <p role="status" className="text-12 text-muted-foreground">第5步已有不同的内容。本轮仍保留原问题与被测版本；新一轮请先保存本轮记录。</p>}
    {versionMismatch && <p role="alert" className="rounded-lg border border-border p-3 text-12">测试表单记录的被测版本与本轮问题绑定的“{snapshot?.prototypeRef}”不同。已保留两者，请核对实际测试版本后再确认记录；不会自动改写原问题。</p>}
    <label className="block text-12" htmlFor={`${id}-change`}>测试之后，对这个问题的认识有什么变化？<select id={`${id}-change`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields.understandingChangeStatus ?? ""} disabled={readOnly} onChange={(event) => update("understandingChangeStatus", event.currentTarget.value)}><option value="">请选择</option><option value="changed">认识有变化</option><option value="unchanged">暂未改变</option><option value="insufficient">证据不足，尚不能判断</option></select></label>
    <div className="grid gap-3 md:grid-cols-2">{([
      ["afterTestBelief", "测试后的认识", "写下现在的看法；暂未改变也有学习价值。"],
      ["understandingEvidence", "支持判断的测试材料", "填写本组测试材料引用、对象代号与时间点；区分说法、行为和解释。"],
    ] as const).map(([field, label, placeholder]) => <label className="text-12" key={field} htmlFor={`${id}-${field}`}>{label}<textarea id={`${id}-${field}`} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields[field] ?? ""} maxLength={5000} disabled={readOnly} placeholder={placeholder} onChange={(event) => update(field, event.currentTarget.value)} /></label>)}</div>
    <label className="block text-12" htmlFor={`${id}-unresolved`}>仍不确定的地方<textarea id={`${id}-unresolved`} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields.unresolvedQuestions ?? ""} maxLength={4000} disabled={readOnly} placeholder="证据不足时，说明缺什么、还不能判断什么。" onChange={(event) => update("unresolvedQuestions", event.currentTarget.value)} /></label>
    <div className="border-t border-border pt-4"><label className="block text-12" htmlFor={`${id}-return`}>如果继续改进，优先从哪一步重新入手？<select id={`${id}-return`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields.returnStep ?? ""} disabled={readOnly} onChange={(event) => update("returnStep", event.currentTarget.value)}><option value="">由小组选择</option>{AIDT_RETURN_STEPS.map((step) => <option key={step.id} value={step.id}>第{step.id}步 · {step.label}</option>)}<option value="undecided">暂未决定，需要支持</option></select></label><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-12" htmlFor={`${id}-reason`}>{decision.kind === "undecided" ? "需要什么支持才能继续？" : "为什么从这里重新入手？"}<textarea id={`${id}-reason`} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields.returnReason ?? ""} maxLength={4000} disabled={readOnly} onChange={(event) => update("returnReason", event.currentTarget.value)} /></label><label className="text-12" htmlFor={`${id}-action`}>下一步具体做什么？{decision.kind === "undecided" ? "（可稍后补充）" : ""}<textarea id={`${id}-action`} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields.nextAction ?? ""} maxLength={4000} disabled={readOnly} onChange={(event) => update("nextAction", event.currentTarget.value)} /></label></div></div>
    <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="outline" disabled={readOnly || missing.length > 0 || confirmed} onClick={() => { if (!readOnly && missing.length === 0) onChange({ ...draft, fields: { ...draft.fields, reflectionConfirmed: "true" } }); }}>{confirmed ? "本轮学习记录已确认" : "确认本轮学习记录"}</Button><span role="status" className="text-12 text-muted-foreground">{confirmed ? "已核对；请保存到小组成果。" : missing.length ? `待补充：${missing.join("、")}` : "核对后确认，再保存到小组成果。"}</span></div>
    <p className="text-11 text-muted-foreground">确认是本次编辑者核对记录，不表示全组投票或测试成功。返回前四步或暂未决定时，保留旧原型即可；新版仍需测试。</p>
  </section>;
}
