"use client";
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AIDT_OUTPUTS, aidtUiStageMarkdown, type AidtUiStageDraft, type AidtIdeaDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtHref, type AidtStep } from "@/features/aidt/lib/project-aidt";
import { printResearchPdf } from "@/lib/research-report-export";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { AidtStageFields } from "@/features/aidt/components/aidt-stage-fields";
import { aidtIdeaReadiness } from "@/features/aidt/lib/aidt-idea-readiness";
import { AidtActivityNav } from "@/features/aidt/components/aidt-activity-nav";

export function printAidtUiText(text: string) {
  const root = document.createElement("article");
  for (const line of text.split("\n")) {
    const node = document.createElement(line.startsWith("# ") ? "h2" : line.startsWith("## ") ? "h3" : line.startsWith("### ") ? "h4" : "p");
    node.textContent = line.replace(/^#{1,3} /, ""); root.append(node);
  }
  printResearchPdf(root, "AIDT 小组草稿");
}

export function AidtStageOutput({ projectId, step, draft, update, readOnly, toolHref, toChat }: {
  projectId: string; step: AidtStep; draft: AidtUiStageDraft;
  update: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean; toolHref: (tool: string) => string;
  toChat?: (text: string) => ComposerOfferResult;
}) {
  const output = AIDT_OUTPUTS[step.id]!;
  const [status, setStatus] = React.useState("");
  const [distinctReviewed, setDistinctReviewed] = React.useState(false);
  const readiness = aidtIdeaReadiness(draft.ideas);
  const imageRequests = React.useRef(new Map<string, number>());
  const field = (id: string, value: string) => update((old) => ({ ...old, fields: { ...old.fields, [id]: value }, ...(id === "reason" && old.selectedIdeaId ? { selectionReasons: { ...old.selectionReasons, [old.selectedIdeaId]: value } } : {}) }));
  const idea = (id: string, value: Partial<AidtIdeaDraft>) => { setDistinctReviewed(false); update((old) => ({ ...old, ideas: old.ideas.map((item) => item.id === id ? { ...item, ...value } : item) })); };
  async function copy() {
    try { await navigator.clipboard.writeText(aidtUiStageMarkdown(step.id, draft)); setStatus("已复制。请粘贴到本步聊天并发送，发送成功后才会保存到本组。"); }
    catch { setStatus("未能复制，请手动选择填写内容。本栏尚未保存到小组。"); }
  }
  function image(id: string, file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setStatus("本页参考图预览支持 PNG、JPEG、WebP，单张不超过2MB。正式上传请使用聊天附件。"); return; }
    const request = (imageRequests.current.get(id) ?? 0) + 1;
    imageRequests.current.set(id, request);
    const reader = new FileReader();
    reader.onload = () => { if (imageRequests.current.get(id) === request && typeof reader.result === "string") idea(id, { image: reader.result, imageName: file.name }); };
    reader.onerror = () => setStatus("参考图读取失败，原有文字草稿仍保留。");
    reader.readAsDataURL(file);
  }
  function printIdeas() {
    if (!readiness.ready || !distinctReviewed) { setStatus("请先完成至少三个不同点子的名称、图像和两三句说明，并核对概念差异。"); return; }
    const article = document.createElement("article");
    const heading = document.createElement("h2"); heading.textContent = "小组点子描述单 · 未保存草稿"; article.append(heading);
    const note = document.createElement("p"); note.textContent = "仅包含本页填写内容与参考图，不是投票结果或已确认方案。"; article.append(note);
    for (const [index, item] of draft.ideas.entries()) {
      const h = document.createElement("h3"); h.textContent = `${index + 1}. ${item.title || "待命名"}${draft.selectedIdeaId === item.id ? "（拟选择）" : ""}`; article.append(h);
      if (item.image) { const img = document.createElement("img"); img.src = item.image; img.width = 300; img.alt = item.title || "候选参考图"; article.append(img); }
      const p = document.createElement("p"); p.textContent = item.description || "核心说明待补充。"; article.append(p);
    }
    printResearchPdf(article, "AIDT 点子描述单草稿");
    setStatus("已请求打开打印预览，可选择另存为PDF；不会因此保存到小组。");
  }
  return <section className="space-y-4" data-testid="aidt-stage-output">
    <div><p className="text-11 text-muted-foreground">本页草稿</p><h3 className="mt-1 text-20 font-semibold">{output.title}</h3></div>
    <details className="text-12 text-muted-foreground" data-testid="aidt-output-help"><summary className="cursor-pointer">填写与保存说明</summary><p className="mt-2">{output.hint}</p><p className="mt-1">本栏只保留本页草稿，刷新或离开页面后会丢失。需要共享时，带入本步聊天，审阅并发送；发送成功才保存到本组对话。</p></details>
    {step.id === 2 && <AidtActivityNav currentId="draft" items={[{ id: "draft", label: "访谈计划", href: toolHref("outcome") }, { id: "sources", label: "研究材料", href: toolHref("sources") }]} />}
    {step.id === 4 && <div className="space-y-3" data-testid="aidt-idea-cards">
      {draft.ideas.map((item, index) => <article key={item.id} className={`space-y-3 rounded-xl border p-3 ${draft.selectedIdeaId === item.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between gap-2"><span className="text-12 font-medium">候选 {index + 1}</span><Button variant="ghost" size="xs" disabled={readOnly} onClick={() => update((old) => ({ ...old, ideas: old.ideas.filter((it) => it.id !== item.id), selectedIdeaId: old.selectedIdeaId === item.id ? "" : old.selectedIdeaId }))}>移除候选 {index + 1}</Button></div>
        <label className="block text-12">点子名称<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-13" aria-label={`候选${index + 1}名称`} value={item.title} maxLength={120} disabled={readOnly} onChange={(e) => idea(item.id, { title: e.currentTarget.value })} placeholder="给这个方向起一个容易讨论的名字" /></label>
        {item.image ? <Image src={item.image} width={480} height={270} unoptimized alt={`候选${index + 1}参考图（未上传）`} className="w-full rounded-md object-contain" /> : <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-12 text-muted-foreground">参考图待补充 · 不代表已生成</div>}
        <label className="block text-12">参考图预览<input aria-label={`候选${index + 1}参考图`} type="file" accept="image/png,image/jpeg,image/webp" disabled={readOnly} className="mt-1 block w-full text-11" onChange={(e) => image(item.id, e.currentTarget.files?.[0])} /></label>
        <label className="block text-12">两三句核心说明<textarea aria-label={`候选${index + 1}核心说明`} className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-13" value={item.description} maxLength={2000} disabled={readOnly} onChange={(e) => idea(item.id, { description: e.currentTarget.value })} placeholder="为谁解决什么问题？主要做法是什么？为什么值得尝试？" /></label>
        <label className="flex items-center gap-2 text-12"><input type="radio" name={`aidt-idea-${projectId}`} checked={draft.selectedIdeaId === item.id} disabled={readOnly} onChange={() => update((old) => ({ ...old, selectionReasons: old.selectedIdeaId ? { ...old.selectionReasons, [old.selectedIdeaId]: old.fields.reason ?? "" } : old.selectionReasons, unboundReason: !old.selectedIdeaId ? old.fields.reason || old.unboundReason : old.unboundReason, fields: { ...old.fields, reason: old.selectionReasons?.[item.id] ?? "" }, selectedIdeaId: item.id }))} />拟选择候选 {index + 1}（不是投票）</label>
      </article>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={readOnly || draft.ideas.length >= 8} onClick={() => update((old) => ({ ...old, ideas: [...old.ideas, { id: `draft-${crypto.randomUUID()}`, title: "", description: "" }] }))}>添加候选</Button><Button variant="outline" size="sm" disabled={!readiness.ready || !distinctReviewed} onClick={printIdeas}>描述单 PDF 预览</Button></div><p className="text-11 text-muted-foreground">至少三个不同点子；当前图文齐备 {readiness.complete} / {draft.ideas.length}。参考图仅在本页，正式材料请用聊天附件上传。</p>
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={distinctReviewed} disabled={readOnly} onChange={(event) => setDistinctReviewed(event.currentTarget.checked)} />本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。</label>
    </div>}
    <AidtStageFields stageNumber={step.id} draft={draft} onChange={field} readOnly={readOnly} />
    {step.id === 4 && (draft.unboundReason || Object.entries(draft.selectionReasons ?? {}).some(([id, text]) => id !== draft.selectedIdeaId && text.trim())) && <details className="text-12"><summary className="cursor-pointer">其他候选的理由与未归属笔记</summary>{Object.entries(draft.selectionReasons ?? {}).filter(([id, text]) => id !== draft.selectedIdeaId && text.trim()).map(([id, text]) => <p className="mt-2 whitespace-pre-wrap" key={id}>{draft.ideas.find((item) => item.id === id)?.title || "已移除候选"}：{text}</p>)}{draft.unboundReason && <p className="mt-2 whitespace-pre-wrap">未归属笔记：{draft.unboundReason}</p>}</details>}
    {step.id === 5 && <Button asChild variant="outline" className="w-full"><Link href={toolHref("design")}>打开原生 Design Workbench</Link></Button>}
    {step.id === 2 && <Button asChild variant="outline" className="w-full"><Link href={toolHref("sources")}>查看与关联真实研究资料</Link></Button>}
    <div className="sticky bottom-0 space-y-2 border-t border-border bg-background py-3">{toChat && <Button className="w-full" disabled={readOnly} onClick={() => {
      const result = toChat(aidtUiStageMarkdown(step.id, draft));
      setStatus(result === "accepted" ? "已带入聊天输入框。请审阅并发送，发送成功后才保存到本组。" : result === "occupied" ? "聊天输入框已有未发送内容，未覆盖。请先处理原草稿，或使用复制。" : "本步聊天尚未就绪，请稍后重试；本栏草稿仍保留。");
    }}>审阅并发送到本步聊天</Button>}<Button variant="outline" className="w-full" onClick={() => void copy()}>复制本步成果到聊天</Button>{step.id === 6 && <Button asChild variant="outline" className="w-full"><Link href={aidtHref(projectId, 6, { tool: "report" })}>预览小组报告</Link></Button>}<p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p></div>
  </section>;
}
