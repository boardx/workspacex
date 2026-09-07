import type { GuidedResearchRuntime } from "./guided-research-api";

type Source = GuidedResearchRuntime["sources"][number];
export type ReportContent = { title: string; summary: string; sections: { sectionId: string; body: string; sourceIds?: string[] }[] };
export type ReportReference = { number: number; title: string; url: string };
export type ReportDocument = { title: string; summary: string; sections: { sectionId: string; title: string; body: string }[]; references: ReportReference[]; unresolvedReferences?: number };
const marker = /\[\[source:([^\]\r\n]+)\]\]/g;
// Citation-like examples inside inline/fenced code remain literal Markdown.
function outsideCode(text: string, transform: (part: string) => string): string {
  const code = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))|(`+)[^\n]*?\2/gm;
  let cursor = 0; let output = "";
  for (const match of text.matchAll(code)) {
    output += transform(text.slice(cursor, match.index)) + match[0]; cursor = match.index! + match[0].length;
  }
  return output + transform(text.slice(cursor));
}
export const citationHref = (number: number) => `#research-reference-${number}`;

/** Match ingestion normalization: canonical HTTP URL, no credentials or fragment. */
export function researchReferenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

/** One numbering pass shared by final rendering, provisional rendering and export. */
export function researchReportDocument(report: ReportContent, sources: Source[], outline: GuidedResearchRuntime["outline"], options: { provisional?: boolean; aliases?: { alias: string; sourceId: string }[] } = {}): ReportDocument {
  const accepted = new Map(sources.filter((source) => source.decision === "accepted").map((source) => [source.id, source]));
  const aliases = new Map<string, string | null>();
  for (const item of options.provisional ? options.aliases ?? [] : []) {
    aliases.set(item.alias, aliases.has(item.alias) && aliases.get(item.alias) !== item.sourceId ? null : item.sourceId);
  }
  let unresolvedReferences = 0;
  const references: ReportReference[] = [];
  const byUrl = new Map<string, ReportReference>();
  function reference(id: string): ReportReference | null {
    const source = accepted.get(id) ?? accepted.get(aliases.get(id) ?? ""); const url = source && researchReferenceUrl(source.url);
    if (!source || !url) return null;
    let item = byUrl.get(url);
    if (!item) { item = { number: references.length + 1, title: source.title, url }; references.push(item); byUrl.set(url, item); }
    return item;
  }
  function content(body: string, fallback: string[] = []): string {
    let markers = false;
    let text = outsideCode(body, (part) => part.replace(marker, (_match, id: string) => {
      markers = true; const item = reference(id);
      if (item) return `[${item.number}](${citationHref(item.number)})`;
      unresolvedReferences++;
      return options.provisional ? "" : "〔来源不可用〕";
    }).replace(/\[\[source:[^\]]*$/, options.provisional ? "" : "〔来源不可用〕"));
    if (!markers && fallback.length) {
      const used = new Set<number>(); const links: string[] = [];
      for (const id of fallback) { const item = reference(id); if (item && !used.has(item.number)) { used.add(item.number); links.push(`[${item.number}](${citationHref(item.number)})`); } }
      if (links.length) text += `\n\n本节来源 ${links.join(" ")}`;
    }
    return text;
  }
  const summary = content(report.summary);
  const sections = report.sections.map((section) => ({ sectionId: section.sectionId, title: outline.find((item) => item.id === section.sectionId)?.title ?? "研究章节", body: content(section.body, section.sourceIds) }));
  return { title: report.title, summary, sections, references, ...(unresolvedReferences ? { unresolvedReferences } : {}) };
}

function escapeMarkdown(text: string): string { return text.replace(/[\\`*_[\]<>]/g, "\\$&").replace(/[\r\n]+/g, " "); }
export function researchReportMarkdown(document: ReportDocument, partial = false): string {
  const footnotes = (text: string) => outsideCode(text, (part) => part.replace(/\[(\d+)\]\(#research-reference-\1\)/g, (_match, number: string) => `[^${number}]`));
  const blocks = [`# ${escapeMarkdown(document.title)}`];
  if (partial) blocks.push("> 本报告基于已有来源生成，部分检索任务未成功，相关证据可能存在缺口。");
  if (document.summary) blocks.push("## 执行摘要", footnotes(document.summary));
  for (const section of document.sections) blocks.push(`## ${escapeMarkdown(section.title)}`, footnotes(section.body));
  if (document.references.length) {
    blocks.push("## 参考来源");
    for (const reference of document.references) blocks.push(`[^${reference.number}]: [${escapeMarkdown(reference.title)}](<${reference.url.replace(/[<>]/g, encodeURIComponent)}>)`);
  }
  return `${blocks.join("\n\n")}\n`;
}
