"use client";
import * as React from "react";
import { Plus, Cpu, ServerCog, ShieldCheck, FlaskConical } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import {
  MODELS, MODEL_FILTERS, MODEL_STATUS_LABEL,
  type ModelFilterKey, type ModelRow,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

export function ModelScreen({ state }: { state: UiState }) {
  const [filter, setFilter] = React.useState<ModelFilterKey>("all");
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(MODELS.map((m) => [m.id, m.status === "enabled"])),
  );

  const rows = MODELS.filter((m) => {
    if (filter === "all") return true;
    if (filter === "untested") return m.status === "untested";
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
          <Button size="sm" variant="primary" data-testid="admin-model-add">
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
                <ModelListRow key={m.id} m={m} on={enabled[m.id] ?? false} setOn={(v) => setEnabled((p) => ({ ...p, [m.id]: v }))} />
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
                <ModelListRow key={m.id} m={m} on={enabled[m.id] ?? false} setOn={(v) => setEnabled((p) => ({ ...p, [m.id]: v }))} />
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminScreen>
  );
}

function ModelListRow({ m, on, setOn }: { m: ModelRow; on: boolean; setOn: (v: boolean) => void }) {
  const untested = m.status === "untested";
  const statusTone = m.status === "enabled" ? "primary" : m.status === "untested" ? "warning" : "outline";
  return (
    <Card data-testid={`admin-model-row-${m.id}`}>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-12 font-medium">{m.name}</span>
            <Badge tone={statusTone} data-testid={`admin-model-status-${m.id}`}>
              {MODEL_STATUS_LABEL[on && !untested ? "enabled" : m.status]}
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
          <span>{m.price}</span>
          <span className="inline-flex items-center gap-1">
            可选范围 <span className="text-background-foreground">{m.optionalScope}</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          {untested ? (
            <Button size="xs" variant="outline" data-testid={`admin-model-test-${m.id}`}>
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
                onCheckedChange={setOn}
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
