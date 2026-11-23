import { confirmAidtIdeaFromChat } from "@/features/aidt/lib/aidt-idea-chat";
import { confirmAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";
import type { AidtIdeaDraft, AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { StageDraft } from "@repo/contracts/aidt-stages";

/** Saved, individually reviewed source sheets for tests of new S5 admission. */
export function reviewedAidtIdeasFixture(projectId: string, ideas: AidtIdeaDraft[], selectedIds: string[],
  source = { revision: 2, id: "hmw-stable", text: "如何帮助赶课者判断？" }) {
  let draft: AidtUiStageDraft = { ideas, selectedIdeaId: "", fields: { ideaHmwSource: JSON.stringify(source),
    ...Object.fromEntries(ideas.map(idea => [`ideaFile:${idea.id}`, JSON.stringify({ projectId, runId: "fixture-run", artifactId: idea.id,
      versionId: "v1", name: "图.png", mime: "image/png", sha256: "a".repeat(64), bytes: 42 })])),
  } };
  for (const idea of ideas) draft = confirmAidtIdeaFromChat(draft, idea.id, idea.description);
  draft = confirmAidtIdeaClassification(draft);
  return StageDraft.parse({ ...draft, fields: { ...draft.fields, ideaSheetIds: JSON.stringify(ideas.map(idea => idea.id)), ideaHandoffIds: JSON.stringify(selectedIds) } });
}
