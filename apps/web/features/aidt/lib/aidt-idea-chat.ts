import {
  invalidateAidtIdeaSheets, readAidtIdeaDirectory, readAidtIdeaHmwSource,
} from "./aidt-idea-handoff";
import { aidtIdeaSentenceCount } from "./aidt-idea-readiness";
import { researchMaterialKey } from "./aidt-research-material-reference";
import type { AidtIdeaDraft, AidtUiStageDraft } from "./aidt-ui-drafts";

const prefix = "ideaChatConfirmation:";
const maxDescriptionLength = 2000;
type Turn = { id: string; role: string; content?: unknown };

export function ideaChatEntity(draft: AidtUiStageDraft | undefined, id: string) {
  if (!draft || !readAidtIdeaDirectory(draft).some(item => item.id === id && !item.archived)) return undefined;
  return draft.ideas.find(item => item.id === id);
}

function confirmationContents(draft: AidtUiStageDraft, idea: AidtIdeaDraft) {
  const hmw = readAidtIdeaHmwSource(draft, idea.id);
  return [idea.title, idea.description, idea.imageAttachment?.attachmentId, idea.imageAttachment?.threadId,
    draft.fields[researchMaterialKey("idea", idea.id)] ?? "", hmw?.id, hmw?.revision];
}

export function isAidtIdeaChatConfirmed(draft: AidtUiStageDraft, id: string) {
  const idea = ideaChatEntity(draft, id);
  return Boolean(idea && draft.fields[prefix + id] === JSON.stringify(confirmationContents(draft, idea)));
}

export function sameSavedAidtIdeaConfirmation(draft: AidtUiStageDraft, saved: AidtUiStageDraft | undefined, id: string) {
  return Boolean(saved && isAidtIdeaChatConfirmed(draft, id) && isAidtIdeaChatConfirmed(saved, id)
    && draft.fields[prefix + id] === saved.fields[prefix + id]);
}

export function allAidtIdeasConfirmed(draft: AidtUiStageDraft) {
  const ideas = readAidtIdeaDirectory(draft).filter(item => !item.archived);
  return ideas.length > 0 && ideas.every(item => isAidtIdeaChatConfirmed(draft, item.id));
}

export function hasAidtIdeaChatConfirmations(draft: AidtUiStageDraft) {
  return Object.keys(draft.fields).some(key => key.startsWith(prefix));
}

export function canConfirmAidtIdeaText(value: string) {
  return value.trim().length <= maxDescriptionLength && [2, 3].includes(aidtIdeaSentenceCount(value));
}

export function confirmAidtIdeaFromChat(draft: AidtUiStageDraft, id: string, value: string): AidtUiStageDraft {
  const idea = ideaChatEntity(draft, id);
  const description = value.trim();
  if (!idea || !canConfirmAidtIdeaText(description)) return draft;
  const changed = invalidateAidtIdeaSheets({ ...draft,
    ideas: draft.ideas.map(item => item.id === id ? { ...item, description } : item),
  });
  return { ...changed, fields: { ...changed.fields, [prefix + id]: JSON.stringify(confirmationContents(changed, { ...idea, description })) } };
}

/** Only a bounded description explicitly presented by the Skill after a real student turn is a proposal. */
export function readAidtIdeaChatProposal(messages: readonly Turn[]) {
  let hasStudentTurn = false;
  let proposal: { messageId: string; description: string } | null = null;
  for (const message of messages) {
    if (typeof message.content !== "string") continue;
    const content = message.content.trim();
    if (message.role === "user" && content && !/^(你好|您好|哈喽|嗨|hello|hi)[。！!？?\s]*$/iu.test(content)) {
      hasStudentTurn = true;
    }
    if (message.role !== "assistant" || !hasStudentTurn) continue;
    const lines = content.split(/\r?\n/u);
    const heading = /^(?:#{1,6}\s*)?(?:\*\*)?(?:描述单草稿|核心描述)(?:\*\*)?\s*(?:[:：]\s*(.*)|$)/u;
    const start = lines.findIndex(line => heading.test(line.trim()));
    if (start === -1) continue;
    const first = lines[start]!.trim().match(heading)?.[1] ?? "";
    const end = lines.findIndex((line, index) => index > start && /^(?:#{1,6}\s*)?(?:\*\*)?(?:待学生确认|确认后下一动作|下一步|学生确认|图像|对应 HMW)(?:\*\*)?(?:\s|[:：]|$)/u.test(line.trim()));
    const description = [first, ...lines.slice(start + 1, end === -1 ? undefined : end)].join("\n").trim();
    if (canConfirmAidtIdeaText(description)) proposal = { messageId: message.id, description };
  }
  return proposal;
}

const proposalPrefix = "ideaChatProposal:";
type IdeaProposal = { messageId: string; description: string };

export function saveAidtIdeaChatProposal(draft: AidtUiStageDraft, id: string, proposal: IdeaProposal) {
  const key = proposalPrefix + id;
  const json = JSON.stringify(proposal);
  if (!ideaChatEntity(draft, id) || !canConfirmAidtIdeaText(proposal.description) || draft.fields[key] === json) return draft;
  return { ...draft, fields: { ...draft.fields, [key]: json } };
}

export function getAidtIdeaChatProposal(draft: AidtUiStageDraft | undefined, id: string): IdeaProposal | null {
  const raw = draft?.fields[proposalPrefix + id];
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<IdeaProposal>;
    return typeof value.messageId === "string" && typeof value.description === "string" && canConfirmAidtIdeaText(value.description)
      ? { messageId: value.messageId, description: value.description } : null;
  } catch { return null; }
}
