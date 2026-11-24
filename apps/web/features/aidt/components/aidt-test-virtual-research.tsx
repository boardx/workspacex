"use client";
import * as React from "react";
import Link from "next/link";
import { interview } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { createDigitalInterviewDraft } from "@/lib/live-interview-metadata";
import { initializeInterviewMarkdown, loadInterviewMarkdown, saveInterviewMarkdown, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { MarkdownProse } from "@/components/chat/markdown-prose";
import { InterviewReportStep } from "@/components/itv/interview-report-step";
import { listProjectResources } from "@/lib/live-project-resources";
import { useOptionalSession } from "@/components/session/session-provider";
import { loadAidtTestResearchContext } from "../lib/aidt-test-prototype-context";
import { previewAidtPdf } from "../lib/aidt-print-preview";
import { aidtTestResearchPath, aidtVirtualResearchBinding, aidtVirtualResearchHref, readAidtVirtualResearch, verifyAidtVirtualResearch, writeAidtVirtualResearch, type AidtVirtualResearchBinding } from "../lib/aidt-test-research";
import { readAidtTestGroups, updateAidtTestGroup, type AidtTestGroup } from "../lib/aidt-test-groups";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Verified = NonNullable<Awaited<ReturnType<typeof verifyAidtVirtualResearch>>>;
export function AidtTestVirtualResearch({ projectId, group, draft, readOnly, update, onSourceChange }: {
  projectId: string; group: AidtTestGroup; draft: AidtUiStageDraft; readOnly: boolean;
  update: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void; onSourceChange?: () => void;
}) {
  const session = useOptionalSession()?.session;
  const sourceId = group.source?.kind === "interview" ? group.source.id : undefined;
  const savedBinding = readAidtVirtualResearch(draft, group.id);
  const bindingKey = savedBinding?.interviewId === sourceId ? JSON.stringify(savedBinding) : "";
  const binding = React.useMemo(() => bindingKey ? JSON.parse(bindingKey) as AidtVirtualResearchBinding : null, [bindingKey]);
  const [attempt, refresh] = React.useReducer(value => value + 1, 0);
  const [source, setSource] = React.useState<InterviewMarkdownEnvelope | null>(null);
  const readScope = JSON.stringify([projectId, session?.currentOrgId, session?.userId, session?.sessionToken, sourceId, binding]);
  const currentScope = React.useRef(readScope); currentScope.current = readScope;
  const [acceptedScope, setAcceptedScope] = React.useState<string | null>(null);
  const [storedVerified, setVerified] = React.useState<Verified | null>(null);
  const [storedCurrentVerified, setCurrentVerified] = React.useState<Verified | null>(null);
  const verified = acceptedScope === readScope ? storedVerified : null;
  const currentVerified = acceptedScope === readScope ? storedCurrentVerified : null;
  const [busy, setBusy] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const reportRoot = React.useRef<HTMLDivElement>(null);
  const outlineRoot = React.useRef<HTMLElement>(null), runsRoot = React.useRef<HTMLElement>(null);
  const [error, setError] = React.useState("");
  const epoch = React.useRef(0);
  React.useEffect(() => { const generation = epoch; generation.current++; return () => { generation.current++; }; }, [group.id, projectId, readOnly, session?.currentOrgId, session?.userId, session?.sessionToken]);
  React.useEffect(() => {
    if (!sourceId) { setSource(null); setVerified(null); setCurrentVerified(null); return; }
    const controller = new AbortController();
    setAcceptedScope(null);
    setSource(null); setVerified(null); setCurrentVerified(null); setError("");
    void listProjectResources(projectId).then(async linked => {
      if (controller.signal.aborted || !linked.items.some(item => item.kind === "interview" && item.id === sourceId)) throw new Error("PROJECT_SOURCE_REQUIRED");
      return loadInterviewMarkdown(sourceId, controller.signal);
    }).then(async current => {
      if (current.interviewId !== sourceId) throw new Error("SOURCE_MISMATCH");
      const target = binding ?? aidtVirtualResearchBinding(current);
      const checked = target && await verifyAidtVirtualResearch(current, target);
      const currentPin = aidtVirtualResearchBinding(current);
      const checkedCurrent = currentPin && await verifyAidtVirtualResearch(current, currentPin);
      if (controller.signal.aborted || currentScope.current !== readScope) return;
      setAcceptedScope(readScope);
      setSource(current); setVerified(checked || null); setCurrentVerified(checkedCurrent || null);
      if (binding && !checked) setError("已保存的大纲、模拟对话或报告版本当前无法核对。原引用保留，不会用最新内容替换。");
    }).catch(() => { if (!controller.signal.aborted) setError("无法读取这份虚拟研究。已保存引用保留，请检查权限后刷新。"); });
    return () => controller.abort();
  }, [sourceId, projectId, binding, attempt, readScope]);
  const change = (mutate: (current: AidtUiStageDraft, latest: AidtTestGroup) => AidtUiStageDraft) => {
    if (readOnly) return;
    update(current => {
      const latest = readAidtTestGroups(current.fields).find(item => item.id === group.id && !item.archived);
      return latest && aidtTestResearchPath(latest) === "virtual" ? mutate(current, latest) : current;
    });
    onSourceChange?.();
  };
  async function create() {
    if (readOnly || busy || sourceId || !group.task.trim() || !session?.sessionToken || !session.userId) return;
    setBusy(true); setError("");
    const generation = epoch.current;
    try {
      const research = await loadAidtTestResearchContext({ projectId, sessionToken: session.sessionToken, userId: session.userId }, group);
      if (epoch.current !== generation) return;
      const created = interview.operations.createDigitalInterviewDraft.out.parse(await createDigitalInterviewDraft({
        name: (group.name || "原型虚拟用户研究").slice(0, 120), tags: ["AIDT", "模拟"],
        scope: { kind: "project", projectId, researchProjectId: null }, requestId: `aidt-s6-${projectId}-${group.id}`,
      }));
      if (epoch.current !== generation) return;
      change((current, latest) => latest.source ? current : updateAidtTestGroup(current, { ...latest, source: { kind: "interview", id: created.interviewId }, evidenceGap: "仅有虚拟用户模拟反馈，尚未开展真实用户验证。" }));
      let current = await initializeInterviewMarkdown(created.interviewId);
      if (epoch.current !== generation) return;
      const intake = current.documents.find(document => document.step === "intake");
      if (!intake?.markdown.trim()) current = await saveInterviewMarkdown(created.interviewId, "intake", {
        expectedVersion: current.version, expectedDocumentVersion: intake?.version ?? 0,
        markdown: [`# 原型虚拟用户研究（模拟）`, ``, `本研究全部为 AI 模拟，用于发现待验证的可能性，不是真实访谈、问卷答卷或行为证据。`, ``, `## 固定被测原型`, `AIDT 项目：${projectId}`, `第 5 步保存版本：V${group.stage5Revision}`, `原型记录：${group.prototypeEntity || "本轮原型"}`, `Design：${group.designId}`, `原型精确版本：${group.versionId}`, `[查看原型来源](/aidt/${encodeURIComponent(projectId)}?step=6&entity=${encodeURIComponent(group.id)})`, ``, `## 原型已有结构与文字（有限摘录）`, research.text, ``, `## 学生本轮想了解的问题`, group.task, ``, `## 使用情境`, group.situation || "待学生补充", ``, `## 输出要求`, `请先形成可编辑的大纲，由学生确认后再通过原生流程执行模拟。报告分别整理功能反馈和用户需求，每条结论引用已保存模拟对话的具体段落；保留分歧、不确定性与下一步真实验证建议。`].join("\n"),
      });
      if (epoch.current === generation) { setSource(current); refresh(); }
    } catch { if (epoch.current === generation) setError("虚拟研究未能完整准备。若来源已创建，可打开原生研究继续；未创建时可重试，不自动运行模型。"); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  function bind(finding?: AidtVirtualResearchBinding["findings"][number]) {
    if (!source || !currentVerified || readOnly) return;
    const pin = aidtVirtualResearchBinding(source);
    if (!pin || (!finding && !currentVerified.references.length)) return;
    if (finding) pin.findings = [finding];
    if (writeAidtVirtualResearch(draft, group, pin) === draft) { setError("当前小组记录容量不足或来源已改变，未覆盖原引用。请核对后重试。"); return; }
    change((current, latest) => latest.source?.id === pin.interviewId ? writeAidtVirtualResearch(current, latest, pin) : current);
  }
  async function printReport(step: "outline" | "runs" | "report" = "report") {
    if (!sourceId || !binding || !verified || printing) return;
    const expected = readScope, generation = epoch.current;
    const isCurrent = () => currentScope.current === expected && epoch.current === generation;
    setPrinting(true); setError("");
    try {
      const links = await listProjectResources(projectId);
      if (!links.items.some(item => item.kind === "interview" && item.id === sourceId)) throw new Error("SOURCE_UNAVAILABLE");
      const actual = await loadInterviewMarkdown(sourceId);
      if (!await verifyAidtVirtualResearch(actual, binding) || !isCurrent()) throw new Error("VERSION_CHANGED");
      const article = step === "outline" ? outlineRoot.current : step === "runs" ? runsRoot.current : reportRoot.current?.querySelector<HTMLElement>("#itv-source-report-print");
      if (!article) throw new Error("REPORT_UNAVAILABLE");
      const printable = document.createElement("article"), notice = document.createElement("p");
      notice.textContent = `AI 模拟研究，不是真实用户陈述或行为。被测原型 ${group.designId} / ${group.versionId}；第5步 V${group.stage5Revision}；产物 ${binding[step].documentId} / V${binding[step].version} / SHA256 ${binding[step].contentHash}`;
      printable.append(notice, article.cloneNode(true));
      await previewAidtPdf(printable, `模拟${step === "outline" ? "访谈大纲" : step === "runs" ? "访谈对话" : "用户研究报告"} · V${binding[step].version}`, { defaultPaper: "A4", layout: "flow", isCurrent });
    } catch { if (isCurrent()) setError("无法核对模拟产物的精确版本或访问权限，未打开打印预览。"); }
    finally { setPrinting(false); }
  }
  const hasSavedMatch = Boolean(binding && verified);
  const classification = (anchor: string, category: "function" | "need") => {
    const reference = verified?.references.find(item => item.anchor === anchor);
    if (!binding || !reference) return;
    const proposed = binding.findings.filter(item => !(item.anchor === anchor && item.category === category));
    if (proposed.length === binding.findings.length) proposed.push({ anchor, category, quote: reference.quote.slice(0, 500), start: reference.start, end: reference.start + Math.min(reference.quote.length, 500) });
    if (proposed.length > 24 || JSON.stringify({ ...binding, findings: proposed }).length > 6000) { setError("本测试的引用记录已达到保存容量。现有内容保留，请减少重复引用后重试。"); return; }
    change((current, latest) => {
    const previous = readAidtVirtualResearch(current, latest.id);
    if (!previous || !binding || previous.report.documentId !== binding.report.documentId || previous.report.version !== binding.report.version || previous.report.contentHash !== binding.report.contentHash || !verified?.references.some(reference => reference.anchor === anchor)) return current;
    const findings = previous.findings.filter(item => !(item.anchor === anchor && item.category === category));
    if (findings.length === previous.findings.length) findings.push({ anchor, category, quote: reference.quote.slice(0, 500), start: reference.start, end: reference.start + Math.min(reference.quote.length, 500) });
    return writeAidtVirtualResearch(current, latest, { ...previous, findings });
    });
  };
  return <section className="space-y-3 rounded-container border border-border p-4" aria-label="虚拟用户研究">
    <div><h3 className="font-semibold">虚拟用户研究</h3><p className="mt-1 text-12 text-muted-foreground">模拟反馈 · 仍需真实用户验证</p></div>
    {!sourceId ? <><p className="text-13">将本测试的问题和固定原型版本带入现有用户研究工作台。先编辑并保存需求和大纲，再执行模拟。</p>
      {!readOnly && <Button type="button" disabled={busy || !group.task.trim()} onClick={() => void create()}>{busy ? "准备研究草稿…" : "创建虚拟研究草稿"}</Button>}
      {!group.task.trim() && <p className="text-12 text-muted-foreground">先在本测试对话中明确测试问题。</p>}</> : <>
      <nav className="flex flex-wrap gap-3 text-13" aria-label="原生虚拟研究流程">{(["intake", "outline", "runs", "report"] as const).map((step, index) => <Link key={step} className="text-primary underline" href={aidtVirtualResearchHref(projectId, sourceId, step, binding ?? undefined)} target="_blank" rel="noreferrer">{["编辑需求", "编辑并确认大纲", "查看模拟对话", "查看原生报告"][index]}</Link>)}</nav>
      <Button type="button" size="sm" variant="outline" onClick={refresh}>刷新研究成果</Button>
      {source === null && !error && <p role="status" className="text-12">正在读取原生研究…</p>}
      {source && !verified && !binding && <p className="text-12 text-muted-foreground">在原生工作台确认大纲、完成模拟对话并保存报告后，回来绑定。</p>}
      {verified && !binding && !readOnly && verified.references.length > 0 && <Button type="button" size="sm" onClick={() => bind()}>绑定已保存的研究报告</Button>}
      {binding && !verified && currentVerified && !readOnly && currentVerified.references.length > 0 && <Button type="button" size="sm" onClick={() => bind()}>选择当前报告作为新修订</Button>}
      {currentVerified && (!binding || !verified) && !currentVerified.references.length && <>
        <p role="status" className="text-12">报告已生成。</p>
        {!readOnly && <AidtSelectSimulationEvidence key={currentVerified.runs.contentHash} markdown={currentVerified.runs.markdown} report={currentVerified.report.markdown} onBind={bind} />}
      </>}
      {hasSavedMatch && verified && <>
        <p role="status" className="text-12">已选择大纲 V{binding!.outline.version}、模拟对话 V{binding!.runs.version}、报告 V{binding!.report.version}；小组保存状态以本页回执为准。</p>
        {(["outline", "runs"] as const).map(step => <details className="text-13" key={step}>
          <summary className="cursor-pointer">{step === "outline" ? "查看模拟访谈大纲" : "查看模拟访谈对话"}</summary>
          <Button type="button" size="sm" variant="outline" disabled={printing} onClick={() => void printReport(step)}>{step === "outline" ? "预览与打印模拟大纲" : "预览与打印模拟对话"}</Button>
          <article ref={step === "outline" ? outlineRoot : runsRoot} className="chat-markdown" aria-label={step === "outline" ? "模拟访谈大纲正文" : "模拟访谈对话正文"}>
            <h3>模拟{step === "outline" ? "访谈大纲" : "访谈对话"} · V{binding![step].version}</h3>
            <p>AI 模拟，不是真实用户陈述或行为。来源 {binding![step].documentId} / SHA256 {binding![step].contentHash}</p>
            <MarkdownProse text={verified[step].markdown} />
          </article>
        </details>)}
        <details className="text-13"><summary className="cursor-pointer">查看模拟研究报告</summary><Button type="button" size="sm" variant="outline" disabled={printing} onClick={() => void printReport()}>{printing ? "核对报告版本…" : "预览与打印模拟报告"}</Button><div ref={reportRoot}><InterviewReportStep interviewId={sourceId} revisionId={source?.revisionId} document={verified.report} sourceDocuments={source?.documents ?? []} expertsDocument={source?.documents.find(document => document.step === "experts")} reportStatus={source?.states.find(state => state.documentId === verified.report.documentId)?.status} /></div></details>
        {(["function", "need"] as const).map(category => <section key={category} className="space-y-2" aria-label={category === "function" ? "模拟功能反馈" : "模拟用户需求"}><h4 className="text-13 font-medium">{category === "function" ? "功能反馈" : "用户需求"} · 模拟</h4>
          {binding!.findings.filter(item => item.category === category).map(item => {
            const reference = verified.references.find(reference => reference.anchor === item.anchor);
            return reference ? <article key={item.anchor} className="space-y-1 text-12"><blockquote>{reference.quote}</blockquote><a className="text-primary underline" href={`#aidt-virtual-${group.id}-${item.anchor}`} onClick={() => {
              const target = document.getElementById(`aidt-virtual-${group.id}-${item.anchor}`);
              target?.closest("details")?.setAttribute("open", ""); target?.focus();
            }}>回到模拟对话原段</a></article> : null;
          })}
          {!binding!.findings.some(item => item.category === category) && <p className="text-12 text-muted-foreground">尚未整理，不能据此推断没有问题。</p>}
        </section>)}
        <details className="text-12"><summary className="cursor-pointer">逐条核对并整理模拟段落</summary><div className="mt-3 space-y-4">{verified.references.map(reference => <article id={`aidt-virtual-${group.id}-${reference.anchor}`} key={reference.anchor} tabIndex={-1} className="space-y-2 rounded-control border border-border p-3 focus-visible:ring-2 focus-visible:ring-ring"><p className="text-muted-foreground">{reference.anchor.startsWith("aidt-selected-") ? "小组从模拟对话选取" : "报告引用"} · 模拟对话 V{binding!.runs.version} · 字符 {reference.start}–{reference.end}</p><blockquote className="whitespace-pre-wrap break-words">{reference.quote}</blockquote>{!readOnly && <div className="flex flex-wrap gap-2">{(["function", "need"] as const).map(category => <Button key={category} type="button" size="xs" variant="outline" aria-pressed={binding!.findings.some(item => item.anchor === reference.anchor && item.category === category)} onClick={() => classification(reference.anchor, category)}>{category === "function" ? "功能反馈" : "用户需求"}</Button>)}</div>}</article>)}</div></details>
      </>}
    </>}
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
  </section>;
}

function AidtSelectSimulationEvidence({ markdown, report, onBind }: {
  markdown: string;
  report: string;
  onBind: (finding: AidtVirtualResearchBinding["findings"][number]) => void;
}) {
  const suggested = React.useMemo(() => {
    const sentences = markdown.matchAll(/[^\r\n。！？!?]+[。！？!?]?/gu);
    for (const match of sentences) {
      const quote = match[0].trim();
      if (quote.length < 20 || quote.length > 500 || !report.includes(quote)) continue;
      const start = match.index + match[0].indexOf(quote);
      return { start, end: start + quote.length, quote };
    }
    return null;
  }, [markdown, report]);
  const [range, setRange] = React.useState({ start: 0, end: 0 });
  const [category, setCategory] = React.useState<"function" | "need">("function");
  const quote = markdown.slice(range.start, range.end);
  const canBind = Boolean(quote.trim()) && quote.length <= 500;

  return <>
    {suggested && <div className="space-y-2 text-13">
      <p>已自动匹配报告中的模拟对话原文，请核对后绑定。</p>
      <blockquote className="whitespace-pre-wrap break-words">{suggested.quote}</blockquote>
      <Button type="button" size="sm" onClick={() => onBind({
        ...suggested, category, anchor: `aidt-selected-${suggested.start}-${suggested.end}`,
      })}>绑定报告与匹配依据</Button>
    </div>}
    {!suggested && <p className="text-12">报告没有可直接匹配的模拟对话原文。可手动选取支持本轮发现的依据。</p>}
    <details className="space-y-2 text-13">
    <summary className="cursor-pointer font-medium">从模拟对话选取依据</summary>
    <p>在下方标选一段支持本轮发现的原文，最多 500 字。选段会随 AIDT 测试卡保存。</p>
    <textarea aria-label="已保存的模拟对话原文" readOnly value={markdown} rows={8}
      className="w-full rounded-md border border-border bg-background p-2"
      onSelect={event => setRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} />
    <p role="status">{canBind ? `已选 ${quote.length} 字` : "请选择 1 至 500 字的非空原文。"}</p>
    <label>依据分类 <select value={category} onChange={event => setCategory(event.target.value === "need" ? "need" : "function")}>
      <option value="function">功能反馈</option><option value="need">用户需求</option>
    </select></label>
    <Button type="button" size="sm" disabled={!canBind}
      onClick={() => onBind({ ...range, quote, category, anchor: `aidt-selected-${range.start}-${range.end}` })}>保存依据并绑定报告</Button>
  </details></>;
}
