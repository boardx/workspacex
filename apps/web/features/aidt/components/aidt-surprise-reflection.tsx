"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { hasAidtSurpriseCardMaterial, parseAidtSurpriseReflection } from "@/features/aidt/lib/aidt-surprise-reflection";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

export type AidtSurpriseReflectionProps = {
  draft: AidtUiStageDraft;
  onChange: (next: AidtUiStageDraft) => void;
  readOnly?: boolean;
  availableCards: readonly AidtDiscoveryCardDraft[];
  availableCardsRevision?: number;
};
/** Student-authored reflection, not a generated finding, evidence verification or server-save receipt. */
export function AidtSurpriseReflection({ draft, onChange, readOnly = false, availableCards, availableCardsRevision }: AidtSurpriseReflectionProps): JSX.Element {
  const fields = draft.fields, reflection = parseAidtSurpriseReflection(draft, availableCards, availableCardsRevision), radioName = React.useId();
  const selected = { ids: reflection.cardIds, invalid: reflection.invalidCardIds };
  const { status, ready, confirmed, missingCardIds: missingCards } = reflection;
  const cards = availableCards.filter((card, index) => card.id.trim() && availableCards.findIndex((other) => other.id === card.id) === index);
  const available = new Map(cards.map((card) => [card.id, card]));
  function edit(patch: Record<string, string>): void {
    if (readOnly) return;
    onChange({ ...draft, fields: { ...fields, ...patch, surpriseConfirmed: "" } });
  }
  function toggleCard(id: string, checked: boolean): void {
    if (!available.has(id)) return;
    const next = checked ? [...new Set([...selected.ids, id])] : selected.ids.filter((current) => current !== id);
    edit({ surpriseCardIds: JSON.stringify(next) });
  }
  return <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="画像前的意外发现反思" data-testid="aidt-surprise-reflection">
    <header className="space-y-1"><h3 className="text-16 font-semibold">有没有出乎意料的发现？</h3><p className="text-13 text-muted-foreground">先回看访谈，再说明哪些判断改变了。没有也可以如实记录。</p></header>
    <fieldset disabled={readOnly} className="flex flex-wrap gap-x-5 gap-y-2"><legend className="mb-2 text-12 font-medium">本组的记录</legend>
      <label className="flex min-h-6 items-center gap-2 text-13"><input type="radio" name={radioName} value="found" checked={status === "found"} onChange={() => edit({ surpriseStatus: "found" })} />有意外发现</label>
      <label className="flex min-h-6 items-center gap-2 text-13"><input type="radio" name={radioName} value="none" checked={status === "none"} onChange={() => edit({ surpriseStatus: "none" })} />暂无意外发现</label>
    </fieldset>
    {status === "none" && <p className="text-13 text-muted-foreground">暂无也可以继续。保留原始材料，不必为了完成任务制造“惊喜”。</p>}
    {status === "found" && <div className="space-y-4">
      <label className="block text-12 font-medium">原先我们怎么想<Textarea aria-label="原先我们怎么想" data-testid="aidt-surprise-belief" rows={2} maxLength={6000} disabled={readOnly} className="mt-2 font-normal" value={fields.priorBelief ?? ""} placeholder="原先我们以为……；没有明确预期可如实说明。" onChange={(event) => edit({ priorBelief: event.currentTarget.value })} /></label>
      <label className="block text-12 font-medium">实际看到或听到了什么<Textarea aria-label="实际看到或听到了什么" data-testid="aidt-surprise-finding" rows={3} maxLength={6000} disabled={readOnly} className="mt-2 font-normal" value={fields.surprisingFinding ?? ""} placeholder="写具体行为或原话；自己的解释放在下方。" onChange={(event) => edit({ surprisingFinding: event.currentTarget.value })} /></label>
      <fieldset disabled={readOnly} className="space-y-2"><legend className="text-12 font-medium">关联人物发现卡或原始材料</legend>
        {reflection.sourceRevisionMismatch && <p role="status" className="text-12 text-muted-foreground" data-testid="aidt-surprise-source-changed">引用历史第2步 V{reflection.sourceRevision}，当前已读取 V{reflection.currentCardsRevision}。旧记录仍保留，请核对后重新确认。</p>}
        {reflection.requiresCardRevision && !reflection.currentCardsRevision && <p role="status" className="text-12 text-muted-foreground">尚未读取已保存的人物发现卡版本，暂不能确认卡片引用。原稿仍保留。</p>}
        {cards.length ? cards.map((card, index) => <label key={card.id} className="flex min-h-6 items-start gap-2 text-13"><input type="checkbox" className="mt-1" checked={selected.ids.includes(card.id)} disabled={readOnly || !hasAidtSurpriseCardMaterial(card)} onChange={(event) => toggleCard(card.id, event.currentTarget.checked)} /><span className="min-w-0 break-words">{card.participantCode.trim() || `受访者 ${index + 1}`} · {card.headline.trim() || "发现卡内容待补充"}{!hasAidtSurpriseCardMaterial(card) ? "（尚无材料内容）" : ""}</span></label>) : <p className="text-12 text-muted-foreground">当前没有可关联的人物发现卡。也可以在下方填写已有访谈原材料的具体定位。</p>}
        <p className="text-11 text-muted-foreground">这里只关联当前可见的学生记录；卡片可能仍是未保存草稿，不代表来源已核验。</p>
        {(selected.invalid || missingCards.length > 0) && <div role="status" className="space-y-2 text-12 text-muted-foreground"><p>原有卡片引用无法读取或已不在当前材料中，请重新核对。</p><Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={() => edit({ surpriseCardIds: JSON.stringify(selected.ids.filter((id) => available.has(id))) })}>清理失效的卡片引用</Button></div>}
      </fieldset>
      <label className="block text-12 font-medium">原始材料与定位<Textarea aria-label="意外发现的原始材料与定位" data-testid="aidt-surprise-source" rows={2} maxLength={6000} disabled={readOnly} className="mt-2 font-normal" value={fields.surpriseSourceDetails ?? ""} placeholder="本组访谈录音、转写或观察记录的引用，加时间点或段落。已选发现卡时可补充。" onChange={(event) => edit({ surpriseSourceDetails: event.currentTarget.value })} /></label>
      <label className="block text-12 font-medium">我们的理解（可以不确定）<Textarea aria-label="我们对意外发现的理解" data-testid="aidt-surprise-interpretation" rows={2} maxLength={6000} disabled={readOnly} className="mt-2 font-normal" value={fields.surpriseInterpretation ?? ""} placeholder="它让我们重新考虑什么？尚不能解释的部分保留未知。" onChange={(event) => edit({ surpriseInterpretation: event.currentTarget.value })} /></label>
    </div>}
    <footer className="space-y-2 border-t border-border pt-3"><Button type="button" variant="outline" size="sm" data-testid="aidt-surprise-confirm" disabled={readOnly || !ready || confirmed} onClick={() => { if (!readOnly && ready) onChange({ ...draft, fields: { ...fields, surpriseConfirmed: "true", ...(reflection.requiresCardRevision ? { surpriseSourceRevision: String(reflection.currentCardsRevision) } : {}) } }); }}>{confirmed ? "本组已确认这份记录" : status === "none" ? "确认暂无意外发现" : "确认本组反思"}</Button>
      <p role="status" className="text-12 text-muted-foreground" data-testid="aidt-surprise-status">{confirmed ? "已由学生确认；共享保存状态以上方回执为准，来源仍需核对。" : status === "found" && !ready ? "记录待补充：说明原先判断、具体发现，并关联人物发现卡或可定位的原始材料。不评分，也不自动要求补访。" : status ? "由本组核对后确认，再继续整理画像。" : "先选择如实记录‘有发现’或‘暂无’。"}</p>
    </footer>
  </section>;
}
