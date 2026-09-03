"use client";
import * as React from "react";
import { Plus, ShieldCheck, FlaskConical, Check, Ban } from "lucide-react";
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
const STATUS_LABEL = { untested: "待测试", enabled: "已启用", disabled: "未启用" } as const;
const KIND_LABEL: Record<ModelPoolRow["kind"], string> = { "closed-api": "闭源 API", "self-hosted": "开源自托管" };

function tagsLabel(row: ModelPoolRow): string {
  return row.capabilityTags.length > 0 ? row.capabilityTags.join(" · ") : "—";
}
function contextLabel(row: ModelPoolRow): string {
  return `${row.contextWindow.toLocaleString("zh-CN")} tokens`;
}
function priceLabel(row: ModelPoolRow): string {
  return row.unitPrice > 0 ? `￥${row.unitPrice} / 1k` : "未定价";
}

/** phase-1 的五项准入测试（人工判读并记录，不做自动化）。 */
const ADMISSION_TESTS = [
  "连通性与稳定性：端点 3 次往返均成功、延迟可接受",
  "中文长文理解：给定 20 页材料能准确摘要不丢关键信息",
  "工具调用：能按 schema 正确发起并消费工具返回",
  "指令遵循与格式：输出严格符合约定 JSON schema",
  "安全与拒答：对越权/出域请求正确拒绝并说明",
];

type PoolState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly rows: readonly ModelPoolRow[] };

export function ModelScreen({ state }: { state: UiState }) {
  const [pool, setPool] = React.useState<PoolState>({ status: "loading" });
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  const [tested, setTested] = React.useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [testOf, setTestOf] = React.useState<ModelPoolRow | null>(null);
  const [disableOf, setDisableOf] = React.useState<ModelPoolRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
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
    tagOf(m.kind, KIND_LABEL[m.kind]),
    tagOf(STATUS_LABEL[isUntested(m) ? "untested" : isOn(m) ? "enabled" : "disabled"]),
    ...(m.kind === "self-hosted" ? [{ key: "confidential-ok", label: "可承接机密" }] : []),
    ...m.capabilityTags.map((t) => tagOf(t)),
  ], [isUntested, isOn]);
  const searchTextOf = React.useCallback(
    (m: ModelPoolRow) => [m.displayName, m.modelId, m.vendor, ...m.capabilityTags].join(" "),
    [],
  );

  function renderStatusBadge(m: ModelPoolRow) {
    const s = statusOf(m);
    return (
      <Badge tone={s === "untested" ? "warning" : s === "enabled" ? "primary" : "outline"} data-testid={`admin-model-status-${m.modelId}`}>
        {STATUS_LABEL[s]}
      </Badge>
    );
  }

  function renderSwitch(m: ModelPoolRow) {
    const on = isOn(m);
    if (isUntested(m)) {
      return (
        <Button size="xs" variant="outline" onClick={() => setTestOf(m)} data-testid={`admin-model-test-${m.modelId}`}>
          <FlaskConical aria-hidden className="h-3 w-3" />
          录入测试判读
        </Button>
      );
    }
    return (
      <label className="flex items-center gap-1.5">
        <span className={cn("text-11", on ? "text-background-foreground" : "text-muted-foreground")}>
          {on ? "已启用" : "未启用"}
        </span>
        <Toggle
          checked={on}
          onCheckedChange={(v) => (on && !v ? setDisableOf(m) : setEnabled((p) => ({ ...p, [m.modelId]: v })))}
          label={`启用/停用 ${m.displayName}`}
          data-testid={`admin-model-toggle-${m.modelId}`}
        />
      </label>
    );
  }

  return (
    <AdminScreen
      state={state}
      hideOrgIdentity
      moduleLabel="模型"
      title="模型管理"
      noticeOverride={<ModelScreenNotice />}
      intro="只有测试通过的模型才会出现在 agent 与 skill 的模型选择里。phase-1 的五项准入测试改为人工判读并记录（不做自动化）。客户机密材料只走开源自托管。"
      emptyHint="模型池是空的，先接入一个模型"
      errors={{ endpoint: "接入失败：连通性测试超时，端点 3 次未响应；模型保持待测试，不进入可选池" }}
      depFailure="模型测试与调用依赖推理网关；网关不可达，无法确认模型状态与单价。"
      denialReason="模型凭据由管理员保管、成员看不到；模型管理仅组织管理员可进入。"
      successMessage="模型『qwen3-72b』五项测试判读通过，已启用并纳入 Ledger 的可选范围"
    >
      <EntityCatalog<ModelPoolRow>
        prefix="admin-model"
        title="模型池"
        status={
          pool.status === "ready"
            ? { kind: "ready" }
            : pool.status === "error"
              ? { kind: "error", message: `读不到模型池（${pool.message}）。这里不退回演示数据——假的模型清单会被当成真实可用模型。` }
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
            接入模型
          </Button>
        }
        onRefresh={() => void refresh()}
        emptyState="模型池是空的——这是本组织在服务端的真实结果。用「接入模型」接一个。"
        searchPlaceholder="按模型名、供应商或能力标签搜索…"
        renderCard={(m) => (
          <CardContent className="flex h-full flex-col gap-2 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-12 font-medium">{m.displayName}</span>
              {renderStatusBadge(m)}
              {m.kind === "self-hosted" && (
                <Badge tone="ai" data-testid={`admin-model-confidential-${m.modelId}`}>
                  <ShieldCheck aria-hidden className="h-3 w-3" />
                  可承接机密
                </Badge>
              )}
            </div>
            <span className="text-11 text-muted-foreground">{KIND_LABEL[m.kind]} · {m.vendor} · {tagsLabel(m)}</span>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-11 text-muted-foreground">
              <span>上下文 {contextLabel(m)}</span>
              <span data-testid={`admin-model-price-${m.modelId}`}>{priceLabel(m)}</span>
              <span className="col-span-2" data-testid={`admin-model-key-status-${m.modelId}`}>
                凭据 <span className="text-background-foreground">{hasApiKeyConfigured(m) ? "已配置" : "未配置"}</span>
              </span>
            </div>
            <CardActions className="mt-auto justify-end pt-1">{renderSwitch(m)}</CardActions>
          </CardContent>
        )}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        detailTitle={(m) => m.displayName}
        detailSubtitle={(m) => `${KIND_LABEL[m.kind]} · ${m.vendor} · ${m.modelId}`}
        renderDetail={(m) => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {renderStatusBadge(m)}
              {m.kind === "self-hosted" && (
                <Badge tone="ai">
                  <ShieldCheck aria-hidden className="h-3 w-3" />
                  可承接机密
                </Badge>
              )}
            </div>
            <div className="flex flex-col divide-y divide-border-subtle">
              <KV k="模型 ID" v={<span className="font-mono text-11">{m.modelId}</span>} />
              <KV k="种类" v={KIND_LABEL[m.kind]} />
              <KV k="供应商" v={m.vendor} />
              <KV k="能力标签" v={tagsLabel(m)} />
              <KV k="上下文窗口" v={contextLabel(m)} />
              <KV k="单价" v={priceLabel(m)} />
              <KV k="凭据" v={hasApiKeyConfigured(m) ? "已配置" : "未配置"} />
              <KV k="合规属性" v={m.complianceAttrs.length > 0 ? m.complianceAttrs.join("、") : "无"} />
              <KV k="机密材料" v={m.kind === "self-hosted" ? "可承接（权重跑在自己的 GPU 上）" : "不路由（闭源 API 一律不承接）"} />
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3">
              <span className="text-10 uppercase tracking-wide text-muted-foreground">状态操作（本地演示，尚未回写后端）</span>
              <div className="flex flex-wrap items-center gap-3">
                {renderSwitch(m)}
                {!isUntested(m) && isOn(m) && (
                  <Button size="xs" variant="outline" onClick={() => setDisableOf(m)} data-testid={`admin-model-detail-disable-${m.modelId}`}>
                    <Ban aria-hidden className="h-3 w-3" />
                    停用
                  </Button>
                )}
              </div>
              <p className="text-10 text-muted-foreground">
                契约的 `enableModel` / `disableModel` / `recordAdmissionTest` 还没有 controller 路由，
                这里的改动刷新即丢。契约里也没有「删除模型」——停用是唯一的下线方式。
              </p>
            </div>
          </div>
        )}
      />

      {/* 接入模型 —— #548：唯一真实写路径，打 POST /models */}
      {addOpen && (
        <AddModelDrawer
          onClose={() => setAddOpen(false)}
          onRegistered={(res) => {
            setAddOpen(false);
            setToast(`已接入模型「${res.displayName}」（${res.status}）。`);
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
            setToast(`模型「${testOf.displayName}」五项测试判读通过，已启用并纳入可选范围（本地演示，尚未回写后端——见页头说明）`);
            setTestOf(null);
          }}
        />
      )}

      {/* 停用二选一确认（D-U5）*/}
      {disableOf && (
        <DisableDialog
          testid="admin-model-disable-dialog"
          verb="停用"
          capabilityName={disableOf.displayName}
          // `inFlightCalls` 来自 `listModelReferences`，那条路由还没有 controller 接线
          // （`model.controller.ts` 文件头），本地没有真实数字可读——诚实显示 0。
          inFlight={0}
          interruptEffect="正经此模型推理的调用会被立即中断，返回「该能力已被管理员停用」；调用方需改选其它已启用模型。"
          drainEffect="已发起的推理跑完当前一轮，此刻起路由不再选用此模型。"
          onCancel={() => setDisableOf(null)}
          onConfirm={(mode: DisableMode) => {
            setEnabled((prev) => ({ ...prev, [disableOf.modelId]: false }));
            setToast(
              mode === "interrupt"
                ? `已停用模型「${disableOf.displayName}」（本地演示，尚未回写后端）`
                : `已停用模型「${disableOf.displayName}」；新调用即刻被拒（本地演示，尚未回写后端）`,
            );
            setDisableOf(null);
          }}
        />
      )}

      <Toast message={toast} testid="admin-model-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}

/**
 * #1381 起本屏的混合态说明——列表/接入是真数据，启用/停用/测试判读仍是本地演示。
 * 视觉上介于 `SampleConfigNotice`（纯真实）与 `NoBackendNotice`（纯零后端）之间，
 * 按 `admin-screen.tsx` 的注释「按 tab/按区块说实话，比笼统覆盖诚实」新写一条。
 */
function ModelScreenNotice() {
  return (
    <div
      data-testid="admin-model-mixed-notice"
      className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-panel p-3"
    >
      <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-12 font-medium">模型清单为真实组织配置</span>
          <Badge tone="outline">GET /models · 真数据</Badge>
        </div>
        <p className="text-11 text-muted-foreground">
          下方列表与「接入模型」都打真实后端——这个组织真的接入了什么模型，就显示什么。
          <strong className="font-medium text-background-foreground">启用/停用开关与五项测试判读仍是本地演示</strong>
          （对应契约操作还没有接 controller 路由）：点了会有提示，但不会持久化，刷新页面或
          另一位管理员看到的状态不会变。
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
  const [kind, setKind] = React.useState<RegisterModelFormInput["kind"]>("closed-api");
  const [vendor, setVendor] = React.useState("");
  const [name, setName] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [contextWindow, setContextWindow] = React.useState("128000");
  const [unitPrice, setUnitPrice] = React.useState("0");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
      capabilityTags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
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
            : "未知错误";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminDrawer
      testid="admin-model-panel"
      title="接入模型"
      subtitle="接入后置为待测试，通过五项判读才进可选池。凭据只在此刻进入系统，之后任何接口都不会回显。"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting} data-testid="admin-model-panel-cancel">
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
            data-testid="admin-model-panel-save"
          >
            {submitting ? "接入中…" : "接入（置待测试）"}
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
            闭源 API
          </Button>
          <Button
            size="xs"
            variant={kind === "self-hosted" ? "primary" : "outline"}
            onClick={() => setKind("self-hosted")}
            disabled={submitting}
            data-testid="admin-model-field-kind-self-hosted"
          >
            开源自托管
          </Button>
        </div>
        <Field
          id="admin-model-field-name"
          label="模型名"
          placeholder="如 qwen3.7-plus"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={submitting}
        />
        <Field
          id="admin-model-field-vendor"
          label="供应商"
          placeholder="如 阿里云百炼 / 自托管 · H100×4"
          value={vendor}
          onChange={(e) => setVendor(e.currentTarget.value)}
          disabled={submitting}
        />
        <Field
          id="admin-model-field-endpoint"
          label="端点 / 权重路径"
          placeholder="https://… 或 自托管 · H100×4"
          value={endpoint}
          onChange={(e) => setEndpoint(e.currentTarget.value)}
          disabled={submitting}
        />
        <Field
          id="admin-model-field-api-key"
          label="API Key（留空表示暂不配置）"
          type="password"
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          disabled={submitting}
          autoComplete="off"
        />
        <Field
          id="admin-model-field-tags"
          label="能力标签（逗号分隔）"
          placeholder="如 推理, 工具, 长文"
          value={tags}
          onChange={(e) => setTags(e.currentTarget.value)}
          disabled={submitting}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="admin-model-field-context"
            label="上下文窗口（tokens）"
            type="number"
            min={1}
            value={contextWindow}
            onChange={(e) => setContextWindow(e.currentTarget.value)}
            disabled={submitting}
          />
          <Field
            id="admin-model-field-price"
            label="单价（￥ / 1k tokens，未知填 0）"
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
          <p className="text-11">只有自托管模型可承接客户机密材料；闭源 API 一律不路由机密。</p>
        </div>
        {error && (
          <p className="text-11 text-destructive" data-testid="admin-model-panel-error">
            接入失败：{error}
          </p>
        )}
      </div>
    </AdminDrawer>
  );
}

function TestModal({ model, onClose, onPass }: { model: ModelPoolRow; onClose: () => void; onPass: () => void }) {
  const [passed, setPassed] = React.useState<boolean[]>(() => ADMISSION_TESTS.map(() => false));
  const allPassed = passed.every(Boolean);
  return (
    <AdminModal
      testid="admin-model-test-dialog"
      width="lg"
      title={`录入测试判读 · ${model.displayName}`}
      subtitle="phase-1 人工判读并记录（不自动化）。五项全部判为通过才可启用。"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="admin-model-test-cancel">取消</Button>
          <Button size="sm" variant="primary" disabled={!allPassed} onClick={onPass} data-testid="admin-model-test-submit" title={allPassed ? undefined : "五项全部判为通过后才可启用"}>
            判读通过并启用
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="admin-model-test-items">
        {ADMISSION_TESTS.map((t, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="admin-model-test-item">
            <Checkbox
              checked={passed[i]}
              // ⚠ 先把 `checked` 读出来再进 updater：React 事件对象在 updater 里跑时
              //   `currentTarget` 已经是 null（合成事件池已回收），从前这里直接读会炸。
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setPassed((p) => p.map((v, j) => (j === i ? checked : v)));
              }}
              label={`${i + 1}. ${t}`}
              data-testid={`admin-model-test-check-${i + 1}`}
            />
            {passed[i] && <Check aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-success" />}
          </div>
        ))}
      </div>
    </AdminModal>
  );
}
