import * as design from "@repo/contracts/design-workbench";
import type { DesignProject } from "@/lib/live-design-workbench";
import { buildPrototypeExportHtml, collectPageCss } from "@/lib/prototype-export-html";
import { renderScreensToMarkup } from "@/lib/prototype-export-render";
import { parseResearchPrintHtml, type ResearchPrintPreviewOptions } from "@/lib/research-print-preview";
import { previewAidtPdf } from "./aidt-print-preview";

type PrintProject = Parameters<typeof renderScreensToMarkup>[0] & Parameters<typeof buildPrototypeExportHtml>[0]["project"];
type Options = Pick<ResearchPrintPreviewOptions, "isCurrent" | "defaultPaper">;
export type AidtPrintablePrototypeSnapshot = {
  id: string;
  frames: readonly string[];
  prototype: DesignProject["prototype"];
  links?: ReadonlyArray<ReadonlyArray<NonNullable<DesignProject["frameLinks"]>[number][number]>>;
};

async function previewProject(project: PrintProject, title: string, options: Options) {
  if (!project.frames.length || project.frames.length !== project.prototype.length || !project.prototype.some(Boolean)) throw new Error("尚无可打印的实际原型页面");
  if (options.isCurrent?.() === false) throw new Error("原型版本或访问状态已变化");
  const screens = await renderScreensToMarkup(project);
  if (options.isCurrent?.() === false) throw new Error("原型版本或访问状态已变化");
  const css = collectPageCss(screens.map(screen => screen.markup).join(""), [...document.styleSheets]);
  const html = buildPrototypeExportHtml({ project, screens, css, forPrint: true });
  const native = parseResearchPrintHtml(html);
  const pages = [...native.querySelectorAll<HTMLElement>(".wx-page")];
  if (pages.length !== project.frames.length) throw new Error("原型页面清单无法核对");
  const documents = pages.map((_, index) => {
    const copy = native.cloneNode(true) as Document;
    copy.querySelectorAll(".wx-page").forEach((page, at) => { if (at !== index) page.remove(); });
    const style = copy.createElement("style");
    style.textContent = ".wx-tabs,.wx-hint{display:none}.wx-shell{max-width:none}@media print{.wx-shell{padding:24px}.wx-page{page-break-after:auto;break-after:auto}}";
    copy.head.append(style);
    return "<!doctype html>" + copy.documentElement.outerHTML;
  });
  // The empty carrier contains no invented output: each page comes from the native exporter above.
  return previewAidtPdf(document.createElement("article"), title, { ...options, defaultPaper: options.defaultPaper ?? "A3", nativeDocuments: documents });
}

/** Current authorized Design object; no read, write, restore or new generation occurs here. */
export function previewAidtDesign(project: DesignProject, title: string, options: Options = {}) {
  return previewProject(project, title, options);
}

/** Exact saved snapshot supplied by the existing authorized loader; uses the S6 laptop/light viewing mode. */
export function previewAidtPrototype(snapshot: AidtPrintablePrototypeSnapshot, title: string, options: Options = {}) {
  return previewProject({ name: title, frames: [...snapshot.frames], prototype: snapshot.prototype, frameLinks: snapshot.links?.map(links => [...links]),
    frameNotes: snapshot.frames.map(() => "该保存快照未包含交互说明字段；此处不补写。"), template: "ui", theme: "light", accent: "neutral", tokens: design.DEFAULT_DESIGN_TOKENS }, title, options);
}
