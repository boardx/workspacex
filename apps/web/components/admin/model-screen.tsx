"use client";
import * as React from "react";
import { Plus, Cpu, ServerCog, ShieldCheck, FlaskConical, Check } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { AdminDrawer, AdminModal, Toast, Field } from "./panel";
import { DisableDialog, type DisableMode } from "./disable-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MODELS, MODEL_FILTERS, MODEL_STATUS_LABEL, inFlightOf,
  type ModelFilterKey, type ModelRow,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

/** phase-1 的五项准入测试（人工判读并记录，不做自动化）。 */
const ADMISSION_TESTS = [
  "连通性与稳定性：端点 3 次往返均成功、延迟可接受",
  "中文长文理解：给定 20 页材料能准确摘要不丢关键信息",
  "工具调用：能按 schema 正确发起并消费工具返回",
  "指令遵循与格式：输出严格符合约定 JSON schema",
  "安全与拒答：对越权/出域请求正确拒绝并说明",
];

export function ModelScreen({ state }: { state: UiState }) {
  const [filter, setFilter] = React.useState<ModelFilterKey>("all");
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(MODELS.map((m) => [m.id, m.status === "enabled"])),
  );
  const [tested, setTested] = React.useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = React.useState(false);
  const [testOf, setTestOf] = React.useState<ModelRow | null>(null);
  const [disableOf, setDisableOf] = React.useState<ModelRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const rows = MODELS.filter((m) => {
    if (filter === "all") return true;
    if (filter === "untested") return m.status === "untested" && !tested.has(m.id);
    return m.kind === filter;
  });
  const hosted = rows.filter((m) => m.kind === "hosted-api");
  const selfHosted = rows.filter((m) => m.kind === "self-hosted");

  return (
    <AdminScreen
      state={state}
      moduleLabel="模型"
      title="模型管理"
      intro="只有测试通过的模型才会出现在 agent 与 skill 的模型选择里。phase-1 的五项准入测试改为人工判读并记录（不做自动化）。客户机密材料只走开源自托管。"
      emptyHint="模型池是空的，先接入一个模型"
      errors={{ endpoint: "接入失败：连通性测试超时，端点 3 次未响应；模型保持待测试，不进入可选池" }}
      depFailure="模型测试与调用依赖推理网关；网关不可达，无法确认模型状态与单价。"
      denialReason="模型凭据由管理员保管、成员看不到；模型管理仅组织管理员可进入。"
      successMessage="模型『qwen3-72b』五项测试判读通过，已启用并纳入 Ledger 的可选范围"
    >
      <div className="flex flex-col gap-4">
        {/* 筛选（可选范围过滤的入口） + 接入 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" data-testid="admin-model-filters">
            {MODEL_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "primary" : "ghost"}
                onClick={() => setFilter(f.key)}
                data-testid={`admin-model-filter-${f.key}`}
              >
                {f.label} {f.count}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)} data-testid="admin-model-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            接入模型
          </Button>
        </div>

        {/* 闭源 API 组 */}
        {hosted.length > 0 && (
          <section className="flex flex-col gap-2" data-testid="admin-model-group-hosted">
            <div className="flex items-center gap-1.5">
              <Cpu aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-13 font-semibold">闭源 API</h2>
              <span className="text-11 text-muted-foreground">· 凭据由管理员保管，成员看不到</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {hosted.map((m) => (
                <ModelListRow key={m.id} m={m} untested={m.status === "untested" && !tested.has(m.id)} on={enabled[m.id] ?? false} setOn={(v) => setEnabled((p) => ({ ...p, [m.id]: v }))} onRequestDisable={() => setDisableOf(m)} onTest={() => setTestOf(m)} />
              ))}
            </div>
          </section>
        )}

        {/* 开源自托管组 */}
        {selfHosted.length > 0 && (
          <section className="flex flex-col gap-2" data-testid="admin-model-group-self">
            <div className="flex items-center gap-1.5">
              <ServerCog aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-13 font-semibold">开源自托管</h2>
              <span className="text-11 text-muted-foreground">· 权重跑在自己的 GPU 上，客户机密材料只走这一类</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {selfHosted.map((m) => (
                <ModelListRow key={m.id} m={m} untested={m.status === "untested" && !tested.has(m.id)} on={enabled[m.id] ?? false} setOn={(v) => setEnabled((p) => ({ ...p, [m.id]: v }))} onRequestDisable={() => setDisableOf(m)} onTest={() => setTestOf(m)} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 接入模型 */}
      {addOpen && (
        <AdminDrawer
          testid="admin-model-panel"
          title="接入模型"
          subtitle="接入后置为待测试，通过五项判读才进可选池"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)} data-testid="admin-model-panel-cancel">取消</Button>
              <Button size="sm" variant="primary" onClick={() => { setAddOpen(false); setToast("已接入模型（待测试），完成五项判读后可启用"); }} data-testid="admin-model-panel-save">接入（置待测试）</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field id="admin-model-field-name" label="模型名" placeholder="如 qwen3-72b" />
            <Field id="admin-model-field-endpoint" label="端点 / 权重路径" placeholder="https://… 或 自托管 · H100×4" />
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5">
              <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-11">只有自托管模型可承接客户机密材料；闭源 API 一律不路由机密。</p>
            </div>
          </div>
        </AdminDrawer>
      )}

      {/* 五项测试判读 */}
      {testOf && (
        <TestModal
          model={testOf}
          onClose={() => setTestOf(null)}
          onPass={() => {
            setTested((s) => new Set(s).add(testOf.id));
            setEnabled((p) => ({ ...p, [testOf.id]: true }));
            setToast(`模型「${testOf.name}」五项测试判读通过，已启用并纳入可选范围`);
            setTestOf(null);
          }}
        />
      )}

      {/* 停用二选一确认（D-U5）*/}
      {disableOf && (
        <DisableDialog
          testid="admin-model-disable-dialog"
          verb="停用"
          capabilityName={disableOf.name}
          inFlight={inFlightOf(disableOf.id)}
          interruptEffect={`正经此模型推理的 ${inFlightOf(disableOf.id)} 个调用会被立即中断，返回「该能力已被管理员停用」；调用方需改选其它已启用模型。`}
          drainEffect={`已发起的 ${inFlightOf(disableOf.id)} 个推理跑完当前一轮，此刻起路由不再选用此模型。`}
          onCancel={() => setDisableOf(null)}
          onConfirm={(mode: DisableMode) => {
            setEnabled((prev) => ({ ...prev, [disableOf.id]: false }));
            setToast(
              mode === "interrupt"
                ? `已停用模型「${disableOf.name}」，并立即中断 ${inFlightOf(disableOf.id)} 个进行中的推理`
                : `已停用模型「${disableOf.name}」；${inFlightOf(disableOf.id)} 个进行中的推理将跑完当前一轮，新调用即刻被拒`,
            );
            setDisableOf(null);
          }}
        />
      )}

      <Toast message={toast} testid="admin-model-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}

function TestModal({ model, onClose, onPass }: { model: ModelRow; onClose: () => void; onPass: () => void }) {
  const [passed, setPassed] = React.useState<boolean[]>(() => ADMISSION_TESTS.map(() => false));
  const allPassed = passed.every(Boolean);
  return (
    <AdminModal
      testid="admin-model-test-dialog"
      width="lg"
      title={`录入测试判读 · ${model.name}`}
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

function ModelListRow({ m, untested, on, setOn, onRequestDisable, onTest }: { m: ModelRow; untested: boolean; on: boolean; setOn: (v: boolean) => void; onRequestDisable: () => void; onTest: () => void }) {
  const statusTone = untested ? "warning" : on ? "primary" : "outline";
  return (
    <Card data-testid={`admin-model-row-${m.id}`}>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-12 font-medium">{m.name}</span>
            <Badge tone={statusTone} data-testid={`admin-model-status-${m.id}`}>
              {MODEL_STATUS_LABEL[untested ? "untested" : on ? "enabled" : "disabled"]}
            </Badge>
            {m.confidentialOk && (
              <Badge tone="ai" data-testid={`admin-model-confidential-${m.id}`}>
                <ShieldCheck aria-hidden className="h-3 w-3" />
                可承接机密
              </Badge>
            )}
          </div>
          <span className="text-11 text-muted-foreground">{m.vendor} · {m.tags}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-muted-foreground">
          <span>上下文 {m.context}</span>
          {/* D-U12：型号定价是编造的演示数据，旁加「示例」小标（自托管的「GPU 摊销」不是数字，不标） */}
          <span className="inline-flex items-center gap-1" data-testid={`admin-model-price-${m.id}`}>
            {m.price}
            {m.price.includes("￥") && (
              <Badge tone="outline" data-testid={`admin-model-price-sample-${m.id}`}>示例</Badge>
            )}
          </span>
          <span className="inline-flex items-center gap-1">
            可选范围 <span className="text-background-foreground">{m.optionalScope}</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          {untested ? (
            <Button size="xs" variant="outline" onClick={onTest} data-testid={`admin-model-test-${m.id}`}>
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
                label={`启用/停用 ${m.name}`}
                data-testid={`admin-model-toggle-${m.id}`}
              />
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
