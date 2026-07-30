"use client";
import * as React from "react";
import { Users, Info, ArrowRightLeft, Wifi, WifiOff, Scissors } from "lucide-react";
import { RuntimeShell, SectionTitle, DecisionNote } from "./runtime-shell";
import { Toast } from "@/components/admin/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Toggle } from "@/components/ui/toggle";
import type { UiState } from "@/lib/ui-state";
import {
  THREAD_AI_TEAM, TEAM_COUNTS, NEXT_SEGMENT_SWAP, CLIPPED_BY_PRIORITY,
  PROJECT_AI_SWITCHES, REASSIGN_HINT, PRESENCE_LABEL, requireValue,
  type PresenceState, type RuntimeRole,
} from "@/lib/mock/agent-runtime";

/**
 * 三个开关的**默认值未裁**（O-23 裁决行只答了合成规则，见
 * `@repo/contracts/thresholds` 的 `projectAiDefault*`）。
 *
 * ⚠ 这里刻意**不**回落成 `false`——「默认全关」是一个从未被裁决、
 * 且被原型（15.2532M「3 项 · 1 项已关」）与 D-10 两次否定的方向。
 * 未裁时界面进入 `null`（未定）态并把缺口画出来，
 * 而**取值**仍走 `requireValue`（裁决落地后 `known: true`，此处自然拿到真值）。
 */
function initialSwitchState(): Record<string, boolean | null> {
  return Object.fromEntries(
    PROJECT_AI_SWITCHES.map((s) => [
      s.id,
      s.defaultOn.known ? requireValue<boolean>(s.defaultOn, s.defaultOnName) : null,
    ]),
  );
}

const ROLES: RuntimeRole[] = ["facilitator", "groupLead", "member", "observer", "admin"];
const PRESENCE_TONE: Record<PresenceState, "primary" | "warning" | "neutral"> = {
  present: "primary", running: "warning", idle: "neutral",
};

export function TeamScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [aiOn, setAiOn] = React.useState<Record<string, boolean | null>>(initialSwitchState);
  const [realtime, setRealtime] = React.useState(true);
  const [reasoned, setReasoned] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const canEdit = role === "facilitator" || role === "admin";

  return (
    <RuntimeShell
      screen="team"
      role={role}
      state={state}
      roles={ROLES}
      title="AI 团队编排 · 主持台"
      intro="谁在场随现场状态自动变化。主持台回答三件事：当前载入了谁 / 为什么 / 下一步换成谁。编制数 ≠ 在场数。项目级 AI 权限三开关按收紧优先合成（O-23）；三者的默认值 O-23 未裁，界面显示为「默认值未裁」。"
      emptyHint="本线程还没有任何 agent —— 从 Agent 市场加入一个，不自动塞默认 agent"
      errors={{ team: "编制校验失败：Ledger『仅能源组』可见性范围不覆盖本项目（平台组），无法载入。" }}
      depFailure="规则求值依赖议程环节事件与实时通道；实时通道不可用，团队切换已降级为轮询。"
      denialReason="组员只看到载入到自己对话里的 agent，不可编制、不可改派；观察者仅可见在场名单。"
      successMessage="已按议程环节『假设梳理』重新载入 AI 团队，载入原因已记录"
    >
      <div className="flex flex-col gap-5">
        {/* 实时/非实时标注 */}
        <div className="flex items-center justify-between rounded-md border border-border-subtle bg-panel px-3 py-2" data-testid="team-realtime">
          <span className="inline-flex items-center gap-1.5 text-11 text-muted-foreground">
            {realtime ? <Wifi aria-hidden className="h-3.5 w-3.5 text-success" /> : <WifiOff aria-hidden className="h-3.5 w-3.5 text-warning" />}
            {realtime ? "实时 · 状态事件到团队切换 < 1 秒" : "非实时 · 最后更新 14:32（实时通道不可用，已降级为轮询）"}
          </span>
          <Button size="xs" variant="outline" onClick={() => setRealtime((v) => !v)} data-testid="team-realtime-toggle">
            {realtime ? "模拟：实时通道断开" : "恢复实时"}
          </Button>
        </div>

        {/* A · 线程级 AI 团队编制（三态 + 因什么载入） */}
        <section className="flex flex-col gap-2" data-testid="team-roster">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle hint="每行 hover/展开显示『因什么载入』（触发事件 + 命中规则）——原型 0 命中，AC1 载体。">
              本线程的 AI 团队
            </SectionTitle>
            <div className="flex items-center gap-2 text-11">
              <Badge tone="neutral" data-testid="team-count-roster"><Users aria-hidden className="h-3 w-3" /> 编制 · {TEAM_COUNTS.roster}</Badge>
              <Badge tone="primary" data-testid="team-count-present">在场 · {TEAM_COUNTS.present}</Badge>
              {canEdit && <Button size="xs" variant="outline" onClick={() => setToast("已打开编制面板（＋ 从 Agent 市场加入 / 静音全部主动插话）")} data-testid="team-edit">编制</Button>}
            </div>
          </div>

          {THREAD_AI_TEAM.map((m) => (
            <Card key={m.id} data-testid={`team-member-${m.id}`}>
              <CardContent className="flex flex-col gap-1.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar initials={m.initials} tone="ai" size="sm" />
                  <span className="text-12 font-medium">{m.name}</span>
                  <span className="text-11 text-muted-foreground">{m.role}</span>
                  <Badge tone={PRESENCE_TONE[m.presence]} data-testid={`team-presence-${m.id}`}>{PRESENCE_LABEL[m.presence]}</Badge>
                  {m.presence === "running" && (
                    <Button size="xs" variant="ghost" onClick={() => setToast("已打开任务队列（跑批中的 agent 不因环节切换被强杀）")} data-testid={`team-queue-${m.id}`}>看任务队列</Button>
                  )}
                  <span className="ml-auto font-mono text-10 text-muted-foreground">{m.model}</span>
                  <Button size="xs" variant="ghost" onClick={() => setReasoned(reasoned === m.id ? null : m.id)} data-testid={`team-why-${m.id}`}>
                    <Info aria-hidden className="h-3 w-3" /> 因什么载入
                  </Button>
                </div>
                <p className="text-11 text-muted-foreground">{m.ability}</p>
                {reasoned === m.id && (
                  <p className="rounded-md border border-ai/20 bg-ai-tint px-2.5 py-1.5 text-11 text-ai-tint-foreground" data-testid={`team-reason-${m.id}`}>
                    载入原因：{m.loadReason}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}

          <DecisionNote testid="team-note-count">
            我替 UC 定的口径：侧栏「编制 {TEAM_COUNTS.roster}」与头部「在场 {TEAM_COUNTS.present}」是<strong>两个接口字段</strong>，分别标注不混用（AC2）。
            这是原型里两个数字对不上（「AI 团队 · 6」vs「团队 4」）的正解。
          </DecisionNote>
        </section>

        {/* B · 下一环节提前提示 + 优先级裁剪 */}
        <section className="grid gap-3 sm:grid-cols-2">
          <Card data-testid="team-next-segment">
            <CardContent className="flex flex-col gap-2 py-3">
              <SectionTitle hint="Backlog 要求、原型无此呈现——补画在主持台。">下一步换成谁 · {NEXT_SEGMENT_SWAP.nextSegment}</SectionTitle>
              {NEXT_SEGMENT_SWAP.willAdd.map((a) => (
                <p key={a.name} className="inline-flex items-center gap-1.5 text-11"><ArrowRightLeft aria-hidden className="h-3 w-3 text-success" /> 将载入 <strong>{a.name}</strong> · {a.role}（{a.why}）</p>
              ))}
              {NEXT_SEGMENT_SWAP.willIdle.map((a) => (
                <p key={a.name} className="inline-flex items-center gap-1.5 text-11 text-muted-foreground"><ArrowRightLeft aria-hidden className="h-3 w-3" /> 转空闲 {a.name} · {a.role}（{a.why}）</p>
              ))}
            </CardContent>
          </Card>
          <Card data-testid="team-clipped">
            <CardContent className="flex flex-col gap-2 py-3">
              <SectionTitle hint="同时命中多条规则取前 4 避免刷屏，被裁剪的可查、不静默丢弃（E1）。">本可载入但被优先级裁剪</SectionTitle>
              {CLIPPED_BY_PRIORITY.map((a) => (
                <p key={a.name} className="inline-flex items-center gap-1.5 text-11 text-muted-foreground" data-testid={`team-clip-${a.name}`}><Scissors aria-hidden className="h-3 w-3" /> {a.name} · {a.role}（{a.why}）</p>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* C · 改派提示条（基于 MCP 授权集） */}
        {(role === "facilitator" || role === "admin" || role === "member") && (
          <Card data-testid="team-reassign">
            <CardContent className="flex flex-wrap items-center gap-2 py-3">
              <ArrowRightLeft aria-hidden className="h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 text-12">
                这条更适合 <strong>{REASSIGN_HINT.suggestedAgent}</strong>：它有<strong>{REASSIGN_HINT.authName}</strong>，改派后本轮由它回答。
              </p>
              {role !== "member" ? (
                <>
                  <Button size="xs" variant="primary" onClick={() => setToast(`已改派本轮给 ${REASSIGN_HINT.suggestedAgent}`)} data-testid="team-reassign-do">改派</Button>
                  <Button size="xs" variant="ghost" onClick={() => setToast("已忽略改派建议")} data-testid="team-reassign-x">×</Button>
                </>
              ) : (
                <Badge tone="outline" data-testid="team-reassign-member-note">组员是否可见改派 · 待确认</Badge>
              )}
            </CardContent>
          </Card>
        )}

        {/* D · 项目级 AI 权限三开关（合成规则已裁 O-23；**默认值未裁**） */}
        <section className="flex flex-col gap-2" data-testid="team-ai-switches">
          <SectionTitle hint="O-23 裁的是合成规则：收紧优先（任一层关闭即关闭，下层不能放宽），服务端求交。变更须留痕、对项目成员可见。⚠ 三个开关的默认值 O-23 未裁 —— 此前写的「默认全关」是伪造出处，且原型为「3 项 · 1 项已关」。">
            项目级 AI 权限（这场里的权限）
          </SectionTitle>
          <Badge tone="warning" data-testid="team-ai-switch-default-pending">
            默认值待人类裁决 · 无出处（O-23 裁决行只答了合成规则；原型 15.2532M 为「3 项 · 1 项已关」，与「默认全关」相反）
          </Badge>
          {PROJECT_AI_SWITCHES.map((s) => (
            <Card key={s.id} data-testid={`team-switch-${s.id}`}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-12 font-medium">{s.label}</span>
                    {aiOn[s.id] === null ? (
                      <Badge tone="warning" data-testid={`team-switch-pending-${s.id}`}>
                        默认值未裁
                      </Badge>
                    ) : (
                      aiOn[s.id] === false && <Badge tone="outline">本场已关闭</Badge>
                    )}
                  </div>
                  <p className="text-11 text-muted-foreground">{s.offConsequence}</p>
                  <p className="text-10 text-muted-foreground">受影响：{s.affected}</p>
                </div>
                <Toggle
                  // 未裁时旋钮只能画在某一侧（控件是二值的）——所以缺口靠上面那枚
                  // 「默认值未裁」徽标承载，**不靠旋钮位置**。看截图的人不会把它读成裁决。
                  checked={aiOn[s.id] ?? false}
                  onCheckedChange={(v) => {
                    if (!canEdit) { setToast("仅引导师（含协同引导师，主持人确认）可改项目级 AI 权限"); return; }
                    setAiOn((p) => ({ ...p, [s.id]: v }));
                    setToast(v ? `已开启「${s.label}」，变更已留痕、对项目成员可见` : `已关闭「${s.label}」`);
                  }}
                  label={s.label}
                  data-testid={`team-switch-toggle-${s.id}`}
                />
              </CardContent>
            </Card>
          ))}
        </section>
      </div>

      <Toast message={toast} testid="team-toast" onDismiss={() => setToast(null)} />
    </RuntimeShell>
  );
}
