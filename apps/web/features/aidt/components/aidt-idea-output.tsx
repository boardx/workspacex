"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { preparePrintImages, printResearchPdf } from "@/lib/research-report-export";
import { aidtIdeaClassificationFor } from "../lib/aidt-idea-classification";
import { getAidtIdeaChatProposal, ideaChatEntity, isAidtIdeaChatConfirmed, sameSavedAidtIdeaConfirmation } from "../lib/aidt-idea-chat";
import { readAidtIdeaHmwSource } from "../lib/aidt-idea-handoff";
import { buildAidtIdeaSheetsDocument } from "../lib/aidt-idea-sheets";
import { aidtResearchMaterialLabel, isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey } from "../lib/aidt-research-material-reference";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtImageAttachmentPreview, type AidtImageAttachmentState } from "./aidt-image-attachment-picker";
import { AidtResearchMaterialPreview } from "./aidt-research-material";

export function AidtIdeaOutput({ projectId, entityId, draft, savedDraft, savedRevision }: {
  projectId: string; entityId: string; draft: AidtUiStageDraft; savedDraft?: AidtUiStageDraft; savedRevision?: number;
}) {
  const item = ideaChatEntity(draft, entityId);
  const persisted = sameSavedAidtIdeaConfirmation(draft, savedDraft, entityId);
  const currentConfirmed = isAidtIdeaChatConfirmed(draft, entityId);
  const proposal = getAidtIdeaChatProposal(draft, entityId);
  const reference = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", entityId)]);
  const material = reference?.projectId === projectId && isAidtResearchImage(reference) ? reference : null;
  const hmw = readAidtIdeaHmwSource(draft, entityId);
  const key = JSON.stringify([projectId, entityId, item?.title, item?.description, item?.imageAttachment, material, savedRevision, currentConfirmed]);
  const [image, setImage] = React.useState<{ key: string; image: AidtImageAttachmentState } | null>(null);
  const [status, setStatus] = React.useState<{ key: string; text: string } | null>(null);
  const [printing, setPrinting] = React.useState(false);
  const lifecycle = React.useRef({ key, generation: 0, active: false });
  if (lifecycle.current.key !== key) {
    lifecycle.current.key = key;
    lifecycle.current.generation++;
  }
  React.useEffect(() => {
    const state = lifecycle.current;
    state.active = true;
    return () => { state.active = false; };
  }, []);
  const onImage = (value: AidtImageAttachmentState) => setImage(previous => previous?.key === key && previous.image.src === value.src && previous.image.failed === value.failed ? previous : { key, image: value });
  const imageSrc = image?.key === key ? image.image.src : undefined;

  async function exportSheet() {
    if (!item || !savedDraft || !persisted || !imageSrc || printing) return;
    const generation = lifecycle.current.generation;
    const isCurrent = () => lifecycle.current.active && lifecycle.current.generation === generation;
    setPrinting(true);
    setStatus(null);
    try {
      const classification = aidtIdeaClassificationFor(savedDraft, entityId);
      const document = buildAidtIdeaSheetsDocument([{
        id: entityId, number: 1, title: item.title, description: item.description, imageSrc, proposed: false,
        hmw: hmw ? `HMW · 第 3 步 V${hmw.revision}：${hmw.text}` : null,
        categories: `学生分类：${classification.labels.join("、") || "暂未分类"}`,
        categoryReason: classification.reason, source: material ? aidtResearchMaterialLabel(material) : item.imageAttachment?.name ?? "",
      }]);
      await preparePrintImages([...document.querySelectorAll("img")]);
      if (!isCurrent()) return;
      await printResearchPdf(document, `AIDT 点子描述单-${item.title}`, { isCurrent });
      if (isCurrent()) setStatus({ key, text: "打印预览已请求，可选择另存为 PDF。" });
    } catch {
      if (isCurrent()) setStatus({ key, text: "未能打开打印预览，请重试。" });
    } finally {
      if (lifecycle.current.active) setPrinting(false);
    }
  }

  if (!item) return <p role="status">点子已不存在。</p>;
  return <section aria-label="点子产物" className="space-y-4" data-testid="aidt-idea-output">
    <div className="flex items-baseline justify-between gap-2"><h3 className="text-16 font-semibold">{item.title}</h3>
      <span className="shrink-0 text-12 text-muted-foreground">{persisted ? `已确认${savedRevision ? ` V${savedRevision}` : ""}` : currentConfirmed ? "待保存" : "待确认"}</span></div>
    {item.description && (!proposal || proposal.description === item.description) && <p className="whitespace-pre-wrap break-words text-13">{item.description}</p>}
    {proposal && proposal.description !== item.description && <div className="space-y-1">
      <h4 className="text-13 font-medium">AI 草稿</h4><p className="whitespace-pre-wrap break-words text-13">{proposal.description}</p>
    </div>}
    {!item.description && !proposal && <p className="text-13 text-muted-foreground">讨论后的点子草稿会显示在这里。</p>}
    {material ? <AidtResearchMaterialPreview projectId={projectId} reference={material} alt="点子配图" onImageState={onImage} />
      : item.imageAttachment ? <AidtImageAttachmentPreview projectId={projectId} reference={item.imageAttachment} alt="点子配图" onState={onImage} /> : null}
    {persisted && <Button type="button" variant="outline" size="sm" disabled={!imageSrc || printing} onClick={() => void exportSheet()}>
      {printing ? "正在准备…" : "导出描述单 PDF"}
    </Button>}
    {status?.key === key && <p role="status" className="text-12">{status.text}</p>}
    {proposal && item.description && proposal.description !== item.description && <details className="text-12"><summary className="cursor-pointer">查看当前记录</summary><p className="mt-2 whitespace-pre-wrap break-words">{item.description}</p></details>}
    {hmw && <details className="text-12"><summary className="cursor-pointer">查看 HMW V{hmw.revision}</summary><p className="mt-2">{hmw.text}</p></details>}
  </section>;
}
