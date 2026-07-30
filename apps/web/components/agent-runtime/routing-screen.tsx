"use client";
import * as React from "react";
import { ShieldCheck, Lock, Info, ArrowRight, Ban, Check } from "lucide-react";
import { RuntimeShell, SectionTitle, DecisionNote } from "./runtime-shell";
import { AdminModal, Toast } from "@/components/admin/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UiState } from "@/lib/ui-state";
import {
  APPROVAL_CARD, ROUTING_CONTEXT, ROUTING_HAS_CONFIDENTIAL, confidentialModelCandidates,
  type RuntimeRole,
} from "@/lib/mock/agent-runtime";

const ROLES: RuntimeRole[] = ["facilitator", "admin", "maintainer", "observer"];

export function RoutingScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [explainOpen, setExplainOpen] = React.useState(false);
  const [changeOpen, setChangeOpen] = React.useState(false);
  const [noLocal, setNoLocal] = React.useState(false); // 演示：无可用自托管模型的失败态
  const [toast, setToast] = React.useState<string | null>(null);
  const candidates = confidentialModelCandidates();

  return (
    <RuntimeShell
      screen="routing"
      role={role}
      state={state}
      roles={ROLES}
      title="机密数据的模型路由 · 批准卡"
      intro="客户机密材料只能由本地（开源自托管）模型处理——服务端强制硬路由，不是提示。含机密任务禁止降级；无可用自托管模型时明确失败，绝不回落闭源。"
      emptyHint="本线程当前没有待批准的高影响动作"
      errors={{ route: "改模型被拒：本次上下文含机密材料，仅本地模型可选，不能改成闭源模型。" }}
      depFailure="路由判定读 Context Pack 各 item 的机密标记（Context Engine）；证据平面不可达，无法完成机密判定。"
      denialReason="观察者不可见机密内容与路由细节；批准卡对无关角色不呈现要读的数据明细。"
      successMessage="批准执行：本次调用已路由到本地 qwen3-32b，机密内容未出自托管"
    >
      <div className="flex flex-col gap-5">
        {/* 无自托管模型失败态开关（本用例最重要的一态，原型零错误态） */}
        <div className="flex items-center justify-between rounded-md border border-border-subtle bg-panel px-3 py-2" data-testid="routing-nolocal-switch">
          <span className="text-11 text-muted-foreground">演示切换：当组织内 0 个已启用自托管模型时，含机密调用一律明确失败</span>
          <Button size="xs" variant={noLocal ? "destructive" : "outline"} onClick={() => setNoLocal((v) => !v)} data-testid="routing-nolocal-toggle">
            {noLocal ? "恢复：有可用本地模型" : "模拟：无可用本地模型"}
          </Button>
        </div>

        {noLocal ? (
          /* 依赖失败态 · 本用例最重要的一态 */
          <Card data-testid="routing-fail">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <Ban aria-hidden className="h-7 w-7 text-destructive" />
              <div className="flex flex-col gap-1">
                <p className="text-14 font-semibold text-destructive">本次内容含客户机密，需本地模型处理</p>
                <p className="text-12 text-muted-foreground">当前组织无可用本地模型（0 个已启用自托管模型），本次调用已明确失败。</p>
                <p className="text-12 text-muted-foreground">绝不回落到闭源模型，也不静默丢弃机密内容后继续。请联系管理员启用一个自托管模型。</p>
              </div>
              <Badge tone="danger">因含机密被拒绝 · 无本地模型</Badge>
            </CardContent>
          </Card>
        ) : (
          /* 批准卡 · 默认态 */
          <Card data-testid="routing-approval-card">
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning" data-testid="routing-paused">已暂停 · 等你批准</Badge>
                <span className="text-13 font-medium">{APPROVAL_CARD.requester} 想执行一个动作</span>
                <Badge tone="outline" data-testid="routing-chain">
                  调用链 {APPROVAL_CARD.chain}（深度 {APPROVAL_CARD.chainDepth}）
                </Badge>
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3">
                {/* 模型行：组合记录 + [改] */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0 text-11 text-muted-foreground">模型</span>
                  <span className="font-mono text-12">{APPROVAL_CARD.comboModelName}</span>
                  <Badge tone="ai">组合记录 · 一个 model_id → pipeline</Badge>
                  <Button size="xs" variant="outline" onClick={() => setChangeOpen(true)} data-testid="routing-change-model">[改]</Button>
                </div>
                {/* token 预算 */}
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-11 text-muted-foreground">token 预算</span>
                  <span className="text-12">{APPROVAL_CARD.tokenBudget}</span>
                </div>
                {/* 要读的数据 · 含机密可点解释 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0 text-11 text-muted-foreground">要读的数据</span>
                  <span className="text-12">项目库 ＋ 电价曲线</span>
                  {ROUTING_HAS_CONFIDENTIAL && (
                    <Button size="xs" variant="ghost" onClick={() => setExplainOpen(true)} data-testid="routing-confidential-explain">
                      <Lock aria-hidden className="h-3 w-3" />
                      含机密，仅本地模型
                      <Info aria-hidden className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* 三个出口 */}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => setToast("已批准执行，转后台任务，约 6 分钟回到本线程")} data-testid="routing-approve">批准执行</Button>
                <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)} data-testid="routing-rerun">改参数再跑</Button>
                <Button size="sm" variant="ghost" onClick={() => setToast("已取消本次动作，未执行、未出域")} data-testid="routing-cancel">不用了</Button>
                <span className="self-center text-11 text-muted-foreground">{APPROVAL_CARD.backAfter}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <DecisionNote testid="routing-note-explain">
          我替 UC 补的：原型里「含机密，仅本地模型」是<strong>纯文本、行内无入口</strong>。UC-20.3 R8 记它为原型确认缺失。
          这里把它做成<strong>可点的解释下钻</strong>（点开看哪些内容被判为机密、依据什么标记），让批准人能对判定负责。
        </DecisionNote>
      </div>

      {/* 机密判定解释下钻 */}
      {explainOpen && (
        <AdminModal
          testid="routing-explain-dialog"
          title="为什么本次仅限本地模型"
          subtitle="机密判定发生在上下文装配完成后、模型调用发起前（材料级粒度 O-17）"
          onClose={() => setExplainOpen(false)}
        >
          <div className="flex flex-col gap-2" data-testid="routing-context-items">
            {ROUTING_CONTEXT.map((it, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2" data-testid={`routing-context-${i}`}>
                <Badge tone="neutral">{it.source}</Badge>
                <span className="min-w-0 flex-1 text-12">{it.label}</span>
                {it.confidential
                  ? <Badge tone="danger"><Lock aria-hidden className="h-3 w-3" /> 机密</Badge>
                  : <Badge tone="outline">非机密</Badge>}
              </div>
            ))}
            <p className="mt-1 text-11 text-muted-foreground">
              上下文含 2 份机密材料 → 整次调用判为含机密 → 候选集收窄为「已启用 ∩ 开源自托管」。
              判定不确定时从严（按含机密处理）。任何绕过尝试被服务端拒绝并计入越权拦截计数。
            </p>
          </div>
        </AdminModal>
      )}

      {/* [改] 面板 · 含机密时候选只有自托管 */}
      {changeOpen && (
        <AdminModal
          testid="routing-change-dialog"
          title="改模型"
          subtitle={ROUTING_HAS_CONFIDENTIAL ? "本次含机密，闭源模型不可选，只列出已启用的自托管候选" : "可选全部已启用模型"}
          onClose={() => setChangeOpen(false)}
        >
          <div className="flex flex-col gap-2">
            {ROUTING_HAS_CONFIDENTIAL && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5">
                <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-11">闭源 API 模型在含机密时不可选——这是系统判定结果，不是可选偏好。</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5" data-testid="routing-change-candidates">
              {candidates.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setChangeOpen(false); setToast(`已改用本地模型 ${m.name}，机密仍不出自托管`); }}
                  data-testid={`routing-candidate-${m.id}`}
                  className="flex items-center gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2 text-left transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                >
                  <ArrowRight aria-hidden className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-12">{m.name}</span>
                  <Badge tone="ai"><ShieldCheck aria-hidden className="h-3 w-3" /> 可承接机密</Badge>
                  <span className="ml-auto text-11 text-muted-foreground">{m.vendor}</span>
                </button>
              ))}
            </div>
            <p className="text-11 text-muted-foreground">
              闭源候选（gpt-5.2 / claude-opus 等 <Check aria-hidden className="inline h-3 w-3" /> 已启用）本可用于非机密场景，但本次<strong>不出现在候选里</strong>。
            </p>
          </div>
        </AdminModal>
      )}

      <Toast message={toast} testid="routing-toast" onDismiss={() => setToast(null)} />
    </RuntimeShell>
  );
}
