"use client";
import * as React from "react";
import { PlatformModelTestRequest, operations as ModelTestContract, type PlatformModelTestCapability } from "@repo/contracts/platform-model-test";
import { AdminScreen } from "./admin-screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { modelTestAmountToMicros, modelTestMicrosToAmount } from "@/lib/model-test-money";
import { ApiError } from "@/lib/api-client";
import { listPlatformOrganizations, type OrganizationList } from "@/lib/live-platform-organizations";
import { getModelTestCandidates, startModelTest, getModelTest, cancelModelTest, type ModelTestCandidate, type PlatformModelTestRecord } from "@/lib/live-platform-model-test";
const capabilityLabels: Record<PlatformModelTestCapability, string> = { text: "文字对话", "image-generation": "图片生成", "text-to-speech": "语音合成", "speech-to-text": "语音识别", embedding: "文本向量", rerank: "文本重排" };
const states: Record<PlatformModelTestRecord["state"], string> = { queued: "等待执行", dispatching: "正在执行", succeeded: "执行成功", failed: "执行失败", cancelled: "已取消", unknown: "供应商结果未确认" };
const reasonLabels: Record<string, string> = { "native-asr-token-bound-unverified": "普通组织的语音识别 Token 上界尚未验证", "adapter-unavailable": "此能力尚未适配", "admission-refused": "成员身份、模型准入或预算检查未通过", "dispatch-cancelled": "执行已取消", "provider-unconfirmed": "供应商结果尚未确认", "dispatch-in-progress": "供应商调用仍在执行", "accounting-unavailable": "用量结算暂不可用" };
const reasonLabel = (reason: string) => reasonLabels[reason] ?? reason;
function explain(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return "需要平台运营权限及所选组织的真实成员身份，平台权限不会免除组织预算。";
  if (error instanceof ApiError && error.status === 404) return "测试记录或测试服务不可用，请核对环境。";
  return "服务暂不可用或响应不符合契约，请查询原测试状态，不要重复发起。";
}
function unavailableReason(candidate: ModelTestCandidate): string | null {
  if (!candidate.available) return candidate.reason ? reasonLabel(candidate.reason) : "配置或适配尚未确认";
  if (!candidate.modelProvider || !candidate.runtimeModelId) return "供应商路由尚未确认";
  if (!candidate.currency) return "费用币种尚未确认";
  if (candidate.capability === "text" && candidate.maximumOutputTokens === null) return "输出安全上限尚未确认";
  if (["image-generation", "text-to-speech", "speech-to-text"].includes(candidate.capability) && (!candidate.nativeUnit || candidate.maximumQuantity === null)) return "原生计费单位或安全上限尚未确认";
  return null;
}
const unsettled = (record: PlatformModelTestRecord | null) => !record || record.state === "queued" || record.state === "dispatching" || record.state === "unknown" || record.settlementState !== "settled";
/** lint-no-backend-badge:backed-by-children — candidates/start/get/cancel use validated live API responses. */
export function PlatformModelTestbench() {
  const [orgs, setOrgs] = React.useState<OrganizationList | null>(null), [search, setSearch] = React.useState("");
  const [orgId, setOrgId] = React.useState(""), [candidates, setCandidates] = React.useState<ModelTestCandidate[] | null>(null), [selected, setSelected] = React.useState("");
  const [prompt, setPrompt] = React.useState(""), [voice, setVoice] = React.useState(""), [language, setLanguage] = React.useState(""), [documents, setDocuments] = React.useState("");
  const [audio, setAudio] = React.useState(""), [sampleRate, setSampleRate] = React.useState("16000");
  const [cost, setCost] = React.useState(""), [timeout, setTimeoutValue] = React.useState(""), [output, setOutput] = React.useState(""), [quantity, setQuantity] = React.useState(""), [confirmed, setConfirmed] = React.useState(false);
  const [record, setRecord] = React.useState<PlatformModelTestRecord | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState<string | null>(null), [loadingOrgs, setLoadingOrgs] = React.useState(false);
  const [recoveryId, setRecoveryId] = React.useState("");
  const [acknowledgeHold, setAcknowledgeHold] = React.useState(false), [previous, setPrevious] = React.useState<{testId:string;orgId:string;record:PlatformModelTestRecord|null}[]>([]);
  const attempt = React.useRef<{ testId: string; orgId: string; modelId?: string; capability?: PlatformModelTestCapability } | null>(null), mounted = React.useRef(true), generation = React.useRef(0), orgGeneration = React.useRef(0);
  const operationBusy = React.useRef(false);
  const active = React.useRef<AbortController | null>(null), candidateAbort = React.useRef<AbortController | null>(null);
  const candidate = candidates?.find((row, index) => String(index) === selected);
  const locked = busy || (attempt.current !== null && unsettled(record));
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); candidateAbort.current?.abort(); }; }, []);
  async function loadOrganizations(cursor?: string) {
    const version = ++orgGeneration.current; setLoadingOrgs(true); setError(null);
    try { const value = await listPlatformOrganizations(search, cursor); if (mounted.current && version === orgGeneration.current) setOrgs(value); }
    catch (cause) { if (mounted.current && version === orgGeneration.current) setError(explain(cause)); }
    finally { if (mounted.current && version === orgGeneration.current) setLoadingOrgs(false); }
  }
  React.useEffect(() => { void loadOrganizations(); /* initial empty search only */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    candidateAbort.current?.abort(); const abort = new AbortController(); candidateAbort.current = abort;
    const version = ++generation.current; setCandidates(null); setSelected(""); setConfirmed(false); setError(null);
    if (!orgId) return () => abort.abort();
    void getModelTestCandidates(orgId, abort.signal).then(value => { if (!abort.signal.aborted && mounted.current && version === generation.current) setCandidates(value); })
      .catch(cause => { if (!abort.signal.aborted && mounted.current && version === generation.current) setError(explain(cause)); });
    return () => abort.abort();
  }, [orgId]);
  const resetConfirmation = () => setConfirmed(false);
  const input = !candidate ? null : candidate.capability === "text" || candidate.capability === "image-generation" ? { prompt }
    : candidate.capability === "text-to-speech" ? { text: prompt, voice, ...(language ? { language } : {}) }
    : candidate.capability === "speech-to-text" ? { audioBase64: audio, sampleRateHz: Number(sampleRate), channels: 1, format: "pcm16" }
    : candidate.capability === "embedding" ? { texts: prompt.split("\n") } : { query: prompt, documents: documents.split("\n") };
  const parsed = PlatformModelTestRequest.safeParse({ testId: "00000000-0000-4000-8000-000000000000", orgId, modelId: candidate?.modelId, capability: candidate?.capability, declaredNonConfidential: confirmed, input,
    bounds: { maximumCostMicros: modelTestAmountToMicros(cost) ?? "", timeoutMs: Number(timeout), ...(candidate?.capability === "text" ? { maxOutputTokens: Number(output) } : {}), ...(["image-generation", "text-to-speech", "speech-to-text"].includes(candidate?.capability ?? "") ? { maximumQuantity: quantity } : {}) } });
  const overBounds = !!candidate && ((candidate.maximumOutputTokens !== null && candidate.capability === "text" && Number(output) > candidate.maximumOutputTokens)
    || (candidate.maximumQuantity !== null && /^(0|[1-9]\d*)$/.test(quantity) && BigInt(quantity) > BigInt(candidate.maximumQuantity)));
  const canStart = !!candidate && unavailableReason(candidate) === null && parsed.success && !overBounds && !locked;
  function accept(value: PlatformModelTestRecord, current: { testId: string; orgId: string; modelId?: string; capability?: PlatformModelTestCapability }) {
    if (value.testId !== current.testId || value.orgId !== current.orgId || (current.modelId !== undefined && value.modelId !== current.modelId) || (current.capability !== undefined && value.capability !== current.capability)) throw new Error("response_identity_mismatch");
    if (mounted.current && attempt.current === current) setRecord(value);
  }
  async function update(cancel = false) {
    const current = attempt.current; if (!current || operationBusy.current) return;
    operationBusy.current = true;
    active.current?.abort(); const abort = new AbortController(); active.current = abort; setBusy(true); setError(null);
    try { accept(await (cancel ? cancelModelTest : getModelTest)(current.testId, current.orgId, abort.signal), current); }
    catch (cause) { if (!abort.signal.aborted && mounted.current) setError(explain(cause)); }
    finally { operationBusy.current = false; if (mounted.current && attempt.current === current) setBusy(false); }
  }
  React.useEffect(() => {
    if (!record || busy || error || !["queued", "dispatching"].includes(record.state)) return;
    const timer = window.setTimeout(() => { void update(); }, 2000); return () => window.clearTimeout(timer);
  }, [record, busy, error]); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    if (!canStart || !parsed.success || attempt.current) return;
    const current = { testId: crypto.randomUUID(), orgId, modelId: parsed.data.modelId, capability: parsed.data.capability }; attempt.current = current; operationBusy.current = true;
    const abort = new AbortController(); active.current = abort; setBusy(true); setRecord(null); setError(null);
    try { accept(await startModelTest({ ...parsed.data, testId: current.testId }, abort.signal), current); }
    catch (cause) { if (!abort.signal.aborted && mounted.current) setError(explain(cause)); }
    finally { operationBusy.current = false; if (mounted.current && attempt.current === current) setBusy(false); }
  }
  async function recover() {
    if (operationBusy.current || attempt.current) return;
    const identity = ModelTestContract.get.in.safeParse({ testId: recoveryId.trim(), orgId });
    if (!identity.success) { setError("请选择原组织并填写有效的测试 UUID。"); return; }
    const current = identity.data; attempt.current = current; operationBusy.current = true;
    active.current?.abort(); const abort = new AbortController(); active.current = abort;
    setBusy(true); setError(null); setRecord(null); setSelected(""); setRecoveryId(current.testId);
    try { accept(await getModelTest(current.testId, current.orgId, abort.signal), current); }
    catch (cause) { if (!abort.signal.aborted && mounted.current) setError(explain(cause)); }
    finally { operationBusy.current = false; if (mounted.current && attempt.current === current) setBusy(false); }
  }
  function prepareAnother() {
    if (busy || (record && ["queued", "dispatching"].includes(record.state)) || (unsettled(record) && !acknowledgeHold)) return;
    const previousAttempt = attempt.current;
    if (previousAttempt) setPrevious(rows => [...rows, { ...previousAttempt, record }]);
    active.current?.abort(); attempt.current = null; setRecord(null); setConfirmed(false); setAcknowledgeHold(false); setError(null);
    setRecoveryId(""); setCost(""); setTimeoutValue(""); setQuantity(""); setOutput(""); setPrompt(""); setAudio(""); setVoice(""); setLanguage(""); setDocuments("");
  }
  async function refreshPrevious(testId:string, previousOrgId:string) {
    if(operationBusy.current)return; operationBusy.current=true;setBusy(true);
    const abort=new AbortController();active.current=abort;
    try {const value=await getModelTest(testId,previousOrgId,abort.signal);if(value.testId!==testId||value.orgId!==previousOrgId)throw new Error("response_identity_mismatch");if(mounted.current)setPrevious(rows=>rows.map(row=>row.testId===testId?{...row,record:value}:row));}
    catch(cause){if(!abort.signal.aborted&&mounted.current)setError(explain(cause));}
    finally{operationBusy.current=false;if(mounted.current)setBusy(false);}
  }
  function field(id: string, label: string, value: string, change: (value: string) => void, hint?: string) {
    return <div className="space-y-1"><label htmlFor={id} className="text-14 font-medium">{label}</label><Input id={id} value={value} inputMode={id === "test-cost" ? "decimal" : undefined} maxLength={id === "test-cost" ? 20 : undefined} disabled={locked || attempt.current !== null} onChange={event => { change(event.target.value); resetConfirmation(); }} />{hint && <p className="text-12 text-muted-foreground">{hint}</p>}</div>;
  }
  return <AdminScreen state="default" moduleLabel="模型测试" title="平台模型测试台" hideOrgIdentity liveBacked intro="验证组织已配置模型的真实调用。公共目录不代表账号可用；每次测试都会经过成员身份、模型准入与预算检查。" emptyHint="先选择组织" denialReason="仅平台运营可见" successMessage="测试状态已更新">
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section aria-label="准备测试" className="min-w-0 space-y-4 rounded-lg border p-4">
        <h2 className="text-16 font-semibold">1. 选择组织与可调用模型</h2>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (!locked) void loadOrganizations(); }}><Input aria-label="搜索测试组织" value={search} placeholder="搜索组织名称" disabled={locked} onChange={event => setSearch(event.target.value)} /><Button type="submit" variant="outline" disabled={locked || loadingOrgs}>搜索</Button></form>
        {loadingOrgs && <p data-testid="loading" role="status">正在加载组织…</p>}
        {orgs && <><Select aria-label="测试所属组织" placeholder="选择真实成员所属组织" value={orgId} disabled={locked || attempt.current !== null} onValueChange={setOrgId} options={orgs.organizations.map(org => ({ value: org.orgId, label: org.name }))} className="max-w-full" />
          {orgs.organizations.length === 0 && <p data-testid="empty">没有匹配组织，请调整搜索。</p>}<Button variant="outline" disabled={locked || !orgs.nextCursor} onClick={() => void loadOrganizations(orgs.nextCursor ?? undefined)}>下一页组织</Button></>}
        <form aria-label="恢复已有测试" className="space-y-2 rounded border p-3" onSubmit={event => { event.preventDefault(); void recover(); }}>
          <label htmlFor="test-recovery-id" className="text-14 font-medium">已有测试 UUID</label>
          <Input id="test-recovery-id" value={recoveryId} disabled={busy || attempt.current !== null} onChange={event => setRecoveryId(event.target.value)} placeholder="粘贴原测试 UUID" />
          <p className="text-12 text-muted-foreground">选择原组织并填写已保存的 UUID，只查询原记录。查询失败保留 UUID，不创建新测试。</p>
          <Button type="submit" variant="outline" disabled={!orgId || !recoveryId.trim() || busy || attempt.current !== null}>恢复原测试（仅查询）</Button>
        </form>
        <p className="text-12 text-muted-foreground">费用与用量归属于登录操作人及所选组织；企业套餐仍受费用与安全上限约束。</p>
        {orgId && candidates === null && !error && <p data-testid="loading" role="status">正在核验模型候选…</p>}
        {candidates && candidates.length === 0 && <p data-testid="empty">没有可测试模型，请先配置组织模型与预算。</p>}
        {candidates && <div className="space-y-2">{candidates.map((row, index) => <div key={`${row.modelId}:${row.capability}`} className="min-w-0 rounded border p-3"><Button variant={selected === String(index) ? "secondary" : "outline"} className="h-auto max-w-full whitespace-normal text-left" aria-pressed={selected === String(index)} disabled={unavailableReason(row) !== null || locked || attempt.current !== null} onClick={() => { setSelected(String(index)); setPrompt(""); setVoice(""); setDocuments(""); setAudio(""); resetConfirmation(); }}>{row.displayName} · {capabilityLabels[row.capability]}</Button><p className="break-all text-12 text-muted-foreground">{row.modelId}</p>{unavailableReason(row) && <p className="text-12">不可测试：{unavailableReason(row)}</p>}</div>)}</div>}
        {candidate && <><h2 className="text-16 font-semibold">2. 输入与费用边界</h2>
          {candidate.capability !== "speech-to-text" && <div className="space-y-1"><label htmlFor="test-prompt">{candidate.capability === "embedding" ? "向量文本（每行一条，最多 8 条）" : candidate.capability === "rerank" ? "重排查询" : candidate.capability === "text-to-speech" ? "合成文本" : "测试提示词"}</label><Textarea id="test-prompt" value={prompt} disabled={locked || attempt.current !== null} onChange={event => { setPrompt(event.target.value); resetConfirmation(); }} /></div>}
          {candidate.capability === "text-to-speech" && <>{field("test-voice", "音色 ID", voice, setVoice)}{field("test-language", "语言（可选）", language, setLanguage)}</>}
          {candidate.capability === "rerank" && <div><label htmlFor="test-documents">候选文档（每行一条，最多 20 条）</label><Textarea id="test-documents" value={documents} disabled={locked || attempt.current !== null} onChange={event => { setDocuments(event.target.value); resetConfirmation(); }} /></div>}
          {candidate.capability === "speech-to-text" && <><div><label htmlFor="test-audio">PCM16 单声道音频（Base64）</label><Textarea id="test-audio" value={audio} disabled={locked || attempt.current !== null} onChange={event => { setAudio(event.target.value); resetConfirmation(); }} /><p className="text-12 text-muted-foreground">仅接受原始 PCM16，不能直接粘贴 MP3/WAV 或外部 URL。</p></div><Select aria-label="采样率" value={sampleRate} disabled={locked || attempt.current !== null} onValueChange={value => { setSampleRate(value); resetConfirmation(); }} options={[{value:"16000",label:"16000 Hz"},{value:"24000",label:"24000 Hz"}]} /></>}
          {field("test-cost", `最大费用（${candidate.currency ?? "币种未确认"}）`, cost, setCost, "填写币种金额，最多 6 位小数，例如 0.10。不会自动填写价格或额度。")}
          {field("test-timeout", "超时上限（毫秒，1–60000）", timeout, setTimeoutValue)}
          {candidate.capability === "text" && field("test-output", "最大输出 Token", output, setOutput, candidate.maximumOutputTokens === null ? "模型输出上限尚未提供。" : `服务端候选上限：${candidate.maximumOutputTokens}`)}
          {["image-generation", "text-to-speech", "speech-to-text"].includes(candidate.capability) && field("test-quantity", `最大计费数量（${candidate.nativeUnit ?? "计费单位未确认"}）`, quantity, setQuantity, candidate.maximumQuantity === null ? "模型数量上限尚未提供。" : `服务端候选上限：${candidate.maximumQuantity}`)}
          {overBounds && <p role="alert">输入上限超出候选模型的已配置安全边界。</p>}
          <label className="flex items-start gap-2 text-14"><Checkbox aria-label="确认非机密输入与费用上限" checked={confirmed} disabled={locked || attempt.current !== null} onChange={event => setConfirmed(event.target.checked)} />确认输入不含机密内容，并授权本次测试在以上费用上限内执行。</label>
          <Button disabled={!canStart || attempt.current !== null} onClick={() => void start()}>发起一次真实测试</Button></>}
      </section>
      <section aria-label="执行与结算结果" className="min-w-0 space-y-4 rounded-lg border p-4" aria-live="polite">
        <h2 className="text-16 font-semibold">3. 执行与结算结果</h2>
        {error && <p role="alert" data-testid="err-test" className="text-destructive">{error}</p>}
        {!attempt.current && <p data-testid="empty" className="text-muted-foreground">完成左侧输入并确认费用后，结果将在这里显示。</p>}
        {attempt.current && <><p className="break-all text-12 text-muted-foreground">测试 ID：{attempt.current.testId}</p><p role="status">{busy ? "正在请求服务端状态…" : record ? states[record.state] : "启动结果未确认，请查询此测试 ID。"}</p>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void update()}>查询原测试状态</Button><Button variant="outline" disabled={busy || (!!record && ["succeeded", "failed", "cancelled"].includes(record.state))} onClick={() => void update(true)}>取消本次测试</Button></div>
          <p className="text-12 text-muted-foreground">取消请求不代表供应商未执行或未计费；离开页面只停止浏览器查询，不会自动撤回供应商调用。</p></>}
        {record && <><p>结算：{record.settlementState === "settled" ? "已结算" : record.settlementState === "held" ? "费用保留，等待核对" : "待结算"}</p>
          {unsettled(record) && <p className="rounded border bg-muted p-3">费用或结果尚未确认，预算预留继续保留。查询原记录不会产生新的模型调用；新测试仍需重新确认费用，且不会释放此预留。</p>}
          {record.failureReason && <p>状态原因：{reasonLabel(record.failureReason)}</p>}
          <p>费用：{record.usage?.costMicros == null || !record.usage.currency ? "未知" : `${modelTestMicrosToAmount(record.usage.costMicros) ?? "未知"} ${record.usage.currency}`} · 币种：{record.usage?.currency ?? "未知"}</p><p>总 Token：{record.usage?.tokens ?? "未知"}</p><p>输入 Token：{record.usage?.inputTokens ?? "未知"} · 输出 Token：{record.usage?.outputTokens ?? "未知"}</p><p>原生数量：{record.usage?.nativeQuantity ?? "未知"} {record.usage?.nativeUnit ?? ""}</p>
          {record.result && <TestResult result={record.result} />}
          </>}
        {attempt.current && <>
          {unsettled(record) && <label className="flex items-start gap-2 text-14"><Checkbox aria-label="确认旧测试预留仍保留" checked={acknowledgeHold} disabled={busy} onChange={event=>setAcknowledgeHold(event.target.checked)} />我确认旧测试预算预留仍保留；新测试会额外占用预算，且必须重新填写并确认费用上限。</label>}
          <Button variant="outline" disabled={busy || (!!record && ["queued","dispatching"].includes(record.state)) || (unsettled(record) && !acknowledgeHold)} onClick={prepareAnother}>准备新测试</Button>
        </>}
        {previous.length > 0 && <section aria-label="之前测试" className="space-y-2"><h3 className="text-14 font-semibold">之前测试</h3>{previous.map(row=><div key={row.testId} className="rounded border p-3 text-12"><p className="break-all">{row.testId}</p><p>{row.record ? states[row.record.state] : "结果未确认"} · {row.record?.settlementState === "settled" ? "已结算" : "预留未确认释放"}</p><Button variant="outline" disabled={busy} onClick={()=>void refreshPrevious(row.testId,row.orgId)}>查询旧测试 {row.testId.slice(0,8)}</Button></div>)}</section>}
      </section>
    </div>
  </AdminScreen>;
}
function TestResult({ result }: { result: NonNullable<PlatformModelTestRecord["result"]> }) {
  if (result.kind === "text") return <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-14">{result.text}</pre>;
  if (result.kind === "image") return <div className="grid gap-2">{result.assets.map((asset, index) => <a key={index} href={asset.url} target="_blank" rel="noopener noreferrer" className="break-all text-14 underline hover:text-primary transition-colors">查看生成图片 {index + 1}（{asset.mimeType}）</a>)}</div>;
  if (result.kind === "audio") return <div className="space-y-2"><audio controls preload="none" src={result.asset.url} className="w-full" aria-label="测试生成语音" /><p>时长：{result.durationMs === null ? "未知" : `${result.durationMs} 毫秒`}</p></div>;
  if (result.kind === "embedding") return <div><p>{result.vectorCount} 个向量 · {result.dimensions} 维</p><pre className="whitespace-pre-wrap break-all text-12">{JSON.stringify(result.preview)}</pre></div>;
  return <ol className="space-y-1">{result.results.map(row => <li key={row.index}>文档 {row.index + 1} · 得分 {row.score}</li>)}</ol>;
}
