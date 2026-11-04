/** SDK-mocked component evidence only; no provider execution, payment, or settlement claim. */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlatformModelTestbench } from "@/components/admin/platform-model-testbench";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { PlatformModelTestCandidate, PlatformModelTestRecord, PlatformModelTestRequest, type PlatformModelTestCapability, type PlatformModelTestResult } from "@repo/contracts/platform-model-test";

const mocks = vi.hoisted(() => ({ orgs: vi.fn(), candidates: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/live-platform-organizations", () => ({ listPlatformOrganizations: mocks.orgs }));
vi.mock("@/lib/live-platform-model-test", () => ({ getModelTestCandidates: mocks.candidates, startModelTest: mocks.start, getModelTest: mocks.get, cancelModelTest: mocks.cancel }));
// Keep owned shell copy observable without bringing unrelated navigation into this page test.
vi.mock("@/components/admin/admin-screen", () => ({ AdminScreen: ({ children, title, intro, moduleLabel, emptyHint, denialReason, successMessage }: { children: React.ReactNode; title: string; intro: string; moduleLabel: string; emptyHint: string; denialReason: string; successMessage: string }) => <main><h1>{title}</h1><p>{intro}</p><div data-testid="shell-copy">{moduleLabel} {emptyHint} {denialReason} {successMessage}</div>{children}</main> }));
const uuid = "12345678-1234-4234-8234-123456789012";
const raw = "用户原文 raw input / untouched";
const modelName = "模型 Model / unchanged";
const org = (orgId: string) => ({ orgId, name: orgId, kind: "organization", memberCount: 1, plan: { plan: null, version: 0, updatedAt: null, updatedBy: null, enforcement: "pending" } });
const organizations = { organizations: [org("org-a"), org("org-b")], nextCursor: null };
function candidate(capability: PlatformModelTestCapability = "text", patch: Partial<PlatformModelTestCandidate> = {}) {
  return PlatformModelTestCandidate.parse({ modelId: "org-model", displayName: modelName, capability, available: true, reason: null, modelProvider: "bailian", runtimeModelId: "qwen3.8-max", currency: "CNY", maximumOutputTokens: 64, nativeUnit: "request", maximumQuantity: "5", ...patch });
}

const results: PlatformModelTestResult[] = [
  { kind: "text", text: raw },
  { kind: "image", assets: [{ url: "https://example.com/raw-image.png?key=原值", mimeType: "image/png" }] },
  { kind: "audio", asset: { url: "/files/raw-audio.mp3", mimeType: "audio/mpeg" }, durationMs: 1234 },
  { kind: "embedding", vectorCount: 1, dimensions: 3, preview: [0.123456789, -0.5, 0] },
  { kind: "rerank", results: [{ index: 1, score: 0.123456789 }] },
];
function record(input: { testId: string; orgId: string; capability?: PlatformModelTestCapability }, patch: Partial<PlatformModelTestRecord> = {}) {
  const capabilityForKind: Record<PlatformModelTestResult["kind"], PlatformModelTestCapability> = { text: "text", image: "image-generation", audio: "text-to-speech", embedding: "embedding", rerank: "rerank" };
  const kindForCapability: Record<PlatformModelTestCapability, PlatformModelTestResult["kind"]> = { text: "text", "image-generation": "image", "text-to-speech": "audio", "speech-to-text": "text", embedding: "embedding", rerank: "rerank" };
  const capability = patch.capability ?? input.capability ?? (patch.result ? capabilityForKind[patch.result.kind] : "text");
  const state = patch.state ?? "succeeded";
  const failureReason = state === "succeeded" ? null : state === "failed" ? "admission-refused" : state === "cancelled" ? "dispatch-cancelled" : state === "unknown" ? "provider-unconfirmed" : null;
  return PlatformModelTestRecord.parse({ testId: input.testId, orgId: input.orgId, modelId: "org-model", capability, state, settlementState: "settled", result: state === "succeeded" ? results.find(result => result.kind === kindForCapability[capability]) : null, failureReason, usage: null, ...patch });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function Language() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>;
}
function show(locale: "en" | "zh-CN" = "zh-CN") { return render(<I18nProvider initialLocale={locale}><Language /><PlatformModelTestbench /></I18nProvider>); }
const language = (locale: "en" | "zh-CN") => fireEvent.click(screen.getByText(locale === "en" ? "EN test" : "ZH test"));
function field(id: string) { const element = document.getElementById(`test-${id}`); if (!element) throw new Error(`Missing existing test-${id}`); return element; }
const fill = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });
async function chooseOrg() {
  fireEvent.keyDown(await screen.findByRole("button", { name: "测试所属组织" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "org-a" }));
}
async function prepare(capability: PlatformModelTestCapability = "text") {
  mocks.candidates.mockResolvedValue([candidate(capability)]); show(); await chooseOrg();
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(modelName) }));
  fill("cost", "0.123456"); fill("timeout", "1000");
  if (capability === "speech-to-text") fill("audio", "AAAAAA=="); else fill("prompt", raw);
  if (capability === "text") fill("output", "16");
  if (capability === "text-to-speech") { fill("voice", "voice-原音"); fill("language", "zh-CN"); }
  if (capability === "rerank") fill("documents", "文档一\ndocument-two");
  if (["image-generation", "text-to-speech", "speech-to-text"].includes(capability)) fill("quantity", "2");
  fireEvent.click(screen.getByLabelText("确认非机密输入与费用上限"));
  return screen.getByRole("button", { name: "发起一次真实测试" });
}
async function recover(patch: Partial<PlatformModelTestRecord> = {}) {
  mocks.get.mockResolvedValue(record({ testId: uuid, orgId: "org-a" }, patch)); show(); await chooseOrg();
  fill("recovery-id", uuid); fireEvent.click(screen.getByRole("button", { name: "恢复原测试（仅查询）" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "查询原测试状态" })).not.toBeDisabled());
}
function noMutations() { expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled(); }
beforeEach(() => {
  mocks.orgs.mockResolvedValue(organizations); mocks.candidates.mockResolvedValue([candidate()]);
  mocks.start.mockImplementation(async input => record(input));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("complete platform model testbench localization (mocked SDK)", () => {
  it("renders English shell, organization search/pagination, recovery, accessible regions and empty results", async () => {
    show("en"); await waitFor(() => expect(mocks.orgs).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/platform.*model.*test/i);
    expect(screen.getByRole("region", { name: /prepare.*test/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /execution.*settlement/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /search.*organi/i })).toHaveAttribute("placeholder", expect.stringMatching(/search/i));
    expect(screen.getByRole("button", { name: /next.*organi/i })).toBeDisabled();
    expect(screen.getByRole("form", { name: /recover.*test/i })).toBeInTheDocument();
    expect(field("recovery-id")).toHaveAccessibleName(/existing.*UUID/i);
    expect(screen.getByTestId("shell-copy").textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(screen.getByTestId("empty")).toHaveTextContent(/confirm.*cost|complete.*input/i);
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/); noMutations();
  });

  it("retains organization search and cursor protocol while retranslating empty results", async () => {
    mocks.orgs.mockResolvedValueOnce({ ...organizations, nextCursor: "cursor-原值" }).mockResolvedValue({ organizations: [], nextCursor: null });
    show(); await screen.findByRole("button", { name: "下一页组织" });
    const search = screen.getByLabelText("搜索测试组织"); fireEvent.change(search, { target: { value: raw } });
    fireEvent.click(screen.getByRole("button", { name: "下一页组织" }));
    await screen.findByText("没有匹配组织，请调整搜索。"); language("en");
    expect(search).toHaveValue(raw); expect(mocks.orgs).toHaveBeenLastCalledWith(raw, "cursor-原值");
    expect(screen.getByText(/no.*matching.*organi/i)).toBeInTheDocument();
    expect(mocks.orgs).toHaveBeenCalledTimes(2); noMutations();
  });

  it("keeps deferred organization and candidate reads owned through locale switches without abort/reload", async () => {
    const orgRead = deferred<typeof organizations>(); const candidatesRead = deferred<PlatformModelTestCandidate[]>();
    mocks.orgs.mockReturnValue(orgRead.promise); mocks.candidates.mockReturnValue(candidatesRead.promise); show();
    const orgLoading = screen.getByTestId("loading"); language("en");
    const englishOrgLoading = orgLoading.textContent; language("zh-CN");
    await act(async () => { orgRead.resolve(organizations); }); await chooseOrg();
    const signal = mocks.candidates.mock.calls[0]![1] as AbortSignal;
    const modelLoading = screen.getByTestId("loading"); language("en");
    const englishModelLoading = modelLoading.textContent;
    language("zh-CN"); expect(signal.aborted).toBe(false);
    await act(async () => { candidatesRead.resolve([]); }); language("en");
    expect(englishOrgLoading).toMatch(/loading.*organi/i); expect(englishModelLoading).toMatch(/verif|check|loading.*model/i);
    expect(screen.getByText(/no.*(?:testable|test).*model/i)).toBeInTheDocument();
    expect(mocks.orgs).toHaveBeenCalledTimes(1); expect(mocks.candidates).toHaveBeenCalledTimes(1); noMutations();
  });

  const capabilities = [
    ["text", /text.*(?:chat|conversation)/i, /test.*prompt/i],
    ["image-generation", /image.*generat/i, /test.*prompt/i],
    ["text-to-speech", /speech.*synth|text.to.speech/i, /(?:synthesis|speech).*text|text.*synth/i],
    ["speech-to-text", /speech.*recog|speech.to.text/i, /PCM16.*(?:mono|single).*Base64/i],
    ["embedding", /(?:text.*)?embedding|text.*vector/i, /(?:embedding|vector).*text/i],
    ["rerank", /rerank/i, /rerank.*query/i],
  ] as const;
  it.each(capabilities)("localizes %s form/aria while preserving exact raw input and valid request", async (capability, label, inputLabel) => {
    const start = await prepare(capability); const promptOrAudio = field(capability === "speech-to-text" ? "audio" : "prompt");
    language("en"); fireEvent.click(start);
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    const request = PlatformModelTestRequest.parse(mocks.start.mock.calls[0]![0]);
    expect(request.capability).toBe(capability); expect(request.modelId).toBe("org-model");
    expect(request.bounds.maximumCostMicros).toBe("123456"); expect(request.bounds.timeoutMs).toBe(1000);
    expect(request.input).toEqual(capability === "text" || capability === "image-generation" ? { prompt: raw } : capability === "text-to-speech" ? { text: raw, voice: "voice-原音", language: "zh-CN" } : capability === "speech-to-text" ? { audioBase64: "AAAAAA==", sampleRateHz: 16000, channels: 1, format: "pcm16" } : capability === "embedding" ? { texts: [raw] } : { query: raw, documents: ["文档一", "document-two"] });
    expect(promptOrAudio).toHaveValue(capability === "speech-to-text" ? "AAAAAA==" : raw);
    expect(promptOrAudio).toHaveAccessibleName(inputLabel);
    expect(screen.getByRole("button", { name: new RegExp(modelName) })).toHaveAccessibleName(label);
    expect(field("cost")).toHaveAccessibleName(/maximum.*cost.*CNY/i);
    expect(field("timeout")).toHaveAccessibleName(/timeout.*(?:ms|millisecond)/i);
    if (capability === "text") expect(field("output")).toHaveAccessibleName(/maximum.*output.*token/i);
    if (capability === "text-to-speech") { expect(field("voice")).toHaveAccessibleName(/voice.*ID/i); expect(field("language")).toHaveAccessibleName(/language.*optional/i); }
    if (capability === "rerank") expect(field("documents")).toHaveAccessibleName(/candidate.*documents/i);
    if (capability === "speech-to-text") expect(screen.getByRole("button", { name: /sample.*rate/i })).toBeInTheDocument();
    if (["image-generation", "text-to-speech", "speech-to-text"].includes(capability)) expect(field("quantity")).toHaveAccessibleName(/maximum.*(?:bill|quantity).*request/i);
    language("zh-CN"); expect(promptOrAudio).toHaveValue(capability === "speech-to-text" ? "AAAAAA==" : raw);
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.candidates).toHaveBeenCalledTimes(1);
  });

  const reasons = [
    ["native-asr-token-bound-unverified", /(?:ASR|speech.*recog).*token.*(?:bound|limit).*(?:unverified|not.*verified)/i],
    ["trusted-adapter-price-or-bound-unavailable", /^(?!.*trusted-adapter-price-or-bound-unavailable).*trusted adapter.*(?:price|pricing|bound|limit)/i],
    ["adapter-unavailable", /(?:not.*adapt|adapter.*unavailable|not.*support)/i],
    ["admission-refused", /member.*(?:admission|budget)/i],
    ["dispatch-cancelled", /(?:execution|dispatch).*cancel/i],
    ["provider-unconfirmed", /provider.*(?:unconfirmed|not.*confirm)/i],
    ["dispatch-in-progress", /provider.*(?:progress|execut|running)/i],
    ["accounting-unavailable", /(?:accounting|settlement).*unavailable/i],
    ["raw-provider-reason-原值", /raw-provider-reason-原值/],
  ] as const;
  it.each(reasons)("translates known candidate reason %s while retaining unknown protocol text", async (reason, english) => {
    mocks.candidates.mockResolvedValue([candidate("text", { available: false, reason })]); show(); await chooseOrg();
    const button = await screen.findByRole("button", { name: new RegExp(modelName) }); expect(button).toBeDisabled(); language("en");
    expect(button.parentElement).toHaveTextContent(english); expect(button.parentElement).toHaveTextContent(/unavailable|cannot.*test|not.*testable/i);
    expect(button).toHaveTextContent(modelName); noMutations();
  });

  it.each([
    [{ available: false, reason: null }, /configuration.*adapter.*(?:unconfirmed|not.*confirm)/i],
    [{ modelProvider: null }, /provider.*rout.*(?:unconfirmed|not.*confirm)/i],
    [{ runtimeModelId: null }, /provider.*rout.*(?:unconfirmed|not.*confirm)/i],
    [{ currency: null }, /(?:cost.*)?currency.*(?:unconfirmed|not.*confirm)/i],
    [{ maximumOutputTokens: null }, /output.*(?:bound|limit).*(?:unconfirmed|not.*confirm)/i],
    [{ capability: "image-generation", nativeUnit: null }, /native.*(?:unit|bound|limit)/i],
    [{ capability: "speech-to-text", maximumQuantity: null }, /native.*(?:unit|bound|limit)/i],
  ] as const)("keeps missing route/price/safety unavailable: %j", async (patch, english) => {
    mocks.candidates.mockResolvedValue([candidate("text", patch)]); show(); await chooseOrg();
    const button = await screen.findByRole("button", { name: new RegExp(modelName) }); language("en");
    expect(button).toBeDisabled(); expect(button.parentElement).toHaveTextContent(english); noMutations();
  });

  it("retranslates local validation without a request and retains invalid UUID", async () => {
    show(); await chooseOrg(); fill("recovery-id", "not-a-uuid"); fireEvent.click(screen.getByRole("button", { name: "恢复原测试（仅查询）" }));
    const error = await screen.findByRole("alert"); const chinese = error.textContent; language("en");
    expect(error).toHaveTextContent(/select.*(?:original|organization).*valid.*UUID/i); expect(field("recovery-id")).toHaveValue("not-a-uuid");
    language("zh-CN"); expect(error.textContent).toBe(chinese); expect(mocks.get).not.toHaveBeenCalled(); noMutations();
  });

  it("translates over-bound validation and never rounds seven-decimal amounts into authorization", async () => {
    const start = await prepare(); fill("output", "65"); language("en");
    expect(screen.getByRole("alert")).toHaveTextContent(/(?:exceed|outside).*safety.*(?:bound|limit)/i); expect(start).toBeDisabled();
    fill("output", "16"); fill("cost", "0.0000001"); expect(start).toBeDisabled(); noMutations();
  });

  it.each([
    [403, /platform.*(?:operator|permission).*member.*budget/i],
    [404, /(?:record|service).*unavailable.*environment/i],
    [503, /service.*(?:unavailable|contract).*query.*(?:original|existing).*not.*(?:repeat|start)/i],
  ] as const)("retranslates safe HTTP %s failures after recovery; retry keeps original identity", async (status, english) => {
    mocks.get.mockRejectedValue(new ApiError(status, "PRIVATE_RAW_ERROR", { message: "PRIVATE_DETAIL" })); show(); await chooseOrg(); fill("recovery-id", uuid);
    fireEvent.click(screen.getByRole("button", { name: "恢复原测试（仅查询）" })); const failure = await screen.findByRole("alert");
    const original = failure.textContent; language("en");
    expect(failure).toHaveTextContent(english); expect(document.body).not.toHaveTextContent("PRIVATE_RAW_ERROR"); expect(document.body).not.toHaveTextContent("PRIVATE_DETAIL");
    expect(field("recovery-id")).toHaveValue(uuid); mocks.get.mockResolvedValue(record({ testId: uuid, orgId: "org-a" }));
    fireEvent.click(screen.getByRole("button", { name: /query.*(?:original|existing).*test.*status/i }));
    await screen.findByText(raw); language("zh-CN"); expect(original).toMatch(/[\u3400-\u9fff]/);
    expect(mocks.get).toHaveBeenCalledTimes(2); expect(mocks.get.mock.calls.every(call => call[0] === uuid && call[1] === "org-a")).toBe(true); noMutations();
  });


  it.each(["organizations", "candidates"] as const)("retranslates safe %s read failure without pretending the list is empty", async source => {
    const failure = new TypeError("PRIVATE_NETWORK_DETAIL");
    if (source === "organizations") mocks.orgs.mockRejectedValue(failure); else mocks.candidates.mockRejectedValue(failure);
    show(); if (source === "candidates") await chooseOrg();
    const alert = await screen.findByRole("alert"); const chinese = alert.textContent; language("en");
    expect(alert).toHaveTextContent(/service.*(?:unavailable|contract).*query.*(?:original|existing)/i);
    expect(document.body).not.toHaveTextContent("PRIVATE_NETWORK_DETAIL");
    expect(screen.queryByText(/no.*matching.*organi|no.*testable.*model/i)).toBeNull();
    language("zh-CN"); expect(alert.textContent).toBe(chinese);
    expect(mocks.orgs).toHaveBeenCalledTimes(1); expect(mocks.candidates).toHaveBeenCalledTimes(source === "candidates" ? 1 : 0); noMutations();
  });

  it("retranslates ambiguous paid-start failure while retaining UUID and GET-only recovery", async () => {
    const start = await prepare(); mocks.start.mockRejectedValue(new Error("PRIVATE_DISPATCH_DETAIL")); fireEvent.click(start);
    const failure = await screen.findByRole("alert");
    const request = PlatformModelTestRequest.parse(mocks.start.mock.calls[0]![0]);
    const query = screen.getByRole("button", { name: "查询原测试状态" });
    language("en"); const english = failure.textContent;
    expect(start).toBeDisabled(); expect(field("prompt")).toHaveValue(raw);
    expect(document.body).not.toHaveTextContent("PRIVATE_DISPATCH_DETAIL");
    mocks.get.mockResolvedValue(record(request, { state: "unknown", settlementState: "held", result: null }));
    fireEvent.click(query); await waitFor(() => expect(query).not.toBeDisabled());
    expect(mocks.get).toHaveBeenCalledWith(request.testId, "org-a", expect.any(AbortSignal));
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.cancel).not.toHaveBeenCalled();
    expect(english).toMatch(/service.*(?:unavailable|contract).*query.*(?:original|existing).*not.*(?:repeat|start)/i);
    expect(screen.getByRole("status")).toHaveTextContent(/provider.*(?:unconfirmed|not.*confirm)/i);
    expect(screen.getByText(new RegExp(request.testId))).toBeInTheDocument();
  });

  it("retranslates failed cancellation without releasing held funds or redispatching", async () => {
    await recover({ state: "unknown", settlementState: "held", result: null });
    mocks.cancel.mockRejectedValue(new ApiError(503, "PRIVATE_CANCEL_DETAIL"));
    fireEvent.click(screen.getByRole("button", { name: "取消本次测试" }));
    const failure = await screen.findByRole("alert"); language("en");
    expect(failure).toHaveTextContent(/service.*(?:unavailable|contract).*query.*(?:original|existing)/i);
    expect(screen.getByText(/(?:cost|funds).*held.*(?:reconcil|check)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare.*new.*test/i })).toBeDisabled();
    expect(mocks.cancel).toHaveBeenCalledWith(uuid, "org-a", expect.any(AbortSignal));
    expect(mocks.cancel).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("PRIVATE_CANCEL_DETAIL");
  });

  it.each(["queued", "dispatching", "succeeded", "failed", "cancelled", "unknown"] as const)("enters and translates execution state %s independently of settlement", async state => {
    await recover({ state, settlementState: "held", ...(state === "succeeded" ? {} : { result: null }) }); language("en");
    const status = screen.getByRole("region", { name: /execution.*settlement/i });
    expect(within(status).getByRole("status")).toHaveTextContent(({ queued: /queued|waiting/i, dispatching: /executing|running|dispatching/i, succeeded: /succeeded|successful/i, failed: /failed/i, cancelled: /cancelled/i, unknown: /provider.*(?:unconfirmed|not.*confirm)/i })[state]);
    expect(status).toHaveTextContent(/(?:cost|funds).*held.*(?:reconcil|check)/i);
    expect(status).toHaveTextContent(/(?:budget.*reservation|reserved.*budget).*(?:remain|retain|held)/i);
    expect(status).toHaveTextContent(/(?:cancel.*(?:not|doesn.t)|(?:not|doesn.t).*cancel).*(?:provider|charg)/i);
    expect(screen.getByLabelText(/confirm.*(?:previous|old).*(?:reservation|reserved)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare.*new.*test/i })).toBeDisabled();
    expect(mocks.get).toHaveBeenCalledTimes(1); noMutations();
  });

  it.each([null, "0"] as const)("keeps unknown usage distinct from zero %s and preserves exact six-decimal cost/native units", async tokens => {
    await recover({ capability: "speech-to-text", usage: { tokens, inputTokens: null, outputTokens: "0", costMicros: "100001", currency: "CNY", nativeQuantity: "1000", nativeUnit: "millisecond", priceVersion: "raw-price-v1" } });
    language("en"); expect(screen.getByText(/cost.*0\.100001 CNY.*currency.*CNY/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`total.*token.*${tokens === null ? "unknown" : "0"}`, "i"))).toBeInTheDocument();
    expect(screen.getByText(/input.*token.*unknown.*output.*token.*0/i)).toBeInTheDocument();
    expect(screen.getByText(/native.*quantity.*1000 millisecond/i)).toBeInTheDocument(); language("zh-CN");
    expect(screen.getByText("输入 Token：未知 · 输出 Token：0")).toBeInTheDocument(); noMutations();
  });


  it.each(results)("translates result labels/aria for $kind without translating output/protocol", async result => {
    await recover({ result }); language("en");
    if (result.kind === "text") expect(screen.getByText(raw).textContent).toBe(raw);
    if (result.kind === "image") expect(screen.getByRole("link", { name: /view.*generated.*image.*1.*image\/png/i })).toHaveAttribute("href", result.assets[0]!.url);
    if (result.kind === "audio") { expect(screen.getByLabelText(/test.*generated.*(?:audio|speech)/i)).toHaveAttribute("src", result.asset.url); expect(screen.getByText(/duration.*1234.*(?:ms|millisecond)/i)).toBeInTheDocument(); }
    if (result.kind === "embedding") { expect(screen.getByText(/1.*vector.*3.*dimension/i)).toBeInTheDocument(); expect(screen.getByText(JSON.stringify(result.preview)).textContent).toBe(JSON.stringify(result.preview)); }
    if (result.kind === "rerank") expect(screen.getByText(/document.*2.*score.*0\.123456789/i)).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(1); noMutations();
  });

  it("translates unknown audio duration and completely unknown currency/usage without inventing zero", async () => {
    await recover({ result: { kind: "audio", asset: { url: "/raw.wav", mimeType: "audio/wav" }, durationMs: null } }); language("en");
    expect(screen.getByText(/duration.*unknown/i)).toBeInTheDocument(); expect(screen.getByText(/cost.*unknown.*currency.*unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/native.*quantity.*unknown/i)).toBeInTheDocument(); noMutations();
  });

  it.each(["adapter-unavailable", "admission-refused", "dispatch-cancelled", "provider-unconfirmed", "dispatch-in-progress", "accounting-unavailable"] as const)("translates record failure reason %s after recovery", async failureReason => {
    await recover({ state: failureReason === "adapter-unavailable" || failureReason === "admission-refused" ? "failed" : failureReason === "dispatch-in-progress" ? "dispatching" : "unknown", settlementState: "held", result: null, failureReason }); language("en");
    const english = reasons.find(([reason]) => reason === failureReason)![1];
    expect(screen.getByText(/(?:status.*reason|reason.*status)/i)).toHaveTextContent(english); noMutations();
  });

  it("retains paid start UUID, locks and request signal during locale changes, then displays pending outcome", async () => {
    const pending = deferred<PlatformModelTestRecord>(); const start = await prepare(); mocks.start.mockReturnValue(pending.promise);
    fireEvent.click(start); const input = PlatformModelTestRequest.parse(mocks.start.mock.calls[0]![0]); const signal = mocks.start.mock.calls[0]![1] as AbortSignal;
    language("en"); fireEvent.click(start); language("zh-CN"); language("en");
    expect(signal.aborted).toBe(false); expect(start).toBeDisabled(); expect(field("prompt")).toHaveValue(raw); expect(field("cost")).toHaveValue("0.123456");
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.orgs).toHaveBeenCalledTimes(1); expect(mocks.candidates).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(record(input, { state: "queued", settlementState: "pending", result: null })); });
    expect(screen.getByText(/settlement.*pending/i)).toBeInTheDocument(); expect(screen.getByText(new RegExp(input.testId))).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each(["recover", "query", "cancel"] as const)("preserves deferred %s ownership/UUID through both locale directions", async operation => {
    const pending = deferred<PlatformModelTestRecord>();
    if (operation === "recover") {
      mocks.get.mockReturnValue(pending.promise); show(); await chooseOrg(); fill("recovery-id", uuid);
      fireEvent.click(screen.getByRole("button", { name: "恢复原测试（仅查询）" }));
    } else {
      await recover({ state: "unknown", settlementState: "held", result: null });
      (operation === "query" ? mocks.get : mocks.cancel).mockReturnValue(pending.promise);
      fireEvent.click(screen.getByRole("button", { name: operation === "query" ? "查询原测试状态" : "取消本次测试" }));
    }
    const api = operation === "cancel" ? mocks.cancel : mocks.get;
    const call = api.mock.calls.at(-1)!; const signal = call[2] as AbortSignal;
    language("en"); const englishBusy = screen.getByRole("status").textContent;
    language("zh-CN"); expect(signal.aborted).toBe(false); language("en");
    expect(field("recovery-id")).toHaveValue(uuid); expect(field("recovery-id")).toBeDisabled();
    expect(api).toHaveBeenCalledTimes(operation === "query" ? 2 : 1);
    await act(async () => { pending.resolve(record({ testId: uuid, orgId: "org-a" }, { state: "cancelled", settlementState: "held", result: null })); });
    expect(englishBusy).toMatch(/request.*(?:server|status)|(?:loading|fetching).*status/i);
    expect(screen.getByRole("status")).toHaveTextContent(/cancelled/i); expect(signal.aborted).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.orgs).toHaveBeenCalledTimes(1); expect(mocks.candidates).toHaveBeenCalledTimes(1);
  });

  it("does not reset queued polling on locale changes or duplicate paid start/cancel", async () => {
    await recover({ state: "queued", settlementState: "pending", result: null });
    vi.useFakeTimers();
    // Schedule a new authoritative queued response under controlled timers.
    mocks.get.mockResolvedValue(record({ testId: uuid, orgId: "org-a" }, { state: "dispatching", settlementState: "pending", result: null }));
    fireEvent.click(screen.getByRole("button", { name: "查询原测试状态" })); await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(1000); }); language("en");
    await act(async () => { vi.advanceTimersByTime(999); }); expect(mocks.get).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); }); expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent(/executing|running|dispatching/i); noMutations();
  });

  it("keeps held history/UUID and raw output across prepare-another and deferred old-record query", async () => {
    await recover({ state: "unknown", settlementState: "held", result: null });
    fireEvent.click(screen.getByLabelText("确认旧测试预留仍保留")); fireEvent.click(screen.getByRole("button", { name: "准备新测试" }));
    const history = screen.getByRole("region", { name: "之前测试" }); const oldQuery = within(history).getByRole("button");
    const pending = deferred<PlatformModelTestRecord>(); mocks.get.mockReturnValue(pending.promise); fireEvent.click(oldQuery);
    const signal = mocks.get.mock.calls[1]![2] as AbortSignal; language("en"); language("zh-CN"); language("en");
    expect(signal.aborted).toBe(false); expect(oldQuery).toBeDisabled();
    await act(async () => { pending.resolve(record({ testId: uuid, orgId: "org-a" })); });
    expect(history).toHaveAccessibleName(/previous.*tests/i); expect(history).toHaveTextContent(uuid); expect(history).toHaveTextContent(/succeeded|successful/i); expect(history).toHaveTextContent(/settled/i);
    expect(field("recovery-id")).toHaveValue(""); expect(mocks.get).toHaveBeenCalledTimes(2); noMutations();
  });
});
