/** Component acceptance for #6255; SDK boundary only, no persistence/authorization claim. */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModelScreen } from "@/components/admin/model-screen";
import { BailianModelCatalog } from "@/components/admin/bailian-model-catalog";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { ApiError } from "@/lib/api-client";
import type { ModelPoolRow, RegisterModelOutput } from "@/lib/live-model";
import type { OrgCoreModelState, OrgCoreModelCandidate } from "@/lib/live-org-core-model";
import type { UiState } from "@/lib/ui-state";
import { bailianModelCatalog } from "@repo/contracts/bailian-model-catalog";

const sdk = vi.hoisted(() => ({ list: vi.fn(), register: vi.fn(), core: vi.fn(), candidates: vi.fn(), saveCore: vi.fn(), org: "actual-org" }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: sdk.org } }) }));
vi.mock("@/lib/live-model", async () => ({
  ...await vi.importActual<typeof import("@/lib/live-model")>("@/lib/live-model"),
  listModels: sdk.list, registerModelFromForm: sdk.register,
}));
vi.mock("@/lib/live-org-core-model", () => ({ getOrgCoreModel: sdk.core, getOrgCoreModelCandidates: sdk.candidates, setOrgCoreModel: sdk.saveCore }));
// The shared navigation/seven-state shell is outside this task. Render its OWNED props
// faithfully; EntityCatalog, panels, dialogs, tags, selects and tabs stay real.
vi.mock("@/components/admin/admin-screen", () => ({
  AdminScreen: (props: React.ComponentProps<typeof import("@/components/admin/admin-screen").AdminScreen>) => <main>
    <span>{props.moduleLabel}</span><h1>{props.title}</h1><div>{props.intro}</div>{props.noticeOverride}
    {props.state === "default" ? props.children : <div role="status">
      {props.emptyHint}{Object.values(props.errors ?? {}).join(" ")}{props.depFailure}{props.denialReason}{props.successMessage}
    </div>}
  </main>,
}));

const hosted: ModelPoolRow = {
  modelId: "m-api-{name}", status: "已启用", kind: "closed-api", shape: "single", vendor: "原厂 {vendor}",
  displayName: "原始模型 {name}", capabilityTags: ["自定义 {tag}"], contextWindow: 400000,
  unitPrice: 0.018123, complianceAttrs: ["原始合规 {scope}"], members: [], credentialConfigured: true,
};
const selfHosted: ModelPoolRow = {
  modelId: "m-self", status: "待测试", kind: "self-hosted", shape: "single", vendor: "自托管 · H100×4",
  displayName: "qwen3-72b", capabilityTags: ["长文"], contextWindow: 128000,
  unitPrice: 0, complianceAttrs: [], members: [], credentialConfigured: false,
};
const disabled: ModelPoolRow = { ...hosted, modelId: "m-disabled", displayName: "disabled-raw", status: "已停用" };
const emptyCore: OrgCoreModelState = { version: 0, selection: null, updatedBy: null, reason: null };
const candidate: OrgCoreModelCandidate = {
  modelId: "formal-{id}", displayName: "正式模型 {name}", modelProvider: "raw-provider", runtimeModelId: "runtime/{id}",
  configRevision: "revision-7", available: true, reason: null,
};
const unavailable: OrgCoreModelCandidate = { ...candidate, modelId: "unavailable", displayName: "Unknown Deployment", modelProvider: null, runtimeModelId: null, configRevision: null, available: false, reason: "DEPLOYMENT_BINDING_UNVERIFIED" };
const binding = { modelId: candidate.modelId, modelProvider: "raw-provider", runtimeModelId: "runtime/{id}", configRevision: "revision-7" };
const raw = [hosted.displayName, hosted.vendor, ...hosted.capabilityTags, ...hosted.complianceAttrs, selfHosted.vendor, ...selfHosted.capabilityTags, candidate.displayName];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function Language() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en")}>TEST EN</button><button onClick={() => setLocale("zh-CN")}>TEST ZH</button></>;
}
function show(locale: Locale = "en", state: UiState = "default") {
  return render(<I18nProvider initialLocale={locale}><Language /><ModelScreen state={state} /></I18nProvider>);
}
function language(locale: Locale) { fireEvent.click(screen.getByText(locale === "en" ? "TEST EN" : "TEST ZH")); }
function field(id: string) { return document.getElementById(`admin-model-field-${id}`) as HTMLInputElement; }
function changeField(id: string, value: string) { fireEvent.change(field(id), { target: { value } }); }
function assertEnglish(container: HTMLElement, authored: readonly string[] = raw) {
  let copy = `${container.textContent} ${[...container.querySelectorAll("[aria-label], [placeholder], [title]")].map(node => [node.getAttribute("aria-label"), node.getAttribute("placeholder"), node.getAttribute("title")].join(" ")).join(" ")}`;
  for (const value of [...authored].sort((a, b) => b.length - a.length)) copy = copy.split(value).join("");
  expect(copy).not.toMatch(/[\u3400-\u9fff]/);
}
async function ready() { await screen.findByTestId(`admin-model-card-${hosted.modelId}`); await screen.findByRole("button", { name: new RegExp(candidate.displayName.replace(/[{}]/g, "\\$&")) }); }
function openRegistration() { fireEvent.click(screen.getByTestId("admin-model-add")); return screen.getByTestId("admin-model-panel"); }
function fillRegistration() {
  changeField("name", "  新模型 {name}  "); changeField("vendor", "  原厂 {vendor}  ");
  changeField("endpoint", "  https://model.example.test/v1  "); changeField("api-key", "  sk-test-only  ");
  changeField("context", "256000"); changeField("price", "0.018123");
  const input = screen.getByTestId("admin-model-tag-input");
  fireEvent.change(input, { target: { value: "已确认" } }); fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "未确认" } });
}
const registrationPayload = {
  kind: "closed-api", displayName: "新模型 {name}", vendor: "原厂 {vendor}", endpoint: "https://model.example.test/v1",
  apiKey: "sk-test-only", capabilityTags: ["已确认", "未确认"], contextWindow: 256000, unitPrice: 0.018123,
};
function publicTab() { fireEvent.mouseDown(screen.getByRole("tab", { name: /Bailian|百炼/ }), { button: 0, ctrlKey: false }); }

beforeEach(() => {
  vi.resetAllMocks(); sdk.org = "actual-org";
  sdk.list.mockResolvedValue([hosted, selfHosted, disabled]);
  sdk.core.mockResolvedValue(emptyCore); sdk.candidates.mockResolvedValue([candidate, unavailable]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("platform model catalog complete localization", () => {
  it("localizes mounted list, tags, credentials and detail while preserving raw identifiers and exact prices", async () => {
    show(); await ready();
    expect(screen.getByRole("heading", { name: /model management/i })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toHaveAccessibleName(/model.*catalog|catalog.*scope/i);
    expect(screen.getByTestId("admin-model-search")).toHaveAccessibleName(/search.*model/i);
    expect(screen.getByTestId("admin-model-count")).toHaveTextContent(/3.*(models|total)|total.*3/i);
    expect(screen.getByTestId("admin-model-mixed-notice")).toHaveTextContent(/local.*demo|local.*demonstration/i);
    expect(screen.getByTestId("admin-model-mixed-notice")).toHaveTextContent(/not.*persist|not.*saved/i);
    expect(screen.getByTestId(`admin-model-price-${hosted.modelId}`)).toHaveTextContent("￥0.018123 / 1k");
    expect(screen.getByTestId(`admin-model-price-${selfHosted.modelId}`)).toHaveTextContent(/unpriced|not priced/i);
    expect(screen.getByTestId(`admin-model-key-status-${hosted.modelId}`)).toHaveTextContent(/configured/i);
    expect(screen.getByTestId(`admin-model-key-status-${selfHosted.modelId}`)).toHaveTextContent(/not configured/i);
    assertEnglish(screen.getByRole("main"));
    fireEvent.click(screen.getByTestId(`admin-model-card-${hosted.modelId}`));
    const drawer = screen.getByTestId("admin-model-detail");
    for (const value of [hosted.displayName, hosted.modelId, hosted.vendor, hosted.complianceAttrs[0]!, "400,000 tokens", "￥0.018123 / 1k", "enableModel", "disableModel", "recordAdmissionTest"]) expect(drawer).toHaveTextContent(value);
    expect(drawer).toHaveTextContent(/local.*demo|local.*demonstration/i);
    expect(within(drawer).getByRole("switch")).toHaveAccessibleName(new RegExp("(enable|disable).*" + hosted.displayName.replace(/[{}]/g, "\\$&"), "i"));
    assertEnglish(drawer);
    language("zh-CN"); expect(drawer).toHaveTextContent("状态操作（本地演示，尚未回写后端）");
    expect(screen.getByTestId("admin-model-detail")).toBe(drawer);
    language("en"); assertEnglish(drawer);
    expect(sdk.list).toHaveBeenCalledTimes(1); expect(sdk.register).not.toHaveBeenCalled();
  });

  it.each(["en", "zh-CN"] as const)("keeps one owned list/core read and loading copy across a %s round trip", async initial => {
    const list = deferred<readonly ModelPoolRow[]>(), core = deferred<OrgCoreModelState>(), candidates = deferred<OrgCoreModelCandidate[]>();
    sdk.list.mockReturnValue(list.promise); sdk.core.mockReturnValue(core.promise); sdk.candidates.mockReturnValue(candidates.promise);
    show(initial);
    const poolLoading = screen.getByTestId("admin-model-loading"), coreLoading = screen.getByTestId("loading");
    const signal = sdk.core.mock.calls[0]![0] as AbortSignal;
    language(initial === "en" ? "zh-CN" : "en");
    expect(poolLoading).toHaveTextContent(initial === "en" ? /正在读取/ : /loading|reading/i);
    expect(coreLoading).toHaveTextContent(initial === "en" ? /正在读取/ : /loading|reading/i);
    language(initial);
    expect(signal.aborted).toBe(false); expect(sdk.list).toHaveBeenCalledTimes(1); expect(sdk.core).toHaveBeenCalledTimes(1); expect(sdk.candidates).toHaveBeenCalledTimes(1);
    await act(async () => { list.resolve([hosted]); core.resolve(emptyCore); candidates.resolve([candidate]); });
    expect(await screen.findByTestId(`admin-model-card-${hosted.modelId}`)).toBeInTheDocument();
    expect(screen.getByTestId("org-core-model-panel")).toHaveTextContent(initial === "en" ? /not configured/i : "核心模型未配置");
  });

  it("retains canonical enabled/untested/disabled tag keys, query and selected detail through both locales", async () => {
    show("zh-CN"); await ready();
    const search = screen.getByTestId("admin-model-search");
    fireEvent.change(search, { target: { value: "原厂 {vendor}" } });
    fireEvent.click(screen.getByTestId("admin-model-tag-enabled"));
    fireEvent.click(screen.getByTestId(`admin-model-card-${hosted.modelId}`));
    const drawer = screen.getByTestId("admin-model-detail");
    language("en");
    expect(screen.getByTestId("admin-model-tag-enabled")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("admin-model-tag-enabled")).toHaveTextContent(/enabled/i);
    expect(screen.getByTestId("admin-model-tag-untested")).toHaveTextContent(/untested|awaiting test/i);
    // 未启用 had a preexisting codepoint slug; it must not silently become a new English key.
    expect(screen.getByTestId("admin-model-tag-t-672a-542f-7528")).toHaveTextContent(/disabled|not enabled/i);
    expect(search).toHaveValue("原厂 {vendor}"); expect(screen.getByTestId("admin-model-detail")).toBe(drawer);
    expect(screen.queryByTestId("admin-model-card-m-disabled")).toBeNull();
    language("zh-CN"); expect(screen.getByTestId("admin-model-tag-enabled")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("admin-model-detail-close"));
    fireEvent.click(screen.getByTestId("admin-model-tag-all"));
    fireEvent.change(search, { target: { value: "does-not-exist" } });
    language("en"); expect(screen.getByTestId("admin-model-no-match")).toHaveTextContent(/no.*match/i);
    assertEnglish(screen.getByTestId("admin-model-no-match")); expect(sdk.list).toHaveBeenCalledTimes(1);
  });

  it("retains registration inputs and uncommitted tags, validation and exact form payload while pending", async () => {
    const submit = deferred<RegisterModelOutput>(); sdk.register.mockReturnValue(submit.promise);
    show("zh-CN"); await ready(); const drawer = openRegistration();
    expect(screen.getByTestId("admin-model-panel-save")).toBeDisabled();
    fillRegistration();
    const name = field("name"), tagInput = screen.getByTestId("admin-model-tag-input");
    language("en"); expect(screen.getByTestId("admin-model-panel")).toBe(drawer); expect(field("name")).toBe(name);
    expect(name).toHaveValue("  新模型 {name}  "); expect(tagInput).toHaveValue("未确认");
    expect(field("api-key")).toHaveValue("  sk-test-only  "); expect(field("api-key")).toHaveAttribute("type", "password");
    expect(field("price")).toHaveValue(0.018123); expect(field("context")).toHaveValue(256000);
    assertEnglish(drawer, [...raw, "新模型 {name}", "已确认", "未确认"]);
    changeField("context", "0"); expect(screen.getByTestId("admin-model-panel-save")).toBeDisabled();
    changeField("context", "256000"); changeField("price", "-1"); expect(screen.getByTestId("admin-model-panel-save")).toBeDisabled();
    changeField("price", "0.018123");
    fireEvent.click(screen.getByTestId("admin-model-panel-save"));
    expect(sdk.register).toHaveBeenCalledTimes(1); expect(sdk.register).toHaveBeenCalledWith(registrationPayload);
    expect(screen.getByTestId("admin-model-panel-save")).toHaveTextContent(/registering|connecting/i);
    language("zh-CN"); expect(screen.getByTestId("admin-model-panel-save")).toHaveTextContent("接入中…");
    expect(name).toBeDisabled(); expect(tagInput).toHaveValue("未确认");
    language("en"); fireEvent.click(screen.getByTestId("admin-model-panel-save")); expect(sdk.register).toHaveBeenCalledTimes(1);
    await act(async () => submit.resolve({ modelId: "registered-id", status: "待测试" }));
    expect(screen.queryByTestId("admin-model-panel")).toBeNull();
    const toast = screen.getByTestId("admin-model-toast"); expect(toast).toHaveTextContent("新模型 {name}");
    expect(toast).toHaveTextContent(/registered|connected/i); expect(toast).toHaveTextContent("待测试");
    language("zh-CN"); expect(toast).toHaveTextContent("已接入模型「新模型 {name}」（待测试）。");
    language("en"); expect(toast).toHaveTextContent(/registered|connected/i);
    await waitFor(() => expect(sdk.list).toHaveBeenCalledTimes(2));
    expect(sdk.core).toHaveBeenCalledTimes(1); expect(sdk.candidates).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, "NOT_ORG_ADMIN", /organization.*administrator|organization.*admin/i],
    [422, "COMPLIANCE_ATTR_UNKNOWN", /compliance/i],
    [503, "DEPENDENCY_UNAVAILABLE", /unavailable|dependency/i],
    [418, "VENDOR_RAW_{name}", /VENDOR_RAW_\{name\}/],
  ] as const)("retranslates registration %s/%s without retrying or exposing private response data", async (status, reason, english) => {
    const submit = deferred<RegisterModelOutput>(); sdk.register.mockReturnValue(submit.promise);
    show(); await ready(); openRegistration(); fillRegistration(); fireEvent.click(screen.getByTestId("admin-model-panel-save"));
    language("zh-CN");
    await act(async () => submit.reject(new ApiError(status, reason, { privateDetail: "NEVER_PROJECT_PRIVATE_BODY" })));
    const error = await screen.findByTestId("admin-model-panel-error"); expect(error).toHaveTextContent("接入失败");
    language("en"); expect(error).toHaveTextContent(english); expect(error).toHaveTextContent(/failed|failure/i);
    expect(error).not.toHaveTextContent("NEVER_PROJECT_PRIVATE_BODY");
    expect(field("name")).toHaveValue("  新模型 {name}  "); expect(screen.getByTestId("admin-model-tag-input")).toHaveValue("未确认");
    expect(sdk.register).toHaveBeenCalledTimes(1); expect(sdk.register).toHaveBeenCalledWith(registrationPayload); expect(sdk.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("admin-model-toast")).toBeNull();
  });

  it("keeps manual admission checks and local-only success semantics through locale switches", async () => {
    show(); await ready(); fireEvent.click(screen.getByTestId("admin-model-card-m-self"));
    fireEvent.click(within(screen.getByTestId("admin-model-detail")).getByTestId("admin-model-test-m-self"));
    const dialog = screen.getByTestId("admin-model-test-dialog"), submit = screen.getByTestId("admin-model-test-submit");
    assertEnglish(dialog); expect(submit).toBeDisabled();
    for (let i = 1; i <= 2; i++) fireEvent.click(screen.getByTestId(`admin-model-test-check-${i}`));
    language("zh-CN"); expect(screen.getByTestId("admin-model-test-dialog")).toBe(dialog);
    expect(dialog).toHaveTextContent("中文长文理解"); expect(submit).toBeDisabled();
    expect(screen.getByTestId("admin-model-test-check-1")).toBeChecked(); expect(screen.getByTestId("admin-model-test-check-2")).toBeChecked();
    language("en");
    for (let i = 3; i <= 5; i++) fireEvent.click(screen.getByTestId(`admin-model-test-check-${i}`));
    expect(submit).toBeEnabled(); fireEvent.click(submit);
    expect(within(screen.getByTestId("admin-model-detail")).getByTestId("admin-model-status-m-self")).toHaveTextContent(/enabled/i);
    const toast = screen.getByTestId("admin-model-toast"); expect(toast).toHaveTextContent(/local.*demo|local.*demonstration/i);
    language("zh-CN"); expect(toast).toHaveTextContent("尚未回写后端"); language("en"); assertEnglish(toast);
    expect(sdk.list).toHaveBeenCalledTimes(1); expect(sdk.register).not.toHaveBeenCalled(); expect(sdk.saveCore).not.toHaveBeenCalled();
  });

  it("keeps disable mode/reason/minimum validation and translates both drain effects and local toast", async () => {
    show(); await ready(); fireEvent.click(screen.getByTestId(`admin-model-card-${hosted.modelId}`));
    fireEvent.click(within(screen.getByTestId("admin-model-detail")).getByTestId(`admin-model-detail-disable-${hosted.modelId}`));
    const dialog = screen.getByTestId("admin-model-disable-dialog"), reason = screen.getByTestId("admin-model-disable-dialog-reason"), confirm = screen.getByTestId("admin-model-disable-dialog-confirm");
    assertEnglish(dialog); expect(within(dialog).getByRole("radiogroup")).toHaveAccessibleName(/disable/i);
    expect(screen.getByTestId("admin-model-disable-dialog-inflight")).toHaveTextContent(/0.*(calls|in progress)/i);
    expect(confirm).toBeDisabled(); fireEvent.change(reason, { target: { value: "abc" } }); expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByTestId("admin-model-disable-dialog-mode-drain"));
    fireEvent.change(reason, { target: { value: "原始下线理由 {reason}" } }); language("zh-CN");
    expect(screen.getByTestId("admin-model-disable-dialog")).toBe(dialog); expect(reason).toHaveValue("原始下线理由 {reason}");
    expect(screen.getByTestId("admin-model-disable-dialog-mode-drain")).toHaveAttribute("aria-checked", "true");
    expect(confirm).toHaveTextContent("允许跑完当前一轮并停用");
    language("en"); expect(dialog).toHaveTextContent(/new.*calls|new.*requests/i); expect(confirm).toBeEnabled(); fireEvent.click(confirm);
    const toast = screen.getByTestId("admin-model-toast"); expect(toast).toHaveTextContent(/new.*(calls|requests).*reject/i);
    expect(toast).toHaveTextContent(/local.*demo|local.*demonstration/i); language("zh-CN"); expect(toast).toHaveTextContent("新调用即刻被拒");
    language("en"); assertEnglish(toast);
    expect(within(screen.getByTestId("admin-model-detail")).getByTestId(`admin-model-status-${hosted.modelId}`)).toHaveTextContent(/disabled|not enabled/i);
    expect(sdk.list).toHaveBeenCalledTimes(1); expect(sdk.register).not.toHaveBeenCalled(); expect(sdk.saveCore).not.toHaveBeenCalled();
  });

  it("renders honest empty/read failures in the active locale without fallback models or hidden retries", async () => {
    const read = deferred<readonly ModelPoolRow[]>(); sdk.list.mockReturnValueOnce(read.promise).mockResolvedValueOnce([]);
    show(); await act(async () => read.reject(new ApiError(403, "NOT_ORG_ADMIN", { private: "NEVER_PROJECT_PRIVATE_BODY" })));
    const error = await screen.findByTestId("admin-model-error");
    expect(error).toHaveTextContent(/organization.*admin/i); expect(error).toHaveTextContent(/demo|sample/i); assertEnglish(error);
    language("zh-CN"); expect(error).toHaveTextContent("不退回演示数据"); language("en");
    expect(error).not.toHaveTextContent("NEVER_PROJECT_PRIVATE_BODY"); expect(sdk.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("admin-model-retry"));
    const empty = await screen.findByTestId("admin-model-empty"); expect(empty).toHaveTextContent(/empty/i); assertEnglish(empty);
    expect(screen.queryByTestId("admin-model-list")).toBeNull(); expect(sdk.list).toHaveBeenCalledTimes(2);
  });

  it("preserves unknown list protocol reasons exactly across locales", async () => {
    sdk.list.mockRejectedValue(new ApiError(418, "RAW_REASON_{id}", { privateDetail: "NEVER_PROJECT_PRIVATE_BODY" }));
    show(); const error = await screen.findByTestId("admin-model-error"); expect(error).toHaveTextContent("RAW_REASON_{id}");
    language("zh-CN"); expect(error).toHaveTextContent("RAW_REASON_{id}"); language("en");
    expect(error).not.toHaveTextContent("NEVER_PROJECT_PRIVATE_BODY"); expect(sdk.list).toHaveBeenCalledTimes(1);
  });

  it("localizes the page-owned seven-state shell props including permission and endpoint limitations", async () => {
    show("en", "denied");
    const status = screen.getByRole("status"); expect(status).toHaveTextContent(/organization.*administrator|organization.*admin/i);
    expect(status).toHaveTextContent(/timeout|timed out/i); expect(status).toHaveTextContent(/gateway/i); assertEnglish(screen.getByRole("main"));
    language("zh-CN"); expect(status).toHaveTextContent("模型管理仅组织管理员可进入");
    expect(status).toHaveTextContent("端点 3 次未响应");
    await act(async () => { await Promise.resolve(); });
  });
});

describe("core model configuration within the mounted page", () => {
  it("keeps a conflict draft during an owned refresh and saves only the adopted version", async () => {
    sdk.saveCore.mockRejectedValueOnce(new ApiError(409, "VERSION_CHANGED", null));
    show("zh-CN"); await ready(); const panel = screen.getByTestId("org-core-model-panel");
    const choice = within(panel).getByRole("button", { name: `选择 ${candidate.displayName}` });
    fireEvent.click(choice); const reason = within(panel).getByRole("textbox");
    fireEvent.change(reason, { target: { value: "保留理由 {reason}" } });
    fireEvent.click(within(panel).getByRole("button", { name: "保存核心模型选择" }));
    await within(panel).findByRole("alert"); language("en");
    const read = deferred<OrgCoreModelState>(); sdk.core.mockReturnValueOnce(read.promise);
    fireEvent.click(within(panel).getByRole("button", { name: /refresh.*(draft|preserv)|preserv.*refresh/i }));
    const signal = sdk.core.mock.calls[1]![0] as AbortSignal;
    language("zh-CN"); expect(reason).toHaveValue("保留理由 {reason}"); expect(choice).toHaveAttribute("aria-pressed", "true");
    expect(reason).toBeDisabled(); language("en"); expect(signal.aborted).toBe(false);
    expect(sdk.core).toHaveBeenCalledTimes(2); expect(sdk.candidates).toHaveBeenCalledTimes(2);
    await act(async () => read.resolve({ ...emptyCore, version: 3 }));
    expect(reason).toBeEnabled(); expect(reason).toHaveValue("保留理由 {reason}");
    sdk.saveCore.mockResolvedValue({ version: 4, selection: binding, updatedBy: "raw-admin", reason: "保留理由 {reason}" });
    fireEvent.click(within(panel).getByRole("button", { name: /save.*core/i }));
    await waitFor(() => expect(sdk.saveCore).toHaveBeenLastCalledWith({ expectedVersion: 3, modelId: "formal-{id}", reason: "保留理由 {reason}" }));
    await within(panel).findByText(/saved/i); expect(sdk.saveCore).toHaveBeenCalledTimes(2);
  });

  it.each(["en", "zh-CN"] as const)("keeps exact core save ownership, selected ID and audit draft on a %s round trip", async initial => {
    const save = deferred<OrgCoreModelState>(); sdk.saveCore.mockReturnValue(save.promise);
    show(initial); await ready(); const panel = screen.getByTestId("org-core-model-panel");
    const choose = within(panel).getByRole("button", { name: new RegExp(candidate.displayName.replace(/[{}]/g, "\\$&")) });
    fireEvent.click(choose); const reason = within(panel).getByRole("textbox"); fireEvent.change(reason, { target: { value: " 原始理由 {reason} " } });
    expect(within(panel).getByRole("button", { name: /Unknown Deployment/ })).toBeDisabled();
    const saveButton = within(panel).getByRole("button", { name: /save.*core|保存核心模型/i }); fireEvent.click(saveButton);
    expect(sdk.saveCore).toHaveBeenCalledTimes(1); expect(sdk.saveCore).toHaveBeenCalledWith({ expectedVersion: 0, modelId: "formal-{id}", reason: "原始理由 {reason}" });
    const signal = sdk.core.mock.calls[0]![0] as AbortSignal;
    language(initial === "en" ? "zh-CN" : "en"); expect(screen.getByTestId("org-core-model-panel")).toBe(panel);
    expect(choose).toHaveAttribute("aria-pressed", "true"); expect(reason).toHaveValue(" 原始理由 {reason} "); expect(saveButton).toBeDisabled();
    language(initial); expect(signal.aborted).toBe(false); expect(sdk.core).toHaveBeenCalledTimes(1); expect(sdk.candidates).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve({ version: 1, selection: binding, updatedBy: "管理员 {actor}", reason: "原始理由 {reason}" }));
    language("en"); expect(panel).toHaveTextContent(/saved/i); expect(panel).toHaveTextContent("管理员 {actor}"); expect(panel).toHaveTextContent("原始理由 {reason}");
    assertEnglish(panel, [...raw, "管理员 {actor}", "原始理由 {reason}"]);
    language("zh-CN"); expect(panel).toHaveTextContent("核心模型选择已保存，变更理由已记录。");
    expect(sdk.saveCore).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "UNAUTHORIZED", /sign in|log in|session/i, /登录状态已失效/],
    [403, "NOT_ORG_ADMIN", /organization.*admin/i, /仅当前组织管理员/],
    [422, "CORE_MODEL_UNAVAILABLE", /selected model.*unavailable/i, /所选模型当前不可用/],
    [409, "VERSION_CHANGED", /another.*admin|changed.*admin/i, /配置已被其他管理员修改/],
    [500, "UNRECOGNIZED", /unavailable|try again/i, /暂不可用/],
  ] as const)("retranslates core save %s/%s and preserves the draft without another operation", async (status, code, english, chinese) => {
    sdk.saveCore.mockRejectedValue(new ApiError(status, code, { privateDetail: "NEVER_PROJECT_PRIVATE_BODY" }));
    show("zh-CN"); await ready(); const panel = screen.getByTestId("org-core-model-panel");
    fireEvent.click(within(panel).getByRole("button", { name: `选择 ${candidate.displayName}` }));
    const reason = within(panel).getByRole("textbox"); fireEvent.change(reason, { target: { value: "保留草稿 {reason}" } });
    fireEvent.click(within(panel).getByRole("button", { name: "保存核心模型选择" }));
    const error = await within(panel).findByRole("alert"); expect(error).toHaveTextContent(chinese);
    language("en"); expect(error).toHaveTextContent(english); expect(error).not.toHaveTextContent("NEVER_PROJECT_PRIVATE_BODY");
    // Permission errors hide the editor but the draft remains in state; no refresh is triggered.
    if (status !== 401 && status !== 403) expect(reason).toHaveValue("保留草稿 {reason}");
    language("zh-CN"); expect(error).toHaveTextContent(chinese);
    expect(sdk.saveCore).toHaveBeenCalledTimes(1); expect(sdk.core).toHaveBeenCalledTimes(1); expect(sdk.candidates).toHaveBeenCalledTimes(1);
  });

  it("localizes unavailable saved binding and empty candidates without inventing a default", async () => {
    sdk.core.mockResolvedValue({ version: 7, selection: { ...binding, configRevision: "old-binding" }, updatedBy: "raw-admin", reason: "raw-reason" });
    sdk.candidates.mockResolvedValue([]); show();
    const panel = await screen.findByTestId("org-core-model-panel"); await within(panel).findByTestId("empty");
    expect(panel).toHaveTextContent("formal-{id}"); expect(panel).toHaveTextContent(/unavailable|deployment.*changed/i);
    expect(within(panel).getByRole("button", { name: /save.*core/i })).toBeDisabled(); assertEnglish(panel);
    language("zh-CN"); expect(panel).toHaveTextContent("当前配置不可用，或部署配置已变化");
    expect(sdk.saveCore).not.toHaveBeenCalled();
  });
});

describe("public catalog localization without tenant mutation", () => {
  it("localizes native tabs, pagination, accessibility and public limitations on the actual mounted page", async () => {
    show(); await ready(); publicTab();
    const catalog = screen.getByTestId("bailian-catalog"); expect(catalog).toHaveAccessibleName(/Bailian.*catalog/i);
    expect(screen.getByTestId("bailian-search")).toHaveAccessibleName(/search.*Bailian/i);
    expect(screen.getByTestId("bailian-vendor-filter")).toHaveAccessibleName(/vendor/i);
    expect(screen.getByTestId("bailian-capability-filter")).toHaveAccessibleName(/capabilit/i);
    expect(screen.getByTestId("bailian-catalog-coverage")).toHaveTextContent(/not.*verified|unverified/i);
    assertEnglish(catalog, bailianModelCatalog.models.flatMap(model => [model.displayName, model.originalVendor ?? ""]));
    const previous = screen.getByRole("button", { name: /previous/i }); expect(previous).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("navigation", { name: /Bailian.*pag/i })).toHaveTextContent(/2\s*\//);
    language("zh-CN"); expect(screen.getByRole("tab", { name: "百炼公共目录" })).toHaveAttribute("aria-selected", "true");
    expect(catalog).toHaveTextContent("第 2 /"); language("en");
    fireEvent.change(screen.getByTestId("bailian-search"), { target: { value: "no-such-model" } });
    const empty = screen.getByTestId("bailian-empty"); expect(empty).toHaveTextContent(/no.*match/i); assertEnglish(empty);
    language("zh-CN"); expect(screen.getByTestId("bailian-search")).toHaveValue("no-such-model");
    fireEvent.click(screen.getByRole("button", { name: "查看全部模型" })); language("en");
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(sdk.list).toHaveBeenCalledTimes(1); expect(sdk.register).not.toHaveBeenCalled(); expect(sdk.saveCore).not.toHaveBeenCalled();
  });

  it("retains raw filter enums, selected public ID, source titles/facts/URLs and callback count across languages", async () => {
    const onView = vi.fn();
    render(<I18nProvider initialLocale="zh-CN"><Language /><BailianModelCatalog onViewOrganizationModels={onView} /></I18nProvider>);
    fireEvent.keyDown(screen.getByTestId("bailian-vendor-filter"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "MiniMax" }));
    fireEvent.keyDown(screen.getByTestId("bailian-capability-filter"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "语音合成" }));
    const search = screen.getByTestId("bailian-search"); fireEvent.change(search, { target: { value: "speech-2.8" } });
    const cardId = "bailian-model-MiniMax/speech-2.8-hd";
    fireEvent.click(screen.getByTestId(cardId)); const drawer = screen.getByTestId("bailian-model-detail");
    const model = bailianModelCatalog.models.find(row => row.modelId === "MiniMax/speech-2.8-hd")!;
    language("en"); expect(screen.getByTestId("bailian-model-detail")).toBe(drawer);
    expect(search).toHaveValue("speech-2.8"); expect(screen.getByTestId("bailian-vendor-filter")).toHaveTextContent("MiniMax");
    expect(screen.getByTestId("bailian-capability-filter")).toHaveTextContent(/speech synthesis/i);
    expect(screen.queryByTestId("bailian-model-MiniMax-M3")).toBeNull();
    expect(screen.getByTestId(cardId)).toHaveTextContent(/context.*(unverified|verification|not.*verified)/i);
    expect(drawer).toHaveTextContent("MiniMax/speech-2.8-hd"); expect(drawer).toHaveTextContent(/not.*verified|unverified/i);
    expect(drawer).toHaveTextContent(/not.*(quote|pricing)|cannot.*(quote|pricing)/i);
    for (const fact of model.parameters) { expect(drawer).toHaveTextContent(fact.name); expect(drawer).toHaveTextContent(fact.value); expect(drawer).toHaveTextContent(fact.scope); }
    for (const source of model.sources) expect(within(drawer).getByRole("link", { name: new RegExp(source.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toHaveAttribute("href", source.url);
    const publicRaw = [model.displayName, model.modelId, model.originalVendor ?? "", ...model.parameters.flatMap(fact => [fact.name, fact.value, fact.scope]), ...model.sources.map(source => source.title)];
    assertEnglish(drawer, publicRaw);
    expect(onView).not.toHaveBeenCalled(); language("zh-CN"); expect(drawer).toHaveTextContent("尚未核验，不能用于报价");
    language("en"); fireEvent.click(within(drawer).getByRole("button", { name: /view organization model/i }));
    expect(onView).toHaveBeenCalledTimes(1); expect(screen.queryByTestId("bailian-model-detail")).toBeNull();
    fireEvent.keyDown(screen.getByTestId("bailian-capability-filter"), { key: "ArrowDown" });
    expect(await screen.findByRole("menuitemradio", { name: /speech synthesis/i })).toHaveAttribute("aria-checked", "true");
    expect(sdk.register).not.toHaveBeenCalled(); expect(sdk.saveCore).not.toHaveBeenCalled();
  });
});
