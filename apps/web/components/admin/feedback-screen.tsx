"use client";
import * as React from "react";
import { LayoutList, Download, ThumbsDown, ArrowRight, GitPullRequestArrow, Check } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { AdminDrawer, Toast } from "./panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  SW_FEEDBACK, SW_FEEDBACK_LABEL, SW_FEEDBACK_SUMMARY, AGENT_FEEDBACK, ITERATION_LOOP,
  type SwFeedbackStatus,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const SW_TONE: Record<SwFeedbackStatus, "warning" | "ai" | "primary"> = {
  pending: "warning",
  "in-iteration": "ai",
  fixed: "primary",
};

const BOARD_COLUMNS: { key: SwFeedbackStatus; label: string }[] = [
  { key: "pending", label: "待处理" },
  { key: "in-iteration", label: "已进入迭代" },
  { key: "fixed", label: "已修复" },
];

export function FeedbackScreen({ state }: { state: UiState }) {
  const [boardOpen, setBoardOpen] = React.useState(false);
  const [triaged, setTriaged] = React.useState<Set<string>>(new Set());
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <AdminScreen
      state={state}
      moduleLabel="反馈"
      title="反馈与迭代"
      intro="两类反馈：软件缺陷/需求进迭代看板；Agent/Skill 的问题由消息级评价聚合成改进建议，进开发 Agent → PR → 人工复核 → 灰度。每条反馈都有状态与去向。"
      emptyHint="本周还没有收到反馈"
      errors={{ push: "推送迭代看板失败：迭代看板连接超时，反馈已保留待重试" }}
      depFailure="消息级评价的聚合依赖埋点流水线；流水线不可用，无法刷新改进建议的票数。"
      denialReason="反馈的分诊与推送仅组织管理员/产品负责人可操作；任意使用者可提反馈但看不到这张分诊面板。"
      successMessage="已把『批准卡记住上次 token 预算』推入下个迭代，开发 Agent 已生成技术方案草案"
    >
      <div className="flex flex-col gap-5">
        {/* 迭代闭环度量 */}
        <section className="flex flex-col gap-2" data-testid="admin-feedback-loop">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-14 font-semibold">迭代闭环 · 本月</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setBoardOpen(true)} data-testid="admin-feedback-board">
                <LayoutList aria-hidden className="h-3.5 w-3.5" />
                打开迭代看板
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setToast(`已导出反馈明细 CSV（本周 ${SW_FEEDBACK_SUMMARY.total} 条软件反馈 + Agent/Skill 改进项）`)} data-testid="admin-feedback-export">
                <Download aria-hidden className="h-3.5 w-3.5" />
                导出
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 pt-4 text-13">
              <span><strong className="text-16 font-semibold">{ITERATION_LOOP.monthFeedback}</strong> 条反馈</span>
              <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span><strong className="text-16 font-semibold">{ITERATION_LOOP.generatedPR}</strong> 条已生成改进 PR</span>
              <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span><strong className="text-16 font-semibold">{ITERATION_LOOP.reviewedLive}</strong> 条人工复核通过并上线</span>
            </CardContent>
          </Card>
        </section>

        {/* 软件反馈 */}
        <section className="flex flex-col gap-2" data-testid="admin-feedback-software">
          <h2 className="text-14 font-semibold">
            软件反馈 <span className="text-11 font-normal text-muted-foreground">· 本周 {SW_FEEDBACK_SUMMARY.total} 条 · {SW_FEEDBACK_SUMMARY.pending} 条待处理</span>
          </h2>
          <div className="flex flex-col gap-1.5">
            {SW_FEEDBACK.map((f) => (
              <Card key={f.id} data-testid={`admin-feedback-sw-${f.id}`}>
                <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <Badge tone={SW_TONE[f.status]} data-testid={`admin-feedback-sw-status-${f.id}`}>
                    {SW_FEEDBACK_LABEL[f.status]}
                  </Badge>
                  <span className="text-12 font-medium">{f.title}</span>
                  <span className="text-11 text-muted-foreground">👍 {f.votes}</span>
                  {f.target && <Badge tone="outline" className="font-mono">{f.target}</Badge>}
                  <span className="w-full text-11 text-muted-foreground">{f.detail}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Agent / Skill 改进反馈（来自消息级评价） */}
        <section className="flex flex-col gap-2" data-testid="admin-feedback-agent">
          <h2 className="text-14 font-semibold">
            Agent / Skill 改进反馈 <span className="text-11 font-normal text-muted-foreground">· 来自消息级评价</span>
          </h2>
          <div className="flex flex-col gap-1.5">
            {AGENT_FEEDBACK.map((f) => {
              const isTriaged = triaged.has(f.id);
              return (
                <Card key={f.id} data-testid={`admin-feedback-agent-${f.id}`}>
                  <CardContent className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Avatar initials={f.initials} tone="ai" size="sm" />
                      <span className="text-12 font-medium">{f.target}</span>
                      <Badge tone="warning">{f.issue}</Badge>
                      <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
                        <ThumbsDown aria-hidden className="h-3 w-3" />
                        {f.down}
                      </span>
                    </div>
                    <p className="text-11 text-muted-foreground">{f.detail}</p>
                    {f.outcome ? (
                      <span className="inline-flex items-center gap-1 text-11 text-primary">
                        <GitPullRequestArrow aria-hidden className="h-3 w-3" />
                        {f.outcome}
                      </span>
                    ) : isTriaged ? (
                      <span className="inline-flex items-center gap-1 text-11 text-primary" data-testid={`admin-feedback-triaged-${f.id}`}>
                        <GitPullRequestArrow aria-hidden className="h-3 w-3" />
                        已生成改进建议草案 · 进开发 Agent 队列，待生成 PR
                      </span>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        className="self-start"
                        onClick={() => {
                          setTriaged((s) => new Set(s).add(f.id));
                          setToast(`已把「${f.target}」分诊为改进建议，开发 Agent 开始生成技术方案`);
                        }}
                        data-testid={`admin-feedback-triage-${f.id}`}
                      >
                        分诊并生成改进建议
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      {/* 迭代看板抽屉 */}
      {boardOpen && (
        <AdminDrawer testid="admin-feedback-board-drawer" title="迭代看板" subtitle="软件反馈按状态分列，拖动在真实系统里改状态" onClose={() => setBoardOpen(false)}>
          <div className="flex flex-col gap-3" data-testid="admin-feedback-board-columns">
            {BOARD_COLUMNS.map((col) => {
              const items = SW_FEEDBACK.filter((f) => f.status === col.key);
              return (
                <div key={col.key} className="flex flex-col gap-1.5" data-testid={`admin-feedback-board-col-${col.key}`}>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={SW_TONE[col.key]}>{col.label}</Badge>
                    <span className="text-11 text-muted-foreground">{items.length} 条</span>
                  </div>
                  {items.map((f) => (
                    <div key={f.id} className="rounded-md border border-border-subtle bg-panel p-2" data-testid="admin-feedback-board-card">
                      <p className="text-12 font-medium">{f.title}</p>
                      <p className="text-11 text-muted-foreground">👍 {f.votes}{f.target ? ` · ${f.target}` : ""}</p>
                    </div>
                  ))}
                  {items.length === 0 && <p className="text-11 text-muted-foreground">本列暂无</p>}
                </div>
              );
            })}
          </div>
        </AdminDrawer>
      )}

      <Toast message={toast} testid="admin-feedback-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}
