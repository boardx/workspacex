"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AIDT_ITERATION_FEEDBACK_FIELD, AIDT_ITERATION_REASON_FIELD, readAidtIterationPrototypeReference, updateAidtIterationBasis, updateAidtIterationPrototypeReference } from "../lib/aidt-prototype-reference";
import { aidtIterationPrototypeMissingItems, confirmAidtIterationPrototypeRelation, isAidtIterationPrototypeRelated, readAidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import { AidtPrototypeVersionPicker } from "./aidt-prototype-version-picker";

/** Optional iteration output; never changes the old tested object or frozen question. */
export function AidtIterationPrototype({ projectId, draft, onChange, readOnly = false }: {
  projectId: string; draft: AidtUiStageDraft; onChange: (draft: AidtUiStageDraft) => void; readOnly?: boolean;
}) {
  const [error, setError] = React.useState("");
  const snapshot = readAidtQuestionSnapshot(draft), related = isAidtIterationPrototypeRelated(draft), missing = aidtIterationPrototypeMissingItems(draft);
  const change = (next: AidtUiStageDraft) => { if (!readOnly) { setError(""); onChange(next); } };
  return <section className="space-y-3 rounded-lg border border-border p-3 text-12" aria-label="迭代产出原型与反馈关系" data-testid="aidt-iteration-prototype">
    <h4 className="text-14 font-semibold">如果本轮产生了新原型，再记录其与旧版和反馈的关系</h4>
    <p className="text-muted-foreground">此处独立记录迭代产出，不替换上方的被测原型或原问题。返回前四步、尚未改版或证据不足时可以留空。</p>
    {snapshot && <p data-testid="aidt-iteration-tested-source">旧被测版本：{snapshot.prototypeRef}；本轮问题：{snapshot.question}</p>}
    <AidtPrototypeVersionPicker projectId={projectId} value={readAidtIterationPrototypeReference(draft)} selectionScope={JSON.stringify([draft.fields.newVersion ?? "", draft.fields.questionSnapshot ?? "", draft.fields[AIDT_ITERATION_FEEDBACK_FIELD] ?? "", draft.fields[AIDT_ITERATION_REASON_FIELD] ?? ""])} readOnly={readOnly} label="迭代产出原型版本" removeLabel="移除迭代产出引用" description="从本项目已关联且当前由你拥有的Design历史中选择。选择仅记录迭代产出；不会把它当作本轮已测试版本，也不会改写旧问题。" onChange={reference => change(updateAidtIterationPrototypeReference(draft, reference))} />
    {([
      [AIDT_ITERATION_FEEDBACK_FIELD, "本次修改依据的反馈或未解问题引用", "记录具体材料/对象代号/时间点，或明确仍是待验证的猜测；不把参考图片当研究证据。"],
      [AIDT_ITERATION_REASON_FIELD, "相对旧版改了什么，为什么？", "由学生说明修改与所列反馈的关系；不要因生成了新版就宣称问题已解决。"],
    ] as const).map(([field, label, placeholder]) => <label className="block" key={field}>{label}<Textarea className="mt-1" aria-label={label} value={draft.fields[field] ?? ""} maxLength={2000} disabled={readOnly} rows={2} placeholder={placeholder} onChange={event => change(updateAidtIterationBasis(draft, field, event.currentTarget.value))} /></label>)}
    <Button type="button" size="sm" variant="outline" disabled={readOnly || missing.length > 0 || related} onClick={() => {
      if (readOnly) return;
      const result = confirmAidtIterationPrototypeRelation(draft);
      if (result.ok) change(result.draft); else setError(result.reason);
    }}>{related ? "新版与旧版及反馈已关联" : "确认关联本次产出、旧版与反馈"}</Button>
    <p role="status" className="text-muted-foreground">{related ? "学生已核对关系；请保存本步成果。新版仍待真实测试，质量与效果未因此通过。" : missing.length ? `可留作草稿；若要关联，待补充：${missing.join("、")}` : "核对后可关联并保存；没有新增原型也能保存本轮学习记录。"}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
