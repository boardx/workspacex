import { interviewMarkdown } from "@repo/contracts";

/** Names and roles come from the saved expert selection, never generated answer titles. */
export function interviewExpertDisplayNames(document: interviewMarkdown.InterviewMarkdownDocument): Map<string, string> {
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  return new Map(blocks.flatMap(block => {
    const link = block.links.find(item => /^#expert-[a-zA-Z0-9_-]+$/u.test(item.url));
    if (!link) return [];
    const body = document.markdown.slice(block.contentStart, block.end);
    const field = blocks.find(item => item.start > block.start && item.start < block.end && item.title === "专业角色");
    const role = (body.match(/^专业角色[：:]\s*([^\n]+)/mu)?.[1]
      ?? (field ? document.markdown.slice(field.contentStart, blocks.find(item => item.start > field.start)?.start ?? field.end).trim() : ""))
      .replace(/\\([\\[\]()*_`#<>/])/gu, "$1").trim();
    const name = role && !link.text.endsWith(`（${role}）`) ? `${link.text}（${role}）` : link.text;
    return [[link.url.slice(8), name] as const];
  }));
}

/** Read-only presentation. Never send this projection back to canonical storage.
 * Only standalone generated metadata is hidden; answer text and links stay intact.
 */
export function interviewTranscriptDisplay(
  markdown: string,
  simulated: boolean,
  experts: readonly { expertId: string; displayName: string }[] = [],
): string {
  let fence: string | null = null;
  let attributedExpert: string | null = null;
  let wrapperDepth = 0;
  let foreignSection = false;
  let leadingMetadata = true;
  let metadataParagraph = false;
  return markdown.split("\n").flatMap((line) => {
    if (/^(?: {4}|\t)/u.test(line)) return !foreignSection ? [line] : [];
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      metadataParagraph = false;
      leadingMetadata = false;
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return !foreignSection ? [line] : [];
    }
    if (fence) return !foreignSection ? [line] : [];
    // A recognized notice may wrap across lines. Its paragraph ends at a
    // blank line or the next heading; subsequent answer paragraphs stay visible.
    if (metadataParagraph) {
      if (line.trim() && !/^\s*#{1,6}\s/u.test(line)) return [];
      metadataParagraph = false;
    }
    const text = line.trim();
    const wrapper = text.match(/^(#{1,6})\s+\[([^\]]+)\]\(#expert-([a-zA-Z0-9_-]+)\)$/u);
    if (wrapper) {
      attributedExpert = wrapper[3]!;
      wrapperDepth = wrapper[1]!.length;
      foreignSection = false;
      leadingMetadata = true;
      const expert = experts.find((item) => item.expertId === attributedExpert);
      // Use saved names/roles for display, retaining the stable source anchor.
      if (expert && (wrapper[2] === expert.expertId || /[（(].+[）)]$/u.test(expert.displayName))) {
        const label = expert.displayName.replace(/([\\[\]])/gu, "\\$1");
        return [`${wrapper[1]} [${label}](#expert-${expert.expertId})`];
      }
      return [line];
    }
    const heading = text.match(/^(#{1,6})\s+(.+?)\s*#*$/u);
    const normalize = (value: string) => value.replace(/[（(]/gu, "(").replace(/[）)]/gu, ")").replace(/\s+/gu, "");
    const namedExpert = simulated && heading && heading[1]!.length <= wrapperDepth
      ? experts.find(item => item.expertId === attributedExpert && normalize(item.displayName) === normalize(heading[2]!))
        ?? experts.find(item => normalize(item.displayName) === normalize(heading[2]!)) : undefined;
    // A copied peer section may contain ordinary same-level insight headings.
    // Only returning to the current expert (or its saved wrapper above) ends it.
    if (foreignSection && namedExpert?.expertId !== attributedExpert) return [];
    if (attributedExpert && namedExpert) {
      foreignSection = namedExpert.expertId !== attributedExpert;
      if (!foreignSection) leadingMetadata = true;
      return [];
    }
    if (leadingMetadata && /^(?:[-*]\s+)?(?:\*\*)?(?:专家\s*ID|虚拟专家\s*ID|虚拟角色\s*ID|persona\s*(?:ID)?)(?:\*\*)?\s*[：:]\s*`?[a-zA-Z0-9_-]+`?[。.]?$/iu.test(text)) return [];
    if (!simulated) return [line];
    if (/^#{1,6}\s+(?:模拟访谈记录|模拟访谈|模拟访谈回答)\s*$/u.test(text)) return [];
    const generatedHeader = text.match(/^#{1,6}\s+(?:访谈回答[：:]\s*.+[（(]((?:persona|virtual)-[a-zA-Z0-9_-]+)[）)]|.+[（(]((?:persona|virtual)-[a-zA-Z0-9_-]+)[）)]\s*访谈(?:记录|回答|回复))\s*$/u);
    if (generatedHeader && attributedExpert === (generatedHeader[1] ?? generatedHeader[2])) return [];
    if (generatedHeader) {
      const mentioned = experts.find(item => item.expertId === (generatedHeader[1] ?? generatedHeader[2]));
      // A model can mention another selected expert inside one task. Keep that
      // text readable without inventing a new server-attributed expert wrapper.
      if (mentioned) return [`${text.match(/^#{1,6}/u)![0]} ${mentioned.displayName.replace(/([\\[\]*_`])/gu, "\\$1")}`];
    }
    const metadataText = text.replace(/^>\s*/u, "").replace(/\*{1,2}/gu, "");
    if (leadingMetadata && (metadataText === "以下回答来自模型模拟，需真人验证。"
      || /^(?:身份声明[：:]\s*本内容为基于模拟画像库生成的专家视角推演|声明[：:]\s*以下所有回答均基于提供的模拟研究计划与材料生成的定性推演|(?:证据边界声明|声明)[：:]\s*以下回答基于模拟(?:专家)?画像生成)/u.test(metadataText))) {
      metadataParagraph = true;
      return [];
    }
    if (text) leadingMetadata = false;
    return [line];
  }).join("\n");
}
