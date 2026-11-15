import type { AidtIdeaDraft } from "@/features/aidt/lib/aidt-ui-drafts";
/** Text/image readiness only; students still judge whether concepts differ. */
export function aidtIdeaReadiness(ideas: readonly AidtIdeaDraft[]) {
  const complete = ideas.filter((idea) => idea.title.trim() && idea.description.trim() && (idea.image || idea.imageAttachment));
  const names = ideas.map((idea) => idea.title.replace(/\s/g, "").toLocaleLowerCase());
  const unique = new Set(names).size === names.length;
  return { complete: complete.length, ready: ideas.length >= 3 && complete.length === ideas.length && unique };
}
