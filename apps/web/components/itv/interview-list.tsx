import { Bot, User, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  INTERVIEW_LIST,
  INTERVIEW_STATUS_LABEL,
  interviewCounts,
  ITV_SCOPES,
  type ItvView,
  type ScopeId,
} from "@/lib/mock/itv";
import { navHref } from "./nav-href";

/**
 * ② 访谈列表（UC-6.0）—— 跨项目全部访谈；真人与数字人/虚拟画像**混排但强标记**，计数分列。
 *   「不属于任何项目」是一等档（不是兜底桶）。虚拟条目在**行内**就强标记，不能只在详情里。
 *   空态区分「本范围无访谈」与「无权查看本范围」两种文案。
 */
export function InterviewList({
  state,
  view,
  scope,
}: {
  state: UiState;
  view: ItvView;
  scope: ScopeId;
}) {
  const rows = INTERVIEW_LIST.filter((r) => r.scope === scope);
  const c = interviewCounts(scope);
  const scopeLabel = ITV_SCOPES.find((s) => s.id === scope)?.label ?? "";

  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-interview-list">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold text-background-foreground">访谈 · {c.total} 场</h1>
        <p className="text-12 text-muted-foreground">
          范围：{scopeLabel} —— 打开任意一场进入全屏管理：时间、提纲、要收集的数据、洞察。
        </p>
        {/* 计数分列：真人 ≠ 虚拟；场次数 ≠ 人数 */}
        <div className="flex flex-wrap items-center gap-2" data-testid="itv-count-split">
          <Badge tone="neutral" data-testid="itv-count-human">
            <User aria-hidden className="h-3 w-3" />真人 {c.human}
          </Badge>
          <Badge tone="ai" data-testid="itv-count-virtual">
            <Bot aria-hidden className="h-3 w-3" />数字人/虚拟 {c.virtual}（探索性，单独计数）
          </Badge>
        </div>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint={
          scope === "unassigned"
            ? "本范围（不属于任何项目）还没有访谈 —— 新建一场，或从研究项目挂过来"
            : "本研究项目还没有访谈 —— 用模板新建第一场"
        }
        errors={{ scope: "范围参数无效，已回退到默认范围" }}
        depFailure={{ what: "访谈列表接口失败，已保留当前范围与筛选，可重试" }}
        denial={{ layer: "project", reason: "你不是该范围的成员，也不是显式协作者" }}
        successMessage="已挂到项目环节（绑定固定快照，可解除且留痕）"
      >
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Card
              key={r.id}
              data-testid={`itv-row-${r.id}`}
              className={cn("p-3", r.source === "virtual" && "border-ai/30 bg-ai-tint/30")}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-11 font-semibold",
                    r.source === "virtual"
                      ? "bg-ai-tint text-ai-tint-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.subjectInitial}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-13 font-medium text-background-foreground">{r.subject}</span>
                    {r.source === "virtual" && (
                      <Badge tone="ai" data-testid={`itv-row-virtual-${r.id}`}>
                        <Bot aria-hidden className="h-3 w-3" />数字人 · 探索性
                      </Badge>
                    )}
                    <Badge tone={r.status === "running" ? "primary" : "outline"}>
                      {INTERVIEW_STATUS_LABEL[r.status]}
                    </Badge>
                    <span className="text-10 text-muted-foreground">{r.belongsTo}</span>
                  </div>
                  <p className="text-12 text-muted-foreground">{r.progress}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-10 text-muted-foreground">{r.metric}</span>
                    <Badge tone="neutral">模板：{r.templateName}</Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  {r.actions.map((a, i) => (
                    <Button
                      key={a}
                      asChild
                      size="xs"
                      variant={i === 0 ? "outline" : "ghost"}
                      data-testid={`itv-row-action-${r.id}-${i}`}
                    >
                      <a
                        href={
                          a === "进入现场"
                            ? navHref({ screen: "record", view, state: "default", scope })
                            : a === "看洞察"
                              ? navHref({ screen: "insight", view, state: "default", scope })
                              : a === "再跑一轮"
                                ? navHref({ screen: "virtual", view, state: "default", scope })
                                : navHref({ screen: "design", view, state: "default", scope })
                        }
                      >
                        {a === "进入现场" && <PlayCircle aria-hidden className="h-3 w-3" />}
                        {a}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </StateShell>
    </section>
  );
}
