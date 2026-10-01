export type VirtualExpertFields = Readonly<{
  name: string;
  role: string;
  domains: string;
  focus: string;
  style: string;
  bio: string;
  limits: string;
}>;

const sections = [
  ["专业角色", "role"], ["专业领域", "domains"], ["研究关注", "focus"],
  ["观点风格", "style"], ["简介", "bio"], ["局限与材料边界", "limits"],
] as const;

/** A narrow, lossless Markdown format for editable AI proposals; unknown output is rejected. */
export function parseVirtualExpertProposal(markdown: string): VirtualExpertFields {
  const normalized = markdown.replace(/\r\n?/gu, "\n").trim();
  const title = /^# ([^\n]+)\n\n/u.exec(normalized);
  if (!title || /<[^>]+>/u.test(normalized)) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  const matches = [...normalized.matchAll(/^## ([^\n]+)\n/gmu)];
  if (matches.length !== sections.length || matches.some((match, index) => match[1] !== sections[index]?.[0])) {
    throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  }
  if (normalized.slice(title[0].length, matches[0]?.index).trim()) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  const values = matches.map((match, index) => normalized.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? normalized.length).trim());
  if (!title[1]?.trim() || values.some((value) => !value || /^#{1,6}\s/gmu.test(value))) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  return { name: title[1].trim(), role: values[0]!, domains: values[1]!, focus: values[2]!, style: values[3]!, bio: values[4]!, limits: values[5]! };
}

export function renderVirtualExpertMarkdown(fields: VirtualExpertFields): string {
  const name = fields.name.trim();
  if (!name || name.includes("\n") || /^#{1,6}\s/gmu.test(name)) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  const body = sections.map(([heading, field]) => {
    const value = fields[field].trim();
    if (!value || /^#{1,6}\s/gmu.test(value)) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
    return `## ${heading}\n${value}`;
  }).join("\n\n");
  return `# ${name}\n\n${body}`;
}

/** Keep persona details nested beneath the selected expert's ## anchor. */
export function renderVirtualExpertSelection(fields: VirtualExpertFields): string {
  return renderVirtualExpertMarkdown(fields)
    .replace(/^# [^\n]+\n\n/u, "")
    .replace(/^## /gmu, "### ")
    + "\n\n材料边界：模拟画像，仅用于模拟研究，不作为真人访谈证据。";
}
