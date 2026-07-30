"use client";
import * as React from "react";
import { Boxes, Share2, Lock, Users, X, Send } from "lucide-react";
import { RuntimeShell, DecisionNote } from "./runtime-shell";
import { AdminModal, Toast, KV } from "@/components/admin/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import {
  AGENT_CHAT_ROSTER, MEMBER_CHAT_DEFAULT_ON, MEMBER_CHAT_META,
  PRESENCE_LABEL, PRIVATE_CHAT, type RuntimeRole, type ChatAgent,
} from "@/lib/mock/agent-runtime";

const ROLES: RuntimeRole[] = ["facilitator", "groupLead", "member", "observer"];

/**
 * 与单个 agent 私聊（UC-4.3）—— v2 重画。
 *
 * v1 三重错已在 mock 头注逐条列明：把「私聊」当成人际私聊、只画单个 Ava、把组员默认画反。
 * v2 忠实还原原型：侧栏「本线程的 AI 团队 · 6」花名册（每行一个可私聊 agent）→ 点开右侧滑出
 * 该 agent 的独立对话（skill 清单 / 往返 / 快捷追问 / agent 专属占位符 / 「只和这个 agent 单聊，不进主线程」）。
 * 组员默认**可**私聊（原型「开·必留」），观察者无入口。
 */
export function ChatScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [transferOf, setTransferOf] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  // 组员默认可私聊（原型「开·必留」，MEMBER_CHAT_DEFAULT_ON = true）；观察者只读、无入口。
  const memberChatEnabled = MEMBER_CHAT_DEFAULT_ON;
  const noEntry = role === "observer" || (role === "member" && !memberChatEnabled);

  const cur = AGENT_CHAT_ROSTER.find((a) => a.key === openKey) ?? null;

  return (
    <RuntimeShell
      screen="chat"
      role={role}
      state={state}
      roles={ROLES}
      title="与单个 agent 私聊"
      intro="侧栏「本线程的 AI 团队 · 6」——每个 agent 都能单独私聊；点一个，右侧滑出与它的独立对话，显示它挂载的 skill。对话不进主线程；把结论转到主线程时带出处（agent + skill 版本 + 数据来源）。"
      emptyHint="本线程没有可私聊的 agent（团队为空或全部不可见），不生成示例对话"
      errors={{ transfer: "转出被拒：目标主线程已归档/只读，私聊内容已保留。" }}
      depFailure="该 agent 的模型已停用 / MCP 隔离；私聊可开启但明确告知能力受限，不静默换模型。"
      denialReason="观察者不可发言、无私聊入口；组员默认可私聊且必留档（原型「开·必留」）。"
      successMessage="已把结论转到主线程，带完整出处；私聊内容未出现在主线程"
    >
      {noEntry ? (
        <Card data-testid="chat-no-entry">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Lock aria-hidden className="h-6 w-6 text-muted-foreground" />
            <p className="text-13 font-medium">当前视角没有私聊入口</p>
            <p className="text-12 text-muted-foreground">
              观察者只读已发布内容，不可发言、无私聊入口。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 组员私聊默认策略（原型「开·必留」）—— 把 v1 画反的默认值显式标出 */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-panel px-3 py-2" data-testid="chat-member-policy">
            <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
            <span className="text-12 font-medium">{MEMBER_CHAT_META.label}</span>
            <span className="text-11 text-muted-foreground">{MEMBER_CHAT_META.usage}</span>
            <Badge tone="primary" className="ml-auto">默认 {MEMBER_CHAT_META.policy}</Badge>
          </div>

          {/* 花名册：本线程的 AI 团队 · 6（每行一个可私聊 agent）*/}
          <section className="flex flex-col gap-1.5" data-testid="chat-roster">
            <div className="flex items-center gap-2">
              <h2 className="text-13 font-semibold">本线程的 AI 团队 · {AGENT_CHAT_ROSTER.length}</h2>
              <span className="text-10 text-muted-foreground">点任一行 → 右侧滑出与它单聊</span>
            </div>
            {AGENT_CHAT_ROSTER.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setOpenKey(a.key)}
                data-testid={`chat-roster-row-${a.key}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border border-border-subtle bg-card p-2.5 text-left transition-colors hover:bg-panel",
                  openKey === a.key && "border-ai/40 bg-ai-tint",
                )}
              >
                <Avatar initials={a.initials} tone="ai" size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-12 font-medium">{a.name} · {a.role}</span>
                    <span className="ml-auto shrink-0 font-mono text-9 text-muted-foreground">{PRESENCE_LABEL[a.presence]}</span>
                  </div>
                  <p className="truncate text-10 text-muted-foreground">{a.desc}</p>
                </div>
              </button>
            ))}
          </section>

          <DecisionNote testid="chat-note-entry">
            v2 修正：原型 <strong>AG 数组明确定义 6 个可单独私聊的 agent</strong>（偏移 17044000–17048000），
            侧栏「本线程的 AI 团队·6」每行都是「点开单聊」入口。v1 误判「私聊全指人际私聊」、只画单个 Ava、
            还把组员默认画反成不可私聊——三处都已按原型改回。sign-off 重点：右侧滑出布局、skill 清单、
            <code>[转到主线程]</code> 的位置与出处预览、组员默认「开·必留」是否符合本组规则。
          </DecisionNote>
        </div>
      )}

      {/* 右侧滑出：与选中 agent 的私聊抽屉 */}
      {cur && (
        <ChatDrawer
          agent={cur}
          onClose={() => setOpenKey(null)}
          onTransfer={(i) => setTransferOf(`${cur.key}-${i}`)}
          onSend={() => setToast("已发送（mock，不真调用模型）")}
        />
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
            <KV k="来自" v={`与 ${cur?.name ?? PRIVATE_CHAT.agentName} 的私聊`} />
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

/* ── 右侧滑出私聊抽屉（原型 agentChatOpen / closeAgentChat，偏移 16721252）──────────── */

function ChatDrawer({
  agent, onClose, onTransfer, onSend,
}: {
  agent: ChatAgent;
  onClose: () => void;
  onTransfer: (i: number) => void;
  onSend: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-background/40" onClick={onClose} data-testid="chat-drawer-overlay">
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="chat-drawer"
      >
        {/* 头：身份 + 模型 + 关闭 */}
        <div className="flex items-center gap-2.5 border-b border-border-subtle bg-panel p-3.5">
          <Avatar initials={agent.initials} tone="ai" size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-13 font-medium" data-testid="chat-drawer-name">{agent.name} · {agent.role}</p>
            <p className="truncate font-mono text-9 text-muted-foreground">{agent.model}</p>
          </div>
          <Badge tone="primary">{PRESENCE_LABEL[agent.presence]}</Badge>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭私聊" data-testid="chat-drawer-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </div>

        {/* 挂载 skill 清单 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle p-3" data-testid="chat-drawer-skills">
          <Boxes aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          {agent.skills.map((s) => (
            <Badge key={s} tone="outline" data-testid={`chat-skill-${agent.key}-${s}`}>{s}</Badge>
          ))}
        </div>

        {/* 往返消息 */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5" data-testid="chat-drawer-messages">
          {agent.lines.map((l, i) => (
            <div key={i} className={cn("flex flex-col gap-1", l.self ? "items-end" : "items-start")}>
              <span className="font-mono text-9 text-muted-foreground">{l.who} · {l.t}</span>
              <div
                className={cn(
                  "max-w-[90%] rounded-lg border p-2.5 text-11 leading-relaxed",
                  l.self ? "border-inverse bg-inverse text-inverse-foreground" : "border-border-subtle bg-card text-foreground",
                )}
              >
                {l.text}
              </div>
              {!l.self && (
                <Button size="xs" variant="outline" onClick={() => onTransfer(i)} data-testid={`chat-transfer-${agent.key}-${i}`}>
                  <Share2 aria-hidden className="h-3 w-3" /> 转到主线程
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* 输入区：快捷追问 + agent 专属占位符 + 「不进主线程」告知 */}
        <div className="border-t border-border-subtle bg-panel p-3">
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="chat-drawer-quick">
            {agent.quick.map((q) => (
              <Button key={q} size="xs" variant="outline" onClick={onSend} data-testid={`chat-quick-${agent.key}-${q}`}>{q}</Button>
            ))}
          </div>
          <div className="rounded-lg border border-border-subtle bg-card p-2">
            <Textarea rows={2} placeholder={agent.placeholder} aria-label="私聊输入" className="border-0 bg-transparent p-0" data-testid="chat-drawer-input" />
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-9 text-muted-foreground">只和这个 agent 单聊，不进主线程</span>
              <Button size="sm" variant="primary" className="ml-auto" onClick={onSend} data-testid="chat-drawer-send">
                <Send aria-hidden className="h-3 w-3" /> 发送
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
