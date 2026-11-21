"use client";
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AIDT_OUTPUTS, aidtUiStageMarkdown, type AidtUiStageDraft, type AidtIdeaDraft, type AidtDiscoveryCardDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtHref, type AidtStep } from "@/features/aidt/lib/project-aidt";
import { printResearchPdf, preparePrintImages } from "@/lib/research-report-export";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { AidtInterviewGuideExport } from "./aidt-interview-guide-export";
import { AidtDefinitionDirectory, AidtDefinitionEditor } from "./aidt-definition";
import { AidtStageFields } from "@/features/aidt/components/aidt-stage-fields";
import { aidtIdeaSentenceCount, aidtIdeaReadiness, aidtCompleteIdeas } from "@/features/aidt/lib/aidt-idea-readiness";
import { aidtIdeaSheets, buildAidtIdeaSheetsDocument } from "../lib/aidt-idea-sheets";
import { AidtIdeaSheetPreview } from "./aidt-idea-sheet-preview";
import { AidtActivityNav } from "@/features/aidt/components/aidt-activity-nav";
import { AidtDiscoveryCards } from "@/features/aidt/components/aidt-discovery-cards";
import { removeAidtDiscoveryAssociations } from "../lib/aidt-discovery-evidence";
import { AidtImageAttachmentPicker, AidtImageAttachmentPreview, type AidtImageAttachmentState } from "./aidt-image-attachment-picker";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtIdeaClassification } from "@/features/aidt/components/aidt-idea-classification";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, aidtIdeaClassificationFor, invalidateAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";
import { getAidtPrototypeGenerationReadiness } from "@/features/aidt/lib/aidt-verification-loop";
import { AidtPrototypeVersionPicker } from "./aidt-prototype-version-picker";
import { readAidtPrototypeReference, updateAidtPrototypeReference, updateAidtPrototypeVersionText } from "../lib/aidt-prototype-reference";
import { AidtResearchMaterialControl, AidtResearchMaterialPreview } from "./aidt-research-material";
import { aidtResearchMaterialsFromFields, isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey } from "../lib/aidt-research-materials";

export function printAidtUiText(text: string, options?: Parameters<typeof printResearchPdf>[2]): Promise<void> {
  const root = document.createElement("article");
  for (const line of text.split("\n")) {
    const node = document.createElement(line.startsWith("# ") ? "h2" : line.startsWith("## ") ? "h3" : line.startsWith("### ") ? "h4" : "p");
    node.textContent = line.replace(/^#{1,3} /, ""); root.append(node);
  }
  return printResearchPdf(root, "AIDT 小组草稿", options);
}

export function AidtStageOutput({ projectId, thread = null, step, draft, update, readOnly, toolHref, toChat, availableCards = [], availableCardsRevision, previousPrototype, previousPrototypeRevision, discoveryCardFields, activeDefinitionEntityId }: {
  projectId: string; step: AidtStep; draft: AidtUiStageDraft;
  thread?: string | null;
  update: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean; toolHref: (tool: string) => string;
  toChat?: (text: string) => ComposerOfferResult;
  availableCards?: readonly AidtDiscoveryCardDraft[]; availableCardsRevision?: number;
  discoveryCardFields?: Readonly<Record<string, string>>; activeDefinitionEntityId?: string | null;
  previousPrototype?: AidtUiStageDraft; previousPrototypeRevision?: number;
}) {
  const output = AIDT_OUTPUTS[step.id]!;
  const [status, setStatus] = React.useState("");
  const [pendingRemoval, setPendingRemoval] = React.useState<string | null>(null);
  const [distinctReviewed, setDistinctReviewed] = React.useState(false);
  const [excludedSheetIds, setExcludedSheetIds] = React.useState<string[]>([]);
  const [printing, setPrinting] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const identity = useOptionalSession()?.session;
  const imageScope = JSON.stringify([identity?.currentOrgId, identity?.userId, identity?.sessionToken, projectId]);
  const printScope = JSON.stringify([imageScope, step.id, readOnly]);
  const printLifecycle = React.useRef({ scope: printScope, active: true, generation: 0 });
  if (printLifecycle.current.scope !== printScope) { printLifecycle.current.scope = printScope; printLifecycle.current.generation++; }
  const latestPrintDraft = React.useRef(draft); latestPrintDraft.current = draft;
  React.useEffect(() => { const lifecycle = printLifecycle.current; lifecycle.active = true; return () => { lifecycle.active = false; }; }, []);
  // A local FileReader needs actor/permission isolation, but no server token.
  // Increment on every scope transition so A -> B -> A cannot revive an old read.
  const localReadScope = JSON.stringify([identity?.currentOrgId, identity?.userId, projectId, step.id, readOnly]);
  const localReadLifecycle = React.useRef({ scope: localReadScope, generation: 0 });
  if (localReadLifecycle.current.scope !== localReadScope) localReadLifecycle.current = { scope: localReadScope, generation: localReadLifecycle.current.generation + 1 };
  const [printImages, setPrintImages] = React.useState<Record<string, AidtImageAttachmentState & { key: string }>>({});
  const rawImage = (item: AidtIdeaDraft) => { const reference = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", item.id)]); return reference?.projectId === projectId && isAidtResearchImage(reference) ? reference : null; };
  const localMaterials = aidtResearchMaterialsFromFields(draft.fields, projectId).map(item => item.material);
  const imageKey = (item: AidtIdeaDraft) => JSON.stringify([imageScope, item.imageAttachment, rawImage(item)]);
  const imageReady = (item: AidtIdeaDraft) => (!item.imageAttachment && !rawImage(item)) || (printImages[item.id]?.key === imageKey(item) && Boolean(printImages[item.id]?.src) && !printImages[item.id]?.failed);
  const completeIdeas = aidtCompleteIdeas(draft.ideas, item => !!rawImage(item));
  const selectedSheets = completeIdeas.filter(item => !excludedSheetIds.includes(item.id));
  const readiness = aidtIdeaReadiness(selectedSheets, item => !!rawImage(item));
  const showSheetChoice = completeIdeas.length > 3 || completeIdeas.some(item => excludedSheetIds.includes(item.id));
  const printMaterialKey = JSON.stringify([distinctReviewed, excludedSheetIds, draft.ideas.map(item => [item.id, imageKey(item), printImages[item.id]])]);
  const printMaterials = React.useRef({ key: printMaterialKey, generation: 0 });
  if (printMaterials.current.key !== printMaterialKey) printMaterials.current = { key: printMaterialKey, generation: printMaterials.current.generation + 1 };
  const prototypeReadiness = getAidtPrototypeGenerationReadiness(draft);
  const imageRequests = React.useRef(new Map<string, number>());
  const field = (id: string, value: string) => { if (readOnly) return; if (id === "version") { update((old) => updateAidtPrototypeVersionText(old, value)); return; } update((old) => ({ ...old, fields: { ...old.fields, [id]: value, ...(["initial", "rewrittenTheme"].includes(id) ? { problemReflectionConfirmed: "" } : {}), ...(step.id === 6 ? { reflectionConfirmed: "" } : {}), ...(step.id === 5 && id === "idea" ? { verificationQuestionConfirmed: "", verificationQuestionConfirmation: "" } : {}) }, ...(id === "reason" && old.selectedIdeaId ? { selectionReasons: { ...old.selectionReasons, [old.selectedIdeaId]: value } } : {}) })); };
  const idea = (id: string, value: Partial<AidtIdeaDraft>) => { if (readOnly) return; if (Object.hasOwn(value, "imageAttachment") || Object.hasOwn(value, "image")) imageRequests.current.set(id, (imageRequests.current.get(id) ?? 0) + 1); setDistinctReviewed(false); update((old) => invalidateAidtIdeaClassification({ ...old, ...(Object.hasOwn(value, "imageAttachment") || Object.hasOwn(value, "image") ? { fields: { ...old.fields, [researchMaterialKey("idea", id)]: "" } } : {}), ideas: old.ideas.map((item) => item.id === id ? { ...item, ...value } : item) })); };
  const removeIdea = (id: string) => {
    if (readOnly) return;
    setDistinctReviewed(false);
    imageRequests.current.set(id, (imageRequests.current.get(id) ?? 0) + 1);
    update((old) => invalidateAidtIdeaClassification({ ...old, fields: { ...old.fields, [researchMaterialKey("idea", id)]: "" }, ideas: old.ideas.filter((item) => item.id !== id), selectedIdeaId: old.selectedIdeaId === id ? "" : old.selectedIdeaId }));
    setPendingRemoval(null);
  };
  async function copy() {
    try { await navigator.clipboard.writeText(aidtUiStageMarkdown(step.id, draft, availableCards, availableCardsRevision)); setStatus("已复制。粘贴并发送成功后才会保存到本组对话；表单共享请使用上方保存按钮。"); }
    catch { setStatus("未能复制，请手动选择填写内容。表单保存状态以上方共享回执为准。"); }
  }
  function image(id: string, file?: File) {
    if (readOnly || !file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setStatus("本页参考图预览支持 PNG、JPEG、WebP，单张不超过2MB。正式保存请使用原始图片入口。"); return; }
    const request = (imageRequests.current.get(id) ?? 0) + 1;
    imageRequests.current.set(id, request);
    const generation = localReadLifecycle.current.generation;
    const currentRead = () => printLifecycle.current.active && localReadLifecycle.current.scope === localReadScope && localReadLifecycle.current.generation === generation && imageRequests.current.get(id) === request;
    const reader = new FileReader();
    reader.onload = () => { if (currentRead() && typeof reader.result === "string") idea(id, { image: reader.result, imageName: file.name, imageAttachment: undefined }); };
    reader.onerror = () => { if (currentRead()) setStatus("参考图读取失败，原有文字草稿仍保留。"); };
    reader.readAsDataURL(file);
  }
  const resolvedImages = Object.fromEntries(draft.ideas.filter(imageReady).map(item => [item.id, printImages[item.id]?.src ?? ""]));
  const sheets = readiness.ready && distinctReviewed && selectedSheets.every(imageReady) ? aidtIdeaSheets(draft, resolvedImages, selectedSheets.map(item => item.id), projectId) : [];
  async function printIdeas(id?: string) {
    if (!sheets.length) { setStatus("请先完成至少三个不同点子的图文与两三句说明，等待图片读取成功，并核对概念差异。"); return; }
    setPrinting(true);
    const printGeneration = printLifecycle.current.generation, materialGeneration = printMaterials.current.generation;
    const isCurrent = () => printLifecycle.current.active && printLifecycle.current.scope === printScope && printLifecycle.current.generation === printGeneration && latestPrintDraft.current === draft && printMaterials.current.generation === materialGeneration;
    try {
      const reviewed = buildAidtIdeaSheetsDocument(sheets);
      await preparePrintImages(Array.from(reviewed.querySelectorAll("img")));
      if (!printLifecycle.current.active || printLifecycle.current.scope !== printScope || printLifecycle.current.generation !== printGeneration) return;
      if (latestPrintDraft.current !== draft) { setStatus("内容已变化，未打印旧稿。请重新审阅当前描述单后重试。"); return; }
      const article = id ? buildAidtIdeaSheetsDocument(sheets.filter(sheet => sheet.id === id)) : reviewed;
      await printResearchPdf(article, id ? `AIDT 点子描述单-${sheets.find(sheet => sheet.id === id)?.title ?? "学生稿"}` : "AIDT 点子描述单草稿", { isCurrent });
      if (!isCurrent()) return;
      setStatus("已请求打开打印预览，可选择另存为PDF；请分别保存各份描述单，不会因此保存到小组。");
    } catch { setStatus("描述单打印未能启动或图片尚不可用，文字与选择仍保留。请重试读取图片后再导出。"); }
    finally { setPrinting(false); }
  }
  return <section className="space-y-4" data-testid="aidt-stage-output">
    <div><h3 className="text-20 font-semibold tracking-tight">{output.title}</h3></div>
    <details className="text-12 text-muted-foreground" data-testid="aidt-output-help"><summary className="cursor-pointer">填写与保存说明</summary><p className="mt-2">{output.hint}</p><p className="mt-1">本栏是可编辑草稿，未保存修改刷新或离开页面后会丢失。使用上方“保存到小组”并核对服务器回执，才会写入共享成果。带入聊天并发送只保存对话，不自动保存这里的表单。</p></details>
    {step.id === 2 && <AidtActivityNav currentId="draft" items={[{ id: "draft", label: "访谈计划", href: toolHref("outcome") }, { id: "sources", label: "研究材料", href: toolHref("sources") }]} />}
    {step.id === 4 && <div className="space-y-3" data-testid="aidt-idea-cards">
      {draft.ideas.map((item, index) => <article key={item.id} className={`space-y-3 rounded-xl border p-3 ${draft.selectedIdeaId === item.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
        {showSheetChoice && completeIdeas.some(complete => complete.id === item.id) && <label className="flex items-center gap-2 text-12"><input type="checkbox" aria-label={`候选${index + 1}用于本次描述单`} checked={!excludedSheetIds.includes(item.id)} disabled={readOnly || printing} onChange={event => { const checked = event.currentTarget.checked; setExcludedSheetIds(ids => checked ? ids.filter(id => id !== item.id) : [...ids.filter(id => id !== item.id), item.id]); setDistinctReviewed(false); }} />用于本次描述单预览</label>}
        <div className="flex items-center justify-between gap-2"><span className="text-12 font-medium">候选 {index + 1}</span><Button variant="ghost" size="xs" disabled={readOnly} onClick={() => item.title.trim() || item.description.trim() || item.image || item.imageAttachment || draft.selectedIdeaId === item.id ? setPendingRemoval(item.id) : removeIdea(item.id)}>移除候选 {index + 1}</Button></div>
        {pendingRemoval === item.id && <div role="alert" className="space-y-2 rounded-lg border border-border p-3 text-12"><p>移除后，本页未保存的内容将丢失；已保存的历史版本不会删除。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPendingRemoval(null)}>保留候选</Button><Button size="sm" variant="outline" disabled={readOnly} onClick={() => removeIdea(item.id)}>确认移除候选</Button></div></div>}
        <label className="block text-12">点子名称<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" aria-label={`候选${index + 1}名称`} value={item.title} maxLength={120} disabled={readOnly} onChange={(e) => idea(item.id, { title: e.currentTarget.value })} placeholder="给这个方向起一个容易讨论的名字" /></label>
        {rawImage(item) ? <AidtResearchMaterialPreview projectId={projectId} reference={rawImage(item)!} alt={`候选${index + 1}原始材料图像`} onImageState={state => setPrintImages(old => old[item.id]?.key === imageKey(item) && old[item.id]?.src === state.src && old[item.id]?.failed === state.failed ? old : { ...old, [item.id]: { ...state, key: imageKey(item) } })} /> : item.imageAttachment ? <AidtImageAttachmentPreview projectId={projectId} reference={item.imageAttachment} alt={`候选${index + 1}已关联图像`} onState={(state) => setPrintImages((old) => old[item.id]?.key === imageKey(item) && old[item.id]?.src === state.src && old[item.id]?.failed === state.failed ? old : { ...old, [item.id]: { ...state, key: imageKey(item) } })} /> : item.image ? <Image src={item.image} width={480} height={270} unoptimized alt={`候选${index + 1}参考图（未上传）`} className="w-full rounded-md object-contain" /> : <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-12 text-muted-foreground">参考图待补充 · 不代表已生成</div>}
        <AidtResearchMaterialControl projectId={projectId} label={`候选${index + 1}原始图片`} selectionScope={JSON.stringify([item.imageAttachment, item.image, rawImage(item)])} imagesOnly localMaterials={localMaterials} value={rawImage(item)} readOnly={readOnly} onChange={reference => { if (readOnly) return; imageRequests.current.set(item.id, (imageRequests.current.get(item.id) ?? 0) + 1); setDistinctReviewed(false); update(old => invalidateAidtIdeaClassification({ ...old, fields: { ...old.fields, [researchMaterialKey("idea", item.id)]: reference ? JSON.stringify(reference) : "" }, ideas: old.ideas.map(current => current.id === item.id && reference ? { ...current, image: "", imageName: reference.name, imageAttachment: undefined } : current) })); }} />
        {thread && <AidtImageAttachmentPicker projectId={projectId} thread={thread} value={item.imageAttachment} readOnly={readOnly} label={`候选${index + 1}图像`} onChange={(reference) => idea(item.id, { image: undefined, imageName: reference?.name, imageAttachment: reference ?? undefined })} />}
        <label className="block text-12">参考图预览<input aria-label={`候选${index + 1}参考图`} type="file" accept="image/png,image/jpeg,image/webp" disabled={readOnly} className="mt-1 block w-full text-11" onChange={(e) => image(item.id, e.currentTarget.files?.[0])} /></label>
        <label className="block text-12">两三句核心说明<textarea aria-label={`候选${index + 1}核心说明`} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-13" value={item.description} maxLength={2000} disabled={readOnly} onChange={(e) => idea(item.id, { description: e.currentTarget.value })} placeholder="为谁解决什么问题？主要做法是什么？为什么值得尝试？" /><span className="mt-1 block text-11 text-muted-foreground">当前 {aidtIdeaSentenceCount(item.description)} 句；请用2–3句话说明做法、作用与待验证之处。</span></label>
        <label className="flex items-center gap-2 text-12"><input type="radio" name={`aidt-idea-${projectId}`} checked={draft.selectedIdeaId === item.id} disabled={readOnly} onChange={() => { if (!readOnly) update((old) => ({ ...old, selectionReasons: old.selectedIdeaId ? { ...old.selectionReasons, [old.selectedIdeaId]: old.fields.reason ?? "" } : old.selectionReasons, unboundReason: !old.selectedIdeaId ? old.fields.reason || old.unboundReason : old.unboundReason, fields: { ...old.fields, reason: old.selectionReasons?.[item.id] ?? "" }, selectedIdeaId: item.id })); }} />拟选择候选 {index + 1}（不是投票）</label>
      </article>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={readOnly || draft.ideas.length >= 8} onClick={() => { if (!readOnly) { setDistinctReviewed(false); update((old) => invalidateAidtIdeaClassification({ ...old, ideas: [...old.ideas, { id: `draft-${crypto.randomUUID()}`, title: "", description: "" }] })); } }}>添加候选</Button><Button variant="outline" size="sm" disabled={printing || !readiness.ready || !distinctReviewed || !selectedSheets.every(imageReady)} data-testid="aidt-idea-sheets-open" onClick={() => setPreviewOpen(value => !value)}>{previewOpen ? "收起描述单预览" : "描述单 PDF 预览"}</Button></div><p className="text-11 text-muted-foreground">至少三个不同点子；预览仅包含名称、图像与2–3句话齐备的描述单，其余脑暴草稿保留。候选较多时，可勾选本次预览；未勾选的候选不会出现在本次PDF。当前图文齐备 {readiness.complete} / {draft.ideas.length}。本地参考图仅在本页；可选原始图片或已发送的聊天附件；关联后再保存到小组。</p>
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={distinctReviewed} disabled={readOnly} onChange={(event) => setDistinctReviewed(event.currentTarget.checked)} />本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。</label>
    </div>}
    {step.id === 4 && previewOpen && (sheets.length ? <AidtIdeaSheetPreview sheets={sheets} printing={printing} onPrint={(id) => void printIdeas(id)} /> : <p role="status" className="text-12 text-muted-foreground">图文或审阅状态已变化，请重新核对后预览。</p>)}
    {step.id === 4 && <AidtIdeaClassification draft={draft} readOnly={readOnly} onChange={(next) => { if (!readOnly) update((old) => ({ ...old, fields: { ...old.fields, ...Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map((key) => [key, next.fields[key] ?? ""])) } })); }} />}
    {step.id === 3 ? activeDefinitionEntityId
      ? <AidtDefinitionEditor projectId={projectId} draft={draft} update={update} readOnly={readOnly} availableCards={availableCards} availableCardsRevision={availableCardsRevision} discoveryCardFields={discoveryCardFields} entityId={activeDefinitionEntityId} />
      : <AidtDefinitionDirectory projectId={projectId} draft={draft} update={update} readOnly={readOnly} availableCards={availableCards} availableCardsRevision={availableCardsRevision} discoveryCardFields={discoveryCardFields} entityHref={id => `${toolHref("outcome")}&entity=${encodeURIComponent(id)}`} />
      : <AidtStageFields projectId={projectId} stageNumber={step.id} draft={draft} onChange={field} onDraftChange={(next) => { if (!readOnly) update(() => next); }} availableCards={availableCards} availableCardsRevision={availableCardsRevision} previousPrototype={previousPrototype} previousPrototypeRevision={previousPrototypeRevision} readOnly={readOnly} />}
    {step.id === 2 && <AidtInterviewGuideExport scopeKey={printScope} guide={draft.fields.guide ?? ""} adoptedGuide={draft.fields.adoptedGuide ?? ""} />}
    {(step.id === 2 || step.id === 6) && <div className="space-y-3" data-testid="aidt-research-materials"><AidtResearchMaterialControl projectId={projectId} label={step.id === 6 ? "测试原始材料" : "研究原始材料"} readOnly={readOnly} onChange={reference => { if (!readOnly && reference) field(`researchFile:${crypto.randomUUID()}`, JSON.stringify(reference)); }} />{aidtResearchMaterialsFromFields(draft.fields, projectId).filter(item => item.key.startsWith("researchFile:")).map(({ key, material }) => <div key={key} className="space-y-2"><AidtResearchMaterialPreview projectId={projectId} reference={material} /><Button type="button" size="xs" variant="ghost" disabled={readOnly} onClick={() => field(key, "")}>移除本步材料关联（保留原件）</Button></div>)}</div>}
    {step.id === 2 && <AidtDiscoveryCards projectId={projectId} thread={thread} cards={draft.discoveryCards ?? []} fields={draft.fields} onFieldChange={field} readOnly={readOnly} onChange={(mutate) => update((old) => { const cards = mutate(old.discoveryCards ?? []); return { ...old, discoveryCards: cards, fields: removeAidtDiscoveryAssociations(old.fields, (old.discoveryCards ?? []).filter(card => !cards.some(current => current.id === card.id)).map(card => card.id)) }; })} />}
    {step.id === 4 && (draft.unboundReason || Object.entries(draft.selectionReasons ?? {}).some(([id, text]) => id !== draft.selectedIdeaId && text.trim())) && <details className="text-12"><summary className="cursor-pointer">其他候选的理由与未归属笔记</summary>{Object.entries(draft.selectionReasons ?? {}).filter(([id, text]) => id !== draft.selectedIdeaId && text.trim()).map(([id, text]) => <p className="mt-2 whitespace-pre-wrap" key={id}>{draft.ideas.find((item) => item.id === id)?.title || "已移除候选"}：{text}</p>)}{draft.unboundReason && <p className="mt-2 whitespace-pre-wrap">未归属笔记：{draft.unboundReason}</p>}</details>}
    {(step.id === 5 || step.id === 6) && identity?.currentOrgId && identity.userId && identity.sessionToken && <AidtPrototypeVersionPicker projectId={projectId} selectionScope={JSON.stringify([draft.fields.version ?? "", draft.fields.questionSnapshot ?? ""])} value={readAidtPrototypeReference(draft)} readOnly={readOnly} onChange={(reference) => { if (!readOnly) update((old) => updateAidtPrototypeReference(old, reference)); }} />}
    {step.id === 5 && <div className="space-y-2">{prototypeReadiness.ready ? <Button asChild variant="outline" className="w-full"><Link href={toolHref("design")}>打开原生 Design Workbench</Link></Button> : <><Button variant="outline" className="w-full" disabled>打开原生 Design Workbench</Button><p role="status" className="text-12 text-muted-foreground">{prototypeReadiness.reason}</p></>}</div>}
    {step.id === 2 && <Button asChild variant="outline" className="w-full"><Link href={toolHref("sources")}>查看与关联真实研究资料</Link></Button>}
    <div className="space-y-2 border-t border-border bg-background py-3" data-testid="aidt-stage-output-actions">{step.id !== 3 && toChat && <Button variant="outline" className="w-full sm:w-auto" disabled={readOnly} onClick={() => {
      const result = toChat(aidtUiStageMarkdown(step.id, draft, availableCards, availableCardsRevision));
      setStatus(result === "accepted" ? "已放入对话输入框，请检查后发送。成果需另外保存到小组。" : result === "occupied" ? "聊天输入框已有未发送内容，未覆盖。请先处理原草稿，或使用复制。" : "本步聊天尚未就绪，请稍后重试；本栏草稿仍保留。");
    }}>带入对话草稿</Button>}<div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => void copy()}>复制内容</Button>{step.id === 6 && <Button asChild variant="outline" size="sm"><Link href={aidtHref(projectId, 6, { tool: "report" })}>预览小组报告</Link></Button>}</div><p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p></div>
  </section>;
}
