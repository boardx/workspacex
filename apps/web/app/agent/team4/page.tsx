"use client";

/**
 * `/agent/team4` —— 投后管理报告 AI 生成单元，ad-hoc MVP。
 *
 * 这条静态路由优先于 `apps/web/app/agent/[teamId]/page.tsx` 的通用 mock 分支
 * （Next.js App Router：静态段优先于动态段），所以 `team4` 不再走"仅展示"的
 * 示例卡片，而是一个真实页面。其余五个 team（Team1…Team3/5/6）仍走原有 mock 展示，
 * 不受影响。
 *
 * 范围边界见 `docs/adhoc/team4-post-investment-agent-mvp-backlog.md`：只做测试 A
 * （单份材料·显性风险识别），输入是粘贴文本而非文件上传/结构化解析。这个 Agent
 * 是临时的，后续会被删除——所以这里不接 AppShell 之外的任何新基础设施。
 */
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bot, Loader2 } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest, ApiError } from "@/lib/api-client";
import { AGENTS_NAV_LABEL } from "@/lib/navigation";

interface FinancialMetric {
  readonly key: string;
  readonly label: string;
  readonly currentValue: string;
  readonly priorValue: string | null;
  readonly yoyPct: number | null;
  readonly evidenceQuote: string;
}

interface PostInvestmentRisk {
  readonly id: string;
  readonly issue: string;
  readonly reason: string;
  readonly evidenceQuote: string;
  readonly kind: string;
}

interface AnalyzeResult {
  readonly metrics: readonly FinancialMetric[];
  readonly risks: readonly PostInvestmentRisk[];
  readonly needsVerification: readonly string[];
}

type LoadState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: AnalyzeResult };

/** 未登录调用会拿到 401；MVP 不做单独的营销落地页文案，直接把这个原因说清楚
 *  （见 backlog「明确不做」）。 */
function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "请先登录后再使用「开始分析」。";
    if (e.reasonCode === "ANALYSIS_FAILED") return "模型分析失败或返回内容无法解析，请稍后重试；不会返回编造的结果。";
    return `分析请求失败（${e.reasonCode ?? e.status}）。`;
  }
  return e instanceof Error ? e.message : "未知错误。";
}

export default function AgentTeam4Page() {
  const [text, setText] = useState("");
  const [state, setState] = useState<LoadState>({ status: "idle" });

  async function analyze() {
    if (text.trim() === "") return;
    setState({ status: "loading" });
    try {
      const result = await apiRequest<AnalyzeResult>("/post-investment/analyze", {
        method: "POST",
        body: { text },
      });
      setState({ status: "done", result });
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  }

  return (
    <AppShell previewRole={null}>
      <div className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div data-testid="agent-team-page" data-team="team4" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
          <header className="space-y-2">
            <p className="text-11 font-medium text-muted-foreground">
              <Link href="/agent" className="transition-colors duration-base hover:underline">Studio / {AGENTS_NAV_LABEL}</Link> / 投后管理报告 AI 生成单元
            </p>
            <h1 className="text-24 font-semibold tracking-tight">投后管理报告 AI 生成单元</h1>
            <p className="text-12 leading-relaxed text-muted-foreground">
              粘贴一份被投企业的经营/财务材料原文，抽取关键财务指标并识别材料中已明确写出的
              异常风险信号。只输出事实、缺口与风险，不给&ldquo;建议投/退出&rdquo;之类的评级。
            </p>
          </header>

          <section className="mt-6 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
            <div className="flex items-center gap-2">
              <Bot aria-hidden className="size-5 text-muted-foreground" />
              <p className="text-12 font-medium">材料原文</p>
            </div>
            <Textarea
              data-testid="pi-material-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴季度经营简报 / 财务报表摘要等原文……"
              className="mt-3 min-h-48"
            />
            <div className="mt-4 flex items-center gap-3">
              <Button
                data-testid="pi-analyze-button"
                size="sm"
                disabled={text.trim() === "" || state.status === "loading"}
                onClick={analyze}
              >
                {state.status === "loading" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                开始分析
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/agent">返回{AGENTS_NAV_LABEL}</Link>
              </Button>
            </div>
            {state.status === "error" ? (
              <p data-testid="pi-analyze-error" className="mt-3 flex items-center gap-2 text-12 text-destructive">
                <AlertTriangle aria-hidden className="size-4" /> {state.message}
              </p>
            ) : null}
          </section>

          {state.status === "done" ? <AnalysisResult result={state.result} /> : null}
        </div>
      </div>
    </AppShell>
  );
}

function formatYoy(yoyPct: number | null): string {
  if (yoyPct === null) return "—（材料未给出可比对比期，不推算）";
  return `${yoyPct > 0 ? "+" : ""}${yoyPct}%`;
}

function AnalysisResult({ result }: { result: AnalyzeResult }) {
  return (
    <section data-testid="pi-analysis-result" className="mt-6 space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-14 font-semibold">财务指标</h2>
        {result.metrics.length === 0 ? (
          <p className="mt-2 text-12 text-muted-foreground">材料中未能识别出可抽取的财务指标。</p>
        ) : (
          <div className="mt-3 space-y-3">
            {result.metrics.map((m) => (
              <div key={m.key} data-testid={`pi-metric-${m.key}`} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-13 font-medium">{m.label}</span>
                  <span className="text-13">{m.currentValue}</span>
                  <Badge tone="outline" className="text-11">同比 {formatYoy(m.yoyPct)}</Badge>
                  {m.priorValue ? <span className="text-11 text-muted-foreground">对比期：{m.priorValue}</span> : null}
                </div>
                <p className="mt-1 text-11 leading-relaxed text-muted-foreground">材料中如何体现：「{m.evidenceQuote}」</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-14 font-semibold">风险清单</h2>
        {result.risks.length === 0 ? (
          <p className="mt-2 text-12 text-muted-foreground">未识别出材料中明确写出的异常/风险信号。</p>
        ) : (
          <div className="mt-3 space-y-3">
            {result.risks.map((r) => (
              <div key={r.id} data-testid={`pi-risk-${r.id}`} className="rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2">
                  <Badge tone="primary" className="text-11">{r.id}</Badge>
                  <Badge tone="neutral" className="text-11">{r.kind}</Badge>
                  <span className="text-13 font-medium">{r.issue}</span>
                </div>
                <p className="mt-1 text-12 leading-relaxed">为什么属于问题：{r.reason}</p>
                <p className="mt-1 text-11 leading-relaxed text-muted-foreground">材料中如何体现：「{r.evidenceQuote}」</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {result.needsVerification.length > 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6">
          <h2 className="text-14 font-semibold">需核实清单</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-12 text-muted-foreground">
            {result.needsVerification.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
