"use client";
import * as React from "react";
import { X, Users, Wrench, FileText, Target, Cpu, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import {
  TEAM_AGENTS, TEAM_ROSTER_COUNT, AGENT_PRESENCE_LABEL,
  CHAT_MESSAGES, isModelSelectable, type TeamAgent, type ApprovalRequest,
} from "@/lib/mock/chat";

/** 取流里第一张仍待批准的卡，用它的 registry 数据做模型/预算投影（与批准卡同源） */
const APPROVAL: ApprovalRequest | undefined = CHAT_MESSAGES.find(
  (m): m is Extract<typeof m, { kind: "approval" }> => m.kind === "approval",
)?.request;

/**
 * 「更多设置」面板（UC-8.2 R3 三 / UC-4.2 R3 步骤 6·9）
 *
 * 补的是原型的一个**死按钮**：底部状态条四段（`Ava ＋3` · `skill：假设拆解` ·
 * `已引用 3 项上下文` · `输出到「假设树」`）旁边有 `更多设置 ▸`，点了没有任何界面。
 * 这四段状态显示的正是本轮调用的四个可调参数，所以面板就是它们的可编辑形态——
 * **不是另开一套设置**，而是把已经显示出来的东西变得可改。
 *
 * 五个分区，前四个逐一对应状态条的四段，第五个是模型与预算：
 *   ① 谁来答      ← `Ava ＋3`
 *   ② 用哪个 skill ← `skill：假设拆解`
 *   ③ 读什么上下文  ← `已引用 3 项上下文`
 *   ④ 产出到哪     ← `输出到「假设树」`
 *   ⑤ 模型与预算   ← 与批准卡同一套 registry（D-07）
 *
 * ⚠ 机密约束与批准卡同源：`要读的数据` 含机密时，模型选择只允许自托管——
 *   这里显示的是同一条判定的前置投影，不是第二套规则。
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ComposerSettings({ open, onClose }: Props) {
  const [agents, setAgents] = React.useState<string[]>(
    TEAM_AGENTS.filter((a) => a.presence === "present").slice(0, 4).map((a) => a.id),
  );
  const [skill, setSkill] = React.useState("mece-hypothesis");
  const [scopes, setScopes] = React.useState<string[]>(["project-lib", "transcript", "brain"]);
  const [output, setOutput] = React.useState("hypothesis-tree");
  const [proactive, setProactive] = React.useState(true);

  if (!open) return null;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const confidential = scopes.includes("confidential");

  return (
    <div
      id="chat-settings-panel"
      data-testid="chat-settings-panel"
      role="dialog"
      aria-label="本轮调用设置"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-md"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-13 font-semibold">本轮调用设置</h2>
        <span className="text-11 text-muted-foreground">改动只影响下一轮，不改线程默认编制</span>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭设置" data-testid="chat-settings-close" className="ml-auto">
          <X aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Separator />

      {/* ① 谁来答 */}
      <Section icon={Users} title="谁来答" hint={`已选 ${agents.length} 个 · 线程编制共 ${TEAM_ROSTER_COUNT} 个`}>
        <div className="flex flex-wrap gap-1.5" data-testid="chat-settings-agents">
          {TEAM_AGENTS.map((a) => (
            <AgentChip key={a.id} agent={a} selected={agents.includes(a.id)} onToggle={() => toggle(agents, setAgents, a.id)} />
          ))}
        </div>
        <p className="text-10 text-muted-foreground">
          跑批中与空闲的 agent 也可选中——它们不计入「在场数」，但可以接本轮的活。
        </p>
      </Section>

      {/* ② skill */}
      <Section icon={Wrench} title="用哪个 skill" hint="phase-1 的 skill 是声明式契约（D-06），不跑任意代码">
        <ChipGroup
          testid="chat-settings-skill"
          value={skill}
          onChange={setSkill}
          options={[
            { id: "mece-hypothesis", label: "MECE 假设拆解" },
            { id: "evidence-check", label: "证据交叉核验" },
            { id: "jtbd-interview", label: "Jobs-to-be-done 访谈法" },
            { id: "none", label: "不用 skill" },
          ]}
        />
      </Section>

      {/* ③ 上下文 */}
      <Section icon={FileText} title="读什么上下文" hint={`已选 ${scopes.length} 项`}>
        <div className="flex flex-wrap gap-1.5" data-testid="chat-settings-context">
          {[
            { id: "project-lib", label: "项目库", meta: "1,482 条" },
            { id: "transcript", label: "本场转录", meta: "28:14" },
            { id: "brain", label: "组织大脑", meta: "604 条" },
            { id: "files", label: "项目文件", meta: "12 件" },
            { id: "confidential", label: "客户机密材料", meta: "含机密", danger: true },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(scopes, setScopes, o.id)}
              aria-pressed={scopes.includes(o.id)}
              data-testid={`chat-settings-scope-${o.id}`}
              className={[
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-11 transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                scopes.includes(o.id)
                  ? o.danger
                    ? "border-warning bg-warning/10 text-warning"
                    : "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {o.label}
              <span className="text-10 text-muted-foreground">{o.meta}</span>
            </button>
          ))}
        </div>
        {confidential && (
          <p role="alert" data-testid="chat-settings-confidential-notice" className="text-10 text-warning">
            含机密材料 —— 按裁决 D-U1「<strong className="font-medium">全程本地</strong>」，
            本轮<strong className="font-medium">所有</strong>模型调用都走本地，云端模型整轮不可用
            （不是「机密走本地、云端承接非机密」）。与批准卡是同一条判定，服务端 gateway 按同一规则拦截。
          </p>
        )}
      </Section>

      {/* ④ 产出 */}
      <Section icon={Target} title="产出到哪" hint="决定这轮的结论落到哪个产物上">
        <ChipGroup
          testid="chat-settings-output"
          value={output}
          onChange={setOutput}
          options={[
            { id: "hypothesis-tree", label: "假设树" },
            { id: "insight-board", label: "洞察库" },
            { id: "report-draft", label: "报告草稿" },
            { id: "thread-only", label: "只回本线程" },
          ]}
        />
      </Section>

      {/* ⑤ 模型与预算 */}
      <Section icon={Cpu} title="模型与预算" hint={APPROVAL ? `取自 ${APPROVAL.budget.registrySource}` : "registry 不可用"}>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="chat-settings-models">
          {APPROVAL?.models.map((m) => {
            // 裁决 D-U1：含机密时云端模型**整轮不可用**，界面直接置灰并注明原因（不是隐藏——
            // 隐藏会让人以为「没有这个模型」，置灰+原因才说明「有但本轮不允许」）
            const sel = isModelSelectable(m, confidential ? [{ id: "c", label: "客户机密材料", confidential: true }] : []);
            return (
              <span key={m.id} title={sel.reason} data-testid={`chat-settings-model-${m.id}`}>
                <Badge tone={!sel.ok ? "neutral" : m.hosting === "local" ? "primary" : "neutral"}>
                  {!sel.ok && <span className="mr-0.5">✕</span>}
                  <span className={!sel.ok ? "line-through" : undefined}>{m.label}</span>
                </Badge>
              </span>
            );
          })}
          {APPROVAL && <Badge tone="outline">预算 {APPROVAL.budget.tokens}</Badge>}
        </div>
        <p className="text-10 text-muted-foreground">
          实际拦截在服务端 gateway 执行，这里只是前置投影。超预算或触发机密路由时会转成批准卡等你确认。
        </p>
      </Section>

      <Separator />

      {/* 主动补充（说明页明写的四条规则之一） */}
      <div className="flex items-center gap-2">
        <Radio aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-12 font-medium">允许 agent 主动补充</span>
          <span className="text-10 text-muted-foreground">
            默认开。主动发言<strong className="font-medium text-background-foreground">必须带来源</strong>，否则会变噪音——这条不可关。可按单个 agent 关闭主动性。
          </span>
        </div>
        <div className="ml-auto shrink-0">
          <Toggle checked={proactive} onCheckedChange={setProactive} label="允许 agent 主动补充" id="chat-settings-proactive" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <p className="text-10 text-muted-foreground">改动即时生效于下一轮</p>
        <Button size="sm" variant="secondary" onClick={onClose} data-testid="chat-settings-apply" className="ml-auto">
          完成
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon, title, hint, children,
}: { icon: typeof Users; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5">
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
        <h3 className="text-12 font-medium">{title}</h3>
        {hint && <span className="text-10 text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function AgentChip({
  agent, selected, onToggle,
}: { agent: TeamAgent; selected: boolean; onToggle: () => void }) {
  const busy = agent.presence !== "present";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      data-testid={`chat-settings-agent-${agent.id}`}
      className={[
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-11 transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-ai bg-ai-tint text-ai-tint-foreground" : "border-border text-muted-foreground hover:bg-muted",
      ].join(" ")}
    >
      <span className="font-medium">{agent.name}</span>
      {busy && <span className="text-10 text-muted-foreground">{AGENT_PRESENCE_LABEL[agent.presence]}</span>}
    </button>
  );
}

function ChipGroup({
  testid, value, onChange, options,
}: { testid: string; value: string; onChange: (v: string) => void; options: { id: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          data-testid={`${testid}-${o.id}`}
          className={[
            "rounded-md border px-2 py-1 text-11 transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.id ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
