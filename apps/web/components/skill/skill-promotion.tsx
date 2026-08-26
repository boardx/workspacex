"use client";
import * as React from "react";
import { Brain, Link2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate, NewScreenTag } from "./skill-shared";
import { PROMOTION_QUEUE_STATS, PROMOTION_CANDIDATE, SKILLS, type SkillView } from "@/lib/mock/skill";

const promoted = SKILLS.find((s) => s.id === "sk-promoted")!;

export function SkillPromotion({ state, view }: { state: UiState; view: SkillView }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="方法晋升生成 skill" uc="UC-3.5 R3 · F67（接收端）">
        方法类知识被 [批准并推给全员] 后，Skill 库自动生成一条来源=「晋升生成」的 skill——
        但<strong className="text-background-foreground">自动生成 ≠ 自动发布</strong>，落待审核。skill 与源知识双向关联，详情页显著展示「来自组织大脑」。
      </ScreenHead>

      {/* phase 边界待裁决横幅 */}
      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3" data-testid="skill-promotion-boundary">
        <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-10 leading-relaxed text-muted-foreground">
          <strong className="text-background-foreground">边界待裁决：</strong>触发端「组织大脑 · 晋升队列」在 14-brain（phase-3，D-24），
          与本能力域的重叠边界 UC 未写清。本原型按 R10 处置②只做<strong className="text-background-foreground">接收端</strong>（来源取值 / 双向关联字段 /
          自动生成≠自动发布门禁路径），触发端就位后接通。触发侧界面（下方晋升队列）仅示意，非本 phase 交付。
        </p>
      </div>

      <RoleGate view={view} allow={["maintainer", "reviewer"]} what="晋升生成与来源溯源">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="晋升队列暂无方法类候选（空态）"
          errors={{ intake: "准入未达标：三项必填（支撑决策 / 复盘结论 / 复检周期）缺项，转写不完整的字段留空标待补、不臆造 schema" }}
          depFailure={{ what: "Skill 库不可写——无法生成 skill，晋升队列的方法审批不受影响。" }}
          denial={{ layer: "organization", reason: "晋升审批与方法论审核由审核人行使；维护者不能自行发布晋升生成的 skill" }}
          successMessage="已生成 skill《工期承诺谈法》· 待方法论审核 · 审核人：周航"
        >
          {/* 触发侧示意（非本 phase 交付） */}
          <section className="flex flex-col gap-2" data-testid="skill-promotion-queue">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-13 font-semibold"><Brain aria-hidden className="h-4 w-4" />组织大脑 · 晋升队列</h2>
              <Badge tone="outline">触发端示意 · 14-brain / phase-3</Badge>
            </div>
            <p className="text-10 text-muted-foreground">
              {PROMOTION_QUEUE_STATS.pending} 条待审 · 同期 {PROMOTION_QUEUE_STATS.demotedOrExpired} 条降级或过期 ·
              五态机 {PROMOTION_QUEUE_STATS.stateMachine}（出口 {PROMOTION_QUEUE_STATS.exits}）
            </p>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4">
                <span className="text-12 font-medium">方法「{PROMOTION_CANDIDATE.method}」</span>
                <p className="text-9 text-muted-foreground">
                  项目层的东西不会自动进组织层。每条候选要回答三问：支撑过哪个决策、复盘结论是什么、多久后需重新检查。
                </p>
                <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)} data-testid="skill-promotion-approve">
                  批准并推给全员
                </Button>
              </CardContent>
            </Card>
          </section>

          {/* 生成回执 + 待审核态 */}
          <Card data-testid="skill-promotion-receipt" className="border-warning/30">
            <CardContent className="flex flex-wrap items-center gap-2 pt-4">
              <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
              <span className="text-11">已生成 skill《{PROMOTION_CANDIDATE.draft.name}》</span>
              <Badge tone="warning">待方法论审核</Badge>
              <span className="text-10 text-muted-foreground">审核人：{promoted.brain?.reviewOwner}</span>
              <Button size="xs" variant="outline" data-testid="skill-promotion-goto">去 Skill 库查看</Button>
              <p className="w-full text-9 text-destructive">
                绕过门禁直接置为已启用会被服务端拒绝并记审计——自动生成不等于自动发布。
              </p>
            </CardContent>
          </Card>

          {/* skill 详情页「来自组织大脑」区块（新增设计） */}
          <section className="flex flex-col gap-2" data-testid="skill-promotion-brain-block">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-13 font-semibold"><Brain aria-hidden className="h-4 w-4" />来自组织大脑</h2>
              <NewScreenTag>新增设计，需产品/设计确认</NewScreenTag>
            </div>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-medium">{promoted.name} v1</span>
                  <Badge tone="ai" data-testid="skill-promotion-source-tag">晋升生成</Badge>
                  <span className="text-9 text-muted-foreground">来源标记由系统打标，任何人不可改写</span>
                </div>
                <BrainLine label="源知识条目" value={promoted.brain!.sourceKnowledge} link />
                <BrainLine label="那个被签字的决策" value={promoted.brain!.decision} link />
                <BrainLine label="复盘结论" value={PROMOTION_CANDIDATE.threeQuestions.retro} />
                <BrainLine label="适用范围 / 有效期" value={`项目库（最小必要）· 有效期至 ${promoted.brain!.validUntil}`} />
                <BrainLine label="复核负责人" value={promoted.brain!.reviewOwner} />
                <p className="rounded-md border border-border-subtle bg-panel p-2 text-9 text-muted-foreground">
                  从 skill 能追回源知识条目与被签字的决策（双向关联）。源知识被推翻/撤销时对应 skill 自动转已停用且不硬删；
                  含客户机密的方法须先过脱敏闸门，生成的 skill 只引用脱敏稿（D-16）。
                </p>
              </CardContent>
            </Card>
          </section>
        </StateShell>
      </RoleGate>

      {confirmOpen && <ApproveDialog onClose={() => setConfirmOpen(false)} />}
    </div>
  );
}

function BrainLine({ label, value, link }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-11">
      <span className="w-28 shrink-0 text-9 uppercase tracking-wide text-muted-foreground">{label}</span>
      {link ? (
        <a href="#" className="inline-flex items-center gap-1 text-primary underline-offset-2 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Link2 aria-hidden className="h-3 w-3" />{value}
        </a>
      ) : (
        <span className="text-background-foreground">{value}</span>
      )}
    </div>
  );
}

/* ── [批准并推给全员] 确认面板（真·未探明 → 补抽取；此处画出草稿预览）── */

function ApproveDialog({ onClose }: { onClose: () => void }) {
  const d = PROMOTION_CANDIDATE.draft;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" data-testid="skill-promotion-approve-dialog" onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-13 font-semibold">批准并推给全员 · 确认</h3>
        <p className="text-11 text-muted-foreground">三项必填（先答再批）：</p>
        <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-2 text-10">
          <span>· 支撑决策：{PROMOTION_CANDIDATE.threeQuestions.decision}</span>
          <span>· 复盘结论：{PROMOTION_CANDIDATE.threeQuestions.retro}</span>
          <span>· 复检周期：{PROMOTION_CANDIDATE.threeQuestions.recheck}</span>
        </div>
        <Checkbox
          id="gen-skill"
          defaultChecked
          data-testid="skill-promotion-genskill-toggle"
          label={<span className="text-10 text-muted-foreground">同时生成 skill（默认勾选，可取消 → A3）</span>}
        />
        <div className="flex flex-col gap-1 rounded-md border border-ai/30 bg-ai-tint/40 p-2" data-testid="skill-promotion-draft-preview">
          <span className="text-9 uppercase tracking-wide text-muted-foreground">将生成的 skill 草稿预览</span>
          <span className="text-10">名称：{d.name} · 目标 agent：{d.targetAgent}</span>
          <pre className="whitespace-pre-wrap font-mono text-9 text-background-foreground">{d.template}</pre>
          <span className="text-9 text-muted-foreground">schema in: {d.io.input.join(", ")} → out: {d.io.output.join(", ")}</span>
          <span className="text-9 text-muted-foreground">数据范围：{d.dataScope} · 已过脱敏闸门</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={onClose} data-testid="skill-promotion-approve-confirm">批准（生成 skill 落待审核）</Button>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="skill-promotion-approve-cancel">取消</Button>
        </div>
      </div>
    </div>
  );
}
