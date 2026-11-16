"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";
import { aidtResearchMaterialLabel, isAidtResearchImage, listAidtResearchMaterials, readAidtResearchMaterial, uploadAidtResearchMaterial, type AidtMaterialContext, type AidtMaterialReceipt, type AidtResearchMaterialReference } from "../lib/aidt-research-materials";
import type { AidtImageAttachmentState } from "./aidt-image-attachment-picker";

type SessionContext = Omit<AidtMaterialContext, "signal">;
type MaterialWorkContext = AidtMaterialContext & { isCurrent: () => boolean };
const materialIdentity = (value?: AidtResearchMaterialReference | null) => JSON.stringify(value ? [value.projectId, value.artifactId, value.versionId, value.runId] : null);
type MaterialProps = { projectId: string; value?: AidtResearchMaterialReference | null; label: string; readOnly?: boolean; imagesOnly?: boolean; selectionScope?: string; localMaterials?: readonly AidtResearchMaterialReference[]; onChange: (reference: AidtResearchMaterialReference | null) => void };

export function AidtResearchMaterialControl(props: MaterialProps) {
  const session = useOptionalSession()?.session;
  if (!isAidtModuleEnabled()) return null;
  if (!session?.currentOrgId || !session.userId || !session.sessionToken) return <p role="status">登录后可保存原始材料。</p>;
  const scope = JSON.stringify([session.currentOrgId, session.userId, session.sessionToken, props.projectId, !!props.readOnly]);
  return <MaterialControl key={scope} {...props} context={{ projectId: props.projectId, sessionToken: session.sessionToken }} />;
}
function MaterialControl({ context, value, label, onChange, readOnly = false, imagesOnly = false, selectionScope, localMaterials = [] }: MaterialProps & { context: SessionContext }) {
  const [file, setFile] = React.useState<File | null>(null), [strategy, setStrategy] = React.useState<"use-existing" | "as-new-version">("use-existing");
  const valueIdentity = materialIdentity(value), intentIdentity = JSON.stringify([valueIdentity, selectionScope ?? ""]);
  const intent = React.useRef({ identity: intentIdentity, generation: 0 });
  if (intent.current.identity !== intentIdentity) intent.current = { identity: intentIdentity, generation: intent.current.generation + 1 };
  const [receiptState, setReceipt] = React.useState<{ intent: string; receipt: AidtMaterialReceipt } | null>(null);
  const receipt = receiptState?.intent === intentIdentity ? receiptState.receipt : null;
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; intent?: string; selected?: string } | null>(null);
  const status = feedback && (feedback.selected ? value === undefined || valueIdentity === feedback.selected : feedback.intent === intentIdentity) ? feedback.text : "";
  const [choices, setChoices] = React.useState<AidtResearchMaterialReference[] | null>(null), [listError, setListError] = React.useState(false);
  const request = React.useRef<{ controller: AbortController; generation: number } | null>(null), active = React.useRef(true), locked = React.useRef(false);
  const notify = React.useRef(onChange); notify.current = onChange;
  React.useEffect(() => { active.current = true; return () => { active.current = false; request.current?.controller.abort(); }; }, []);
  React.useEffect(() => {
    if (request.current && request.current.generation !== intent.current.generation) { request.current.controller.abort(); request.current = null; locked.current = false; setPending(false); }
  }, [intentIdentity]);
  async function execute(work: (context: MaterialWorkContext) => Promise<void>) {
    if (readOnly || locked.current) return;
    locked.current = true; setPending(true); setFeedback(null);
    const operation = { controller: new AbortController(), generation: intent.current.generation }; request.current = operation;
    const isCurrent = () => active.current && !operation.controller.signal.aborted && request.current === operation && intent.current.generation === operation.generation;
    try { await work({ ...context, signal: operation.controller.signal, isCurrent }); }
    catch { if (isCurrent()) setFeedback({ intent: intentIdentity, text: "材料保存或回读未通过，尚未关联本次文件。原有文字与选择仍保留；若已取得上传回执，可只重试回读。" }); }
    finally { if (active.current && request.current === operation) { request.current = null; setPending(false); locked.current = false; } }
  }
  async function accept(context: MaterialWorkContext, received: AidtMaterialReceipt | AidtResearchMaterialReference) {
    const result = await readAidtResearchMaterial(context, received);
    if (!context.isCurrent()) return;
    if (imagesOnly && !isAidtResearchImage(result.reference)) throw new Error("AIDT_MATERIAL_IMAGE_REQUIRED");
    notify.current(result.reference); setFile(null); setReceipt(null); setChoices(null);
    setFeedback({ selected: materialIdentity(result.reference), text: `${"duplicateAction" in received && received.duplicateAction === "use-existing" ? "重复文件已复用原版本。" : "duplicateAction" in received && received.duplicateAction === "as-new-version" ? "重复文件已另存新版本。" : ""}${result.processingFailed ? "后续材料处理失败；原件可读，检索和转写状态未确认。" : ""}原件已保存并回读，已加入草稿；请保存到小组。` });
  }
  return <div className="space-y-2 rounded-lg border border-border p-3" aria-label={label} data-testid="aidt-research-material-control">
    <p className="text-12 font-medium">{label}</p>
    <label className="block text-12">选择原始文件<input aria-label={`${label}选择文件`} type="file" accept={imagesOnly ? "image/png,image/jpeg,image/webp,image/gif" : ".txt,.md,.csv,.pdf,.docx,image/png,image/jpeg,image/webp,image/gif"} disabled={readOnly || pending} className="mt-1 block w-full text-12" onChange={event => { if (!readOnly && !locked.current) { setFile(event.currentTarget.files?.[0] ?? null); setReceipt(null); setFeedback(null); } }} /></label>
    <details className="text-12"><summary className="cursor-pointer text-muted-foreground">重复文件设置</summary><label className="mt-2 block">内容重复时<select aria-label={`${label}重复处理`} disabled={readOnly || pending} value={strategy} className="ml-2 rounded-md border border-border bg-background p-1" onChange={event => { if (!readOnly) setStrategy(event.currentTarget.value === "as-new-version" ? "as-new-version" : "use-existing"); }}><option value="use-existing">使用已有原件版本</option><option value="as-new-version">明确另存为新版本</option></select></label></details>
    <p className="text-11 text-muted-foreground">仅存原件；AI建议需另行请求。录音与转写暂后置。</p>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={readOnly || pending || !file || !!receipt} onClick={() => void execute(async current => { if (!file) return; const received = await uploadAidtResearchMaterial(current, file, strategy); if (!current.isCurrent()) return; setReceipt({ intent: intentIdentity, receipt: received }); await accept(current, received); })}>保存原始材料</Button>
      {receipt && <Button type="button" size="sm" variant="outline" disabled={readOnly || pending} onClick={() => void execute(current => accept(current, receipt))}>重试读取上传回执</Button>}
      <Button type="button" size="sm" variant="ghost" disabled={readOnly || pending} onClick={() => void execute(async current => {
        setListError(false); try { const received = await listAidtResearchMaterials(current); if (current.isCurrent()) { const unique = new Map([...received, ...localMaterials.filter(reference => reference.projectId === context.projectId)].map(reference => [`${reference.artifactId}:${reference.versionId}`, reference])); setChoices([...unique.values()].filter(reference => !imagesOnly || isAidtResearchImage(reference))); } } catch (error) { if (current.isCurrent()) setListError(true); throw error; }
      })}>选择本组已保存原始材料</Button>
      {value && <Button type="button" size="xs" variant="ghost" disabled={readOnly || pending} onClick={() => { if (!readOnly) notify.current(null); }}>移除原始材料引用</Button>}
    </div>
    {pending && <p role="status" className="text-12">正在上传或核对原件回执…</p>}
    {receipt && <details className="text-11"><summary className="cursor-pointer text-muted-foreground">来源与版本</summary><p className="mt-1 break-all">上传受理回执：{receipt.runId}；{receipt.duplicateAction === "use-existing" ? "重复内容选择复用原件；" : receipt.duplicateAction === "as-new-version" ? "重复内容选择新版本；" : ""}实际回读通过前不关联。</p></details>}
    {listError && <p role="alert" className="text-12">已有材料读取失败，未判定为无材料。</p>}
    {choices && <div className="space-y-2">{!choices.length && <p className="text-12">尚无已保存的阶段原始材料引用。新上传先关联草稿，再保存本步成果。</p>}{choices.map(reference => <Button type="button" key={`${reference.artifactId}:${reference.versionId}`} size="sm" variant="outline" className="h-auto whitespace-normal text-left" disabled={readOnly || pending} onClick={() => void execute(current => accept(current, reference))}>关联原始材料：{reference.name}</Button>)}</div>}
    {status && <p role="status" className="text-12">{status}</p>}
  </div>;
}

export function AidtResearchMaterialPreview({ projectId, reference, alt, onImageState }: { projectId: string; reference: AidtResearchMaterialReference; alt?: string; onImageState?: (state: AidtImageAttachmentState) => void }) {
  const session = useOptionalSession()?.session;
  if (!isAidtModuleEnabled()) return null;
  if (!session?.currentOrgId || !session.userId || !session.sessionToken) return <p>登录后核对材料来源。</p>;
  const scope = JSON.stringify([session.currentOrgId, session.userId, session.sessionToken, projectId, reference]);
  return <MaterialPreview key={scope} context={{ projectId, sessionToken: session.sessionToken }} reference={reference} alt={alt ?? reference.name} onImageState={onImageState} />;
}
function MaterialPreview({ context, reference, alt, onImageState }: { context: SessionContext; reference: AidtResearchMaterialReference; alt: string; onImageState?: (state: AidtImageAttachmentState) => void }) {
  const { projectId, sessionToken } = context;
  const [retry, refresh] = React.useReducer((value: number) => value + 1, 0), [decoded, setDecoded] = React.useState(false);
  const [state, setState] = React.useState<{ url?: string; text?: string; failed?: boolean; processingFailed?: boolean; resolved?: AidtResearchMaterialReference } | null>(null);
  const notify = React.useRef(onImageState); notify.current = onImageState;
  const serialized = JSON.stringify(reference);
  const stableReference = React.useMemo(() => JSON.parse(serialized) as AidtResearchMaterialReference, [serialized]);
  const activeImage = React.useRef<string | undefined>(undefined); activeImage.current = state?.url;
  React.useEffect(() => {
    const cancellation = new AbortController(); let url: string | undefined;
    setState(null); setDecoded(false); notify.current?.({ src: null, failed: false });
    void readAidtResearchMaterial({ projectId, sessionToken, signal: cancellation.signal }, stableReference).then(async result => {
      const text = result.reference.mime === "text/plain" ? (await result.blob.text()).slice(0, 10000) : undefined;
      if (cancellation.signal.aborted) return;
      url = URL.createObjectURL(result.blob); setState({ url, text, processingFailed: result.processingFailed, resolved: result.reference });
    }).catch(() => { if (!cancellation.signal.aborted) { setState({ failed: true }); notify.current?.({ src: null, failed: true }); } });
    return () => { cancellation.abort(); if (url) URL.revokeObjectURL(url); notify.current?.({ src: null, failed: false }); };
  }, [projectId, sessionToken, stableReference, retry]);
  React.useEffect(() => { if (decoded && state?.url) notify.current?.({ src: state.url, failed: false }); }, [decoded, state?.url]);
  const shown = state?.resolved ?? reference;
  return <div className="space-y-2" data-testid="aidt-research-material-preview"><p className="text-12 font-medium">{shown.name}</p><details className="text-11"><summary className="cursor-pointer text-muted-foreground">来源与版本</summary><p className="mt-1 break-all">原件定位（待学生核实）：{aidtResearchMaterialLabel(shown)}</p><p className="mt-1 break-all">内容SHA-256：{shown.sha256}</p><p className="mt-1">本次上传提交者：{state?.resolved ? state.resolved.submittedBy ?? "未提供" : state?.failed ? "无法核对" : "正在核对"}；提交时间：{state?.resolved ? state.resolved.submittedAt ?? "未提供" : state?.failed ? "无法核对" : "正在核对"}。这不是阶段关联保存者或文件原作者。</p></details>
    {!state ? <p role="status">正在核对原件与完整性…</p> : state.failed ? <div role="alert"><p>原件不可访问、损坏或读取失败，未用其他材料替代。</p><Button type="button" size="xs" variant="outline" onClick={refresh}>重试读取原件</Button></div> : <>
      {state.processingFailed && <p role="alert" className="text-12">后续材料处理失败；原件仍可下载，检索和转写状态未确认。</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated original bytes, verified hash and revocable local blob URL */}
      {state.url && isAidtResearchImage(reference) && <img src={state.url} alt={alt} className="max-h-60 w-full rounded-md object-contain" onLoad={event => { if (activeImage.current !== event.currentTarget.src) return; if (event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalHeight > 0) setDecoded(true); else { setState({ failed: true }); notify.current?.({ src: null, failed: true }); } }} onError={event => { if (activeImage.current !== event.currentTarget.src) return; setState({ failed: true }); notify.current?.({ src: null, failed: true }); }} />}
      {state.text !== undefined && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-12" data-testid="aidt-research-original-text">{state.text}</pre>}
      {state.text !== undefined && <p className="text-11 text-muted-foreground">原文预览最多前10000字；完整原件请下载。这里不会转写或改写内容。</p>}
      {state.url && <a className="text-12 underline" href={state.url} download={reference.name}>下载真实原件</a>}
    </>}
  </div>;
}
