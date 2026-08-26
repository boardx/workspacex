import { Bot, Plus, ShieldAlert, HelpCircle, RotateCcw, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  VIRTUAL_CONSTRUCT_RULE,
  VIRTUAL_HARD_CONSTRAINTS,
  VIRTUAL_EXPERTS,
  VIRTUAL_QUESTIONS,
  VIRTUAL_DEDUCTION,
  VIRTUAL_DISAGREEMENT,
  VIRTUAL_ADOPT_QUEUE,
  VIRTUAL_ADOPTED_DESTINATIONS,
  CONFIDENCE_CAP_LABEL,
  type ItvView,
} from "@/lib/mock/itv";

/**
 * ③ 虚拟用户画像推演访谈（UC-6.5 虚拟隔离）—— 人类原话「对虚拟的用户画像做推演访谈」。
 *   v1 只做了「phase-3 占位屏」，把这条完全丢了。这里做出真实可点的三段：
 *     专家设定（用真实材料构造的推理角色）/ 提问与推演 / 采纳与标注。
 *
 * ⚠ 硬约束（服务端强制，此处为界面投影）：只有真人来源能标「强」；虚拟推演一律探索性，
 *   不计入证据强度、不能单独支撑决策、报告里单列章节。每条推演强制带「不确定」「会被推翻」。
 *   —— 这正是任务要求「界面上也要区分真人/虚拟来源」的落点。
 */
export function VirtualPersona({ state, view }: { state: UiState; view: ItvView }) {
  const canWrite = view === "researcher";
  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-virtual-persona">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-20 font-semibold text-background-foreground">
            <Bot aria-hidden className="h-5 w-5 text-ai-tint-foreground" />
            虚拟画像推演访谈
          </h1>
          <p className="text-12 text-muted-foreground">
            用真实材料构造的推理角色 · 不是真人，不产生语音与录音，也不占用访谈场次计数。
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={!canWrite} data-testid="itv-virtual-add-expert">
          <Plus aria-hidden className="h-3.5 w-3.5" />新增虚拟专家
        </Button>
      </header>

      {/* 三条硬约束常驻 */}
      <div
        className="flex flex-col gap-1 rounded-md border border-ai/30 bg-ai-tint px-3 py-2"
        data-testid="itv-virtual-constraints"
      >
        <span className="flex items-center gap-1.5 text-11 font-medium text-ai-tint-foreground">
          <ShieldAlert aria-hidden className="h-3.5 w-3.5" />虚拟推演的三条硬约束
        </span>
        {VIRTUAL_HARD_CONSTRAINTS.map((c, i) => (
          <p key={i} className="text-10 text-ai-tint-foreground">{c}</p>
        ))}
      </div>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="还没有虚拟专家 —— 需先有 ≥2 场真人访谈或 ≥3 条组织层判断才能构造"
        errors={{ construct: "V4 材料不足（缺 2 项），不能启用；凭空设定人格 = 编故事，被拒绝" }}
        depFailure={{ what: "推演所需的 Context API 不可用；已启用专家的历史推演仍可查看" }}
        denial={{ layer: "project", reason: "观察者看不到未发布的虚拟推演过程" }}
        successMessage="已采纳为待验证假设（标注「仅推演」，证据强度 0）"
      >
        <div className="flex flex-col gap-4">
          {/* 专家设定 */}
          <div className="flex flex-col gap-2" data-testid="itv-virtual-experts">
            <p className="rounded-md border border-border-subtle bg-panel px-3 py-2 text-11 text-muted-foreground">
              构造规则：{VIRTUAL_CONSTRUCT_RULE}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {VIRTUAL_EXPERTS.map((e) => (
                <Card
                  key={e.id}
                  data-testid={`itv-expert-${e.id}`}
                  className={cn("p-3", e.state === "insufficient" && "border-dashed border-warning/40 bg-warning/5")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ai-tint font-mono text-10 text-ai-tint-foreground">
                        {e.id}
                      </span>
                      <span className="text-12 font-medium text-background-foreground">{e.role}</span>
                    </div>
                    <Badge tone={e.state === "enabled" ? "ai" : "warning"} data-testid={`itv-expert-cap-${e.id}`}>
                      {e.state === "enabled" ? CONFIDENCE_CAP_LABEL[e.confidenceCap] : "材料不足"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-10 text-muted-foreground">构造依据：{e.basis}</p>
                  {e.state === "enabled" ? (
                    <div className="mt-2 flex flex-col gap-1 text-10">
                      <p className="text-background-foreground">立场偏好：{e.stance}</p>
                      <p className="text-muted-foreground">已知局限：{e.limits}</p>
                      <p className="text-warning">不可用于：{e.notFor}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-10 text-warning" data-testid={`itv-expert-insufficient-${e.id}`}>
                      {e.insufficientHint}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </div>

          {/* 提问与推演 */}
          <div className="grid gap-3 xl:grid-cols-[280px_1fr]" data-testid="itv-virtual-deduction">
            <Card className="p-3">
              <span className="text-12 font-medium text-background-foreground">问题清单 · 来自 RQ</span>
              <p className="mb-2 text-10 text-muted-foreground">只需要问题与文字推演，不模拟对话过程、不生成语音。</p>
              <div className="flex flex-col gap-1.5">
                {VIRTUAL_QUESTIONS.map((q, i) => (
                  <div
                    key={i}
                    data-testid={`itv-virtual-question-${i}`}
                    className={cn(
                      "rounded-md border p-2",
                      i === 0 ? "border-primary/40 bg-accent" : "border-border-subtle bg-panel",
                    )}
                  >
                    <p className="text-11 text-background-foreground">{q.question}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge tone="outline">{q.rq}</Badge>
                      <span className="text-10 text-muted-foreground">{q.progress}</span>
                    </div>
                  </div>
                ))}
                <Button size="xs" variant="ghost" disabled={!canWrite}>
                  <Plus aria-hidden className="h-3 w-3" />自定义问题
                </Button>
              </div>
            </Card>

            {/* 单条推演结果（含强制字段） */}
            <Card className="p-3" data-testid="itv-deduction-result">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ai-tint font-mono text-10 text-ai-tint-foreground">
                  {VIRTUAL_DEDUCTION.expertId}
                </span>
                <span className="text-12 font-medium text-background-foreground">{VIRTUAL_DEDUCTION.expertRole}</span>
                <Badge tone="ai">虚拟推演 · 探索性</Badge>
                <span className="text-10 text-muted-foreground">{VIRTUAL_DEDUCTION.steps}</span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5 text-11">
                <p className="text-foreground"><span className="text-muted-foreground">立场：</span>{VIRTUAL_DEDUCTION.stance}</p>
                <p className="text-foreground"><span className="text-muted-foreground">理由：</span>{VIRTUAL_DEDUCTION.reason}</p>
                <p className="text-foreground"><span className="text-muted-foreground">推得：</span>{VIRTUAL_DEDUCTION.inference}</p>
                <p className="text-muted-foreground">引用：{VIRTUAL_DEDUCTION.citation}</p>
                {/* 强制字段：不确定 / 会被推翻 —— 界面必须显示 */}
                <p className="flex gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-warning" data-testid="itv-deduction-uncertain">
                  <HelpCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  不确定：{VIRTUAL_DEDUCTION.uncertain}
                </p>
                <p className="flex gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-destructive" data-testid="itv-deduction-refutable">
                  <RotateCcw aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  会被推翻：{VIRTUAL_DEDUCTION.refutable}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["追问这一步", "要求反例", "送去采纳", "变成真人访谈提问"].map((a) => (
                  <Button key={a} size="xs" variant="outline" disabled={!canWrite}>{a}</Button>
                ))}
              </div>
              <div className="mt-3 rounded-md border border-border-subtle bg-panel p-2">
                <p className="text-10 uppercase tracking-wide text-muted-foreground">三位专家的分歧 · 分歧本身就是要去问真人的地方</p>
                {VIRTUAL_DISAGREEMENT.map((d) => (
                  <p key={d.expert} className="mt-1 text-10 text-background-foreground">
                    <span className="font-mono text-ai-tint-foreground">{d.expert}</span> {d.claim}
                  </p>
                ))}
              </div>
            </Card>
          </div>

          {/* 采纳与标注 */}
          <Card className="p-3" data-testid="itv-virtual-adopt">
            <span className="text-12 font-medium text-background-foreground">采纳与标注 · 待你判断（推演结论不会自动进任何地方）</span>
            <div className="mt-2 flex flex-col gap-2">
              {VIRTUAL_ADOPT_QUEUE.map((a, i) => (
                <div
                  key={i}
                  data-testid={`itv-adopt-${a.expertId}-${i}`}
                  className="rounded-md border border-border-subtle bg-panel p-2.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-10 text-ai-tint-foreground">{a.expertId}</span>
                    <Badge tone="ai">{a.tag}</Badge>
                  </div>
                  <p className="mt-1 text-11 text-background-foreground">{a.claim}</p>
                  {a.note && (
                    <p className="mt-1 flex gap-1 text-10 text-warning">
                      <Ban aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                      {a.note}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {a.actions.map((act) => (
                      <Button key={act} size="xs" variant="outline" disabled={!canWrite}>{act}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-border-subtle bg-card p-2" data-testid="itv-adopt-destinations">
              <p className="text-10 uppercase tracking-wide text-muted-foreground">已采纳的去向</p>
              {VIRTUAL_ADOPTED_DESTINATIONS.map((d, i) => (
                <p key={i} className="mt-1 text-10 text-background-foreground">· {d}</p>
              ))}
            </div>
          </Card>
        </div>
      </StateShell>
    </section>
  );
}
