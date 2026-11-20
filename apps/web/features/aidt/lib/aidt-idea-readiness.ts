import type { AidtIdeaDraft } from "@/features/aidt/lib/aidt-ui-drafts";
/** A transparent punctuation/line check, not an AI judgement of idea quality. */
export function aidtIdeaSentenceCount(description: string): number {
  return description.trim().split(/[。！？!?]+|\.(?:\s+|$)|\n+/u).filter(part => part.trim()).length;
}
/** Incomplete brainstorming remains editable; it is never silently exported as a finished sheet. */
export function aidtCompleteIdeas(ideas: readonly AidtIdeaDraft[], hasOriginalImage?: (idea: AidtIdeaDraft) => boolean): AidtIdeaDraft[] {
  return ideas.filter(idea => idea.title.trim() && [2, 3].includes(aidtIdeaSentenceCount(idea.description)) && (idea.image || idea.imageAttachment || hasOriginalImage?.(idea)));
}
/** Text/image readiness only; students still judge whether concepts differ. */
export function aidtIdeaReadiness(ideas: readonly AidtIdeaDraft[], hasOriginalImage?: (idea: AidtIdeaDraft) => boolean) {
  const complete = aidtCompleteIdeas(ideas, hasOriginalImage);
  const names = complete.map(idea => idea.title.replace(/\s/g, "").toLocaleLowerCase());
  const distinctNames = new Set(names).size;
  const identifiersValid = ideas.every(idea => !!idea.id.trim()) && new Set(ideas.map(idea => idea.id)).size === ideas.length;
  return { complete: complete.length, distinctNames, identifiersValid, ready: complete.length >= 3 && distinctNames === names.length && identifiersValid };
}
