"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { AIDT_OUTPUTS, aidtUiStageSummary } from "../lib/aidt-ui-drafts";
import type { AidtSharedStage } from "../lib/live-aidt-stages";
import { aidtResearchMaterialsFromFields, researchMaterialKey } from "../lib/aidt-research-material-reference";
import { AidtResearchMaterialPreview } from "./aidt-research-material";
import { AidtStageHistory } from "./aidt-stage-history";

type Props = {
  stages: Readonly<Record<number, AidtSharedStage>>;
  stageId: number;
  projectId: string;
  sessionToken: string | null;
  phase: "loading" | "ready" | "error";
  retry?: () => void;
  onReference?: (stage: AidtSharedStage) => "accepted" | "occupied" | "unavailable";
};

export function AidtArtifactShelf({ stages, stageId, projectId, sessionToken, phase, retry, onReference }: Props) {
  const [selected, select] = React.useState<number | null>(null);
  const [materialKey, setMaterialKey] = React.useState<string | null>(null);
  const [referenceStatus, setReferenceStatus] = React.useState("");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const preview = phase === "ready" && selected !== null ? stages[selected] : undefined;
  const entries = Object.values(stages);
  const materials = preview ? aidtResearchMaterialsFromFields(preview.content.draft.fields, projectId) : [];
  function list(title: string, items: AidtSharedStage[]) {
    return <section className="space-y-2">
      <h3 className="text-12 font-medium text-muted-foreground">{title}</h3>
      {items.length === 0 && <p className="text-12 text-muted-foreground">尚无保存版本</p>}
      {items.map((stage) => <Button key={stage.stageId} size="sm" variant={preview?.stageId === stage.stageId ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal text-left" aria-pressed={preview?.stageId === stage.stageId} onClick={() => { if (selected !== stage.stageId) { select(stage.stageId); setHistoryOpen(false); setMaterialKey(null); setReferenceStatus(""); } }}>
        <span className="min-w-0 break-words">{AIDT_OUTPUTS[stage.stageId]?.title}</span><span className="ml-auto shrink-0 text-11 text-muted-foreground">V{stage.revision}</span>
      </Button>)}
    </section>;
  }
  if (phase === "loading") return <p role="status" className="text-13 text-muted-foreground">正在读取小组成果…</p>;
  if (phase === "error") return <div role="alert" className="space-y-2 text-13"><p>小组成果暂时无法读取。</p>{retry && <Button size="sm" variant="outline" onClick={retry}>重新读取</Button>}</div>;
  return <div className="space-y-4">
    {preview && <section className="space-y-2 rounded-xl border border-border-subtle bg-muted p-3" aria-label="成果预览">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-13 font-medium">{AIDT_OUTPUTS[preview.stageId]?.title} · V{preview.revision}</h3>
        <Button type="button" size="xs" variant="ghost" onClick={() => { select(null); setHistoryOpen(false); setMaterialKey(null); setReferenceStatus(""); }}>关闭预览</Button>
      </div>
      <p className="whitespace-pre-wrap break-words text-13">{aidtUiStageSummary(preview.stageId, preview.content.draft) || "已保存空草稿"}</p>
      {preview.sourceStageRevisions.length > 0 && <p className="text-12 text-muted-foreground">引用：{preview.sourceStageRevisions.map(s => `第 ${s.stageId} 步 V${s.revision}`).join("、")}</p>}
      {preview.content.summaryReport && <details className="text-12"><summary className="cursor-pointer font-medium">查看已保存报告</summary><p className="mt-2 whitespace-pre-wrap break-words">{preview.content.summaryReport.markdown}</p></details>}
      {materials.length > 0 && <section className="space-y-2" aria-label="关联原始材料">
        <h4 className="text-12 font-medium">关联原始材料</h4>
        {materials.map(({ key, material }) => <div key={key}>
          <Button variant="ghost" size="xs" className="h-auto whitespace-normal text-left" aria-expanded={materialKey === key} onClick={() => setMaterialKey(current => current === key ? null : key)}>{material.name}</Button>
          {materialKey === key && <AidtResearchMaterialPreview projectId={projectId} reference={material} quote={preview.content.draft.discoveryCards?.find(card => researchMaterialKey("source", card.id) === key)?.quote} />}
        </div>)}
      </section>}
      {onReference && <Button size="xs" variant="outline" onClick={() => {
        const result = onReference(preview);
        setReferenceStatus(result === "accepted" ? "引用已放入输入框，发送前可核对。" : result === "occupied" ? "输入框已有草稿，请先处理后再引用。" : "对话尚未就绪，请稍后重试。");
      }}>引用到本轮</Button>}
      {referenceStatus && <p role="status" className="text-12 text-muted-foreground">{referenceStatus}</p>}
      <details key={preview.stageId} className="text-12" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-medium">查看历史版本</summary>
        {historyOpen && <AidtStageHistory projectId={projectId} stageId={preview.stageId} sessionToken={sessionToken} currentRevision={preview.revision} />}
      </details>
    </section>}
    {list("本步", entries.filter(stage => stage.stageId === stageId))}
    {list("其他阶段", entries.filter(stage => stage.stageId !== stageId))}
  </div>;
}
