"use client";
import * as React from "react";
import { ShieldAlert, Boxes, Share2, Lock } from "lucide-react";
import { RuntimeShell, SectionTitle, DecisionNote } from "./runtime-shell";
import { AdminModal, Toast, KV } from "@/components/admin/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import type { UiState } from "@/lib/ui-state";
import { PRIVATE_CHAT, PRESENCE_LABEL, type RuntimeRole } from "@/lib/mock/agent-runtime";

const ROLES: RuntimeRole[] = ["facilitator", "groupLead", "member", "observer"];

export function ChatScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [transferOf, setTransferOf] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  // O-24：组员默认不可私聊（由引导师逐场开关）；观察者无私聊入口
  const memberChatEnabled = false;
  const noEntry = role === "observer" || (role === "member" && !memberChatEnabled);

  return (
    <RuntimeShell
      screen="chat"
      role={role}
      state={state}
      roles={ROLES}
      title="与单个 agent 私聊"
      intro="点 AI 团队里某个 agent，右侧滑出与它的独立对话，显示它挂载的 skill。对话不进主线程；把结论转到主线程时带出处（agent + skill 版本 + 数据来源）。"
      emptyHint="本线程没有可私聊的 agent（团队为空或全部不可见），不生成示例对话"
      errors={{ transfer: "转出被拒：目标主线程已归档/只读，私聊内容已保留。" }}
      depFailure="该 agent 的模型已停用 / MCP 隔离；私聊可开启但明确告知能力受限，不静默换模型。"
      denialReason="观察者不可发言、无私聊入口；组员默认不可私聊，由引导师逐场开关。"
      successMessage="已把结论转到主线程，带完整出处；私聊内容未出现在主线程"
    >
      {noEntry ? (
        <Card data-testid="chat-no-entry">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Lock aria-hidden className="h-6 w-6 text-muted-foreground" />
            <p className="text-13 font-medium">当前视角没有私聊入口</p>
            <p className="text-12 text-muted-foreground">
              {role === "observer" ? "观察者只读已发布内容，不可发言、无私聊入口。" : "组员默认不可私聊，需引导师在本场打开开关（逐场生效，不跨场继承）。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3" data-testid="chat-panel">
          {/* 面板顶部固定：身份 + 状态 + 模型 + skill 清单 + 审计告知 */}
          <Card>
            <CardContent className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Avatar initials={PRIVATE_CHAT.agentInitials} tone="ai" size="md" />
                <div className="flex flex-col">
                  <span className="text-13 font-medium">{PRIVATE_CHAT.agentName}</span>
                  <span className="text-11 text-muted-foreground">{PRIVATE_CHAT.agentRole}</span>
                </div>
                <Badge tone="primary">{PRESENCE_LABEL[PRIVATE_CHAT.presence]}</Badge>
                <span className="ml-auto font-mono text-11 text-muted-foreground">{PRIVATE_CHAT.model}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="chat-skills">
                <Boxes aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-11 text-muted-foreground">挂载 skill：</span>
                {PRIVATE_CHAT.skills.map((s) => (
                  <Badge key={s.name} tone="outline" data-testid={`chat-skill-${s.version}`}>{s.name} · {s.version}</Badge>
                ))}
              </div>
              {/* O-24 明示告知：本对话属于本项目，可被审计 */}
              <p className="inline-flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-11" data-testid="chat-audit-notice">
                <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                {PRIVATE_CHAT.auditNotice}
              </p>
            </CardContent>
          </Card>

          {/* 消息流（视觉区分于主线程；每条 agent 结论旁给 [转到主线程]） */}
          <div className="flex flex-col gap-2" data-testid="chat-messages">
            {PRIVATE_CHAT.messages.map((m) => (
              <div key={m.id} className={`flex flex-col gap-1 rounded-md border p-2.5 ${m.from === "user" ? "border-border-subtle bg-panel" : "border-ai/20 bg-ai-tint"}`} data-testid={`chat-msg-${m.id}`}>
                <span className="text-10 font-medium text-muted-foreground">{m.from === "user" ? "你" : `${PRIVATE_CHAT.agentName}（机器产出）`}</span>
                <p className={`text-12 ${m.from === "agent" ? "text-ai-tint-foreground" : ""}`}>{m.text}</p>
                {m.transferable && (
                  <div>
                    <Button size="xs" variant="outline" onClick={() => setTransferOf(m.id)} data-testid={`chat-transfer-${m.id}`}>
                      <Share2 aria-hidden className="h-3 w-3" /> 转到主线程
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 输入区（占位，不真发） */}
          <div className="flex items-end gap-2" data-testid="chat-input-row">
            <Textarea rows={2} placeholder="问 Ava 一件事…（私聊不进主线程）" aria-label="私聊输入" className="flex-1" data-testid="chat-input" />
            <Button size="sm" variant="primary" onClick={() => setToast("已发送（mock，不真调用模型）")} data-testid="chat-send">发送</Button>
          </div>

          <DecisionNote testid="chat-note-entry">
            我替 UC 补的：UC-4.3 明说「点某个 agent 进私聊」的入口与右侧滑出面板<strong>原型确认缺失</strong>（档案里的「私聊」全指人际私聊）。
            本面板整体是补画，需逐条 sign-off：右侧滑出布局、skill 清单呈现、`[转到主线程]` 的位置与出处预览。
          </DecisionNote>
        </div>
      )}

      {/* 转出到主线程 · 出处预览 */}
      {transferOf && (
        <AdminModal
          testid="chat-transfer-dialog"
          title="转到主线程 · 出处预览"
          subtitle="转过去时带出处；主线程中仍标识为机器产出，可点回私聊原文（受权限约束）"
          onClose={() => setTransferOf(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setTransferOf(null)} data-testid="chat-transfer-cancel">取消</Button>
              <Button size="sm" variant="primary" onClick={() => { setTransferOf(null); setToast("已转到主线程，带完整出处"); }} data-testid="chat-transfer-confirm">确认转出</Button>
            </>
          }
        >
          <div className="flex flex-col divide-y divide-border-subtle" data-testid="chat-transfer-provenance">
            <KV k="来自" v={`与 ${PRIVATE_CHAT.agentName} 的私聊`} />
            <KV k="agent 版本" v={PRIVATE_CHAT.transferProvenance.agentVersion} />
            <KV k="skill 版本" v={PRIVATE_CHAT.transferProvenance.skillVersion} />
            <KV k="时间" v={PRIVATE_CHAT.transferProvenance.at} />
            <KV k="数据来源" v={PRIVATE_CHAT.transferProvenance.dataSources} />
          </div>
        </AdminModal>
      )}

      <Toast message={toast} testid="chat-toast" onDismiss={() => setToast(null)} />
    </RuntimeShell>
  );
}
