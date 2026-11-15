"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtDiscoveryCardDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AidtImageAttachmentPicker, AidtImageAttachmentPreview } from "./aidt-image-attachment-picker";

/** Student-authored records. Attachment references are not upload receipts or verified evidence. */
export function AidtDiscoveryCards({ cards, readOnly, onChange, projectId, thread = null }: {
  cards: readonly AidtDiscoveryCardDraft[]; readOnly: boolean;
  projectId?: string; thread?: string | null;
  onChange: (mutate: (previous: AidtDiscoveryCardDraft[]) => AidtDiscoveryCardDraft[]) => void;
}) {
  const [removeId, setRemoveId] = React.useState<string | null>(null);
  const update = (id: string, patch: Partial<AidtDiscoveryCardDraft>) => {
    if (!readOnly) onChange((previous) => previous.map((card) => card.id === id ? { ...card, ...patch } : card));
  };
  return <section className="space-y-3" aria-label="人物发现卡" data-testid="aidt-discovery-cards">
    <div className="flex items-center justify-between gap-3"><div><h4 className="text-14 font-semibold">一位受访者，一张发现卡</h4><p className="mt-1 text-12 text-muted-foreground">先写你们的发现，再核对原话和材料。</p></div><Button type="button" size="sm" variant="outline" disabled={readOnly} data-testid="aidt-discovery-add" onClick={() => {
      if (readOnly) return;
      onChange((previous) => [...previous, { id: crypto.randomUUID(), participantCode: "", headline: "", headlineKind: "student-summary", context: "", quote: "", sourceRef: "", photoRef: "" }]);
    }}>添加发现卡</Button></div>
    {!cards.length && <p className="rounded-lg border border-dashed border-border p-4 text-13 text-muted-foreground" data-testid="aidt-discovery-empty">真实访谈后，再为每位受访者记录一张。尚未访谈可以先保留空白。</p>}
    {cards.map((card, index) => {
      const label = `发现卡${index + 1}`;
      return <article className="rounded-xl border border-border bg-card p-4" key={card.id} data-testid="aidt-discovery-card" data-card-id={card.id}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-11 text-muted-foreground">{card.participantCode || `受访者 ${index + 1}`} · {card.headlineKind === "quote" ? "引文待核对" : "学生概括"}</p><h5 className="mt-1 break-words text-16 font-medium">{card.headline || "最有启发的发现是什么？"}</h5></div><Button type="button" size="xs" variant="ghost" disabled={readOnly} aria-label={`移除${label}`} data-testid={`aidt-discovery-remove-${index}`} onClick={() => setRemoveId(card.id)}>移除</Button></div>
        {removeId === card.id && <div className="mt-3 rounded-lg border border-border p-3" role="alert" data-testid="aidt-discovery-remove-confirm"><p className="text-12">从当前草稿移除这张卡？原始访谈附件不会删除。</p><div className="mt-2 flex gap-2"><Button type="button" size="xs" disabled={readOnly} onClick={() => { if (!readOnly) onChange((previous) => previous.filter((item) => item.id !== card.id)); setRemoveId(null); }}>确认移除</Button><Button type="button" size="xs" variant="outline" onClick={() => setRemoveId(null)}>保留发现卡</Button></div></div>}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-12">受访者代号<input aria-label={`${label}受访者代号`} data-testid={`aidt-discovery-participant-${index}`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" value={card.participantCode} maxLength={120} disabled={readOnly} placeholder="如 A，不填写不必要的个人信息" onChange={(event) => update(card.id, { participantCode: event.currentTarget.value })} /></label>
          <label className="text-12">Headline 来源<select aria-label={`${label}标题来源`} data-testid={`aidt-discovery-kind-${index}`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" value={card.headlineKind} disabled={readOnly} onChange={(event) => update(card.id, { headlineKind: event.currentTarget.value === "quote" ? "quote" : "student-summary" })}><option value="student-summary">学生概括</option><option value="quote">受访者原话（需核对出处）</option></select></label>
          <label className="text-12 md:col-span-2">一句发现<input aria-label={`${label}一句发现`} data-testid={`aidt-discovery-headline-${index}`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" value={card.headline} maxLength={500} disabled={readOnly} onChange={(event) => update(card.id, { headline: event.currentTarget.value })} /></label>
          <label className="text-12 md:col-span-2">具体情况<textarea aria-label={`${label}具体情况`} data-testid={`aidt-discovery-context-${index}`} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-13" value={card.context} maxLength={5000} disabled={readOnly} placeholder="最近一次经历、所处背景、实际行为；不同意见仍保留。" onChange={(event) => update(card.id, { context: event.currentTarget.value })} /></label>
        </div>
        <details className="mt-3 text-12" open={!card.sourceRef.trim()} data-testid={`aidt-discovery-evidence-${index}`}><summary className="cursor-pointer text-muted-foreground">{card.sourceRef.trim() ? "核对原话、照片与来源" : "补充原始材料 · 尚缺来源"}</summary><div className="mt-3 grid gap-3">
          <label>受访者原话<textarea aria-label={`${label}受访者原话`} data-testid={`aidt-discovery-quote-${index}`} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-13" value={card.quote} maxLength={5000} disabled={readOnly} placeholder="逐字记录，与学生解释分开；没有原话留空。" onChange={(event) => update(card.id, { quote: event.currentTarget.value })} /></label>
          <label>原始材料与定位<input aria-label={`${label}原始材料与定位`} data-testid={`aidt-discovery-source-${index}`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" value={card.sourceRef} maxLength={2000} disabled={readOnly} placeholder="本组已上传录音/转写/笔记引用，加时间点或段落" onChange={(event) => update(card.id, { sourceRef: event.currentTarget.value })} /></label>
          <label>照片引用（可缺失）<input aria-label={`${label}照片引用`} data-testid={`aidt-discovery-photo-${index}`} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" value={card.photoRef} maxLength={2000} disabled={readOnly} placeholder="本组已上传且获授权的照片引用；不会自动上传或生成照片" onChange={(event) => update(card.id, { photoRef: event.currentTarget.value })} /></label>
          {projectId && card.photoAttachment && <AidtImageAttachmentPreview projectId={projectId} reference={card.photoAttachment} alt={`${card.participantCode || `受访者${index + 1}`}的已关联照片（用途与授权待学生核对）`} />}
          {projectId && thread && <AidtImageAttachmentPicker projectId={projectId} thread={thread} value={card.photoAttachment} readOnly={readOnly} label={`${label}照片`} onChange={(reference) => update(card.id, { photoAttachment: reference ?? undefined })} />}
          <p className="text-11 text-muted-foreground">填写引用不等于材料已上传或核验。照片缺失时保留缺口，概括不伪装成引文。</p>
        </div></details>
      </article>;
    })}
  </section>;
}
