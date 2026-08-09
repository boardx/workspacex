"use client";
import * as React from "react";
import {
  Users, UserX, Send, QrCode, ClipboardList, BarChart3, Vote, Timer, ShieldCheck, Check, Copy,
  FileWarning, AlertTriangle, Plus,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SURVEY_QUESTIONS, QUESTION_TYPE_LABEL, RECOVERY, missingRoster, CROSS_SEGMENTS,
  MIN_INFERABLE_N, SURVEY_CONCLUSIONS, LIVE_VOTE, SURVEY_SESSION,
  REPORT_TEMPLATE, mappedQuestions, qualityGateBlockers,
  canWriteSurvey, type SurveyView, type SurveyOption,
} from "@/lib/mock/survey";

/**
 * 问卷工作台 · 三标签 `问卷设计 ｜ 报告模板 ｜ 回收与分析`（UC-12.1 R8，原型字节 16,193,522 起）
 * + 本页额外的「现场投票」演示标签（见 UC-12.4 R7.1 的 IA 注记，`lib/mock/survey.ts` 顶部）。
 */
export function SurveyWorkspace({ state, view }: { state: UiState; view: SurveyView }) {
  const canWrite = canWriteSurvey(view);
  const missing = missingRoster();
  const pct = Math.round((RECOVERY.submitted / RECOVERY.rosterTotal) * 100);
  const blockers = qualityGateBlockers();

  const [editing, setEditing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [confirmedIds, setConfirmedIds] = React.useState<Set<string>>(new Set());
  const [voteStarted, setVoteStarted] = React.useState(false);

  const copyLink = () => {
    const url = "https://ke.app/s/eu-storage-precheck?g=2";
    try {
      void navigator.clipboard?.writeText(url);
    } catch {
      /* 预览环境无剪贴板权限时静默降级，仍给可见反馈 */
    }
    setCopied(true);
  };

  const body = (
    <Tabs defaultValue="design" className="flex flex-col gap-3" data-testid="survey-tabs">
      <TabsList>
        <TabsTrigger value="design" data-testid="survey-tab-design"><ClipboardList aria-hidden className="h-3.5 w-3.5" /> 问卷设计</TabsTrigger>
        <TabsTrigger value="report" data-testid="survey-tab-report"><FileWarning aria-hidden className="h-3.5 w-3.5" /> 报告模板{blockers.length > 0 && <Badge tone="warning" className="ml-1">{blockers.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="recovery" data-testid="survey-tab-recovery"><Users aria-hidden className="h-3.5 w-3.5" /> 回收与分析</TabsTrigger>
        <TabsTrigger value="vote" data-testid="survey-tab-vote"><Vote aria-hidden className="h-3.5 w-3.5" /> 现场投票</TabsTrigger>
      </TabsList>

      {/* ── 问卷设计：题干 + → 报告章节 映射标注 + 诱导性表述提示（UC-12.1 R7.5/R7.6）── */}
      <TabsContent value="design" className="flex flex-col gap-2" data-testid="survey-panel-design">
        <p className="text-11 text-muted-foreground">
          题目 · {SURVEY_QUESTIONS.length}。每道题都带 <code>→ 报告章节</code> 映射；未映射的题标「未映射」，
          诱导性表述在编辑期就地提示（发布期变为阻断，见「报告模板」标签）。
        </p>
        {SURVEY_QUESTIONS.map((q) => {
          const section = REPORT_TEMPLATE.sections.find((s) => s.id === q.reportSectionId);
          return (
            <div key={q.id} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2.5" data-testid={`survey-design-${q.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="outline">{QUESTION_TYPE_LABEL[q.type]}</Badge>
                <span className="text-12 font-medium">Q{q.no}</span>
                {section ? (
                  <Badge tone="primary" data-testid={`survey-design-mapped-${q.id}`}>→ {section.label}</Badge>
                ) : (
                  <Badge tone="warning" data-testid={`survey-design-unmapped-${q.id}`}>未映射</Badge>
                )}
                {q.leadingIssue && (
                  <Badge tone="danger" data-testid={`survey-design-leading-${q.id}`}>
                    <AlertTriangle aria-hidden className="h-2.5 w-2.5" /> 诱导性表述
                  </Badge>
                )}
              </div>
              <p className="text-12">{q.text}</p>
              {q.leadingIssue && (
                <p className="text-10 text-destructive">{q.leadingIssue}</p>
              )}
              {q.options && (
                <ul className="flex flex-col gap-0.5 pt-0.5">
                  {q.options.map((o, i) => (
                    <li key={i} className="text-10 text-muted-foreground">· {o.label}</li>
                  ))}
                </ul>
              )}
              {q.type === "open" && <p className="text-10 text-muted-foreground">开放题 · 自由文本，回收后抽样脱敏展示</p>}
            </div>
          );
        })}
        {canWrite && !editing && (
          <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing(true)} data-testid="survey-design-edit">编辑题目与逻辑…</Button>
        )}
        {canWrite && (
          <Button size="sm" variant="ghost" className="self-start" data-testid="survey-ai-add-question">叫 AI 帮我补充题目 →</Button>
        )}
        {canWrite && editing && (
          <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-accent p-3" data-testid="survey-design-editor">
            <span className="text-11 font-medium">编辑题目文案（每行一题 · 本地预览，不落库）</span>
            <Textarea
              rows={SURVEY_QUESTIONS.length}
              defaultValue={SURVEY_QUESTIONS.map((q) => `Q${q.no} ${q.text}`).join("\n")}
              data-testid="survey-design-editor-text"
            />
            <p className="text-10 text-muted-foreground">
              量表点数、跳转逻辑与必填项在真实编辑器里逐项可改；此处仅演示「点了有屏」。
            </p>
            <div className="flex items-center gap-1.5">
              <Button size="xs" variant="primary" onClick={() => setEditing(false)} data-testid="survey-design-edit-done">完成编辑</Button>
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)} data-testid="survey-design-edit-cancel">取消</Button>
            </div>
          </div>
        )}
      </TabsContent>

      {/* ── 报告模板：质量门禁双阻断 + 章节 ↔ 题目映射（UC-12.1 R7.5 / UC-12.2 R7.1 头号硬约束）── */}
      <TabsContent value="report" className="flex flex-col gap-3" data-testid="survey-panel-report">
        <div className="rounded-md border border-border bg-panel p-3">
          <p className="text-12 font-medium">报告模板 · {REPORT_TEMPLATE.name}</p>
          <p className="text-10 text-muted-foreground">
            每个问卷发布前必须映射到一个报告模板 —— 没映射完的题不能发布。
          </p>
        </div>

        {blockers.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5" data-testid="survey-quality-gate">
            <span className="text-11 font-semibold text-destructive">质量门禁 {blockers.length} 阻断 —— 修完才能发布</span>
            <ul className="flex flex-col gap-0.5">
              {blockers.map((b, i) => (
                <li key={i} className="text-10 text-destructive" data-testid={`survey-gate-blocker-${i}`}>
                  {b.label}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border border-primary/30 bg-accent p-2.5 text-11" data-testid="survey-quality-gate-clear">
            质量门禁已清空，可发布。
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-11 font-medium">报告章节</span>
          {REPORT_TEMPLATE.sections.map((sec) => {
            const mapped = mappedQuestions(sec.id);
            return (
              <div key={sec.id} className="flex items-center justify-between rounded-md border border-border-subtle bg-card px-2.5 py-2" data-testid={`survey-report-section-${sec.id}`}>
                <span className="text-11 font-medium">{sec.label}</span>
                {mapped.length > 0 ? (
                  <span className="text-10 text-primary">映射 {mapped.map((q) => `Q${q.no}`).join(" / ")}</span>
                ) : (
                  <Badge tone="danger" data-testid={`survey-report-gap-${sec.id}`}>{sec.missingField ?? "缺供料题目"}</Badge>
                )}
              </div>
            );
          })}
          {canWrite && (
            <Button size="xs" variant="outline" className="self-start" data-testid="survey-report-add-section">
              <Plus aria-hidden className="h-3 w-3" /> 新增报告章节（会立刻新增一个待供料的阻断项）
            </Button>
          )}
        </div>
      </TabsContent>

      {/* ── 回收与分析：进度 + 名单 + 原始分布 + 交叉切分 + AI 候选结论 ─────
          （UC-12.1 R8：原型工作台第三个标签是「回收与分析」单一标签，不是两个）── */}
      <TabsContent value="recovery" className="flex flex-col gap-3" data-testid="survey-panel-recovery">
        <div className="flex flex-col gap-2 rounded-md border border-border bg-panel p-3">
          <div className="flex items-center justify-between">
            <span className="text-13 font-semibold" data-testid="survey-recovery-count">
              回收中 · {RECOVERY.submitted} / {RECOVERY.rosterTotal}
            </span>
            <span className="text-11 text-muted-foreground">完成率 {pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={RECOVERY.submitted} aria-valuemin={0} aria-valuemax={RECOVERY.rosterTotal} aria-label="回收进度">
            <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ai"><ShieldCheck aria-hidden className="h-2.5 w-2.5" /> 匿名回收 · 不记录个人身份</Badge>
            <span className="text-10 text-muted-foreground">名单只做「谁交了 / 谁没交」的核对，答卷内容与身份不绑定。</span>
          </div>
          {canWrite && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant={copied ? "secondary" : "outline"} onClick={copyLink} data-testid="survey-copy-link">
                  {copied ? <Check aria-hidden className="h-3 w-3" /> : <QrCode aria-hidden className="h-3 w-3" />}
                  {copied ? "已复制链接" : "分组链接 / 二维码"}
                </Button>
                <Button size="xs" variant="primary" data-testid="survey-remind" disabled={missing.length === 0}>
                  <Send aria-hidden className="h-3 w-3" /> 催未交的 {missing.length} 人
                </Button>
              </div>
              {copied && (
                <span className="inline-flex items-center gap-1 text-10 text-muted-foreground" data-testid="survey-copy-link-done">
                  <Copy aria-hidden className="h-3 w-3" /> 已复制第 2 组分组链接，可粘到群里；二维码同链接。
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5" data-testid="survey-roster">
          <span className="text-11 font-medium">名单核对</span>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {RECOVERY.roster.map((r) => (
              <li
                key={r.id}
                data-testid={`survey-roster-${r.id}`}
                className={
                  "flex items-center justify-between rounded-sm border px-2 py-1.5 " +
                  (r.submitted ? "border-border-subtle bg-card" : "border-warning/30 bg-warning/5")
                }
              >
                <span className="min-w-0 truncate text-10">{r.name} · {r.group}</span>
                {r.submitted ? (
                  <Badge tone={r.resubmitted ? "neutral" : "primary"}>{r.resubmitted ? "已交 · 以最后一次为准" : "已交"}</Badge>
                ) : (
                  <Badge tone="warning"><UserX aria-hidden className="h-2.5 w-2.5" /> 未交</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-11 font-medium">原始分布（结论点回这里）</span>
          {SURVEY_QUESTIONS.filter((q) => q.options).map((q) => (
            <div key={q.id} id={`survey-q-${q.id}`} data-testid={`survey-dist-${q.id}`} className="scroll-mt-4 flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2.5">
              <div className="flex items-center gap-1.5">
                <Badge tone="outline">{QUESTION_TYPE_LABEL[q.type]}</Badge>
                <span className="text-11 font-medium">Q{q.no} · {q.text}</span>
                <span className="ml-auto text-10 text-muted-foreground">n={q.sampleN}{q.scaleAvg ? ` · 均值 ${q.scaleAvg}` : ""}</span>
              </div>
              <DistributionBars options={q.options!} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5" data-testid="survey-cross">
          <span className="text-11 font-medium">按角色交叉切分</span>
          <p className="text-10 text-muted-foreground">样本量低于 {MIN_INFERABLE_N} 的切分标为「不可推断」，只作定性线索，不出结论。</p>
          <ul className="flex flex-col gap-1">
            {CROSS_SEGMENTS.map((seg) => {
              const inferable = seg.n >= MIN_INFERABLE_N;
              return (
                <li key={seg.id} data-testid={`survey-cross-${seg.id}`} className="flex items-center justify-between rounded-sm border border-border-subtle bg-card px-2 py-1.5">
                  <span className="text-11">{seg.label} · <span className="text-muted-foreground">n={seg.n}</span></span>
                  {inferable ? (
                    <span className="text-10">{seg.topOption}（{seg.topPct}%）</span>
                  ) : (
                    <Badge tone="warning" data-testid={`survey-cross-uninferable-${seg.id}`}>不可推断 · n&lt;{MIN_INFERABLE_N}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-1.5" data-testid="survey-analysis-conclusions">
          <span className="text-11 font-medium">AI 候选结论（每条挂题目与样本量）</span>
          {SURVEY_CONCLUSIONS.map((c) => {
            const confirmed = c.confirmed || confirmedIds.has(c.id);
            return (
              <div key={c.id} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2" data-testid={`survey-analysis-conclusion-${c.id}`}>
                <div className="flex flex-wrap items-center gap-1">
                  {c.machine && <Badge tone="ai">AI 候选</Badge>}
                  {c.sampleN < MIN_INFERABLE_N && <Badge tone="warning">n={c.sampleN} · 不可推断</Badge>}
                  {confirmed && <Badge tone="primary" data-testid={`survey-confirmed-${c.id}`}>已入库</Badge>}
                </div>
                <p className="text-11">{c.text}</p>
                <div className="flex items-center gap-1.5">
                  <a href={`#survey-q-${c.questionId}`} className="text-10 text-primary transition-colors duration-200 hover:underline">点回原始分布</a>
                  {canWrite && !confirmed && c.sampleN >= MIN_INFERABLE_N && (
                    <Button
                      size="xs"
                      variant="ai"
                      onClick={() => setConfirmedIds((s) => new Set(s).add(c.id))}
                      data-testid={`survey-confirm-${c.id}`}
                    >
                      确认入库
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TabsContent>

      {/* ── 现场投票：60 秒倒计时 + 分布 + 未投的人 ─────────────── */}
      <TabsContent value="vote" className="flex flex-col gap-3" data-testid="survey-panel-vote">
        <p className="text-10 text-muted-foreground" data-testid="survey-vote-ia-note">
          原型里现场投票的发起入口在项目「主持台 · 知识图谱派发」（`VT 全场投票` 卡片），
          不是问卷工作台的独立功能；此处仅演示投票结果与问卷共享的匿名口径和分布组件。
        </p>
        <div className="flex flex-col gap-2 rounded-md border border-border bg-panel p-3">
          <div className="flex items-center justify-between">
            <span className="text-11 text-muted-foreground">从当前假设一键生成</span>
            <span className="inline-flex items-center gap-1 text-12 font-semibold tabular-nums text-warning" data-testid="survey-vote-timer">
              <Timer aria-hidden className="h-3.5 w-3.5" /> {voteStarted ? LIVE_VOTE.countdownSec : LIVE_VOTE.remainingSec}s / {LIVE_VOTE.countdownSec}s
            </span>
          </div>
          <p className="text-13 font-medium">{LIVE_VOTE.question}</p>
          <p className="text-10 text-muted-foreground">来自假设：{LIVE_VOTE.fromHypothesis}</p>
          <DistributionBars options={LIVE_VOTE.options as unknown as SurveyOption[]} />
          <Badge tone="ai" className="self-start"><ShieldCheck aria-hidden className="h-2.5 w-2.5" /> 匿名投票 · 只给分布，不显示个人选择</Badge>
        </div>
        <div className="flex flex-col gap-1" data-testid="survey-vote-notvoted">
          <span className="text-11 font-medium">还没投的人（在哪个模块忙着）</span>
          {LIVE_VOTE.notVoted.map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-sm border border-border-subtle bg-card px-2 py-1.5">
              <span className="text-10">{p.name}</span>
              <span className="text-10 text-muted-foreground">{p.where}</span>
            </div>
          ))}
        </div>
        {canWrite && (
          voteStarted ? (
            <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2.5" data-testid="survey-vote-started">
              <Timer aria-hidden className="h-3.5 w-3.5 text-warning" />
              <span className="text-11">投票已发起，{LIVE_VOTE.countdownSec} 秒倒计时开始 · 大屏与各组同步显示（乐观预览，不落库）。</span>
            </div>
          ) : (
            <Button size="sm" variant="primary" className="self-start" onClick={() => setVoteStarted(true)} data-testid="survey-vote-new">从当前假设发起投票…</Button>
          )
        )}
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-18 font-semibold tracking-tight">{SURVEY_SESSION.active}</h1>
          <p className="text-11 text-muted-foreground">{SURVEY_SESSION.project} · 最后更新 {SURVEY_SESSION.lastUpdate}</p>
        </div>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="这个项目还没有问卷——从模板新建一份，或用「会前摸底」快速起题"
        errors={{
          duplicate: "检测到同一链接重复提交，已按最后一次生效，未产生重复答卷。",
          concurrency: "另一名研究员刚改了题目逻辑，你的版本已过期，请刷新后再发布。",
        }}
        depFailure={{ what: "匿名回收 / 洞察库依赖暂时不可用。已保留最近一次成功的回收数据，可安全重试。" }}
        denial={{ layer: "project", reason: "你在本项目中的角色不能查看问卷回收明细；已发布的脱敏汇总可在报告中查看。" }}
        successMessage="结论已确认入洞察库，并已挂上原始分布出处"
      >
        {body}
      </StateShell>
    </div>
  );
}

/* ── 分布条 ─────────────────────────────────────────────────── */
function DistributionBars({ options }: { options: SurveyOption[] }) {
  const max = Math.max(1, ...options.map((o) => o.count));
  const total = options.reduce((a, o) => a + o.count, 0) || 1;
  return (
    <ul className="flex flex-col gap-1">
      {options.map((o, i) => {
        const pct = Math.round((o.count / total) * 100);
        return (
          <li key={i} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-10">{o.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${(o.count / max) * 100}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-10 tabular-nums text-muted-foreground">{o.count} · {pct}%</span>
          </li>
        );
      })}
    </ul>
  );
}
