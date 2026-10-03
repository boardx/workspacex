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
  let leadingMetadata = true;
  let metadataParagraph = false;
  return markdown.split("\n").flatMap((line) => {
    if (/^(?: {4}|\t)/u.test(line)) return [line];
    // A recognized notice may wrap across lines. Its paragraph ends at a
    // blank line or the next heading; subsequent answer paragraphs stay visible.
    if (metadataParagraph) {
      if (line.trim() && !/^\s*#{1,6}\s/u.test(line)) return [];
      metadataParagraph = false;
    }
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      leadingMetadata = false;
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return [line];
    }
    if (fence) return [line];
    const text = line.trim();
    const wrapper = text.match(/^(#{1,6})\s+\[([^\]]+)\]\(#expert-([a-zA-Z0-9_-]+)\)$/u);
    if (wrapper) {
      attributedExpert = wrapper[3]!;
      leadingMetadata = true;
      const expert = experts.find((item) => item.expertId === attributedExpert);
      // Only replace a technical wrapper label, retaining its stable anchor.
      if (expert && wrapper[2] === expert.expertId) {
        const label = expert.displayName.replace(/([\\[\]])/gu, "\\$1");
        return [`${wrapper[1]} [${label}](#expert-${expert.expertId})`];
      }
      return [line];
    }
    if (leadingMetadata && /^(?:[-*]\s+)?(?:\*\*)?(?:专家\s*ID|虚拟专家\s*ID|虚拟角色\s*ID|persona\s*(?:ID)?)(?:\*\*)?\s*[：:]\s*`?[a-zA-Z0-9_-]+`?[。.]?$/iu.test(text)) return [];
    if (!simulated) return [line];
    if (/^#{1,6}\s+(?:模拟访谈记录|模拟访谈|模拟访谈回答)\s*$/u.test(text)) return [];
    const generatedHeader = text.match(/^#{1,6}\s+(?:访谈回答[：:]\s*.+[（(]((?:persona|virtual)-[a-zA-Z0-9_-]+)[）)]|.+[（(]((?:persona|virtual)-[a-zA-Z0-9_-]+)[）)]访谈记录)\s*$/u);
    if (generatedHeader && attributedExpert === (generatedHeader[1] ?? generatedHeader[2])) return [];
    const metadataText = text.replace(/^>\s*/u, "").replace(/\*\*/gu, "");
    if (leadingMetadata && (metadataText === "以下回答来自模型模拟，需真人验证。"
      || /^(?:身份声明[：:]\s*本内容为基于模拟画像库生成的专家视角推演|声明[：:]\s*以下所有回答均基于提供的模拟研究计划与材料生成的定性推演)/u.test(metadataText))) {
      metadataParagraph = true;
      return [];
    }
    if (text) leadingMetadata = false;
    return [line];
  }).join("\n");
}
