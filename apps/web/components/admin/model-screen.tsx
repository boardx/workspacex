"use client";
import * as React from "react";
import Link from "next/link";
import { Plus, Cpu, ServerCog, ShieldCheck, FlaskConical, Check, ArrowUpRight, LayoutGrid, LayoutList } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { AdminDrawer, AdminModal, Toast, Field } from "./panel";
import { DisableDialog, type DisableMode } from "./disable-dialog";
import { Card, CardContent } from "@/components/ui/card";
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
 * 不再是 `lib/mock/admin.ts` 的 18 台示例模型；`lint-no-backend-badge` 按「本文件是否
 * import 了 `@/lib/live-*`」判定，本屏直接 import，不需要 `backed-by-children` 标记。
 *
 * ⚠ 这屏仍是**混合态**，不是「整屏已完成」：`enableModel` / `disableModel` /
 * `recordAdmissionTest` 这三条契约操作还没有 controller 路由（`model.controller.ts`
 * 文件头逐条列了缺口），所以下面的启用开关与测试判读 modal 依旧只改本地 React state——
 * 点了会有 toast，但刷新页面或另一个管理员看到的状态不会变。真实的只有：接入（`POST
 * /models`）与列表（`GET /models`，#1381）。
 */

/** 三态展示标签，独立于 `lib/mock/admin.ts` 的 `MODEL_STATUS_VIEW_LABEL`——那份是 mock 专用的英文键位映射，这里直接对着契约的中文 `ModelStatus` 渲染，不经过第二套键位。 */
const STATUS_LABEL = { untested: "待测试", enabled: "已启用", disabled: "未启用" } as const;

type KindFilter = "all" | "untested" | "closed-api" | "self-hosted";
const KIND_FILTERS: readonly { key: KindFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "untested", label: "待测试" },
  { key: "closed-api", label: "闭源 API" },
  { key: "self-hosted", label: "开源自托管" },
];

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

/**
 * 后台统一改版（人类原话：「左边保留后台菜单，右边卡片展示 entity 列表，卡片可切换列表」）——
 * 「模型」屏这一份。默认卡片视图，可切回现有的列表实现（不重写，原样复用 `ModelListRow`）。
 * 与其它后台屏（Agent 目录等，并行 agent 同批改造）保持结构一致的 testid 与切换交互形状，
 * 便于后续把这份「本地写一份」的切换按钮收敛进共享组件。
 */
type ModelView = "card" | "list";

export function ModelScreen({ state }: { state: UiState }) {
  const [filter, setFilter] = React.useState<KindFilter>("all");
  const [view, setView] = React.useState<ModelView>("card");
  const [pool, setPool] = React.useState<readonly ModelPoolRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  const [tested, setTested] = React.useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = React.useState(false);
  const [testOf, setTestOf] = React.useState<ModelPoolRow | null>(null);
  const [disableOf, setDisableOf] = React.useState<ModelPoolRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const list = await listModels();
      setPool(list);
      setLoadError(null);
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
      setLoadError(e instanceof ApiError ? (e.reasonCode ?? `http_${e.status}`) : String(e));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const allRows = pool ?? [];
  const rows = allRows.filter((m) => {
    if (filter === "all") return true;
    if (filter === "untested") return m.status === "待测试" && !tested.has(m.modelId);
    return m.kind === filter;
  });
  const hosted = rows.filter((m) => m.kind === "closed-api");
  const selfHosted = rows.filter((m) => m.kind === "self-hosted");

  return (
    <AdminScreen
      state={state}
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
      <div className="flex flex-col gap-4">
        {/*
          2026-08-11（人类直接裁决，真合并）：原「智能体运行时」的机密路由批准卡子屏
          （`agent-runtime/routing-screen.tsx`）折入这里——后台左栏不再有独立的
          「智能体运行时」入口，模型路由相关的运行时配置在模型屏里就能找到。
          见 `lib/navigation.ts` `ADMIN_SECOND_LEVEL` 里 `agent-runtime` 项的注释。
        */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              机密路由批准卡的运行时预览（客户机密材料强制走自托管模型，原「智能体运行时」子屏，已并入此处）。
            </p>
            <Link
              href="/preview/agent-runtime?screen=routing"
              data-testid="admin-model-open-runtime-routing"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
            >
              打开机密路由批准卡预览
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {loadError && (
          <p className="text-12 text-destructive" data-testid="admin-model-load-error">
            读不到模型池（{loadError}）。这里不退回演示数据——假的模型清单会被当成真实可用模型。
          </p>
        )}

        {/* 筛选（可选范围过滤的入口） + 接入 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" data-testid="admin-model-filters">
            {KIND_FILTERS.map((f) => {
              const count =
                f.key === "all" ? allRows.length
                : f.key === "untested" ? allRows.filter((m) => m.status === "待测试" && !tested.has(m.modelId)).length
                : allRows.filter((m) => m.kind === f.key).length;
              return (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? "primary" : "ghost"}
                  onClick={() => setFilter(f.key)}
                  data-testid={`admin-model-filter-${f.key}`}
                >
                  {f.label} {count}
                </Button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
              data-testid="admin-model-view-toggle"
            >
              <Button
                size="xs"
                variant={view === "card" ? "primary" : "ghost"}
                aria-pressed={view === "card"}
                aria-label="卡片视图"
                onClick={() => setView("card")}
                data-testid="admin-model-view-toggle-card"
              >
                <LayoutGrid aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="xs"
                variant={view === "list" ? "primary" : "ghost"}
                aria-pressed={view === "list"}
                aria-label="列表视图"
                onClick={() => setView("list")}
                data-testid="admin-model-view-toggle-list"
              >
                <LayoutList aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)} data-testid="admin-model-add">
              <Plus aria-hidden className="h-3.5 w-3.5" />
              接入模型
            </Button>
          </div>
        </div>

        <div data-testid="admin-model-view-container" data-view={view}>
          {/* 闭源 API 组 */}
          {hosted.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="admin-model-group-hosted">
              <div className="flex items-center gap-1.5">
                <Cpu aria-hidden className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-13 font-semibold">闭源 API</h2>
                <span className="text-11 text-muted-foreground">· 凭据由管理员保管，成员看不到</span>
              </div>
              <ModelGroup
                groupKey="hosted"
                view={view}
                rows={hosted}
                tested={tested}
                enabled={enabled}
                setEnabled={setEnabled}
                setDisableOf={setDisableOf}
                setTestOf={setTestOf}
              />
            </section>
          )}

          {/* 开源自托管组 */}
          {selfHosted.length > 0 && (
            <section className="mt-4 flex flex-col gap-2" data-testid="admin-model-group-self">
              <div className="flex items-center gap-1.5">
                <ServerCog aria-hidden className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-13 font-semibold">开源自托管</h2>
                <span className="text-11 text-muted-foreground">· 权重跑在自己的 GPU 上，客户机密材料只走这一类</span>
              </div>
              <ModelGroup
                groupKey="self"
                view={view}
                rows={selfHosted}
                tested={tested}
                enabled={enabled}
                setEnabled={setEnabled}
                setDisableOf={setDisableOf}
                setTestOf={setTestOf}
              />
            </section>
          )}
        </div>
      </div>

      {/* 接入模型 —— #548：唯一真实写路径，打 POST /models */}
      {addOpen && (
        <AddModelDrawer
          onClose={() => setAddOpen(false)}
          onRegistered={(res) => {
            setAddOpen(false);
            setToast(`已接入模型「${res.displayName}」（${res.status}）。`);
            // #1381：列表现在读真数据了，刷新就能看到刚接入的这条——不再需要那句
            // 「下方列表仍是示例组织配置」的道歉。
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
          // （`model.controller.ts` 文件头），本地没有真实数字可读——诚实显示 0，
          // 不借用 mock 的假计数表。
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
 * 按 `admin-screen.tsx` 的注释「按 tab/按区块说实话，比笼统覆盖诚实」新写一条，
 * 不复用那两条——它们各自的整句陈述对本屏都不成立。
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
              onChange={(e) => setPassed((p) => p.map((v, j) => (j === i ? e.currentTarget.checked : v)))}
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

/** 分组内的行渲染，按 `view` 切换卡片/列表，两种视图共享同一份状态与回调。 */
function ModelGroup({
  groupKey,
  view,
  rows,
  tested,
  enabled,
  setEnabled,
  setDisableOf,
  setTestOf,
}: {
  /** "hosted" / "self"——两个分组各出一份 card-grid / list 容器，testid 靠这个后缀避免全局重名。 */
  groupKey: "hosted" | "self";
  view: ModelView;
  rows: readonly ModelPoolRow[];
  tested: Set<string>;
  enabled: Record<string, boolean>;
  setEnabled: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setDisableOf: (m: ModelPoolRow) => void;
  setTestOf: (m: ModelPoolRow) => void;
}) {
  if (view === "card") {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid={`admin-model-card-grid-${groupKey}`}
      >
        {rows.map((m) => (
          <ModelCard
            key={m.modelId}
            m={m}
            untested={m.status === "待测试" && !tested.has(m.modelId)}
            on={enabled[m.modelId] ?? false}
            setOn={(v) => setEnabled((p) => ({ ...p, [m.modelId]: v }))}
            onRequestDisable={() => setDisableOf(m)}
            onTest={() => setTestOf(m)}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid={`admin-model-list-${groupKey}`}>
      {rows.map((m) => (
        <ModelListRow
          key={m.modelId}
          m={m}
          untested={m.status === "待测试" && !tested.has(m.modelId)}
          on={enabled[m.modelId] ?? false}
          setOn={(v) => setEnabled((p) => ({ ...p, [m.modelId]: v }))}
          onRequestDisable={() => setDisableOf(m)}
          onTest={() => setTestOf(m)}
        />
      ))}
    </div>
  );
}

/**
 * 卡片视图 —— 与 Skill 目录（`skill-catalog-live.tsx`）的卡片信息密度对齐：
 * 标题 + 状态徽标一行，关键字段网格排布，操作按钮落在卡片底部。列表视图的六项信息
 * （供应商 / 能力标签 / 上下文长度 / 单价 / 可选范围 / 启用开关或测试入口）一个不丢，
 * 只是从横向一行换成纵向卡片布局。
 */
function ModelCard({ m, untested, on, setOn, onRequestDisable, onTest }: { m: ModelPoolRow; untested: boolean; on: boolean; setOn: (v: boolean) => void; onRequestDisable: () => void; onTest: () => void }) {
  const statusTone = untested ? "warning" : on ? "primary" : "outline";
  const confidentialOk = m.kind === "self-hosted";
  return (
    <Card data-testid={`admin-model-card-${m.modelId}`}>
      <CardContent className="flex h-full flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-12 font-medium">{m.displayName}</span>
          <Badge tone={statusTone} data-testid={`admin-model-status-${m.modelId}`}>
            {STATUS_LABEL[untested ? "untested" : on ? "enabled" : "disabled"]}
          </Badge>
          {confidentialOk && (
            <Badge tone="ai" data-testid={`admin-model-confidential-${m.modelId}`}>
              <ShieldCheck aria-hidden className="h-3 w-3" />
              可承接机密
            </Badge>
          )}
        </div>
        <span className="text-11 text-muted-foreground">{m.vendor} · {tagsLabel(m)}</span>

        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-11 text-muted-foreground">
          <span>上下文 {contextLabel(m)}</span>
          <span className="inline-flex items-center gap-1" data-testid={`admin-model-price-${m.modelId}`}>
            {priceLabel(m)}
          </span>
          <span className="col-span-2 inline-flex items-center gap-1" data-testid={`admin-model-key-status-${m.modelId}`}>
            凭据 <span className="text-background-foreground">{hasApiKeyConfigured(m) ? "已配置" : "未配置"}</span>
          </span>
        </div>

        <div className="mt-auto flex items-center justify-end pt-1">
          {untested ? (
            <Button size="xs" variant="outline" onClick={onTest} data-testid={`admin-model-test-${m.modelId}`}>
              <FlaskConical aria-hidden className="h-3 w-3" />
              录入测试判读
            </Button>
          ) : (
            <label className="flex items-center gap-1.5">
              <span className={cn("text-11", on ? "text-background-foreground" : "text-muted-foreground")}>
                {on ? "已启用" : "未启用"}
              </span>
              <Toggle
                checked={on}
                onCheckedChange={(v) => (on && !v ? onRequestDisable() : setOn(v))}
                label={`启用/停用 ${m.displayName}`}
                data-testid={`admin-model-toggle-${m.modelId}`}
              />
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ModelListRow({ m, untested, on, setOn, onRequestDisable, onTest }: { m: ModelPoolRow; untested: boolean; on: boolean; setOn: (v: boolean) => void; onRequestDisable: () => void; onTest: () => void }) {
  const statusTone = untested ? "warning" : on ? "primary" : "outline";
  const confidentialOk = m.kind === "self-hosted";
  return (
    <Card data-testid={`admin-model-row-${m.modelId}`}>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-12 font-medium">{m.displayName}</span>
            <Badge tone={statusTone} data-testid={`admin-model-status-${m.modelId}`}>
              {STATUS_LABEL[untested ? "untested" : on ? "enabled" : "disabled"]}
            </Badge>
            {confidentialOk && (
              <Badge tone="ai" data-testid={`admin-model-confidential-${m.modelId}`}>
                <ShieldCheck aria-hidden className="h-3 w-3" />
                可承接机密
              </Badge>
            )}
          </div>
          <span className="text-11 text-muted-foreground">{m.vendor} · {tagsLabel(m)}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-muted-foreground">
          <span>上下文 {contextLabel(m)}</span>
          <span className="inline-flex items-center gap-1" data-testid={`admin-model-price-${m.modelId}`}>
            {priceLabel(m)}
          </span>
          <span className="inline-flex items-center gap-1" data-testid={`admin-model-key-status-${m.modelId}`}>
            凭据 <span className="text-background-foreground">{hasApiKeyConfigured(m) ? "已配置" : "未配置"}</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          {untested ? (
            <Button size="xs" variant="outline" onClick={onTest} data-testid={`admin-model-test-${m.modelId}`}>
              <FlaskConical aria-hidden className="h-3 w-3" />
              录入测试判读
            </Button>
          ) : (
            <label className="flex items-center gap-1.5">
              <span className={cn("text-11", on ? "text-background-foreground" : "text-muted-foreground")}>
                {on ? "已启用" : "未启用"}
              </span>
              <Toggle
                checked={on}
                onCheckedChange={(v) => (on && !v ? onRequestDisable() : setOn(v))}
                label={`启用/停用 ${m.displayName}`}
                data-testid={`admin-model-toggle-${m.modelId}`}
              />
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
