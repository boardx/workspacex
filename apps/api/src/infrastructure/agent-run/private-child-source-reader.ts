import {NATIVE_SUBTASK_CONTEXT_PREFIX} from "@repo/contracts/standard-subtask-tools";
import type {DatabasePort} from "../../application/ports/database.port";
import {assembleChildSourceInput,readChildSourceInput,produceChildSdkEvidence,type ChildSdkSubject} from "../../application/agent-run/child-input-source-provenance";
import {PgSubtaskRunStore} from "./pg-subtask-run-store";
import {PgAgentRunRepository} from "./pg-agent-run-repository";
import {readPublishedSubtaskInstructions} from "./subtask-run-executor";

/** Called only after the existing leased owner resolver, on its caller TenantSession.
 * No parent-running requirement and no new authorization. Native context needs its
 * actual authorized resolver; a stored reference is never treated as resolved content.
 */
export async function readPrivateChildSources(db:DatabasePort,subject:ChildSdkSubject,serializedBody:string) {
 const store=new PgSubtaskRunStore(db),run=await store.get(subject.orgId,subject.runId);
 if(!run||run.parentRunId!==subject.rootRunId)throw new Error("AI_CHILD_SOURCE_IDENTITY_MISMATCH");
 // The caller owner resolver already locked and verified this exact attempt/epoch.
 // Do not invoke lifecycle readExecution here: it takes parent/child write locks.
 const state={run,executionAttemptId:subject.attemptId,leaseEpoch:subject.leaseEpoch,remoteRunId:null,remoteThreadId:null};
 const parent=await readPublishedSubtaskInstructions(db,subject.orgId,run);
 if(!parent)throw new Error("AI_CHILD_SOURCE_IDENTITY_MISMATCH");
 const skills=await new PgAgentRunRepository(db).readPinnedSkills(subject.orgId,run.snapshot.skillVersionIds);
 const unresolvedNativeContext=Boolean(run.context?.startsWith(NATIVE_SUBTASK_CONTEXT_PREFIX));
 const context=unresolvedNativeContext?null:run.context;
 const input=assembleChildSourceInput({modelProvider:run.snapshot.modelProvider,modelId:run.snapshot.modelId,
  system:parent.instructions,user:context?`${run.description}\n\nContext:\n${context}`:run.description,
  skills,orgId:String(subject.orgId),runId:run.id,executionAttemptId:subject.attemptId,executionLeaseEpoch:subject.leaseEpoch},subject.orgId,run,state,parent.instructions,context,skills,true);
 const assembly=readChildSourceInput(input,{orgId:subject.orgId,rootRunId:subject.rootRunId,runId:subject.runId,attemptId:subject.attemptId,leaseEpoch:subject.leaseEpoch});
 return assembly?produceChildSdkEvidence(assembly,subject,serializedBody,unresolvedNativeContext):null;
}
