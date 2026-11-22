"use client";

import * as React from "react";
import { registerTemplate } from "@repo/fabric-markdown";
import { CanvasStage, type CanvasStageHandle } from "@/components/canvas/canvas-stage";
import type { CanvasTemplate } from "@/lib/live-canvas";
import { orgTemplateSpec } from "../../../../../shared/canvas/org-template-spec";
import { Button } from "@/components/ui/button";
import { previewAidtPdf } from "../lib/aidt-print-preview";

/** A private render key keeps historical snapshots from replacing the current global persona template. */
export function AidtPersonaCanvasPreview({ template, code, stageRef, onCodeChange, sourceNotice }: {
  template: CanvasTemplate; code: string; sourceNotice?: string; stageRef?: React.Ref<CanvasStageHandle>; onCodeChange?: (code: string) => void;
}) {
  const identity = React.useId().replace(/[^\w-]/gu, "");
  const renderKey = `__aidt-persona-${identity}-${template.version}`;
  const ownStage = React.useRef<CanvasStageHandle>(null);
  React.useImperativeHandle(stageRef, () => ({ exportPNG: options => ownStage.current?.exportPNG(options) ?? null, fitToContent: () => ownStage.current?.fitToContent() }));
  const lifetime = React.useRef({ active: true, template, code, sourceNotice }); lifetime.current.template = template; lifetime.current.code = code; lifetime.current.sourceNotice = sourceNotice;
  const [printFailure, setPrintFailure] = React.useState("");
  React.useEffect(() => { const captured = lifetime.current; captured.active = true; return () => { captured.active = false; }; }, []);
  const [registered, setRegistered] = React.useState<CanvasTemplate | null>(null);
  React.useEffect(() => {
    // Preserve the actual backend sections, geometry, typography and paper metadata. No replacement template or text-card layout.
    registerTemplate(orgTemplateSpec(template, renderKey));
    setRegistered(template);
  }, [renderKey, template]);
  if (registered !== template) return <p role="status" className="text-13 text-muted-foreground">正在准备画像画布…</p>;
  const markdown = "```canvas\n" + code.replace(/^模板[:：]\s*persona\s*$/mu, `模板: ${renderKey}`) + "\n```";
  const print = async () => {
    setPrintFailure("");
    const captured = { template, code, sourceNotice };
    const isCurrent = () => lifetime.current.active && lifetime.current.template === captured.template && lifetime.current.code === captured.code && lifetime.current.sourceNotice === captured.sourceNotice;
    try {
      const picture = ownStage.current?.exportPNG();
      if (!picture) { setPrintFailure("画布尚未准备好，请稍后重试。"); return; }
      const root = document.createElement("section"); const image = document.createElement("img");
      image.src = picture.dataUrl; image.alt = "用户画像画布完整内容"; image.width = picture.width; image.height = picture.height;
      image.style.cssText = "display:block;width:100%;height:auto;object-fit:contain";
      if (sourceNotice) { const notice = document.createElement("p"); notice.textContent = sourceNotice; root.append(notice); }
      root.append(image);
      await image.decode();
      if (!isCurrent()) return;
      await previewAidtPdf(root, `用户画像 · 后台模板 V${template.version}`, { isCurrent, layout: sourceNotice ? "flow" : "canvas", ...(sourceNotice ? {} : { canvasSize: { width: picture.width, height: picture.height } }), defaultPaper: "A1" });
    } catch { if (isCurrent()) setPrintFailure("暂时无法打开打印预览，请重试。"); }
  };
  return <div className="space-y-2">{sourceNotice && <p className="text-12 text-muted-foreground">{sourceNotice}</p>}<div className="h-[28rem] min-h-80 overflow-hidden rounded-xl border border-border" data-testid="aidt-persona-canvas-preview">
    <CanvasStage key={renderKey} ref={ownStage} markdown={markdown} readOnly={!onCodeChange} tool="select" zoom={1} fitOnLoad onMarkdownChange={markdown => {
      if (!onCodeChange) return;
      const block = /^```canvas\s*\n([\s\S]*?)\n```\s*$/u.exec(markdown);
      if (!block) return;
      const body = block[1]!.replace(/^模板[:：]\s*\S+\s*$/mu, "模板: persona");
      if (body.length <= 6000) onCodeChange(body);
    }} />
  </div><Button type="button" size="sm" variant="outline" onClick={() => void print()}>打印画像</Button>{printFailure && <p role="alert" className="text-13">{printFailure}</p>}</div>;
}
