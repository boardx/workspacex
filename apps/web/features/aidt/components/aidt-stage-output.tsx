"use client";
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AIDT_OUTPUTS, aidtUiStageMarkdown, type AidtUiStageDraft, type AidtIdeaDraft, type AidtDiscoveryCardDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtHref, type AidtStep } from "@/features/aidt/lib/project-aidt";
import { printResearchPdf } from "@/lib/research-report-export";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { AidtStageFields } from "@/features/aidt/components/aidt-stage-fields";
import { aidtIdeaReadiness } from "@/features/aidt/lib/aidt-idea-readiness";
import { AidtActivityNav } from "@/features/aidt/components/aidt-activity-nav";
import { AidtDiscoveryCards } from "@/features/aidt/components/aidt-discovery-cards";
import { AidtImageAttachmentPicker, AidtImageAttachmentPreview, type AidtImageAttachmentState } from "./aidt-image-attachment-picker";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtIdeaClassification } from "@/features/aidt/components/aidt-idea-classification";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, aidtIdeaClassificationFor, invalidateAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";
import { getAidtPrototypeGenerationReadiness } from "@/features/aidt/lib/aidt-verification-loop";

export function printAidtUiText(text: string) {
  const root = document.createElement("article");
  for (const line of text.split("\n")) {
    const node = document.createElement(line.startsWith("# ") ? "h2" : line.startsWith("## ") ? "h3" : line.startsWith("### ") ? "h4" : "p");
    node.textContent = line.replace(/^#{1,3} /, ""); root.append(node);
  }
  printResearchPdf(root, "AIDT 小组草稿");
}

export function AidtStageOutput({ projectId, thread = null, step, draft, update, readOnly, toolHref, toChat, availableCards = [], availableCardsRevision, previousPrototype, previousPrototypeRevision }: {
  projectId: string; step: AidtStep; draft: AidtUiStageDraft;
  thread?: string | null;
  update: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean; toolHref: (tool: string) => string;
  toChat?: (text: string) => ComposerOfferResult;
  availableCards?: readonly AidtDiscoveryCardDraft[]; availableCardsRevision?: number;
  previousPrototype?: AidtUiStageDraft; previousPrototypeRevision?: number;
}) {
  const output = AIDT_OUTPUTS[step.id]!;
  const [status, setStatus] = React.useState("");
  const [pendingRemoval, setPendingRemoval] = React.useState<string | null>(null);
  const [distinctReviewed, setDistinctReviewed] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const identity = useOptionalSession()?.session;
  const imageScope = JSON.stringify([identity?.currentOrgId, identity?.userId, identity?.sessionToken, projectId]);
  const printScope = JSON.stringify([imageScope, step.id, readOnly]);
  const printLifecycle = React.useRef({ scope: printScope, active: true }); printLifecycle.current.scope = printScope;
  React.useEffect(() => { const lifecycle = printLifecycle.current; lifecycle.active = true; return () => { lifecycle.active = false; }; }, []);
  // A local FileReader needs actor/permission isolation, but no server token.
  // Increment on every scope transition so A -> B -> A cannot revive an old read.
  const localReadScope = JSON.stringify([identity?.currentOrgId, identity?.userId, projectId, step.id, readOnly]);
  const localReadLifecycle = React.useRef({ scope: localReadScope, generation: 0 });
  if (localReadLifecycle.current.scope !== localReadScope) localReadLifecycle.current = { scope: localReadScope, generation: localReadLifecycle.current.generation + 1 };
  const [printImages, setPrintImages] = React.useState<Record<string, AidtImageAttachmentState & { key: string }>>({});
  const imageKey = (item: AidtIdeaDraft) => JSON.stringify([imageScope, item.imageAttachment]);
  const imageReady = (item: AidtIdeaDraft) => !item.imageAttachment || (printImages[item.id]?.key === imageKey(item) && Boolean(printImages[item.id]?.src) && !printImages[item.id]?.failed);
  const readiness = aidtIdeaReadiness(draft.ideas);
  const prototypeReadiness = getAidtPrototypeGenerationReadiness(draft);
  const imageRequests = React.useRef(new Map<string, number>());
  const field = (id: string, value: string) => { if (!readOnly) update((old) => ({ ...old, fields: { ...old.fields, [id]: value, ...(["initial", "rewrittenTheme"].includes(id) ? { problemReflectionConfirmed: "" } : {}), ...(step.id === 6 ? { reflectionConfirmed: "" } : {}), ...(step.id === 5 && id === "idea" ? { verificationQuestionConfirmed: "", verificationQuestionConfirmation: "" } : {}) }, ...(id === "reason" && old.selectedIdeaId ? { selectionReasons: { ...old.selectionReasons, [old.selectedIdeaId]: value } } : {}) })); };
  const idea = (id: string, value: Partial<AidtIdeaDraft>) => { if (readOnly) return; setDistinctReviewed(false); update((old) => invalidateAidtIdeaClassification({ ...old, ideas: old.ideas.map((item) => item.id === id ? { ...item, ...value } : item) })); };
  const removeIdea = (id: string) => {
    if (readOnly) return;
    setDistinctReviewed(false);
    update((old) => invalidateAidtIdeaClassification({ ...old, ideas: old.ideas.filter((item) => item.id !== id), selectedIdeaId: old.selectedIdeaId === id ? "" : old.selectedIdeaId }));
    setPendingRemoval(null);
  };
  async function copy() {
    try { await navigator.clipboard.writeText(aidtUiStageMarkdown(step.id, draft, availableCards, availableCardsRevision)); setStatus("已复制。粘贴并发送成功后才会保存到本组对话；表单共享请使用上方保存按钮。"); }
    catch { setStatus("未能复制，请手动选择填写内容。表单保存状态以上方共享回执为准。"); }
  }
  function image(id: string, file?: File) {
    if (readOnly || !file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setStatus("本页参考图预览支持 PNG、JPEG、WebP，单张不超过2MB。正式上传请使用聊天附件。"); return; }
    const request = (imageRequests.current.get(id) ?? 0) + 1;
    imageRequests.current.set(id, request);
    const generation = localReadLifecycle.current.generation;
    const currentRead = () => printLifecycle.current.active && localReadLifecycle.current.scope === localReadScope && localReadLifecycle.current.generation === generation && imageRequests.current.get(id) === request;
    const reader = new FileReader();
    reader.onload = () => { if (currentRead() && typeof reader.result === "string") idea(id, { image: reader.result, imageName: file.name, imageAttachment: undefined }); };
    reader.onerror = () => { if (currentRead()) setStatus("参考图读取失败，原有文字草稿仍保留。"); };
    reader.readAsDataURL(file);
  }
  async function printIdeas() {
    if (!readiness.ready || !distinctReviewed || !draft.ideas.every(imageReady)) { setStatus("请先完成至少三个不同点子的图文，等待已关联图片读取成功，并核对概念差异。"); return; }
    setPrinting(true);
    try {
    const article = document.createElement("article");
    const heading = document.createElement("h2"); heading.textContent = "小组点子描述单 · 学生审阅稿"; article.append(heading);
    const note = document.createElement("p"); note.textContent = "根据本页内容导出；共享保存另行处理，不代表投票结果或已确认方案。"; article.append(note);
    const images: HTMLImageElement[] = [];
    for (const [index, item] of draft.ideas.entries()) {
      const section = document.createElement("section"); section.style.breakInside = "avoid"; if (index) section.style.breakBefore = "page";
      const h = document.createElement("h3"); h.textContent = `${index + 1}. ${item.title || "待命名"}${draft.selectedIdeaId === item.id ? "（拟选择）" : ""}`; section.append(h);
      const source = item.imageAttachment ? printImages[item.id]?.src : item.image;
      if (source) { const img = document.createElement("img"); img.src = source; img.width = 300; img.alt = item.title || "候选参考图"; section.append(img); images.push(img); }
      const p = document.createElement("p"); p.textContent = item.description || "核心说明待补充。"; section.append(p);
      const classification = aidtIdeaClassificationFor(draft, item.id);
      const classificationLabel = document.createElement("p"); classificationLabel.textContent = `学生分类（${classification.confirmed ? "本组已确认" : "尚未确认"}）：${classification.labels.join("、") || "暂未分类"}`; section.append(classificationLabel);
      const classificationReason = document.createElement("p"); classificationReason.textContent = `学生分类理由：${classification.reason.trim() || "尚未填写"}`; section.append(classificationReason);
      if (item.imageAttachment) { const ref = document.createElement("p"); ref.textContent = `图片来源：对话 ${item.imageAttachment.threadId} · 附件 ${item.imageAttachment.attachmentId}`; section.append(ref); }
      article.append(section);
    }
    await Promise.all(images.map((img) => img.decode()));
    if (!printLifecycle.current.active || printLifecycle.current.scope !== printScope) return;
    printResearchPdf(article, "AIDT 点子描述单草稿");
    setStatus("已请求打开打印预览，可选择另存为PDF；不会因此保存到小组。");
    } catch { setStatus("描述单打印未能启动或图片尚不可用，文字与选择仍保留。请重试读取图片后再导出。"); }
    finally { setPrinting(false); }
  }
  return <section className="space-y-4" data-testid="aidt-stage-output">
    <div><p className="text-11 text-muted-foreground">本页草稿</p><h3 className="mt-1 text-20 font-semibold">{output.title}</h3></div>
    <details className="text-12 text-muted-foreground" data-testid="aidt-output-help"><summary className="cursor-pointer">填写与保存说明</summary><p className="mt-2">{output.hint}</p><p className="mt-1">本栏是可编辑草稿，未保存修改刷新或离开页面后会丢失。使用上方“保存到小组”并核对服务器回执，才会写入共享成果。带入聊天并发送只保存对话，不自动保存这里的表单。</p></details>
    {step.id === 2 && <AidtActivityNav currentId="draft" items={[{ id: "draft", label: "访谈计划", href: toolHref("outcome") }, { id: "sources", label: "研究材料", href: toolHref("sources") }]} />}
    {step.id === 4 && <div className="space-y-3" data-testid="aidt-idea-cards">
      {draft.ideas.map((item, index) => <article key={item.id} className={`space-y-3 rounded-xl border p-3 ${draft.selectedIdeaId === item.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between gap-2"><span className="text-12 font-medium">候选 {index + 1}</span><Button variant="ghost" size="xs" disabled={readOnly} onClick={() => item.title.trim() || item.description.trim() || item.image || item.imageAttachment || draft.selectedIdeaId === item.id ? setPendingRemoval(item.id) : removeIdea(item.id)}>移除候选 {index + 1}</Button></div>
        {pendingRemoval === item.id && <div role="alert" className="space-y-2 rounded-lg border border-border p-3 text-12"><p>移除后，本页未保存的内容将丢失；已保存的历史版本不会删除。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPendingRemoval(null)}>保留候选</Button><Button size="sm" variant="outline" disabled={readOnly} onClick={() => removeIdea(item.id)}>确认移除候选</Button></div></div>}
        <label className="block text-12">点子名称<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" aria-label={`候选${index + 1}名称`} value={item.title} maxLength={120} disabled={readOnly} onChange={(e) => idea(item.id, { title: e.currentTarget.value })} placeholder="给这个方向起一个容易讨论的名字" /></label>
        {item.imageAttachment ? <AidtImageAttachmentPreview projectId={projectId} reference={item.imageAttachment} alt={`候选${index + 1}已关联图像`} onState={(state) => setPrintImages((old) => old[item.id]?.key === imageKey(item) && old[item.id]?.src === state.src && old[item.id]?.failed === state.failed ? old : { ...old, [item.id]: { ...state, key: imageKey(item) } })} /> : item.image ? <Image src={item.image} width={480} height={270} unoptimized alt={`候选${index + 1}参考图（未上传）`} className="w-full rounded-md object-contain" /> : <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-12 text-muted-foreground">参考图待补充 · 不代表已生成</div>}
        {thread && <AidtImageAttachmentPicker projectId={projectId} thread={thread} value={item.imageAttachment} readOnly={readOnly} label={`候选${index + 1}图像`} onChange={(reference) => idea(item.id, { image: undefined, imageName: reference?.name, imageAttachment: reference ?? undefined })} />}
        <label className="block text-12">参考图预览<input aria-label={`候选${index + 1}参考图`} type="file" accept="image/png,image/jpeg,image/webp" disabled={readOnly} className="mt-1 block w-full text-11" onChange={(e) => image(item.id, e.currentTarget.files?.[0])} /></label>
        <label className="block text-12">两三句核心说明<textarea aria-label={`候选${index + 1}核心说明`} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-13" value={item.description} maxLength={2000} disabled={readOnly} onChange={(e) => idea(item.id, { description: e.currentTarget.value })} placeholder="为谁解决什么问题？主要做法是什么？为什么值得尝试？" /></label>
        <label className="flex items-center gap-2 text-12"><input type="radio" name={`aidt-idea-${projectId}`} checked={draft.selectedIdeaId === item.id} disabled={readOnly} onChange={() => { if (!readOnly) update((old) => ({ ...old, selectionReasons: old.selectedIdeaId ? { ...old.selectionReasons, [old.selectedIdeaId]: old.fields.reason ?? "" } : old.selectionReasons, unboundReason: !old.selectedIdeaId ? old.fields.reason || old.unboundReason : old.unboundReason, fields: { ...old.fields, reason: old.selectionReasons?.[item.id] ?? "" }, selectedIdeaId: item.id })); }} />拟选择候选 {index + 1}（不是投票）</label>
      </article>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={readOnly || draft.ideas.length >= 8} onClick={() => { if (!readOnly) { setDistinctReviewed(false); update((old) => invalidateAidtIdeaClassification({ ...old, ideas: [...old.ideas, { id: `draft-${crypto.randomUUID()}`, title: "", description: "" }] })); } }}>添加候选</Button><Button variant="outline" size="sm" disabled={printing || !readiness.ready || !distinctReviewed || !draft.ideas.every(imageReady)} onClick={() => void printIdeas()}>{printing ? "准备描述单…" : "描述单 PDF 预览"}</Button></div><p className="text-11 text-muted-foreground">至少三个不同点子；当前图文齐备 {readiness.complete} / {draft.ideas.length}。本地参考图仅在本页；共享保存请选取原生聊天中已发送的图片附件。</p>
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={distinctReviewed} disabled={readOnly} onChange={(event) => setDistinctReviewed(event.currentTarget.checked)} />本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。</label>
    </div>}
    {step.id === 4 && <AidtIdeaClassification draft={draft} readOnly={readOnly} onChange={(next) => { if (!readOnly) update((old) => ({ ...old, fields: { ...old.fields, ...Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map((key) => [key, next.fields[key] ?? ""])) } })); }} />}
    <AidtStageFields stageNumber={step.id} draft={draft} onChange={field} onDraftChange={(next) => { if (!readOnly) update(() => next); }} availableCards={availableCards} availableCardsRevision={availableCardsRevision} previousPrototype={previousPrototype} previousPrototypeRevision={previousPrototypeRevision} readOnly={readOnly} />
    {step.id === 2 && <AidtDiscoveryCards projectId={projectId} thread={thread} cards={draft.discoveryCards ?? []} readOnly={readOnly} onChange={(mutate) => update((old) => ({ ...old, discoveryCards: mutate(old.discoveryCards ?? []) }))} />}
    {step.id === 4 && (draft.unboundReason || Object.entries(draft.selectionReasons ?? {}).some(([id, text]) => id !== draft.selectedIdeaId && text.trim())) && <details className="text-12"><summary className="cursor-pointer">其他候选的理由与未归属笔记</summary>{Object.entries(draft.selectionReasons ?? {}).filter(([id, text]) => id !== draft.selectedIdeaId && text.trim()).map(([id, text]) => <p className="mt-2 whitespace-pre-wrap" key={id}>{draft.ideas.find((item) => item.id === id)?.title || "已移除候选"}：{text}</p>)}{draft.unboundReason && <p className="mt-2 whitespace-pre-wrap">未归属笔记：{draft.unboundReason}</p>}</details>}
    {step.id === 5 && <div className="space-y-2">{prototypeReadiness.ready ? <Button asChild variant="outline" className="w-full"><Link href={toolHref("design")}>打开原生 Design Workbench</Link></Button> : <><Button variant="outline" className="w-full" disabled>打开原生 Design Workbench</Button><p role="status" className="text-12 text-muted-foreground">{prototypeReadiness.reason}</p></>}</div>}
    {step.id === 2 && <Button asChild variant="outline" className="w-full"><Link href={toolHref("sources")}>查看与关联真实研究资料</Link></Button>}
    <div className="space-y-2 border-t border-border bg-background py-3" data-testid="aidt-stage-output-actions">{toChat && <Button className="w-full sm:w-auto" disabled={readOnly} onClick={() => {
      const result = toChat(aidtUiStageMarkdown(step.id, draft, availableCards, availableCardsRevision));
      setStatus(result === "accepted" ? "已带入聊天输入框。审阅并发送后保存本组对话；表单共享请使用上方保存按钮。" : result === "occupied" ? "聊天输入框已有未发送内容，未覆盖。请先处理原草稿，或使用复制。" : "本步聊天尚未就绪，请稍后重试；本栏草稿仍保留。");
    }}>审阅并发送到本步聊天</Button>}<div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => void copy()}>复制本步成果到聊天</Button>{step.id === 6 && <Button asChild variant="outline" size="sm"><Link href={aidtHref(projectId, 6, { tool: "report" })}>预览小组报告</Link></Button>}</div><p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p></div>
  </section>;
}
