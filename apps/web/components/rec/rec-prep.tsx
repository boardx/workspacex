"use client";
import * as React from "react";
import { Check, AlertTriangle, ShieldOff, Play } from "lucide-react";
import { Toast } from "@/components/admin/panel";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { isReadOnlyRec, type RecView } from "@/lib/mock/rec";
import {
  PREP_PARTICIPANTS, PREP_INCOMPLETE, PREP_CAN_START, PREP_CHECKS,
  PREP_SPEAKER_LABELS, PREP_MATERIALS, PREP_META,
  AUTHZ_COLS, AUTHZ_COL_LABEL, AUTHZ_LABEL,
  type AuthzValue, type AuthzCol,
} from "@/lib/mock/rec-v2";

/**
 * 准备室 · 逐人 × 三项授权矩阵（原型 16088061）。
 *
 * 这是 v1 缺失的那一屏：v1 把逐人授权塌成一个布尔 `authComplete`，只在指派屏显示「授权 3/4」结论徽标，
 * 而**产生这个结论的授权矩阵屏根本不存在**。此屏把结论还原为过程：
 *   录音 | 转录 | AI 分析 三列 × 每人；Weber 拒绝 AI 分析；P-12 未签则「开始」不可用。
 */
export function RecPrep({ state, view }: { state: UiState; view: RecView }) {
  const readOnly = isReadOnlyRec(view);
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="rec-prep">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-18 font-semibold tracking-tight">{PREP_META.title}</h1>
        {!PREP_CAN_START && (
          <Badge tone="danger" data-testid="rec-prep-blocked-badge">
            {PREP_INCOMPLETE.length} 人未完成授权 · 不能开始录制
          </Badge>
        )}
        <Badge tone="outline" data-testid="rec-prep-authcount">
          授权 {PREP_PARTICIPANTS.length - PREP_INCOMPLETE.length}/{PREP_PARTICIPANTS.length}
        </Badge>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint="本场还没有参与者进入准备室——授权矩阵为空；名单从项目在场表载入。"
        errors={{
          authz: "P-12 的同意书链接渲染变量缺失（缺「材料保留期」），系统不发出授权链接、也不把 P-12 计入可录制名单（E6）。",
        }}
        depFailure={{ what: "同意书模板渲染服务暂不可用；已保存的逐人授权不受影响，可安全重试。手动核对不依赖它。" }}
        denial={{ layer: "project", reason: "只有引导师/研究员可配置逐人授权；你可查看授权状态但不能修改。" }}
        successMessage="P-12 已完成三项授权 → 授权 3/3，「开始访谈」已可用；录音/转录/AI 分析仅对已授权项开启。"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(360px,1fr)_300px]">
          {/* 左：逐人授权矩阵 */}
          <section className="flex flex-col gap-3" data-testid="rec-prep-matrix">
            <div>
              <h2 className="mb-2 text-12 font-semibold">逐人授权 · 按个人配置，不强制全场统一</h2>
              <div className="overflow-hidden rounded-lg border border-border-subtle">
                {/* 表头 */}
                <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_76px] gap-2 border-b border-border-subtle bg-panel px-3 py-2 text-10 font-medium text-muted-foreground">
                  <span>参与者</span>
                  {AUTHZ_COLS.map((c) => (
                    <span key={c}>{AUTHZ_COL_LABEL[c]}</span>
                  ))}
                </div>
                {PREP_PARTICIPANTS.map((p, i) => {
                  const incomplete = AUTHZ_COLS.some((c) => p.authz[c] === "pending");
                  return (
                    <div
                      key={p.id}
                      data-testid={`rec-prep-row-${p.id}`}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_64px_64px_76px] items-center gap-2 px-3 py-2.5",
                        i < PREP_PARTICIPANTS.length - 1 && "border-b border-border-subtle",
                        incomplete && "bg-destructive/5",
                      )}
                    >
                      <span className="truncate text-11">{p.name}</span>
                      {AUTHZ_COLS.map((c) => (
                        <AuthzCell key={c} pid={p.id} col={c} value={p.authz[c]} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Weber 拒绝 AI 分析 / P-12 未签 的后果说明 */}
            {PREP_PARTICIPANTS.filter((p) => p.note).map((p) => (
              <div
                key={p.id}
                data-testid={`rec-prep-note-${p.id}`}
                className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3"
              >
                {p.authz.aiAnalysis === "deny" ? (
                  <ShieldOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                ) : (
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                )}
                <p className="text-10 leading-relaxed text-muted-foreground">{p.note}</p>
              </div>
            ))}

            {/* 设备与转录检查 */}
            <div>
              <h2 className="mb-2 text-12 font-semibold">设备与转录检查</h2>
              <div className="grid gap-2 sm:grid-cols-2" data-testid="rec-prep-checks">
                {PREP_CHECKS.map((chk) => (
                  <div
                    key={chk.id}
                    data-testid={`rec-prep-check-${chk.id}`}
                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-card p-2.5"
                  >
                    <span
                      className={cn(
                        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded text-9",
                        chk.state === "ok" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                      )}
                    >
                      {chk.state === "ok" ? "✓" : "·"}
                    </span>
                    <span className="text-10">{chk.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 右：发言人标签 + 材料 + 开始按钮 */}
          <aside className="flex flex-col gap-3">
            <div>
              <h2 className="mb-2 text-12 font-semibold">发言人标签</h2>
              <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-card p-3" data-testid="rec-prep-speaker-labels">
                {PREP_SPEAKER_LABELS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-10">
                    <span className="h-4 w-4 shrink-0 rounded bg-muted" />
                    <span className="flex-1">{s.name}</span>
                    <span className={cn("font-mono text-9", s.calibrated ? "text-success" : "text-warning")}>
                      {s.calibrated ? "已校准" : "待采样"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-12 font-semibold">材料与原型</h2>
              <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-card p-3 text-10" data-testid="rec-prep-materials">
                {PREP_MATERIALS.map((m) => (
                  <div key={m} className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">›</span>
                    <span className="truncate">{m}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              variant={PREP_CAN_START ? "primary" : "ghost"}
              disabled={!PREP_CAN_START || readOnly}
              onClick={() => setToast("开始访谈（mock）：录音/转录/AI 分析仅对已授权项开启")}
              data-testid="rec-prep-start"
              className="w-full"
              title={PREP_CAN_START ? undefined : "未完成授权前不可开始"}
            >
              <Play aria-hidden className="h-3.5 w-3.5" />
              {PREP_CAN_START ? PREP_META.startEnabledLabel : PREP_META.startDisabledLabel}
            </Button>
            <p className="text-9 leading-relaxed text-muted-foreground" data-testid="rec-prep-footnote">
              {PREP_META.footnote}
            </p>
          </aside>
        </div>
      </StateShell>
      <Toast message={toast} testid="rec-prep-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}

function AuthzCell({ pid, col, value }: { pid: string; col: AuthzCol; value: AuthzValue }) {
  const tone =
    value === "allow" ? "text-success" : value === "deny" ? "text-destructive" : "text-destructive";
  return (
    <span
      data-testid={`rec-prep-cell-${pid}-${col}`}
      className={cn("inline-flex items-center gap-1 font-mono text-10", tone)}
    >
      {value === "allow" && <Check aria-hidden className="h-3 w-3" />}
      {value === "deny" && <ShieldOff aria-hidden className="h-3 w-3" />}
      {AUTHZ_LABEL[value]}
    </span>
  );
}
