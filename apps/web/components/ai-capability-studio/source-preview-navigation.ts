/** Fixed preview resource identity only; query parameters do not authorize real resources. */
export const sourcePreviewIdentity = { skillId: "demo-skill", draftId: "demo-source-draft" } as const;
const context = new URLSearchParams(sourcePreviewIdentity).toString();
export const sourcePreviewHref = `/preview/ai-capability-studio/source?${context}`;
export const sourceConnectionRepairHref = `/preview/ai-capability-studio/connections?returnTo=source&${context}`;
export function isSourcePreviewContext(params: { skillId?: string; draftId?: string }) {
  return params.skillId === sourcePreviewIdentity.skillId && params.draftId === sourcePreviewIdentity.draftId;
}
