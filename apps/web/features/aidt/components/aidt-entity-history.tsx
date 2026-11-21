"use client";

import * as React from "react";
import Link from "next/link";
import { AidtProblemWorkspace } from "./aidt-problem-workspace";
import { AidtInterviewOutput } from "./aidt-interview-output";
import { AidtStageOutput } from "./aidt-stage-output";
import { AidtPrototypeEntityOutput } from "./aidt-prototype-handoff";
import { aidtHref, type AidtStep } from "../lib/project-aidt";
import { readAidtDefinitionEntities } from "../lib/aidt-definition";
import { readAidtIdeaDirectory } from "../lib/aidt-idea-handoff";
import { listAidtProblems, readAidtProblemEntityDraft } from "../lib/aidt-problem-entities";
import { readAidtInterviews } from "../lib/aidt-interviews";
import { readAidtPrototypeEntityDraft } from "../lib/aidt-prototype-handoff";
import { readAidtTestGroups } from "../lib/aidt-test-groups";
import { readAidtStageRevision, type AidtSharedStage } from "../lib/live-aidt-stages";

export function AidtEntityHistory({ projectId, entityId, step, revision, token, timestamp, sourceId }: {
  projectId: string;
  entityId: string;
  step: AidtStep;
  revision: number;
  token: string;
  timestamp: string | null;
  sourceId: string | null;
}) {
  const [stage, setStage] = React.useState<AidtSharedStage | null>();
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const abort = new AbortController();
    void readAidtStageRevision(projectId, step.id, revision, token, abort.signal).then(
      value => { if (!abort.signal.aborted) setStage(value); },
      () => { if (!abort.signal.aborted) setFailed(true); },
    );
    return () => abort.abort();
  }, [projectId, step.id, revision, token]);

  const backHref = aidtHref(projectId, step.id);
  const draft = stage?.content.draft;
  const fields = draft?.fields ?? {};
  const belongs = draft && (
    (step.id === 1 && listAidtProblems(draft).some(row => row.id === entityId))
    || (step.id === 2 && readAidtInterviews(fields).some(row => row.id === entityId))
    || (step.id === 3 && readAidtDefinitionEntities(fields).some(row => row.id === entityId))
    || (step.id === 4 && readAidtIdeaDirectory(draft).some(row => row.id === entityId))
    || (step.id === 5 && readAidtPrototypeEntityDraft(draft, entityId))
    || (step.id === 6 && readAidtTestGroups(fields).some(row => row.id === entityId))
  );
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="aidt-entity-history">
    <header className="flex items-center gap-3 border-b border-border px-4 py-3">
      <Link className="text-12 text-primary underline" href={backHref}>返回产物列表</Link>
      <h1 className="text-16 font-semibold">{step.title} · V{revision}</h1>
    </header>
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      {failed || stage !== undefined && !belongs
        ? <p role="alert">无法查看此产物的历史版本。</p>
        : stage === undefined
          ? <p role="status">正在读取历史版本…</p>
          : draft && <>
            <p className="text-12 text-muted-foreground">已保存的历史版本。</p>
            {timestamp && <p className="text-12">来源定位 {timestamp}</p>}
            {step.id === 1
              ? <AidtProblemWorkspace draft={readAidtProblemEntityDraft(draft, entityId)} readOnly manualEdit={false}
                  confirmRevision={revision} update={() => undefined} ask={() => "unavailable"} conversationRef={() => undefined} />
              : step.id === 2
              ? <AidtInterviewOutput projectId={projectId} entityId={entityId} draft={draft} frozenSourceId={sourceId} />
              : step.id === 5
              ? <AidtPrototypeEntityOutput projectId={projectId} designId={entityId} stageDraft={draft}
                  update={() => undefined} workflow={{ matchesServer: false }} readOnly />
              : <AidtStageOutput projectId={projectId} step={step} draft={draft} readOnly
                  update={() => undefined} toolHref={() => backHref}
                  activeDefinitionEntityId={step.id === 3 ? entityId : undefined}
                  ideaEntityId={step.id === 4 ? entityId : undefined} activeTestEntityId={step.id === 6 ? entityId : undefined}
                  availableCardsRevision={stage?.sourceStageRevisions.find(source => source.stageId === 2)?.revision}
                  readTestPrototypeEntity={readAidtPrototypeEntityDraft} />}
          </>}
    </div>
  </section>;
}
