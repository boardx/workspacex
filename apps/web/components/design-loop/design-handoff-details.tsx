"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { buildDesignDocMarkdown } from "@/lib/design-doc-markdown";
import type { DesignProject } from "@/lib/live-design-workbench";
import { PrototypeCanvas, deviceOf } from "./prototype-canvas";

/** The inbox receives the full project, including original HTML. Exports never
 * truncate source or include the owner's publishing token. */
export function DesignHandoffDetails({ project }: { readonly project: DesignProject }) {
  const [selectedFrame, setSelectedFrame] = useState(0);
  const frame = Math.min(selectedFrame, Math.max(0, project.frames.length - 1));
  const document = buildDesignDocMarkdown(project);
  const download = (kind: "json" | "md") => {
    const body = kind === "json" ? JSON.stringify({ version: 1, design: { ...project, share: null } }, null, 2) : document;
    const url = URL.createObjectURL(new Blob([body], { type: kind === "json" ? "application/json" : "text/markdown;charset=utf-8" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `design-${project.id}.${kind}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border p-3" aria-label="完整设计交付" data-testid="inbox-design-handoff">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="mr-auto text-13 font-semibold">完整设计 · {project.frames.length} 页</h4>
        <Button variant="outline" size="sm" onClick={() => download("md")}>下载设计文档</Button>
        <Button variant="outline" size="sm" onClick={() => download("json")}>下载完整设计包</Button>
      </div>
      <p className="text-11 text-muted-foreground">设计包包含全部页面 HTML、组件结构、交互跳转、验收标准、设计参数及协作记录。</p>
      {project.frames.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label="设计页面">
            {project.frames.map((label, index) => <Button key={index} variant={frame === index ? "secondary" : "outline"} size="sm" aria-pressed={frame === index} onClick={() => setSelectedFrame(index)}>{index + 1}. {label}</Button>)}
          </div>
          <div className="max-h-80 max-w-full overflow-auto rounded-control border border-border" aria-label="设计原型预览">
            <PrototypeCanvas key={frame} label={project.frames[frame] ?? ""} root={project.prototype[frame] ?? null}
              frameIndex={frame} device={deviceOf(project.template)} mode="preview" thumbnail
              ungenerated={project.prototype[frame] == null} theme={project.theme} accent={project.accent} tokens={project.tokens}
              wireframe={project.template === "wireframe"} links={project.frameLinks?.[frame] ?? []}
              onNavigate={(to) => { if (to >= 0 && to < project.frames.length) setSelectedFrame(to); }} />
          </div>
        </>
      )}
      <pre className="whitespace-pre-wrap break-words font-sans text-13 text-card-foreground">{document}</pre>
    </section>
  );
}
