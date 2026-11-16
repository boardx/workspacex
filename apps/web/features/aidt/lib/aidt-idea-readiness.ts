import type { AidtIdeaDraft } from "@/features/aidt/lib/aidt-ui-drafts";
/** A transparent punctuation/line check, not an AI judgement of idea quality. */
export function aidtIdeaSentenceCount(description: string): number {
  return description.trim().split(/[。！？!?]+|\.(?:\s+|$)|\n+/u).filter(part => part.trim()).length;
}
/** Text/image readiness only; students still judge whether concepts differ. */
export function aidtIdeaReadiness(ideas: readonly AidtIdeaDraft[], hasOriginalImage?: (idea: AidtIdeaDraft) => boolean) {
  const complete = ideas.filter((idea) => idea.title.trim() && [2, 3].includes(aidtIdeaSentenceCount(idea.description)) && (idea.image || idea.imageAttachment || hasOriginalImage?.(idea)));
  const names = ideas.map((idea) => idea.title.replace(/\s/g, "").toLocaleLowerCase());
  const unique = new Set(names).size === names.length && ideas.every(idea => !!idea.id.trim()) && new Set(ideas.map(idea => idea.id)).size === ideas.length;
  return { complete: complete.length, ready: ideas.length >= 3 && complete.length === ideas.length && unique };
}
