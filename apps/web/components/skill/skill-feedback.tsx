"use client";
import * as React from "react";
import { ThumbsUp, ThumbsDown, GitPullRequest, FileDiff, MessageSquareWarning } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate, NewScreenTag } from "./skill-shared";
import {
  FEEDBACK_AGGS, FEEDBACK_LOOP, FEEDBACK_CLASS_LABEL, FEEDBACK_CLASS_TONE,
  PROPOSAL_DIFF, UNATTRIBUTED_NOTE, type SkillView, type FeedbackAgg,
} from "@/lib/mock/skill";

export function SkillFeedback({ state, view }: { state: UiState; view: SkillView }) {
  const [diffOf, setDiffOf] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="Skill 改进反馈与版本触发" uc="UC-3.6 R3 · F68">
        对 AI 消息点 👍/👎 归因到 skill 版本 → 满意度 → 聚合改进队列（归类分流）→ 改进提案 diff →
        人工复核（不得自动上线）→ 触发发新版。
      </ScreenHead>

      <RoleGate view={view} allow={["maintainer", "reviewer", "facilitator", "groupLead", "member"]} what="改进反馈处置">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="暂无待处置的改进建议（空态）"
          errors={{ proposal: "改进提案校验失败：契约 diff 的 schema 破坏性改动未通过静态校验" }}
          depFailure={{ what: "提案生成模型不可用——无法起草改进 diff（含机密案例走自托管，见 UC-20.3）。" }}
          denial={{ layer: "organization", reason: "反馈与迭代处置仅能力维护者/审核人可见；采集侧 👍/👎 对参与者可用" }}
          successMessage="复核通过 · v5 上线、v4 自动归档、已建实例锁定版本"
        >
          {/* 采集侧：消息级 👍/👎（原型确认缺失，补画） */}
          <section className="flex flex-col gap-2" data-testid="skill-fb-collect">
            <div className="flex items-center gap-2">
              <h2 className="text-13 font-semibold">采集侧 · 对话 AI 消息评价</h2>
              <NewScreenTag>👍/👎 评价控件原型确认缺失</NewScreenTag>
            </div>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4">
                <p className="rounded-md border border-border-subtle bg-panel p-2 text-11">
                  <span className="text-9 text-muted-foreground">AI · Facilitator · v4</span><br />
                  「讨论已经比较发散，建议现在进入收敛投票环节。」
                </p>
                <div className="flex items-center gap-2">
                  <Button size="xs" variant="outline" data-testid="skill-fb-thumbup"><ThumbsUp aria-hidden className="h-3 w-3" /> 有用</Button>
                  <Button size="xs" variant="outline" data-testid="skill-fb-thumbdown"><ThumbsDown aria-hidden className="h-3 w-3" /> 待改进（可填理由）</Button>
                  <span className="text-9 text-muted-foreground">评价是否可撤销/对本人可见待确认</span>
                </div>
                <p className="text-9 text-muted-foreground">
                  绑定完整归因链：消息 → agent（Facilitator）→ skill（提议收敛）→ skill 版本（v4）。
                </p>
              </CardContent>
            </Card>
            <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-10 text-muted-foreground" data-testid="skill-fb-unattributed">
              {UNATTRIBUTED_NOTE}
            </p>
          </section>

          {/* 处置侧：聚合改进队列（归类分流） */}
          <section className="flex flex-col gap-2" data-testid="skill-fb-aggs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-13 font-semibold">Agent / Skill 改进反馈（来自消息级评价）</h2>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" data-testid="skill-fb-board">打开迭代看板</Button>
                <Button size="xs" variant="ghost" data-testid="skill-fb-export">导出</Button>
              </div>
            </div>
            {FEEDBACK_AGGS.map((f) => (
              <AggRow key={f.id} f={f} onDiff={() => setDiffOf(f.id)} />
            ))}
          </section>

          {/* 闭环指标 */}
          <p className="rounded-md border border-primary/30 bg-accent/40 p-3 text-11" data-testid="skill-fb-loop">
            {FEEDBACK_LOOP}
          </p>
        </StateShell>
      </RoleGate>

      {diffOf && <ProposalDiff onClose={() => setDiffOf(null)} />}
    </div>
  );
}

function AggRow({ f, onDiff }: { f: FeedbackAgg; onDiff: () => void }) {
  const canPR = f.klass === "contract"; // 归类为实现层/模型所限不出现 [生成 skill 改进 PR]
  return (
    <Card data-testid={`skill-fb-row-${f.id}`}>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-13 font-medium">{f.agent} · {f.title}</span>
          <Badge tone="danger" className="gap-1"><ThumbsDown aria-hidden className="h-3 w-3" />👎{f.down}</Badge>
          <Badge tone={FEEDBACK_CLASS_TONE[f.klass]} data-testid={`skill-fb-class-${f.id}`}>{FEEDBACK_CLASS_LABEL[f.klass]}</Badge>
          <span className="text-9 text-muted-foreground">👎 计数 {f.down} · 原始案例 {f.cases}（分口径）</span>
        </div>
        <p className="text-11 text-muted-foreground">{f.people}</p>
        <p className="text-11">{f.suggestion}</p>
        <div className="flex flex-wrap items-center gap-2">
          {canPR ? (
            <Button size="xs" variant="primary" onClick={onDiff} data-testid={`skill-fb-genpr-${f.id}`}>
              <GitPullRequest aria-hidden className="h-3 w-3" /> 生成 skill 改进 PR
            </Button>
          ) : (
            <Button size="xs" variant="outline" data-testid={`skill-fb-software-${f.id}`}>
              <MessageSquareWarning aria-hidden className="h-3 w-3" /> 软件反馈通道
            </Button>
          )}
          <Button size="xs" variant="ghost" data-testid={`skill-fb-cases-${f.id}`}>看 {f.cases} 个原始案例</Button>
          {!canPR && <span className="text-9 text-muted-foreground">归类非「契约可解」→ 不出现 [生成改进 PR]</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 改进提案 diff（补画）：左右 diff + 人工复核不自动上线 ─────────────── */

function ProposalDiff({ onClose }: { onClose: () => void }) {
  const d = PROPOSAL_DIFF;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" data-testid="skill-fb-diff" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-13 font-semibold"><FileDiff aria-hidden className="h-4 w-4" />{d.skill} · 契约改进提案 {d.from} → {d.to}</h3>
          <Badge tone="ai">AI 起草</Badge>
          <Badge tone="outline">人工已修改 {d.humanEdits} 处</Badge>
          <NewScreenTag>提案 diff 页需补画</NewScreenTag>
        </div>
        <p className="text-10 text-muted-foreground">改进 PR = 契约变更提案，不是代码 PR（D-06）。</p>
        <div className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-panel p-2 font-mono text-10" data-testid="skill-fb-diff-lines">
          {d.lines.map((l, i) => (
            <span
              key={i}
              className={
                l.type === "add" ? "rounded-sm bg-success/10 px-1 text-success"
                : l.type === "del" ? "rounded-sm bg-destructive/10 px-1 text-destructive line-through"
                : "px-1 text-muted-foreground"
              }
            >
              {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}{l.text}
            </span>
          ))}
        </div>
        {/* 复核界面：原始问题 → 建议 → diff → 受影响引用 → 批准/退回 */}
        <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-2 text-10">
          <span className="text-9 uppercase tracking-wide text-muted-foreground">受影响引用清单</span>
          <span>· 进行中项目 3 · 蓝本绑定 5 · agent 挂载 1（升级后按锁定版本，不自动跟随）</span>
        </div>
        <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-10 text-muted-foreground" role="alert">
          未经人工复核不得上线：绕过被拒并记审计，提交人 ≠ 复核人。复核通过后触发发新版（vN+1 上线、vN 归档、已建实例锁版本）。
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={onClose} data-testid="skill-fb-diff-approve">批准发布（触发发新版）</Button>
          <Button size="sm" variant="outline" onClick={onClose} data-testid="skill-fb-diff-return">退回</Button>
        </div>
      </div>
    </div>
  );
}
