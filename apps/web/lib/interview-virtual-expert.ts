import { InterviewExpertFields,expertMarkdownHeadings } from '@repo/contracts/interview-expert-library';
import { EXPERT_PROFILE_FIELDS,emptyExpertProfile,parseExpertProfileDraft,profileValue } from './interview-expert-profile';
export type VirtualExpertFields = Readonly<InterviewExpertFields>;

const sections = [
  ["专业角色", "role"], ["专业领域", "domains"], ["研究关注", "focus"],
  ["观点风格", "style"], ["简介", "bio"], ["局限与材料边界", "limits"],
] as const;

/** A narrow, lossless Markdown format for editable AI proposals; unknown output is rejected. */
export function parseVirtualExpertProposal(markdown: string): VirtualExpertFields {
  const normalized = markdown.replace(/\r\n?/gu, "\n").trim();
  const title = /^# ([^\n]+)\n/u.exec(normalized);
  if (!title || /<[^>]+>/u.test(normalized)) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  const matches = expertMarkdownHeadings(normalized,2);
  const extraMatches=matches.slice(sections.length);
  const extraKeys=extraMatches.map(match=>EXPERT_PROFILE_FIELDS.find(([,label])=>label===match.text));
  if (matches.length < sections.length || matches.slice(0,sections.length).some((match, index) => match.text !== sections[index]?.[0]) || extraKeys.some(key=>!key) || new Set(extraMatches.map(match=>match.text)).size!==extraMatches.length) {
    throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  }
  const titleBody = normalized.slice(title[0].length, matches[0]?.start).trim();
  // The server asks for a "虚拟角色名称" section. Preserve its actual name
  // when a model follows that labeled-section format instead of naming the H1.
  const labeledName = title[1]?.trim() === "虚拟角色名称";
  const name = labeledName ? titleBody : title[1]?.trim();
  if ((labeledName && (!name || name.includes("\n") || /^#/u.test(name))) || (!labeledName && titleBody)) {
    throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  }
  const values = matches.map((match, index) => normalized.slice(match.end, matches[index + 1]?.start ?? normalized.length).trim());
  const draft=emptyExpertProfile();extraKeys.forEach((field,index)=>{if(field)draft[field[0]]=values[sections.length+index]??'';});
  let profile;try{profile=parseExpertProfileDraft(draft);}catch{throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");}
  const parsed = InterviewExpertFields.safeParse({ ...(profile?{profile}:{}), name, role: values[0], domains: values[1], focus: values[2], style: values[3], bio: values[4], limits: values[5] });
  if (!parsed.success) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  return parsed.data;
}

function validatedFields(fields: VirtualExpertFields): InterviewExpertFields {
  const parsed = InterviewExpertFields.safeParse(fields);
  if (!parsed.success) throw new Error("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  return parsed.data;
}
function renderSections(fields: InterviewExpertFields, depth: 2 | 3): string {
  return [...sections.map(([heading, field]) => `${"#".repeat(depth)} ${heading}\n${fields[field]}`),
    ...EXPERT_PROFILE_FIELDS.flatMap(([key,label])=>{const value=profileValue(fields.profile,key);return value?[`${"#".repeat(depth)} ${label}\n${value}`]:[];})].join("\n\n");
}
export function renderVirtualExpertMarkdown(fields: VirtualExpertFields): string {
  const value = validatedFields(fields);
  return `# ${value.name}\n\n${renderSections(value, 2)}`;
}

/** Generate nested field headings directly, preserving literal code contents. */
export function renderVirtualExpertSelection(fields: VirtualExpertFields): string {
  return renderSections(validatedFields(fields), 3)
    + "\n\n材料边界：模拟画像，仅用于模拟研究，不作为真人访谈证据。";
}

/** Read editable fields from one saved virtual-expert block without changing its anchor. */
export function parseVirtualExpertSelection(name: string, markdown: string): VirtualExpertFields {
  const body = markdown.replace(/^## \[[^\n]+\]\(#expert-[^\n]+\)\s*\n/u, "")
    .replace(/\n\n材料边界：模拟画像，仅用于模拟研究，不作为真人访谈证据。\s*$/u, "")
    .trim();
  let proposal=body;
  for(const heading of expertMarkdownHeadings(body,3).reverse())proposal=proposal.slice(0,heading.start)+proposal.slice(heading.start).replace(/^### /u,'## ');
  return parseVirtualExpertProposal(`# ${name}\n\n${proposal}`);
}
