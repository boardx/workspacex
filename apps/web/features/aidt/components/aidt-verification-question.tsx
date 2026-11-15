"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtVerificationQuestion, isVerificationQuestionConfirmed, updateAidtVerificationField } from "@/features/aidt/lib/aidt-verification-loop";

export function AidtVerificationQuestion({ draft, onChange, readOnly = false }: {
  draft: AidtUiStageDraft; onChange: (draft: AidtUiStageDraft) => void; readOnly?: boolean;
}) {
  const id = React.useId();
  const [error, setError] = React.useState("");
  const confirmed = isVerificationQuestionConfirmed(draft);
  const update = (field: "verificationQuestion" | "beforeTestBelief" | "verificationBasis" | "verificationLimits", text: string) => {
    if (readOnly) return;
    setError("");
    onChange(updateAidtVerificationField(draft, field, text));
  };
  return <section aria-label="本轮验证问题" className="space-y-3" data-testid="aidt-verification-question">
    <div><h4 className="text-14 font-semibold">先明确想知道什么，再做原型</h4><p className="mt-1 text-12 text-muted-foreground">原型帮助你们学习；问题由学生确认，AI 不替小组决定。</p></div>
    <label className="block text-13" htmlFor={`${id}-question`}>通过这次制作原型，你最想知道什么？</label>
    <textarea id={`${id}-question`} className="min-h-24 w-full rounded-md border border-border bg-background p-3 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields.verificationQuestion ?? ""} maxLength={3000} disabled={readOnly} placeholder="写下本轮最关注的一个问题，其他问题可以附记。" onChange={(event) => update("verificationQuestion", event.currentTarget.value)} />
    <details className="rounded-lg border border-border p-3 text-12"><summary className="cursor-pointer font-medium">补充先前看法与验证范围</summary><div className="mt-3 space-y-3">
      {([
        ["beforeTestBelief", "测试前，你们怎么想？", "可以写不确定；不要为了填满表格编出预期。"],
        ["verificationBasis", "目前看法的依据", "已有观察、原话、材料引用，或明确只是猜测。"],
        ["verificationLimits", "这个原型能了解什么，还有什么不能验证？", "静态图可以了解理解和意向；实际投入时间或付费需要真实行为测试。"],
      ] as const).map(([field, label, placeholder]) => <label className="block" key={field} htmlFor={`${id}-${field}`}>{label}<textarea id={`${id}-${field}`} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-13 disabled:bg-disabled disabled:text-disabled-foreground" value={draft.fields[field] ?? ""} maxLength={2000} disabled={readOnly} placeholder={placeholder} onChange={(event) => update(field, event.currentTarget.value)} /></label>)}
      <p className="text-muted-foreground">不清楚的部分可以留空，作为测试前的缺口保留。</p>
    </div></details>
    <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="outline" disabled={readOnly || !draft.fields.verificationQuestion?.trim() || confirmed} onClick={() => {
      if (readOnly) return;
      const next = confirmAidtVerificationQuestion(draft);
      if (next) onChange(next);
      else setError("问题卡过长，请精简后再确认；原稿仍可保存。");
    }}>{confirmed ? "本轮问题已确认" : "确认本轮验证问题"}</Button><span className="text-12 text-muted-foreground" role="status">{confirmed ? "仍待真实测试；编辑问题卡后需重新确认。" : "可先保存草稿，确认后再生成原型。"}</span></div>
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
  </section>;
}
