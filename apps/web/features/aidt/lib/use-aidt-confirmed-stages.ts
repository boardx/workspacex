"use client";

import * as React from "react";
import type { AidtSharedStage } from "./live-aidt-stages";
import { AIDT_ROUND_COMPLETION_FIELD, aidtRoundConfirmation, aidtRoundDigest, aidtRoundPayload } from "./aidt-round-completion";

const EMPTY: ReadonlySet<number> = new Set();

export async function aidtStageHasConfirmation(stage: AidtSharedStage): Promise<boolean> {
  const record = stage.content.draft.fields[AIDT_ROUND_COMPLETION_FIELD];
  if (!record) return false;
  const payload = aidtRoundPayload(stage.projectId, stage.stageId, stage.content.draft, stage.sourceStageRevisions);
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
    void Promise.all(candidates.map(async stage => (await aidtStageHasConfirmation(stage)) ? stage.stageId : null)).then(ids => {
      if (active) setResult({ stages, scope, completed: new Set(ids.filter(id => id !== null)) });
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [scope, stages]);
  if (!scope) return null;
  if (Object.keys(stages).length === 0) return EMPTY;
  return result?.scope === scope && result.stages === stages ? result.completed : null;
}
