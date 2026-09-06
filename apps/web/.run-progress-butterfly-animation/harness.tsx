/**
 * issue #2785 截图 harness —— 见同目录 README.md「截图怎么来的」。
 * 直接渲染生产用的 RunProgressCard（run-progress-card.tsx，面板 body 用的同一个组件）+
 * 真实文案常量，静态渲染成 HTML（不起 Next/CopilotKit）。用法：
 *   pnpm exec tsx .run-progress-butterfly-animation/harness.tsx <输出目录>
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunProgressButterfly, type RunProgressButterflyMotion } from "@/components/chat/run-progress-butterfly";
import { RunProgressCard } from "@/components/chat/run-progress-card";
import { REPLYING_PHASE_LABEL } from "@/lib/copilotkit-v2-run-progress";
import { phaseLabelForRunPhase, phaseLabelForToolName } from "@/lib/agent-run-phase";

// issue #2837（PR #2839 review）—— 不再复刻进度卡：直接渲染生产用的 `RunProgressCard`，
// 截图即真实 UI，卡片再改也不会在这里漂成第二份声明。
const STAGES = [
  { stage: "preparing", phase: phaseLabelForRunPhase("accepted"), elapsed: 2, longrun: false },
  { stage: "acting", phase: phaseLabelForToolName("call_skill"), elapsed: 7, longrun: false },
  { stage: "replying", phase: REPLYING_PHASE_LABEL, elapsed: 46, longrun: true },
] as const;

function Card({
  stage,
  phase,
  elapsed,
  longrun,
  motion,
}: {
  stage: "preparing" | "acting" | "replying";
  phase: string;
  elapsed: number;
  longrun: boolean;
  motion: RunProgressButterflyMotion;
}): JSX.Element {
  return (
    <RunProgressCard
      className="mt-3"
      stage={stage}
      phaseLabel={phase}
      elapsedSeconds={elapsed}
      isLongRun={longrun}
      planStep={null}
      motion={motion}
    />
  );
}

function Page(): JSX.Element {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      {(["fly", "flap", "drift"] as const).map((motion) => (
        <section key={motion} data-shot-section={motion} className="mb-6 flex flex-col gap-2 bg-background p-2">
          <h2 className="text-11 font-medium text-muted-foreground">motion={motion}</h2>
          {STAGES.map((s) => (
            <div key={s.stage} data-shot={`${motion}-${s.stage}`} className="w-fit pr-4">
              <Card {...s} motion={motion} />
            </div>
          ))}
          <div data-shot={`${motion}-large`} className="w-fit p-2">
            <RunProgressButterfly motion={motion} className="h-12 w-12" />
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
