"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { AIDT_OUTPUTS } from "@/features/aidt/lib/aidt-ui-drafts";
import { AIDT_STAGE_GUIDANCE } from "@/features/aidt/lib/aidt-stage-guidance";
import { AidtStageContract } from "@/features/aidt/components/aidt-stage-contract";

export type AidtReviewCheckpoint = { number: number; text: string };
/** Learning/output review belongs outside the canonical Chat. All content is supplied by the host. */
export function AidtStageJourney({ stageNumber, inputText, currentOutput, checkpoints = [], onKeepCheckpoint, readOnly = false, reportNote }: {
  stageNumber: number; inputText: string; currentOutput: string; checkpoints?: readonly AidtReviewCheckpoint[];
  onKeepCheckpoint?: () => void; readOnly?: boolean; reportNote: string;
}): JSX.Element {
  const guide = AIDT_STAGE_GUIDANCE[stageNumber]!;
  const [choice, setChoice] = React.useState<number | null>(null);
  const previous = checkpoints.find((x) => x.number === choice) ?? checkpoints[checkpoints.length - 1];
  return <details className="text-13" data-testid="aidt-stage-journey" data-stage={stageNumber}>
    <summary className="cursor-pointer text-12 text-muted-foreground">输入依据与修改记录</summary>
    <div className="mt-3 space-y-3">
    <div className="space-y-1 border-b border-border-subtle pb-3">
      <h3 className="text-14 font-medium">学生输入 → {AIDT_OUTPUTS[stageNumber]!.title}</h3>
      <p className="text-12 text-muted-foreground">讨论由学生整理进成果，建议不自动成为小组结论。</p>
    </div>
    <dl className="space-y-2">
      <div><dt className="font-medium">学生先提供</dt><dd className="text-muted-foreground">{guide.input}</dd></div>
      <div><dt className="font-medium">Agent可协助</dt><dd className="text-muted-foreground">{guide.assistance}</dd></div>
      <div><dt className="font-medium">本组自己决定</dt><dd className="text-muted-foreground">{guide.decision}</dd></div>
    </dl>
    <AidtStageContract stageNumber={stageNumber} />
    <details data-testid="aidt-journey-input"><summary className="cursor-pointer font-medium">本页输入与引用依据</summary><p className="mt-2 whitespace-pre-wrap break-words">{inputText.trim() || "尚未记录本步输入或显式引用；不自动补造前序依据。"}</p></details>
    <details data-testid="aidt-journey-comparison">
      <summary className="cursor-pointer font-medium">修改前后的产出对照</summary>
      {checkpoints.length > 0 && <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="选择本页先前记录">{checkpoints.map((x) => <Button type="button" size="xs" variant={previous?.number === x.number ? "secondary" : "outline"} aria-pressed={previous?.number === x.number} data-testid={`aidt-journey-choice-${x.number}`} data-checkpoint={x.number} onClick={() => setChoice(x.number)} key={x.number}>本页记录 {x.number}</Button>)}</div>}
      <div className="mt-3 space-y-3">
        <section data-testid="aidt-journey-previous"><h4 className="text-12 font-medium">先前保留的内容</h4><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{previous?.text ?? "尚未保留旧稿；不能把当前输入推断成过去的产出。"}</p></section>
        <section data-testid="aidt-journey-current"><h4 className="text-12 font-medium">本步当前草稿</h4><p className="mt-1 whitespace-pre-wrap break-words">{currentOutput.trim() || "尚未整理当前产出；学生可先在Chat表达或在下方记录。"}</p></section>
      </div>
    </details>
    {onKeepCheckpoint && <Button type="button" size="sm" variant="outline" data-testid="aidt-journey-keep" disabled={readOnly || !currentOutput.trim()} onClick={onKeepCheckpoint}>保留当前内容作本页对照</Button>}
    <p className="text-12 text-muted-foreground">本页临时对照，刷新后清除。</p>
    <div className="border-t border-border-subtle pt-3"><h4 className="font-medium">下一步带走什么</h4><p className="text-muted-foreground">{guide.handoff}</p></div>
    <p className="text-12 text-muted-foreground" data-testid="aidt-journey-report-note">{reportNote}</p>
    </div>
  </details>;
}
