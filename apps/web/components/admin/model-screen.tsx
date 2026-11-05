"use client";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import * as React from "react";
import { Plus, ShieldCheck, FlaskConical, Check, Ban } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useOptionalSession } from "@/components/session/session-provider";
import { OrgCoreModelPanel } from "./org-core-model-panel";
import { BailianModelCatalog } from "./bailian-model-catalog";
import { AdminScreen } from "./admin-screen";
import { AdminDrawer, AdminModal, Toast, Field, KV } from "./panel";
import { DisableDialog, type DisableMode } from "./disable-dialog";
import { EntityCatalog, CardActions, tagOf, type CatalogTag } from "./entity-catalog";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError } from "@/lib/api-client";
import {
  hasApiKeyConfigured, listModels, registerModelFromForm,
  type ModelPoolRow, type RegisterModelFormInput,
} from "@/lib/live-model";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/provider";

/**
 * #1381 起本屏的列表读走 `lib/live-model.ts` 的 `listModels()`（真实 `GET /models`），
 * 不再是示例模型清单；`lint-no-backend-badge` 按「本文件是否 import 了 `@/lib/live-*`」
 * 判定，本屏直接 import，不需要 `backed-by-children` 标记。
 *
 * ⚠ 这屏仍是**混合态**，不是「整屏已完成」：`enableModel` / `disableModel` /
 * `recordAdmissionTest` 这三条契约操作还没有 controller 路由（`model.controller.ts`
 * 文件头逐条列了缺口），所以面板里的启用开关与测试判读 modal 依旧只改本地 React state——
 * 点了会有 toast，但刷新页面或另一个管理员看到的状态不会变。真实的只有：接入（`POST
 * /models`）与列表（`GET /models`，#1381）。
 *
 * 2026-09-02（人类原话：「简化…模型…参考画布模板的首页，简化为一个卡片的列表，通过一个
 * 侧边面板来展示当前的实体的内容，可以增加删除修改，并通过 tag 来过滤和搜索」）：
 * 「闭源 API / 开源自托管」两个分组、四个筛选按钮、卡片/列表切换、机密路由预览链接卡
 * 全部撤掉，收成 `EntityCatalog` 一个网格——种类 / 状态 / 能力标签 / 可承接机密都成了
 * 标签筛选条上的标签；启用开关、测试判读、停用都进了点卡片打开的侧边面板。
 * `AdminScreen` 外壳保留：`verify-ui-states.sh` 的七态矩阵仍以 `/admin/model?state=` 锚定。
 */

/** 三态展示标签，直接对着契约的中文 `ModelStatus` 渲染，不经过第二套键位。 */
const STATUS_LABEL = { untested: "model.untested", enabled: "model.enabled", disabled: "model.disabled" } as const;
// Stable catalog identity is independent of translated display labels.
const STATUS_TAG = { untested: "待测试", enabled: "已启用", disabled: "未启用" } as const;
const KIND_LABEL = { "closed-api": "model.closed", "self-hosted": "model.hosted" } as const;

function tagsLabel(row: ModelPoolRow): string {
  return row.capabilityTags.length > 0 ? row.capabilityTags.join(" · ") : "—";
}
function contextLabel(row: ModelPoolRow): string {
  return `${row.contextWindow.toLocaleString("zh-CN")} tokens`;
}
function priceLabel(row: ModelPoolRow, t: ReturnType<typeof useI18n>["t"]): string {
  return row.unitPrice > 0 ? `￥${row.unitPrice} / 1k` : t("model.unpriced");
}

function failureText(reason: string | null, t: ReturnType<typeof useI18n>["t"]): string {
  switch (reason) {
    case "NOT_ORG_ADMIN": return t("model.adminError");
    case "COMPLIANCE_ATTR_UNKNOWN": return t("model.complianceError");
    case "DEPENDENCY_UNAVAILABLE": return t("model.dependencyError");
    case null: return t("model.unknownError");
    default: return reason;
  }
}

type ModelToast =
  | { readonly key: "model.registered"; readonly name: string; readonly status: string }
  | { readonly key: "model.assessed" | "model.disabledToast" | "model.drainedToast"; readonly name: string };

/** phase-1 的五项准入测试（人工判读并记录，不做自动化）。 */
const ADMISSION_TESTS = [
  "model.test1", "model.test2", "model.test3", "model.test4", "model.test5",
] as const;

type PoolState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly rows: readonly ModelPoolRow[] };

export function ModelScreen({ state }: { state: UiState }) {
  const { t } = useI18n();
  const session = useOptionalSession()?.session;
  const [catalogTab, setCatalogTab] = React.useState("organization");
  const [pool, setPool] = React.useState<PoolState>({ status: "loading" });
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  const [tested, setTested] = React.useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [testOf, setTestOf] = React.useState<ModelPoolRow | null>(null);
  const [disableOf, setDisableOf] = React.useState<ModelPoolRow | null>(null);
  const [toast, setToast] = React.useState<ModelToast | null>(null);
  const generation = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const request = ++generation.current;
    setPool((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const list = await listModels();
      if (request !== generation.current) return;
      setPool({ status: "ready", rows: list });
      // 只给**新出现**的 modelId 播种本地开关状态——已经在本会话里被本地切过的行不重置，
      // 否则每次刷新都会把管理员刚点的「停用」悄悄弹回真实状态（真实写路径还没接，
      // 唯一的状态就是这份本地 state）。
      setEnabled((prev) => {
        const next = { ...prev };
        for (const row of list) {
          if (!(row.modelId in next)) next[row.modelId] = row.status === "已启用";
        }
        return next;
      });
    } catch (e) {
      if (request !== generation.current) return;
      setPool({ status: "error", message: e instanceof ApiError ? (e.reasonCode ?? `http_${e.status}`) : String(e) });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const rows = React.useMemo(() => (pool.status === "ready" ? pool.rows : []), [pool]);
  const isUntested = React.useCallback(
    (m: ModelPoolRow) => m.status === "待测试" && !tested.has(m.modelId),
    [tested],
  );
  const isOn = React.useCallback((m: ModelPoolRow) => enabled[m.modelId] ?? false, [enabled]);
  const statusOf = (m: ModelPoolRow): keyof typeof STATUS_LABEL =>
    isUntested(m) ? "untested" : isOn(m) ? "enabled" : "disabled";

  const tagsOf = React.useCallback((m: ModelPoolRow): readonly CatalogTag[] => [
    tagOf(m.kind, t(KIND_LABEL[m.kind])),
    tagOf(STATUS_TAG[isUntested(m) ? "untested" : isOn(m) ? "enabled" : "disabled"], t(STATUS_LABEL[isUntested(m) ? "untested" : isOn(m) ? "enabled" : "disabled"])),
    ...(m.kind === "self-hosted" ? [{ key: "confidential-ok", label: t("model.confidential") }] : []),
    ...m.capabilityTags.map((t) => tagOf(t)),
  ], [isUntested, isOn, t]);
  const searchTextOf = React.useCallback(
    (m: ModelPoolRow) => [m.displayName, m.modelId, m.vendor, ...m.capabilityTags].join(" "),
    [],
  );

  function renderStatusBadge(m: ModelPoolRow) {
    const s = statusOf(m);
    return (
      <Badge tone={s === "untested" ? "warning" : s === "enabled" ? "primary" : "outline"} data-testid={`admin-model-status-${m.modelId}`}>
        {t(STATUS_LABEL[s])}
      </Badge>
    );
  }

  function renderSwitch(m: ModelPoolRow) {
    const on = isOn(m);
    if (isUntested(m)) {
      return (
        <Button size="xs" variant="outline" onClick={() => setTestOf(m)} data-testid={`admin-model-test-${m.modelId}`}>
          <FlaskConical aria-hidden className="h-3 w-3" />
          {t("model.assess")}
        </Button>
      );
    }
    return (
      <label className="flex items-center gap-1.5">
        <span className={cn("text-11", on ? "text-background-foreground" : "text-muted-foreground")}>
          {t(on ? "model.enabled" : "model.disabled")}
        </span>
        <Toggle
          checked={on}
          onCheckedChange={(v) => (on && !v ? setDisableOf(m) : setEnabled((p) => ({ ...p, [m.modelId]: v })))}
          label={t("model.toggle", { name: m.displayName })}
          data-testid={`admin-model-toggle-${m.modelId}`}
        />
      </label>
    );
  }

  return (
    <AdminScreen
      state={state}
      hideOrgIdentity
      moduleLabel={t("model.module")}
      title={t("model.title")}
      noticeOverride={<ModelScreenNotice />}
      intro={t("model.intro")}
      emptyHint={t("model.emptyHint")}
      errors={{ endpoint: t("model.endpointError") }}
      depFailure={t("model.dependency")}
      denialReason={t("model.denial")}
      successMessage={t("model.success")}
    >
      <Tabs value={catalogTab} onValueChange={setCatalogTab}>
        <TabsList aria-label={t("model.scope")}>
          <TabsTrigger value="organization">{t("model.organization")}</TabsTrigger>
          <TabsTrigger value="bailian">{t("model.public")}</TabsTrigger>
        </TabsList>
        <TabsContent value="organization">
          {session?.currentOrgId ? <OrgCoreModelPanel key={session.currentOrgId} orgId={session.currentOrgId} /> : null}
      <EntityCatalog<ModelPoolRow>
        prefix="admin-model"
        title={t("model.pool")}
        status={
          pool.status === "ready"
            ? { kind: "ready" }
            : pool.status === "error"
              ? { kind: "error", message: t("model.readError", { reason: failureText(pool.message, t) }) }
              : { kind: "loading" }
        }
        rows={rows}
        keyOf={(m) => m.modelId}
        searchTextOf={searchTextOf}
        tagsOf={tagsOf}
        cardTestId={(m) => `admin-model-card-${m.modelId}`}
        headerActions={
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)} data-testid="admin-model-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            {t("model.add")}
          </Button>
        }
        onRefresh={() => void refresh()}
        emptyState={t("model.empty")}
        searchPlaceholder={t("model.search")}
        renderCard={(m) => ({
          title: <span className="font-mono">{m.displayName}</span>,
          subtitle: `${t(KIND_LABEL[m.kind])} · ${m.vendor} · ${tagsLabel(m)}`,
          badges: (
            <>
              {renderStatusBadge(m)}
              {m.kind === "self-hosted" && (
                <Badge tone="ai" data-testid={`admin-model-confidential-${m.modelId}`}>
                  <ShieldCheck aria-hidden className="h-3 w-3" />
                  {t("model.confidential")}
                </Badge>
              )}
            </>
          ),
          children: (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-11 text-muted-foreground">
              <span>{t("model.context", { value: contextLabel(m) })}</span>
              <span data-testid={`admin-model-price-${m.modelId}`}>{priceLabel(m, t)}</span>
              <span className="col-span-2" data-testid={`admin-model-key-status-${m.modelId}`}>
                {t("model.key")} <span className="text-background-foreground">{t(hasApiKeyConfigured(m) ? "model.configured" : "model.notConfigured")}</span>
              </span>
            </div>
          ),
          actions: <CardActions className="justify-end">{renderSwitch(m)}</CardActions>,
        })}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        detailTitle={(m) => m.displayName}
        detailSubtitle={(m) => `${t(KIND_LABEL[m.kind])} · ${m.vendor} · ${m.modelId}`}
        renderDetail={(m) => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {renderStatusBadge(m)}
              {m.kind === "self-hosted" && (
                <Badge tone="ai">
                  <ShieldCheck aria-hidden className="h-3 w-3" />
                  {t("model.confidential")}
                </Badge>
              )}
            </div>
            <div className="flex flex-col divide-y divide-border-subtle">
              <KV k={t("model.id")} v={<span className="font-mono text-11">{m.modelId}</span>} />
              <KV k={t("model.kind")} v={t(KIND_LABEL[m.kind])} />
              <KV k={t("model.vendor")} v={m.vendor} />
              <KV k={t("model.tags")} v={tagsLabel(m)} />
              <KV k={t("model.contextWindow")} v={contextLabel(m)} />
              <KV k={t("model.price")} v={priceLabel(m, t)} />
              <KV k={t("model.key")} v={t(hasApiKeyConfigured(m) ? "model.configured" : "model.notConfigured")} />
              <KV k={t("model.compliance")} v={m.complianceAttrs.length > 0 ? m.complianceAttrs.join("、") : t("model.none")} />
              <KV k={t("model.confidentialMaterials")} v={t(m.kind === "self-hosted" ? "model.confidentialAllowed" : "model.confidentialDenied")} />
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3">
              <span className="text-10 uppercase tracking-wide text-muted-foreground">{t("model.localOperations")}</span>
              <div className="flex flex-wrap items-center gap-3">
                {renderSwitch(m)}
                {!isUntested(m) && isOn(m) && (
                  <Button size="xs" variant="outline" onClick={() => setDisableOf(m)} data-testid={`admin-model-detail-disable-${m.modelId}`}>
                    <Ban aria-hidden className="h-3 w-3" />
                    {t("model.disable")}
                  </Button>
                )}
              </div>
              <p className="text-10 text-muted-foreground">
                {t("model.routesMissing")}
              </p>
            </div>
          </div>
        )}
      />

        </TabsContent>
        <TabsContent value="bailian">
          <BailianModelCatalog onViewOrganizationModels={() => setCatalogTab("organization")} />
        </TabsContent>
      </Tabs>

      {/* 接入模型 —— #548：唯一真实写路径，打 POST /models */}
      {addOpen && (
        <AddModelDrawer
          onClose={() => setAddOpen(false)}
          onRegistered={(res) => {
            setAddOpen(false);
            setToast({ key: "model.registered", name: res.displayName, status: res.status });
            // #1381：列表现在读真数据了，刷新就能看到刚接入的这条。
            void refresh();
          }}
        />
      )}

      {/* 五项测试判读 */}
      {testOf && (
        <TestModal
          model={testOf}
          onClose={() => setTestOf(null)}
          onPass={() => {
            setTested((s) => new Set(s).add(testOf.modelId));
            setEnabled((p) => ({ ...p, [testOf.modelId]: true }));
            setToast({ key: "model.assessed", name: testOf.displayName });
            setTestOf(null);
          }}
        />
      )}

      {/* 停用二选一确认（D-U5）*/}
      {disableOf && (
        <DisableDialog
          testid="admin-model-disable-dialog"
          verb={t("model.disable")}
          capabilityName={disableOf.displayName}
          // `inFlightCalls` 来自 `listModelReferences`，那条路由还没有 controller 接线
          // （`model.controller.ts` 文件头），本地没有真实数字可读——诚实显示 0。
          inFlight={0}
          interruptEffect={t("model.interruptEffect")}
          drainEffect={t("model.drainEffect")}
          onCancel={() => setDisableOf(null)}
          onConfirm={(mode: DisableMode) => {
            setEnabled((prev) => ({ ...prev, [disableOf.modelId]: false }));
            setToast({ key: mode === "interrupt" ? "model.disabledToast" : "model.drainedToast", name: disableOf.displayName });
            setDisableOf(null);
          }}
        />
      )}

      <Toast message={toast ? t(toast.key, { ...toast }) : null} testid="admin-model-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}

/**
 * #1381 起本屏的混合态说明——列表/接入是真数据，启用/停用/测试判读仍是本地演示。
 * 视觉上介于 `SampleConfigNotice`（纯真实）与 `NoBackendNotice`（纯零后端）之间，
 * 按 `admin-screen.tsx` 的注释「按 tab/按区块说实话，比笼统覆盖诚实」新写一条。
 */
function ModelScreenNotice() {
  const { t } = useI18n();
  return (
    <div
      data-testid="admin-model-mixed-notice"
      className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-panel p-3"
    >
      <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-12 font-medium">{t("model.noticeTitle")}</span>
          <Badge tone="outline">{t("model.noticeBadge")}</Badge>
        </div>
        <p className="text-11 text-muted-foreground">
          {t("model.noticeBefore")}
          <strong className="font-medium text-background-foreground">{t("model.noticeStrong")}</strong>
          {t("model.noticeAfter")}
        </p>
      </div>
    </div>
  );
}

type RegisterResult = { readonly displayName: string; readonly status: string };

/**
 * #548 起 —— 真实的「接入模型」表单。提交打真实 `POST /models`，凭据只在这一次进入系统
 * （契约的 `out` 里没有它，服务端也不回显）。#1381 起提交成功后父组件会刷新真实列表。
 */
function AddModelDrawer({
  onClose,
  onRegistered,
}: {
  onClose: () => void;
  onRegistered: (result: RegisterResult) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = React.useState<RegisterModelFormInput["kind"]>("closed-api");
  const [vendor, setVendor] = React.useState("");
  const [name, setName] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [contextWindow, setContextWindow] = React.useState("128000");
  const [unitPrice, setUnitPrice] = React.useState("0");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<{ readonly reason: string | null } | null>(null);

  const contextWindowNum = Number(contextWindow);
  const unitPriceNum = Number(unitPrice);
  const canSubmit =
    name.trim().length > 0 &&
    vendor.trim().length > 0 &&
    Number.isInteger(contextWindowNum) &&
    contextWindowNum > 0 &&
    Number.isFinite(unitPriceNum) &&
    unitPriceNum >= 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const form: RegisterModelFormInput = {
      kind,
      vendor: vendor.trim(),
      displayName: name.trim(),
      capabilityTags: [...commitDraft(tags, tagDraft, { maxTags: 10, maxTagLength: 20 })],
      contextWindow: contextWindowNum,
      unitPrice: unitPriceNum,
      apiKey: apiKey.trim().length > 0 ? apiKey.trim() : null,
      endpoint: endpoint.trim().length > 0 ? endpoint.trim() : null,
    };
    try {
      const result = await registerModelFromForm(form);
      onRegistered({ displayName: form.displayName, status: result.status });
    } catch (e) {
      const message =
        e instanceof ApiError
          ? `${e.reasonCode ?? `HTTP ${e.status}`}`
          : e instanceof Error
            ? e.message
            : null;
      setError({ reason: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminDrawer
      testid="admin-model-panel"
      title={t("model.add")}
      subtitle={t("model.registerSubtitle")}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting} data-testid="admin-model-panel-cancel">
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
            data-testid="admin-model-panel-save"
          >
            {t(submitting ? "model.registering" : "model.register")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5" data-testid="admin-model-field-kind">
          <Button
            size="xs"
            variant={kind === "closed-api" ? "primary" : "outline"}
            onClick={() => setKind("closed-api")}
            disabled={submitting}
            data-testid="admin-model-field-kind-closed-api"
          >
            {t("model.closed")}
          </Button>
          <Button
            size="xs"
            variant={kind === "self-hosted" ? "primary" : "outline"}
            onClick={() => setKind("self-hosted")}
            disabled={submitting}
            data-testid="admin-model-field-kind-self-hosted"
          >
            {t("model.hosted")}
          </Button>
        </div>
        <Field
          id="admin-model-field-name"
          label={t("model.name")}
          placeholder={t("model.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={submitting}
        />
        <Field
          id="admin-model-field-vendor"
          label={t("model.vendor")}
          placeholder={t("model.vendorPlaceholder")}
          value={vendor}
          onChange={(e) => setVendor(e.currentTarget.value)}
          disabled={submitting}
        />
        <Field
          id="admin-model-field-endpoint"
          label={t("model.endpoint")}
          placeholder={t("model.endpointPlaceholder")}
          value={endpoint}
          onChange={(e) => setEndpoint(e.currentTarget.value)}
          disabled={submitting}
        />
        <Field
          id="admin-model-field-api-key"
          label={t("model.apiKey")}
          type="password"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          disabled={submitting}
          autoComplete="off"
        />
        <TagField
          label={t("model.tags")}
          value={tags}
          onChange={setTags}
          draft={tagDraft}
          onDraftChange={setTagDraft}
          maxTags={10}
          maxTagLength={20}
          disabled={submitting}
          testIdPrefix="admin-model-tag"
          emptyHint={t("model.tagHint")}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="admin-model-field-context"
            label={t("model.contextInput")}
            type="number"
            min={1}
            value={contextWindow}
            onChange={(e) => setContextWindow(e.currentTarget.value)}
            disabled={submitting}
          />
          <Field
            id="admin-model-field-price"
            label={t("model.priceInput")}
            type="number"
            min={0}
            step="0.001"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.currentTarget.value)}
            disabled={submitting}
          />
        </div>
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-11">{t("model.confidentialWarning")}</p>
        </div>
        {error && (
          <p className="text-11 text-destructive" data-testid="admin-model-panel-error">
            {t("model.registrationFailed", { reason: failureText(error.reason, t) })}
          </p>
        )}
      </div>
    </AdminDrawer>
  );
}

function TestModal({ model, onClose, onPass }: { model: ModelPoolRow; onClose: () => void; onPass: () => void }) {
  const { t } = useI18n();
  const [passed, setPassed] = React.useState<boolean[]>(() => ADMISSION_TESTS.map(() => false));
  const allPassed = passed.every(Boolean);
  return (
    <AdminModal
      testid="admin-model-test-dialog"
      width="lg"
      title={t("model.assessTitle", { name: model.displayName })}
      subtitle={t("model.assessSubtitle")}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="admin-model-test-cancel">{t("common.cancel")}</Button>
          <Button size="sm" variant="primary" disabled={!allPassed} onClick={onPass} data-testid="admin-model-test-submit" title={allPassed ? undefined : t("model.assessGuard")}>
            {t("model.assessSubmit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="admin-model-test-items">
        {ADMISSION_TESTS.map((testKey, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="admin-model-test-item">
            <Checkbox
              checked={passed[i]}
              // ⚠ 先把 `checked` 读出来再进 updater：React 事件对象在 updater 里跑时
              //   `currentTarget` 已经是 null（合成事件池已回收），从前这里直接读会炸。
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setPassed((p) => p.map((v, j) => (j === i ? checked : v)));
              }}
              label={`${i + 1}. ${t(testKey)}`}
              data-testid={`admin-model-test-check-${i + 1}`}
            />
            {passed[i] && <Check aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-success" />}
          </div>
        ))}
      </div>
    </AdminModal>
  );
}
