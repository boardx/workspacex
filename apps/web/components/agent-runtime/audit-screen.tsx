"use client";
import * as React from "react";
import { Download, ChevronRight, AlertTriangle, Search, Gauge, Ban } from "lucide-react";
import { RuntimeShell, SectionTitle, DecisionNote } from "./runtime-shell";
import { AdminModal, Toast, KV } from "@/components/admin/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UiState } from "@/lib/ui-state";
import {
  AUDIT_TIMELINE, AUDIT_COUNTS, AUDIT_KIND_LABEL, AUDIT_DRILL,
  ORG_AUDIT_ROWS, ORG_AUDIT_FILTERS, OVERVIEW_ANOMALIES, ANOMALY_CHAINS,
  type AuditEventKind, type RuntimeRole,
} from "@/lib/mock/agent-runtime";

const ROLES: RuntimeRole[] = ["admin", "facilitator", "maintainer", "groupLead"];
const KIND_TONE: Record<AuditEventKind, "primary" | "warning" | "neutral" | "outline"> = {
  "agent-call": "primary", decision: "outline", version: "neutral", role: "outline",
};

export function AuditScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [filter, setFilter] = React.useState<AuditEventKind | "all">("all");
  const [drillOpen, setDrillOpen] = React.useState(false);
  const [chainOf, setChainOf] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const rows = AUDIT_TIMELINE.filter((r) => filter === "all" || r.kind === filter);
  // 组织级检索屏仅组织管理员可见（D-34）
  const showOrg = role === "admin";

  return (
    <RuntimeShell
      screen="audit"
      role={role}
      state={state}
      roles={ROLES}
      title="Agent 行为审计"
      intro="任一条 AI 结论都能追到当时的输入与调用链。tool-call 四要素（函数签名 / 参数 / 命中数 / 运行态）、agent 互调调用链与深度、异常检测与自动限速。审计不可删除。"
      emptyHint="本项目还没有审计事件，不生成示例条目"
      errors={{ audit: "写入失败：tool-call 留痕写入失败，该次工具调用必须失败（没有留痕就没有调用）。" }}
      depFailure="审计写入依赖 provenance_events（append-only）；证据平面不可达，涉客户数据的调用一律失败。"
      denialReason="组长/组员/观察者不可见审计屏；能力维护者只见与其 agent 相关的调用元数据，不含项目内容正文。"
      successMessage="已导出本项目审计（CSV · 214 条），内容与界面一致、可复现"
    >
      <div className="flex flex-col gap-5">
        {/* A · 项目级审计时间线（四类事件同一条，不可删除） */}
        <section className="flex flex-col gap-2" data-testid="audit-timeline">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle hint="角色 · 版本 · Agent 调用 · 决策，四类事件同一条时间线，不可删除。此屏已存在（项目→成果沉淀→审计与反馈），本用例做实其中 Agent 调用类。">
              审计与反馈 · 时间线
            </SectionTitle>
            <Button size="xs" variant="outline" onClick={() => setToast("已导出（CSV / JSON），大批量转异步并给回执")} data-testid="audit-export">
              <Download aria-hidden className="h-3 w-3" /> 导出 CSV / JSON
            </Button>
          </div>

          {/* 筛选计数条 */}
          <div className="flex flex-wrap gap-1" data-testid="audit-filters">
            {(["all", "role", "version", "agent-call", "decision"] as const).map((k) => (
              <Button key={k} size="xs" variant={filter === k ? "primary" : "ghost"} onClick={() => setFilter(k)} data-testid={`audit-filter-${k}`}>
                {k === "all" ? "全部" : AUDIT_KIND_LABEL[k]} {AUDIT_COUNTS[k]}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <Card key={r.id} data-testid={`audit-row-${r.id}`}>
                <CardContent className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="font-mono text-11 text-muted-foreground">{r.ts}</span>
                  <Badge tone={KIND_TONE[r.kind]}>{AUDIT_KIND_LABEL[r.kind]}</Badge>
                  <span className="min-w-0 flex-1 text-12">{r.text}</span>
                  {r.drillable && (
                    <Button size="xs" variant="ghost" onClick={() => setDrillOpen(true)} data-testid={`audit-drill-${r.id}`}>
                      下钻 <ChevronRight aria-hidden className="h-3 w-3" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* B · 异常检测与自动限速 */}
        <section className="flex flex-col gap-2" data-testid="audit-anomalies">
          <SectionTitle hint="额度异常按相对均值倍数（10 倍 / 24h 滚动窗口 · O-36）自动限速；越权调用拦截并计数。限速是系统自动动作。">
            异常待处理（{OVERVIEW_ANOMALIES.length}）
          </SectionTitle>
          {OVERVIEW_ANOMALIES.map((a) => (
            <Card key={a.id} data-testid={`audit-anomaly-${a.id}`}>
              <CardContent className="flex flex-wrap items-center gap-2 py-3">
                <Badge tone={a.severity === "high" ? "danger" : "warning"}>{a.severity === "high" ? "高" : "中"}</Badge>
                {a.kind === "越权调用"
                  ? <Ban aria-hidden className="h-4 w-4 text-destructive" />
                  : <Gauge aria-hidden className="h-4 w-4 text-warning" />}
                <span className="min-w-0 flex-1 text-12">{a.detail}</span>
                {a.kind === "额度异常" && <Badge tone="outline" data-testid={`audit-throttled-${a.id}`}>已自动限速（系统执行）</Badge>}
                <Button size="xs" variant="ghost" onClick={() => setChainOf(a.id)} data-testid={`audit-chain-${a.id}`}>查看调用链</Button>
                {role === "admin" && <Button size="xs" variant="outline" onClick={() => setToast("需填理由后标记为正常并解除限速")} data-testid={`audit-normal-${a.id}`}>标记为正常</Button>}
              </CardContent>
            </Card>
          ))}
        </section>

        {/* C · 组织级审计检索屏（D-34 新建，尚无原型） */}
        {showOrg ? (
          <section className="flex flex-col gap-2" data-testid="audit-org-search">
            <SectionTitle hint="D-34 新建、尚无原型——从零补画。按项目 / 人 / 时间跨项目检索并导出；管理员读项目内容须留痕且对负责人可见。">
              组织级审计检索（后台新增）
            </SectionTitle>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-panel p-2" data-testid="audit-org-filters">
              <Search aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              {ORG_AUDIT_FILTERS.projects.map((p) => <Badge key={p} tone="outline">{p}</Badge>)}
            </div>
            <div className="flex flex-col gap-1.5">
              {ORG_AUDIT_ROWS.map((r) => (
                <Card key={r.id} data-testid={`audit-org-row-${r.id}`}>
                  <CardContent className="flex flex-wrap items-center gap-2 py-2.5">
                    <Badge tone="neutral">{r.project}</Badge>
                    <span className="text-11 text-muted-foreground">{r.when}</span>
                    <span className="text-12">{r.who}</span>
                    <span className="ml-auto min-w-0 text-11 text-muted-foreground">{r.event}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ) : (
          <DecisionNote testid="audit-org-hint">
            组织级审计检索屏（按项目/人/时间 + 导出）仅<strong>组织管理员</strong>可见——切到「组织管理员」视角查看。它是 D-34 新建、原型中不存在的屏。
          </DecisionNote>
        )}
      </div>

      {/* Agent 调用下钻（tool-call 四要素 + 调用链 + 批准 + 采纳与否） */}
      {drillOpen && (
        <AdminModal
          testid="audit-drill-dialog"
          width="lg"
          title={AUDIT_DRILL.title}
          subtitle={`${AUDIT_DRILL.thought} · ${AUDIT_DRILL.summary}`}
          onClose={() => setDrillOpen(false)}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col divide-y divide-border-subtle">
              <KV k="调用链" v={<span>{AUDIT_DRILL.chain} · 深度 {AUDIT_DRILL.chainDepth}</span>} />
              <KV k="agent 版本" v={AUDIT_DRILL.agentVersion} />
              <KV k="skill 版本" v={AUDIT_DRILL.skillVersion} />
              <KV k="模型" v={<span className="font-mono">{AUDIT_DRILL.modelId}</span>} />
              <KV k="当时的输入" v={AUDIT_DRILL.contextPack} />
              <KV k="批准" v={AUDIT_DRILL.approval} />
              <KV k="采纳与否" v={AUDIT_DRILL.adopted} />
              <KV k="三层权限快照" v={AUDIT_DRILL.permissionSnapshot} />
            </div>
            <SectionTitle hint="内建工具（graph. / brain.）与 MCP 工具（mcp:服务器.工具）命名空间可区分；逐条独立运行态。">
              tool-call 明细（{AUDIT_DRILL.toolCalls.length}）
            </SectionTitle>
            <div className="flex flex-col gap-1.5" data-testid="audit-toolcalls">
              {AUDIT_DRILL.toolCalls.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2" data-testid={`audit-toolcall-${i}`}>
                  <Badge tone={t.namespace === "mcp" ? "warning" : "neutral"}>{t.namespace === "mcp" ? "MCP 工具" : "内建工具"}</Badge>
                  <span className="font-mono text-12">{t.signature}</span>
                  <span className="font-mono text-11 text-muted-foreground">{t.params}</span>
                  <span className="ml-auto text-11">{t.hits}</span>
                  <Badge tone={t.runState === "running" ? "warning" : "outline"}>{t.runState === "running" ? "运行中" : "已完成"}</Badge>
                </div>
              ))}
            </div>
          </div>
        </AdminModal>
      )}

      {/* 异常调用链下钻 */}
      {chainOf && (
        <AdminModal
          testid="audit-chain-dialog"
          title="调用链"
          subtitle="下钻到具体一次调用（含被拦截的那一步）"
          onClose={() => setChainOf(null)}
        >
          <div className="flex flex-col gap-1.5" data-testid="audit-chain-steps">
            {(ANOMALY_CHAINS[chainOf] ?? []).map((s, i) => (
              <div key={i} className={`flex flex-col gap-0.5 rounded-md border p-2.5 ${s.blocked ? "border-destructive/30 bg-destructive/5" : "border-border-subtle bg-panel"}`} data-testid={`audit-chain-step-${i}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-10 text-muted-foreground">{s.ts}</span>
                  <span className="text-11 font-medium">{s.actor}</span>
                  {s.blocked && <Badge tone="danger"><AlertTriangle aria-hidden className="h-3 w-3" /> 拦截/告警点</Badge>}
                </div>
                <p className="text-11 text-muted-foreground">{s.action}</p>
              </div>
            ))}
          </div>
        </AdminModal>
      )}

      <Toast message={toast} testid="audit-toast" onDismiss={() => setToast(null)} />
    </RuntimeShell>
  );
}
