"use client";

import * as React from "react";
import type { AidtSharedStage } from "./live-aidt-stages";
import { AIDT_ROUND_COMPLETION_FIELD, aidtRoundConfirmation, aidtRoundDigest, aidtRoundPayload, aidtRoundMissingOutput } from "./aidt-round-completion";
import { listAidtProblems, readAidtProblemEntityDraft, readAidtProblemHandoffDraft } from "./aidt-problem-entities";
import { areAidtInterviewsComplete } from "./aidt-interviews";
import { allAidtDefinitionEntitiesConfirmed } from "./aidt-definition-chat";
import { readAidtDefinition, readAidtDefinitionSelection } from "./aidt-definition";
import { allAidtIdeasConfirmed, hasAidtIdeaChatConfirmations } from "./aidt-idea-chat";
import { readAidtBrainstormSelection } from "./aidt-brainstorm";
import { readAidtIdeaHandoff } from "./aidt-idea-handoff";
import { aidtAllActivePrototypeEntitiesConfirmed } from "./aidt-prototype-handoff";
import { isAidtReflectionConfirmed } from "./aidt-verification-loop";
import { aidtTestGroupsComplete } from "./aidt-test-groups";

const EMPTY: ReadonlySet<number> = new Set();

export async function aidtStageHasConfirmation(stage: AidtSharedStage, stages?: Readonly<Record<number, AidtSharedStage>>): Promise<boolean> {
  const saved = stage.content.draft;
  if (stage.stageId === 1 && readAidtProblemHandoffDraft(saved) !== undefined) {
    const active = listAidtProblems(saved).filter(problem => !problem.archived);
    if (!active.length || !readAidtProblemHandoffDraft(saved)) return false;
    const confirmations = await Promise.all(active.map(async problem => {
      const draft = readAidtProblemEntityDraft(saved, problem.id);
      if (aidtRoundMissingOutput(1, draft) !== null) return false;
      const digest = await aidtRoundDigest(aidtRoundPayload(stage.projectId, 1, draft, stage.sourceStageRevisions));
      return draft.fields[AIDT_ROUND_COMPLETION_FIELD] === aidtRoundConfirmation(stage.projectId, 1, digest, false);
    }));
    return confirmations.every(Boolean);
  }
  if (stage.stageId === 2 && Object.keys(saved.fields).some(key => key.startsWith("interviewRecord:"))) {
    return areAidtInterviewsComplete(saved, stage.projectId);
  }
  if (stage.stageId === 3) {
    const definition = readAidtDefinition(saved.fields);
    if (definition.invalid || definition.personas.length || definition.hmws.length || definition.surprises.length) {
      return allAidtDefinitionEntitiesConfirmed(saved) && Boolean(readAidtDefinitionSelection(saved.fields)) && aidtRoundMissingOutput(3, saved, {
        projectId: stage.projectId, cards: stages?.[2]?.content.draft.discoveryCards, cardsRevision: stages?.[2]?.revision,
      }) === null;
    }
  }
  if (stage.stageId === 4 && ["ideaHmwSource", "ideaSheetIds", "ideaHandoffIds"].some(key => Object.hasOwn(saved.fields, key))) {
    if (readAidtBrainstormSelection(saved)) return true;
    const handoff = readAidtIdeaHandoff(saved, stage.projectId);
    return Boolean(handoff && (!hasAidtIdeaChatConfirmations(saved) || allAidtIdeasConfirmed(saved)));
  }
  if (stage.stageId === 5 && Object.keys(saved.fields).some(key => key.startsWith("prototypeEntity:") || key === "prototypeHandoffEntity")) {
    return aidtAllActivePrototypeEntitiesConfirmed(saved);
  }
  if (stage.stageId === 6 && Object.keys(saved.fields).some(key => key.startsWith("testGroup:"))) {
    return aidtTestGroupsComplete(saved) && isAidtReflectionConfirmed(saved);
  }
  const draft = stage.stageId === 1 ? readAidtProblemHandoffDraft(stage.content.draft) : undefined;
  if (draft === null) return false;
  const selected = draft ?? stage.content.draft;
  const record = selected.fields[AIDT_ROUND_COMPLETION_FIELD];
  if (!record) return false;
  const payload = aidtRoundPayload(stage.projectId, stage.stageId, selected, stage.sourceStageRevisions);
  const digest = await aidtRoundDigest(payload);
  return record === aidtRoundConfirmation(stage.projectId, stage.stageId, digest, stage.stageId === 4 || stage.stageId === 5);
}

/** Only persisted confirmations matching the saved content count towards progress. */
export function useAidtConfirmedStages(stages: Readonly<Record<number, AidtSharedStage>>, scope: string | null): ReadonlySet<number> | null {
  const [result, setResult] = React.useState<{ stages: typeof stages; scope: string; completed: ReadonlySet<number> } | null>(null);
  React.useEffect(() => {
    if (!scope) return;
    let active = true;
    const candidates = Object.values(stages);
    void Promise.all(candidates.map(async stage => (await aidtStageHasConfirmation(stage, stages)) ? stage.stageId : null)).then(ids => {
      if (active) setResult({ stages, scope, completed: new Set(ids.filter(id => id !== null)) });
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [scope, stages]);
  if (!scope) return null;
  if (Object.keys(stages).length === 0) return EMPTY;
  return result?.scope === scope && result.stages === stages ? result.completed : null;
}
