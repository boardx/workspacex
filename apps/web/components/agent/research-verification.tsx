"use client";

/**
 * 第三步：预测比对表 + 根因分类 —— 需求文档「数月后回来看当初的判断对不对」。
 *
 * ## 这张表为什么长这样
 *
 * 左边是**当初写下的预测**（只读，发布那一刻就钉住了），右边是**今天的实际**。
 * 两列并排是刻意的：只显示"兑现率 60%"这样的汇总，人会点头然后走开；
 * 逐条并排才会看见"哦，我们当时以为 2027 年 EDA 能覆盖三个环节"这种具体的错。
 *
 * 预测那列**不可编辑**。允许改的话，三个月后"当初的预测"就会被今天的认知悄悄修饰，
 * 而修饰过的预测必然显得比实际更准——那不是验证，是自我确认。
 *
 * ## 根因为什么是必填而不是可选
 *
 * 复盘的产出应当是"下次改什么"。一份只有判定没有根因的比对表，读完仍然不知道
 * 该动哪里。服务端对 partial/missed 强制要求根因（`ROOT_CAUSE_REQUIRED`），
 * 这里同步把提交按钮禁用并说明——但**判定仍以服务端为准**。
 */
import * as React from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import { researchWorkflow as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  explainResearchFailure,
  fillResearchPrediction,
  type ResearchPrediction,
} from "@/lib/live-research-workflow";

const VERDICT_TONE: Readonly<Record<C.PredictionVerdictName, string>> = {
  matched: "text-emerald-600 dark:text-emerald-400",
  partial: "text-amber-600 dark:text-amber-400",
  missed: "text-destructive",
};

/** 汇总。与后端 `summarize` 同一口径，但这里只是展示，不参与任何判定。 */
function summarize(rows: readonly ResearchPrediction[]) {
  const n = (f: (p: ResearchPrediction) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    filled: n((p) => p.verdict !== null),
    matched: n((p) => p.verdict === "matched"),
    partial: n((p) => p.verdict === "partial"),
    missed: n((p) => p.verdict === "missed"),
    framework: n((p) => p.rootCause === "framework"),
  };
}

export function ResearchVerification({
  threadId,
  predictions,
  onChange,
}: {
  threadId: string;
  predictions: readonly ResearchPrediction[];
  onChange: (next: ResearchPrediction[]) => void;
}): JSX.Element | null {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<{ what: string; next: string } | null>(null);
  const [drafts, setDrafts] = React.useState<
    Record<string, { actual: string; verdict: C.PredictionVerdictName | null; rootCause: C.RootCauseName | null }>
  >({});

  if (predictions.length === 0) return null;
  const sum = summarize(predictions);

  function draft(id: string) {
    return drafts[id] ?? { actual: "", verdict: null, rootCause: null };
  }

  /** 这一条为什么还不能提交——一句话，按优先级。 */
  function blockedReason(id: string): string | null {
    const d = draft(id);
    if (!d.actual.trim()) return "先写下实际情况";
    if (d.verdict === null) return "选一个判定";
    if (d.verdict !== "matched" && d.rootCause === null) return "没兑现的预测必须选根因";
    return null;
  }

  async function submit(id: string) {
    const d = draft(id);
    setBusy(id);
    setFailure(null);
    try {
      onChange(await fillResearchPrediction(threadId, id, d.actual.trim(), d.verdict!, d.rootCause));
    } catch (e) {
      setFailure(explainResearchFailure(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section data-testid="research-verification" className="border-b border-border px-5 py-4 md:px-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-3">
        <header className="space-y-1">
          <h2 className="text-12 font-semibold">预测与实际比对</h2>
          <p data-testid="research-verification-summary" className="text-11 text-muted-foreground">
            共 {sum.total} 条，已回填 {sum.filled} 条 · 兑现 {sum.matched} / 部分 {sum.partial} / 未兑现{" "}
            {sum.missed}
          </p>
          {/* 框架性根因是整个第三步唯一会改变**下一次**研判的信号——单独说一句。
              执行性问题改的是这一次，框架性问题改的是以后每一次。 */}
          {sum.framework > 0 ? (
            <p data-testid="research-framework-signal" className="text-11 text-amber-700 dark:text-amber-400">
              其中 {sum.framework} 条属于框架性问题 —— 判断逻辑本身需要修订，不只是这一次没做好。
            </p>
          ) : null}
        </header>

        {failure ? (
          <p data-testid="research-verification-failure" className="flex items-start gap-1.5 text-11 text-destructive">
            <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>{failure.what}。{failure.next}</span>
          </p>
        ) : null}

        <ul className="space-y-2">
          {predictions.map((p) => {
            const filled = p.verdict !== null;
            const d = draft(p.id);
            const blocked = blockedReason(p.id);
            return (
              <li
                key={p.id}
                data-testid={`research-prediction-${p.id}`}
                data-filled={filled}
                className="rounded-md border border-border p-3 text-11"
              >
                <div className="flex flex-wrap items-start gap-2">
                  {/* 当初的预测——**只读**。可编辑的话，三个月后它会被今天的认知悄悄修饰。 */}
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground">第 {p.graphVersion} 版预测：</span>
                    {p.statement}
                  </span>
                  <ArrowRight aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    {filled ? (
                      <>
                        <span className={cn("font-medium", VERDICT_TONE[p.verdict!])}>
                          {C.PREDICTION_VERDICT_LABELS[p.verdict!]}
                        </span>
                        ：{p.actual}
                        {p.rootCause ? (
                          <span data-testid={`research-root-cause-${p.id}`} className="block text-muted-foreground">
                            根因：{C.ROOT_CAUSE_LABELS[p.rootCause]}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">尚未回填</span>
                    )}
                  </span>
                </div>

                {!filled ? (
                  <div className="mt-2 space-y-2">
                    <input
                      data-testid={`research-actual-${p.id}`}
                      value={d.actual}
                      onChange={(e) => setDrafts((s) => ({ ...s, [p.id]: { ...draft(p.id), actual: e.target.value } }))}
                      placeholder="今天的实际情况是？"
                      className="w-full rounded border border-border bg-background px-2 py-1"
                    />
                    <div className="flex flex-wrap gap-1">
                      {C.PREDICTION_VERDICTS.map((v) => (
                        <Button
                          key={v}
                          data-testid={`research-verdict-${p.id}-${v}`}
                          size="sm"
                          variant={d.verdict === v ? "primary" : "outline"}
                          onClick={() =>
                            setDrafts((s) => ({
                              ...s,
                              // 改判为「兑现」时清掉根因：兑现了没有根因可言，
                              // 留着上次选的会提交一个自相矛盾的组合。
                              [p.id]: { ...draft(p.id), verdict: v, rootCause: v === "matched" ? null : draft(p.id).rootCause },
                            }))
                          }
                        >
                          {C.PREDICTION_VERDICT_LABELS[v]}
                        </Button>
                      ))}
                    </div>

                    {/* 根因只在"没兑现"时出现——兑现了还要选根因是在制造噪音 */}
                    {d.verdict !== null && d.verdict !== "matched" ? (
                      <div data-testid={`research-root-cause-picker-${p.id}`} className="flex flex-wrap gap-1">
                        {C.ROOT_CAUSES.map((rc) => (
                          <Button
                            key={rc}
                            data-testid={`research-root-cause-${p.id}-${rc}`}
                            size="sm"
                            variant={d.rootCause === rc ? "primary" : "outline"}
                            onClick={() => setDrafts((s) => ({ ...s, [p.id]: { ...draft(p.id), rootCause: rc } }))}
                          >
                            {C.ROOT_CAUSE_LABELS[rc]}
                          </Button>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        data-testid={`research-fill-${p.id}`}
                        size="sm"
                        variant="primary"
                        disabled={busy === p.id || blocked !== null}
                        onClick={() => void submit(p.id)}
                      >
                        回填这一条
                      </Button>
                      {/* 禁用必说明原因——同门①，team2 的教训 */}
                      {blocked ? (
                        <span data-testid={`research-fill-blocked-${p.id}`} className="text-muted-foreground">
                          {blocked}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
