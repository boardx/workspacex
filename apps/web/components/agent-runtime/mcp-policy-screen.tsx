"use client";
import * as React from "react";
import { Lock, ShieldAlert, Check } from "lucide-react";
import { RuntimeShell, SectionTitle, DecisionNote } from "./runtime-shell";
import { AdminModal, Toast, Field } from "@/components/admin/panel";
import { AuthScopeBadge, ReviewBadge } from "@/components/admin/scope-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { mcpEndpointHint } from "@/lib/mcp-endpoint-hint";
import type { UiState } from "@/lib/ui-state";
import {
  MCP_SECURITY_SWITCHES, REVIEW_VERDICTS, MCP_SERVERS, MCP_AUTH_LABEL,
  type RuntimeRole, type ReviewVerdict, type McpSecuritySwitch,
} from "@/lib/mock/agent-runtime";

const ROLES: RuntimeRole[] = ["admin", "securityReviewer", "maintainer"];
const ISOLATED = MCP_SERVERS.find((s) => s.reviewStatus === "pending");

export function McpPolicyScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [on, setOn] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(MCP_SECURITY_SWITCHES.map((s) => [s.id, s.defaultOn])),
  );
  const [confirmSwitch, setConfirmSwitch] = React.useState<McpSecuritySwitch | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [verdict, setVerdict] = React.useState<ReviewVerdict>("hold");
  const [reason, setReason] = React.useState("");
  const [scopeSet, setScopeSet] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const canReview = role === "securityReviewer" || role === "admin";
  // 放行必须同时设定授权范围；结论=放行时理由与授权范围都必填
  const reviewValid = reason.trim().length >= 4 && (verdict !== "clear" || scopeSet);

  return (
    <RuntimeShell
      screen="mcp-policy"
      role={role}
      state={state}
      roles={ROLES}
      title="MCP 安全策略 · 放行评审"
      intro="四条安全开关把外部能力入口管住。开关三（机密仅本地）不可关、开关四（agent 自行发现）phase-1 不可开。放行评审是『默认隔离』策略的唯一出口。"
      emptyHint="当前没有待评审的服务器"
      errors={{ review: "放行被拒：结论为『放行』但未设定授权范围。不允许『已连接但范围未定』的空档。" }}
      depFailure="放行后要连上服务器做工具发现；MCP 网关不可达，无法完成放行。"
      denialReason="安全策略仅组织管理员可改；放行评审仅安全评审人 / 组织管理员；能力维护者只读。"
      successMessage="欧盟法规库维持隔离，评审结论与理由已写入审计（不可删除）"
    >
      <div className="flex flex-col gap-5">
        {/* A · 四开关 */}
        <section className="flex flex-col gap-2" data-testid="mcp-policy-switches">
          <SectionTitle hint="每个开关旁写明『关掉/打开会发生什么』；不可改的两条以只读常开/常关呈现（带锁图标），而非可点报错。">
            安全策略（四开关）
          </SectionTitle>
          {MCP_SECURITY_SWITCHES.map((s) => {
            const locked = s.lock !== "toggleable";
            const value = s.lock === "locked-on" ? true : s.lock === "locked-off" ? false : (on[s.id] ?? false);
            return (
              <Card key={s.id} data-testid={`mcp-switch-${s.id}`}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="flex items-start gap-2">
                    {locked
                      ? <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      : <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-12 font-medium">{s.label}</span>
                        {s.lock === "locked-on" && <Badge tone="primary" data-testid={`mcp-switch-lock-${s.id}`}>只读常开</Badge>}
                        {s.lock === "locked-off" && <Badge tone="outline" data-testid={`mcp-switch-lock-${s.id}`}>只读常关</Badge>}
                        <Badge tone="neutral">执行体 · {s.executedBy}</Badge>
                      </div>
                      <p className="text-11 text-muted-foreground">{s.consequence}</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {locked ? (
                      <span className="inline-flex items-center gap-1 text-11 text-muted-foreground" data-testid={`mcp-switch-state-${s.id}`}>
                        <Lock aria-hidden className="h-3 w-3" /> {value ? "已开（锁定）" : "已关（锁定）"}
                      </span>
                    ) : (
                      <Toggle
                        checked={value}
                        onCheckedChange={(v) => {
                          if (role !== "admin") { setToast("仅组织管理员可改安全开关"); return; }
                          if (!v) { setConfirmSwitch(s); return; } // 关掉是危险动作 → 二次确认
                          setOn((p) => ({ ...p, [s.id]: v }));
                        }}
                        label={s.label}
                        data-testid={`mcp-switch-toggle-${s.id}`}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <DecisionNote testid="mcp-note-discover">
            我替 UC 处理的证据冲突：后台数据总览「越权调用尝试 · 客户 CRM 已拦截 7 次」是<strong>授权范围（UC-21.1）</strong>的执行结果，
            <strong>不是</strong>开关四的证据（客户 CRM 是已注册已连接的服务器）。开关四『agent 自行发现』在原型里<strong>无执行证据</strong>，故只读常关。
          </DecisionNote>
        </section>

        {/* B · 隔离行 + 放行评审入口 */}
        {ISOLATED && (
          <section className="flex flex-col gap-2" data-testid="mcp-policy-isolated">
            <SectionTitle hint="原型里隔离行只有五个静态字段、无操作按钮。评审入口/面板/角色整体是原型确认缺失，此处补画。">
              待评审服务器（1 台隔离待评审）
            </SectionTitle>
            <Card data-testid={`mcp-isolated-row-${ISOLATED.id}`}>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-12 font-medium">{ISOLATED.name}</span>
                    <span className="text-11 text-muted-foreground">{ISOLATED.note}</span>
                  </div>
                  {/*
                    端点对「能力维护者」不可见（domain I-6 / F52）。
                    此前这一行无条件渲染 ISOLATED.endpoint，而本屏的角色切换器里就有
                    maintainer —— 内网地址对一个只读角色是直接露出来的。
                    维护者拿到的是两值粗粒度提示（与契约 McpServerRow.endpointHint 同粒度），
                    信息量到此为止，拨不过去。
                  */}
                  {canReview ? (
                    <span className="font-mono text-10 text-muted-foreground" data-testid="mcp-isolated-endpoint">{ISOLATED.endpoint}</span>
                  ) : (
                    <span className="text-10 text-muted-foreground" data-testid="mcp-isolated-endpoint-hint">
                      端点 · {mcpEndpointHint(ISOLATED.endpoint)}（端点与凭据仅组织管理员 / 安全评审人可见）
                    </span>
                  )}
                </div>
                <span className="text-11 text-muted-foreground">{ISOLATED.tools} 工具</span>
                <AuthScopeBadge scope={ISOLATED.authScope} team={ISOLATED.authTeam} />
                <ReviewBadge status="pending" />
                <Badge tone="danger">已隔离</Badge>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-11 text-muted-foreground">隔离理由：第三方 · 未审计</span>
                  <Button size="xs" variant="primary" disabled={!canReview} onClick={() => setReviewOpen(true)} data-testid="mcp-review-open" title={canReview ? undefined : "仅安全评审人 / 组织管理员可评审"}>
                    去评审
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        )}
      </div>

      {/* 关闭可关开关的二次确认 */}
      {confirmSwitch && (
        <AdminModal
          testid="mcp-switch-confirm"
          title={`关闭策略 · ${confirmSwitch.label}`}
          subtitle="策略变更是高影响动作，写入审计与 provenance_events，并在后台数据总览可见"
          onClose={() => setConfirmSwitch(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirmSwitch(null)} data-testid="mcp-switch-confirm-cancel">取消</Button>
              <Button size="sm" variant="destructive" onClick={() => { setOn((p) => ({ ...p, [confirmSwitch.id]: false })); setToast(`已关闭「${confirmSwitch.label}」，变更已留痕`); setConfirmSwitch(null); }} data-testid="mcp-switch-confirm-ok">确认关闭</Button>
            </>
          }
        >
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-12">{confirmSwitch.consequence}</p>
          </div>
        </AdminModal>
      )}

      {/* 放行评审面板（结论三选 + 理由必填 + 放行须设授权范围） */}
      {reviewOpen && ISOLATED && (
        <AdminModal
          testid="mcp-review-dialog"
          width="lg"
          title={`放行安全评审 · ${ISOLATED.name}`}
          subtitle="评审人 ≠ 注册人；结论必须填理由且不可删除"
          onClose={() => setReviewOpen(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setReviewOpen(false)} data-testid="mcp-review-cancel">取消</Button>
              <Button size="sm" variant="primary" disabled={!reviewValid} onClick={() => { setReviewOpen(false); setToast(verdict === "clear" ? `已放行「${ISOLATED.name}」并设定授权范围` : verdict === "hold" ? `「${ISOLATED.name}」维持隔离，理由已留痕` : "已有条件放行（工具级粒度待裁决）"); }} data-testid="mcp-review-submit" title={reviewValid ? undefined : "填理由；结论为放行时须同时设定授权范围"}>
                提交评审结论
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5" data-testid="mcp-review-verdicts">
              <span className="text-11 font-medium text-muted-foreground">评审结论（三选一）</span>
              {REVIEW_VERDICTS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setVerdict(v.key)}
                  data-testid={`mcp-review-verdict-${v.key}`}
                  className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-all duration-200 hover:bg-accent hover:text-accent-foreground ${verdict === v.key ? "border-primary bg-accent text-accent-foreground" : "border-border-subtle bg-panel"}`}
                >
                  <span className="flex items-center gap-1.5 text-12 font-medium">
                    {verdict === v.key && <Check aria-hidden className="h-3 w-3 text-success" />}
                    {v.label}
                  </span>
                  <span className="text-11 text-muted-foreground">{v.hint}</span>
                </button>
              ))}
            </div>

            {verdict === "clear" && (
              <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="mcp-review-scope">
                <span className="text-11 font-medium">放行须同时设定授权范围（不允许放行了但范围没定）</span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(MCP_AUTH_LABEL) as (keyof typeof MCP_AUTH_LABEL)[]).map((k) => (
                    <Button key={k} size="xs" variant={scopeSet ? "outline" : "ghost"} onClick={() => setScopeSet(true)} data-testid={`mcp-review-scope-${k}`}>{MCP_AUTH_LABEL[k]}</Button>
                  ))}
                </div>
                {scopeSet && <span className="inline-flex items-center gap-1 text-11 text-success"><Check aria-hidden className="h-3 w-3" /> 授权范围已设定</span>}
              </div>
            )}

            <Field id="mcp-review-reason" label="理由（必填，写入审计，不可删除）" value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder="例如：核对端点归属与工具清单，第三方未审计，暂维持隔离等供应商 SOC2 报告。" />
          </div>
        </AdminModal>
      )}

      <Toast message={toast} testid="mcp-policy-toast" onDismiss={() => setToast(null)} />
    </RuntimeShell>
  );
}