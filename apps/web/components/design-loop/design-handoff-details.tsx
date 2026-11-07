"use client";
import { translate } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";


import { Button } from "@/components/ui/button";
import { useState } from "react";
import { buildDesignDocMarkdown } from "@/lib/design-doc-markdown";
import type { DesignProject } from "@/lib/live-design-workbench";
import { PrototypeCanvas, deviceOf } from "./prototype-canvas";

/** The inbox receives the full project, including original HTML. Exports never
 * truncate source or include the owner's publishing token. */
export function DesignHandoffDetails({ project }: { readonly project: DesignProject }) {
  const { locale } = useI18n();
  const [selectedFrame, setSelectedFrame] = useState(0);
  const frame = Math.min(selectedFrame, Math.max(0, project.frames.length - 1));
  const document = buildDesignDocMarkdown(project, new Date(), locale);
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
    <section className="flex flex-col gap-3 rounded-card border border-border p-3" aria-label={translate(locale, "inbox.completeDesignHandoff2")} data-testid="inbox-design-handoff">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="mr-auto text-13 font-semibold">{translate(locale, "inbox.completeDesign")} {project.frames.length} {translate(locale, "inbox.pages")}</h4>
        <Button variant="outline" size="sm" onClick={() => download("md")}>{translate(locale, "inbox.downloadDesignDocument")}</Button>
        <Button variant="outline" size="sm" onClick={() => download("json")}>{translate(locale, "inbox.downloadCompleteDesignPackage")}</Button>
      </div>
      <p className="text-11 text-muted-foreground">{translate(locale, "inbox.thePackageIncludesAllPageHTMLComponentStructureNavigation")}</p>
      {project.frames.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label={translate(locale, "inbox.designPages")}>
            {project.frames.map((label, index) => <Button key={index} variant={frame === index ? "secondary" : "outline"} size="sm" aria-pressed={frame === index} onClick={() => setSelectedFrame(index)}>{index + 1}. {label}</Button>)}
          </div>
          <div className="max-h-80 max-w-full overflow-auto rounded-control border border-border" aria-label={translate(locale, "inbox.designPrototypePreview")}>
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
