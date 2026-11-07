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
import { useI18n } from "@/lib/i18n/provider";
import type { ModelTestbenchKey } from "@/lib/i18n/namespaces/model-testbench";
import { ApiError } from "@/lib/api-client";
import { listPlatformOrganizations, type OrganizationList } from "@/lib/live-platform-organizations";
import { getModelTestCandidates, startModelTest, getModelTest, cancelModelTest, type ModelTestCandidate, type PlatformModelTestRecord } from "@/lib/live-platform-model-test";
const capabilityLabels: Record<PlatformModelTestCapability, ModelTestbenchKey> = { text: "modelTestbench.capability.text", "image-generation": "modelTestbench.capability.image-generation", "text-to-speech": "modelTestbench.capability.text-to-speech", "speech-to-text": "modelTestbench.capability.speech-to-text", embedding: "modelTestbench.capability.embedding", rerank: "modelTestbench.capability.rerank" };
const states: Record<PlatformModelTestRecord["state"], ModelTestbenchKey> = { queued: "modelTestbench.state.queued", dispatching: "modelTestbench.state.dispatching", succeeded: "modelTestbench.state.succeeded", failed: "modelTestbench.state.failed", cancelled: "modelTestbench.state.cancelled", unknown: "modelTestbench.state.unknown" };
const reasonLabels: Record<string, ModelTestbenchKey> = { "trusted-adapter-price-or-bound-unavailable": "modelTestbench.reason.trusted-adapter-price-or-bound-unavailable", "native-asr-token-bound-unverified": "modelTestbench.reason.native-asr-token-bound-unverified", "adapter-unavailable": "modelTestbench.reason.adapter-unavailable", "admission-refused": "modelTestbench.reason.admission-refused", "dispatch-cancelled": "modelTestbench.reason.dispatch-cancelled", "provider-unconfirmed": "modelTestbench.reason.provider-unconfirmed", "dispatch-in-progress": "modelTestbench.reason.dispatch-in-progress", "accounting-unavailable": "modelTestbench.reason.accounting-unavailable" };
function reasonLabel(reason: string, t: ReturnType<typeof useI18n>["t"]): string {
  const key = Object.hasOwn(reasonLabels, reason) ? reasonLabels[reason] : undefined;
  return key ? t(key) : reason;
}
function explain(error: unknown): ModelTestbenchKey {
  if (error instanceof ApiError && error.status === 403) return "modelTestbench.error.permission";
  if (error instanceof ApiError && error.status === 404) return "modelTestbench.error.notFound";
  return "modelTestbench.error.unavailable";
}
function unavailableReason(candidate: ModelTestCandidate, t: ReturnType<typeof useI18n>["t"]): string | null {
  if (!candidate.available) return candidate.reason ? reasonLabel(candidate.reason, t) : t("modelTestbench.reason.configuration-unconfirmed");
  if (!candidate.modelProvider || !candidate.runtimeModelId) return t("modelTestbench.reason.route-unconfirmed");
  if (!candidate.currency) return t("modelTestbench.reason.currency-unconfirmed");
  if (candidate.capability === "text" && candidate.maximumOutputTokens === null) return t("modelTestbench.reason.output-unconfirmed");
  if (["image-generation", "text-to-speech", "speech-to-text"].includes(candidate.capability) && (!candidate.nativeUnit || candidate.maximumQuantity === null)) return t("modelTestbench.reason.native-unconfirmed");
  return null;
}
const unsettled = (record: PlatformModelTestRecord | null) => !record || record.state === "queued" || record.state === "dispatching" || record.state === "unknown" || record.settlementState !== "settled";
/** lint-no-backend-badge:backed-by-children — candidates/start/get/cancel use validated live API responses. */
export function PlatformModelTestbench() {
  const { t } = useI18n();
  const [orgs, setOrgs] = React.useState<OrganizationList | null>(null), [search, setSearch] = React.useState("");
  const [orgId, setOrgId] = React.useState(""), [candidates, setCandidates] = React.useState<ModelTestCandidate[] | null>(null), [selected, setSelected] = React.useState("");
  const [prompt, setPrompt] = React.useState(""), [voice, setVoice] = React.useState(""), [language, setLanguage] = React.useState(""), [documents, setDocuments] = React.useState("");
  const [audio, setAudio] = React.useState(""), [sampleRate, setSampleRate] = React.useState("16000");
  const [cost, setCost] = React.useState(""), [timeout, setTimeoutValue] = React.useState(""), [output, setOutput] = React.useState(""), [quantity, setQuantity] = React.useState(""), [confirmed, setConfirmed] = React.useState(false);
  const [record, setRecord] = React.useState<PlatformModelTestRecord | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState<ModelTestbenchKey | null>(null), [loadingOrgs, setLoadingOrgs] = React.useState(false);
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
  const canStart = !!candidate && unavailableReason(candidate, t) === null && parsed.success && !overBounds && !locked;
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
    if (!identity.success) { setError("modelTestbench.error.recovery"); return; }
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
  return <AdminScreen state="default" moduleLabel={t("modelTestbench.module")} title={t("modelTestbench.title")} hideOrgIdentity liveBacked intro={t("modelTestbench.intro")} emptyHint={t("modelTestbench.emptyHint")} denialReason={t("modelTestbench.denial")} successMessage={t("modelTestbench.success")}>
    <div data-testid="model-testbench-grid" className="grid min-w-0 gap-6 lg:grid-cols-2 [&_button]:break-words">
      <section data-testid="model-testbench-prepare" aria-label={t("modelTestbench.prepare")} className="min-w-0 space-y-4 rounded-lg border p-4">
        <h2 className="text-16 font-semibold">{t("modelTestbench.chooseHeading")}</h2>
        <form className="flex min-w-0 gap-2 [&>input]:min-w-0 [&>button]:shrink-0" onSubmit={event => { event.preventDefault(); if (!locked) void loadOrganizations(); }}><Input aria-label={t("modelTestbench.searchAria")} value={search} placeholder={t("modelTestbench.searchPlaceholder")} disabled={locked} onChange={event => setSearch(event.target.value)} /><Button type="submit" variant="outline" disabled={locked || loadingOrgs}>{t("modelTestbench.search")}</Button></form>
        {loadingOrgs && <p data-testid="loading" role="status">{t("modelTestbench.loadingOrganizations")}</p>}
        {orgs && <><Select aria-label={t("modelTestbench.organizationAria")} placeholder={t("modelTestbench.organizationPlaceholder")} value={orgId} disabled={locked || attempt.current !== null} onValueChange={setOrgId} options={orgs.organizations.map(org => ({ value: org.orgId, label: org.name }))} className="h-auto min-h-8 min-w-0 max-w-full whitespace-normal text-left [&>span]:break-words" />
          {orgs.organizations.length === 0 && <p data-testid="empty">{t("modelTestbench.noOrganizations")}</p>}<Button variant="outline" disabled={locked || !orgs.nextCursor} onClick={() => void loadOrganizations(orgs.nextCursor ?? undefined)}>{t("modelTestbench.nextOrganizations")}</Button></>}
        <form aria-label={t("modelTestbench.recoverAria")} className="space-y-2 rounded border p-3 [&>button]:h-auto [&>button]:whitespace-normal" onSubmit={event => { event.preventDefault(); void recover(); }}>
          <label htmlFor="test-recovery-id" className="text-14 font-medium">{t("modelTestbench.recoveryId")}</label>
          <Input id="test-recovery-id" value={recoveryId} disabled={busy || attempt.current !== null} onChange={event => setRecoveryId(event.target.value)} placeholder={t("modelTestbench.recoveryPlaceholder")} />
          <p className="text-12 text-muted-foreground">{t("modelTestbench.recoveryHint")}</p>
          <Button type="submit" variant="outline" disabled={!orgId || !recoveryId.trim() || busy || attempt.current !== null}>{t("modelTestbench.recover")}</Button>
        </form>
        <p className="text-12 text-muted-foreground">{t("modelTestbench.attribution")}</p>
        {orgId && candidates === null && !error && <p data-testid="loading" role="status">{t("modelTestbench.loadingCandidates")}</p>}
        {candidates && candidates.length === 0 && <p data-testid="empty">{t("modelTestbench.noCandidates")}</p>}
        {candidates && <div className="space-y-2">{candidates.map((row, index) => <div key={`${row.modelId}:${row.capability}`} className="min-w-0 rounded border p-3"><Button variant={selected === String(index) ? "secondary" : "outline"} className="h-auto max-w-full whitespace-normal text-left" aria-pressed={selected === String(index)} disabled={unavailableReason(row, t) !== null || locked || attempt.current !== null} onClick={() => { setSelected(String(index)); setPrompt(""); setVoice(""); setDocuments(""); setAudio(""); resetConfirmation(); }}>{row.displayName} · {t(capabilityLabels[row.capability])}</Button><p className="break-all text-12 text-muted-foreground">{row.modelId}</p>{unavailableReason(row, t) && <p className="text-12">{t("modelTestbench.unavailable", { reason: unavailableReason(row, t)! })}</p>}</div>)}</div>}
        {candidate && <><h2 className="text-16 font-semibold">{t("modelTestbench.boundsHeading")}</h2>
          {candidate.capability !== "speech-to-text" && <div className="space-y-1"><label htmlFor="test-prompt">{candidate.capability === "embedding" ? t("modelTestbench.embeddingInput") : candidate.capability === "rerank" ? t("modelTestbench.rerankInput") : candidate.capability === "text-to-speech" ? t("modelTestbench.speechInput") : t("modelTestbench.prompt")}</label><Textarea id="test-prompt" value={prompt} disabled={locked || attempt.current !== null} onChange={event => { setPrompt(event.target.value); resetConfirmation(); }} /></div>}
          {candidate.capability === "text-to-speech" && <>{field("test-voice", t("modelTestbench.voice"), voice, setVoice)}{field("test-language", t("modelTestbench.language"), language, setLanguage)}</>}
          {candidate.capability === "rerank" && <div><label htmlFor="test-documents">{t("modelTestbench.documents")}</label><Textarea id="test-documents" value={documents} disabled={locked || attempt.current !== null} onChange={event => { setDocuments(event.target.value); resetConfirmation(); }} /></div>}
          {candidate.capability === "speech-to-text" && <><div><label htmlFor="test-audio">{t("modelTestbench.audio")}</label><Textarea id="test-audio" value={audio} disabled={locked || attempt.current !== null} onChange={event => { setAudio(event.target.value); resetConfirmation(); }} /><p className="text-12 text-muted-foreground">{t("modelTestbench.audioHint")}</p></div><Select aria-label={t("modelTestbench.sampleRate")} value={sampleRate} disabled={locked || attempt.current !== null} onValueChange={value => { setSampleRate(value); resetConfirmation(); }} options={[{value:"16000",label:"16000 Hz"},{value:"24000",label:"24000 Hz"}]} /></>}
          {field("test-cost", t("modelTestbench.cost", { currency: candidate.currency ?? t("modelTestbench.unknownCurrency") }), cost, setCost, t("modelTestbench.costHint"))}
          {field("test-timeout", t("modelTestbench.timeout"), timeout, setTimeoutValue)}
          {candidate.capability === "text" && field("test-output", t("modelTestbench.output"), output, setOutput, candidate.maximumOutputTokens === null ? t("modelTestbench.outputHint") : t("modelTestbench.serverLimit", { limit: candidate.maximumOutputTokens }))}
          {["image-generation", "text-to-speech", "speech-to-text"].includes(candidate.capability) && field("test-quantity", t("modelTestbench.quantity", { unit: candidate.nativeUnit ?? t("modelTestbench.unknownUnit") }), quantity, setQuantity, candidate.maximumQuantity === null ? t("modelTestbench.quantityHint") : t("modelTestbench.serverLimit", { limit: candidate.maximumQuantity }))}
          {overBounds && <p role="alert">{t("modelTestbench.overBounds")}</p>}
          <label className="flex items-start gap-2 text-14 [&>input]:shrink-0"><Checkbox aria-label={t("modelTestbench.consentAria")} checked={confirmed} disabled={locked || attempt.current !== null} onChange={event => setConfirmed(event.target.checked)} />{t("modelTestbench.consent")}</label>
          <Button disabled={!canStart || attempt.current !== null} onClick={() => void start()}>{t("modelTestbench.start")}</Button></>}
      </section>
      <section data-testid="model-testbench-results" aria-label={t("modelTestbench.results")} className="min-w-0 space-y-4 rounded-lg border p-4" aria-live="polite">
        <h2 className="text-16 font-semibold">{t("modelTestbench.resultsHeading")}</h2>
        {error && <p role="alert" data-testid="err-test" className="text-destructive">{t(error)}</p>}
        {!attempt.current && <p data-testid="empty" className="text-muted-foreground">{t("modelTestbench.resultsEmpty")}</p>}
        {attempt.current && <><p className="break-all text-12 text-muted-foreground">{t("modelTestbench.testId", { id: attempt.current.testId })}</p><p role="status">{busy ? t("modelTestbench.requesting") : record ? t(states[record.state]) : t("modelTestbench.startUnconfirmed")}</p>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void update()}>{t("modelTestbench.query")}</Button><Button variant="outline" disabled={busy || (!!record && ["succeeded", "failed", "cancelled"].includes(record.state))} onClick={() => void update(true)}>{t("modelTestbench.cancel")}</Button></div>
          <p className="text-12 text-muted-foreground">{t("modelTestbench.cancelWarning")}</p></>}
        {record && <><p>{t("modelTestbench.settlement", { state: record.settlementState === "settled" ? t("modelTestbench.settled") : record.settlementState === "held" ? t("modelTestbench.held") : t("modelTestbench.pending") })}</p>
          {unsettled(record) && <p className="rounded border bg-muted p-3">{t("modelTestbench.holdWarning")}</p>}
          {record.failureReason && <p>{t("modelTestbench.statusReason", { reason: reasonLabel(record.failureReason, t) })}</p>}
          <p>{t("modelTestbench.usageCost", { cost: record.usage?.costMicros == null || !record.usage.currency ? t("modelTestbench.unknown") : `${modelTestMicrosToAmount(record.usage.costMicros) ?? t("modelTestbench.unknown")} ${record.usage.currency}`, currency: record.usage?.currency ?? t("modelTestbench.unknown") })}</p><p>{t("modelTestbench.totalTokens", { tokens: record.usage?.tokens ?? t("modelTestbench.unknown") })}</p><p>{t("modelTestbench.partialTokens", { input: record.usage?.inputTokens ?? t("modelTestbench.unknown"), output: record.usage?.outputTokens ?? t("modelTestbench.unknown") })}</p><p>{t("modelTestbench.nativeQuantity", { quantity: record.usage?.nativeQuantity ?? t("modelTestbench.unknown"), unit: record.usage?.nativeUnit ?? "" })}</p>
          {record.result && <TestResult result={record.result} />}
          </>}
        {attempt.current && <>
          {unsettled(record) && <label className="flex items-start gap-2 text-14 [&>input]:shrink-0"><Checkbox aria-label={t("modelTestbench.holdAria")} checked={acknowledgeHold} disabled={busy} onChange={event=>setAcknowledgeHold(event.target.checked)} />{t("modelTestbench.holdConsent")}</label>}
          <Button variant="outline" disabled={busy || (!!record && ["queued","dispatching"].includes(record.state)) || (unsettled(record) && !acknowledgeHold)} onClick={prepareAnother}>{t("modelTestbench.prepareAnother")}</Button>
        </>}
        {previous.length > 0 && <section aria-label={t("modelTestbench.previous")} className="space-y-2"><h3 className="text-14 font-semibold">{t("modelTestbench.previous")}</h3>{previous.map(row=><div key={row.testId} className="rounded border p-3 text-12"><p className="break-all">{row.testId}</p><p>{row.record ? t(states[row.record.state]) : t("modelTestbench.resultUnconfirmed")} · {row.record?.settlementState === "settled" ? t("modelTestbench.settled") : t("modelTestbench.reservationUnconfirmed")}</p><Button variant="outline" disabled={busy} onClick={()=>void refreshPrevious(row.testId,row.orgId)}>{t("modelTestbench.queryPrevious", { id: row.testId.slice(0,8) })}</Button></div>)}</section>}
      </section>
    </div>
  </AdminScreen>;
}
function TestResult({ result }: { result: NonNullable<PlatformModelTestRecord["result"]> }) {
  const { t } = useI18n();
  if (result.kind === "text") return <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-14">{result.text}</pre>;
  if (result.kind === "image") return <div className="grid gap-2">{result.assets.map((asset, index) => <a key={index} href={asset.url} target="_blank" rel="noopener noreferrer" className="break-all text-14 underline hover:text-primary transition-colors">{t("modelTestbench.image", { index: index + 1, mime: asset.mimeType })}</a>)}</div>;
  if (result.kind === "audio") return <div className="space-y-2"><audio controls preload="none" src={result.asset.url} className="w-full" aria-label={t("modelTestbench.audioAria")} /><p>{t("modelTestbench.duration", { duration: result.durationMs === null ? t("modelTestbench.unknown") : t("modelTestbench.milliseconds", { duration: result.durationMs }) })}</p></div>;
  if (result.kind === "embedding") return <div><p>{t("modelTestbench.vectors", { count: result.vectorCount, dimensions: result.dimensions })}</p><pre className="whitespace-pre-wrap break-all text-12">{JSON.stringify(result.preview)}</pre></div>;
  return <ol className="space-y-1">{result.results.map(row => <li key={row.index}>{t("modelTestbench.score", { index: row.index + 1, score: row.score })}</li>)}</ol>;
}
