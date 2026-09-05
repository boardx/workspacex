/**
 * issue #2769 截图 harness —— 见同目录 README.md「截图怎么来的」。
 * 用真实 RunProgressXMark + 真实文案常量 + 与 copilotkit-v2-panel-body.tsx 同一套 className
 * 复刻进度卡，静态渲染成 HTML（不起 Next/CopilotKit）。用法：
 *   pnpm exec tsx .run-progress-x-animation/harness.tsx <输出目录>
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunProgressXMark, type RunProgressXMarkMotion } from "@/components/chat/run-progress-x-mark";
import { cn } from "@/lib/utils";
import { REPLYING_PHASE_LABEL } from "@/lib/copilotkit-v2-run-progress";
import { phaseLabelForRunPhase, phaseLabelForToolName } from "@/lib/agent-run-phase";

const RUN_STAGE_ORDER = [
  { key: "preparing", label: "准备" },
  { key: "acting", label: "执行" },
  { key: "replying", label: "回复" },
] as const;

const STAGES = [
  { stage: "preparing", phase: phaseLabelForRunPhase("accepted"), elapsed: 2 },
  { stage: "acting", phase: phaseLabelForToolName("call_skill"), elapsed: 7 },
  { stage: "replying", phase: REPLYING_PHASE_LABEL, elapsed: 11 },
] as const;

function Card({ stage, phase, elapsed, motion }: {
  stage: string; phase: string; elapsed: number; motion: RunProgressXMarkMotion;
}): JSX.Element {
  return (
    <div data-testid="copilotkit-v2-running-indicator" role="status" aria-live="polite"
      className="mt-3 flex w-fit max-w-full flex-col gap-1 rounded-lg border border-border-subtle bg-muted/60 px-3 py-2">
      <span className="flex items-center gap-1 text-9 text-muted-foreground" data-testid="copilotkit-v2-thinking-stage" data-stage={stage}>
        {RUN_STAGE_ORDER.map(({ key, label }, i) => (
          <React.Fragment key={key}>
            {i > 0 ? <span aria-hidden>→</span> : null}
            <span className={cn(key === stage && "font-medium text-card-foreground")}>{label}</span>
          </React.Fragment>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground" data-testid="copilotkit-v2-thinking">
        <RunProgressXMark motion={motion} />
        <span data-testid="copilotkit-v2-thinking-phase">{phase}</span>
        <span data-testid="copilotkit-v2-thinking-elapsed">· 已用 {elapsed} 秒</span>
      </span>
    </div>
  );
}

function Page(): JSX.Element {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      {(["breathe", "turn"] as const).map((motion) => (
        <section key={motion} className="mb-6 flex flex-col gap-2">
          <h2 className="text-11 font-medium text-muted-foreground">motion={motion}</h2>
          {STAGES.map((s) => (
            <div key={s.stage} data-shot={`${motion}-${s.stage}`} className="w-fit pr-4">
              <Card {...s} motion={motion} />
            </div>
          ))}
          <div data-shot={`${motion}-large`} className="w-fit p-2">
            <RunProgressXMark motion={motion} className="h-12 w-12" />
          </div>
        </section>
      ))}
    </main>
  );
}

const outDir = process.argv[2];
if (!outDir) throw new Error("用法：tsx harness.tsx <输出目录>");
mkdirSync(outDir, { recursive: true });
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="./out.css"></head><body>${renderToStaticMarkup(<Page />)}</body></html>`;
writeFileSync(join(outDir, "index.html"), html);
console.log(`wrote ${join(outDir, "index.html")}`);
