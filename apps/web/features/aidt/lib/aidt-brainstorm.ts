import { isAidtGreetingText } from "@repo/contracts/aidt-stages";
import { z } from "zod";
import { AIDT_BRAINSTORM_PREFIX, AIDT_BRAINSTORM_SELECTION_FIELD, AidtBrainstorm, readAidtBrainstorm, readAidtBrainstormSelection, type AidtBrainstorm as Session } from "@repo/contracts/aidt-brainstorm";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

export { readAidtBrainstormSelection };
const descriptions = z.array(z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(1000),
}).strict()).min(1).max(24);
type Candidate = z.infer<typeof descriptions>[number];
type Turn = { id: string; role: string; content?: unknown };
type Proposal = { messageId: string; items: Candidate[] };
const stableTitle = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");

export function createAidtBrainstorm(draft: AidtUiStageDraft, session: Session): AidtUiStageDraft {
  if (!AidtBrainstorm.safeParse(session).success || session.candidates.length
    || readAidtBrainstorm(draft.fields, session.id) || Object.keys(draft.fields).length >= 100) return draft;
  return { ...draft, fields: { ...draft.fields, [AIDT_BRAINSTORM_PREFIX + session.id]: JSON.stringify(session) } };
}

export function readAidtBrainstormProposals(turns: readonly Turn[], sessionId: string): Proposal[] {
  const proposals: Proposal[] = [];
  let studentStarted = false;
  for (const turn of turns) {
    if (typeof turn.content !== "string") continue;
    if (turn.role === "user" && turn.content.trim() && !isAidtGreetingText(turn.content)) studentStarted = true;
    if (turn.role !== "assistant" || !studentStarted || turn.content.length > 100_000) continue;
    for (const match of turn.content.matchAll(/\x60\x60\x60aidt-ideas\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60/g)) {
      try {
        const value: unknown = JSON.parse(match[1]!);
        const parsed = z.object({ sessionId: z.literal(sessionId), candidates: descriptions }).strict().safeParse(value);
        if (parsed.success) proposals.push({ messageId: turn.id, items: parsed.data.candidates });
      } catch { /* Ignore malformed and incomplete model drafts. */ }
    }
  }
  return proposals;
}

export function addAidtBrainstormCandidates(draft: AidtUiStageDraft, sessionId: string, proposals: readonly Proposal[]) {
  const session = readAidtBrainstorm(draft.fields, sessionId);
  if (!session || session.archived || session.candidates.length >= session.count) return draft;
  const existing = draft.ideas.filter(idea => session.candidates.includes(idea.id));
  const titles = new Set(existing.map(idea => stableTitle(idea.title)));
  const descriptions = new Set(existing.map(idea => stableTitle(idea.description)));
  const usedIds = new Set(draft.ideas.map(idea => idea.id));
  const ideas: AidtUiStageDraft["ideas"] = [];
  for (const proposal of proposals) {
    for (const [index, item] of proposal.items.entries()) {
      if (session.candidates.length + ideas.length >= session.count || draft.ideas.length + ideas.length >= 100) break;
      const suffix = proposal.messageId.replace(/[^\w-]/g, "").slice(-48);
      if (!suffix) continue;
      const id = `${sessionId}-${suffix}-${index}`;
      const title = stableTitle(item.title), description = stableTitle(item.description);
      if (usedIds.has(id) || !title || !description || titles.has(title) || descriptions.has(description)) continue;
      titles.add(title);
      descriptions.add(description);
      usedIds.add(id);
      ideas.push({ id, ...item });
    }
  }
  if (!ideas.length) return draft;
  const next = { ...session, candidates: [...session.candidates, ...ideas.map(idea => idea.id)] };
  return { ...draft, ideas: [...draft.ideas, ...ideas], fields: { ...draft.fields, [AIDT_BRAINSTORM_PREFIX + sessionId]: JSON.stringify(next) } };
}

export function confirmAidtBrainstormSelection(draft: AidtUiStageDraft, sessionId: string, ids: string[]): AidtUiStageDraft {
  const session = readAidtBrainstorm(draft.fields, sessionId);
  if (!session || session.archived) return draft;
  const next = { ...draft, fields: {
    ...draft.fields,
    ideaHmwSource: JSON.stringify(session.source),
    ideaSheetIds: "",
    ideaHandoffIds: JSON.stringify(ids),
    [AIDT_BRAINSTORM_SELECTION_FIELD]: JSON.stringify({ sessionId, ids }),
  } };
  return readAidtBrainstormSelection(next) ? next : draft;
}
