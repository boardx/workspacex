import * as React from "react";
import { getAidtStageContract } from "@/features/aidt/lib/aidt-stage-contracts";

/** Task expectations only: no generation, persistence, Skill mounting or stage gates. */
export function AidtStageContract({ stageNumber }: { stageNumber: number }): JSX.Element | null {
  const contract = getAidtStageContract(stageNumber);
  if (!contract) return null;
  return <details className="rounded-control border border-border-subtle bg-card p-3 text-13" data-testid="aidt-stage-contract" data-stage={stageNumber}>
    <summary className="cursor-pointer font-medium">本步约定 · 输入{contract.inputs.length}项 → 过程反馈 → 正式交付</summary>
    <div className="mt-3 space-y-3">
      <p className="font-medium" data-testid="aidt-contract-title">{contract.title}</p>
      <section aria-label="本步输入" data-testid="aidt-contract-inputs">
        <h4 className="text-12 font-medium">输入{contract.inputs.length}项 · 逐步补齐，学生先提供</h4>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          {contract.inputs.map((input, index) => <li key={input.title} data-testid={`aidt-contract-input-${index + 1}`}><span className="font-medium">{input.title}</span><p className="text-12 text-muted-foreground">{input.detail}</p></li>)}
        </ol>
      </section>
      <section aria-label="本步过程反馈" data-testid="aidt-contract-feedback">
        <h4 className="text-12 font-medium">过程反馈 · 供学生判断和修改</h4>
        {contract.feedback.map(text => <p key={text} className="mt-1 text-12 text-muted-foreground">{text}</p>)}
      </section>
      <section aria-label="本步正式交付目标" data-testid="aidt-contract-deliverables">
        <h4 className="text-12 font-medium">正式交付 · 待学生完成</h4>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          {contract.deliverables.map(item => <li key={item.title}><span className="font-medium">{item.title}</span><p className="text-12 text-muted-foreground">{item.detail}</p></li>)}
        </ul>
      </section>
      <p className="text-12 text-muted-foreground" data-testid="aidt-contract-boundary">{contract.boundary}</p>
      <p className="text-12 text-muted-foreground" data-testid="aidt-contract-suggested-skill">推荐Skill：<span className="break-all">{contract.suggestedSkill}</span> · 设计建议，当前未接入此预览。</p>
      <p className="text-12 text-muted-foreground">列出的文件和版本是交付目标；此处不执行生成、上传或项目保存，也不据此认定全组已确认或学习已完成。</p>
    </div>
  </details>;
}
