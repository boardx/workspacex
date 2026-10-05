import type {PlatformModelTestAccounting,PlatformModelTestOperation} from "../../application/model/platform-model-test-ports";
import type {DatabasePort} from "../../application/ports/database.port";
import type {TokenUsageMeterPort} from "../../application/agent-run/ports";
import {toOrgId} from "../../domain/org-id";
import {PgAiAdmissionRepository} from "../auth/pg-ai-admission-repository";
import {PgTokenUsageRepository} from "../auth/pg-token-usage-repository";
import {recoverAiReceiptSettlement} from "../../application/agent-run/stage-two-receipt-recovery";
import type {AiReservationInput} from "../../application/agent-run/ai-admission-ports";
import type {PgPlatformModelTestRepository} from "./pg-platform-model-test-repository";

/** The trusted prepared adapter resolves its exact body against the audited tariff inside
 * the same transaction as admission. This is not a public maximum-cost assertion. */
export interface PlatformTestReservationResolver {
 resolve(operation:PlatformModelTestOperation,scoped:DatabasePort):Promise<{
  reservation:AiReservationInput;
  startedAt:string;
  callPurpose:Parameters<NonNullable<TokenUsageMeterPort["startRequest"]>>[1]["callPurpose"];
 }>;
}
const actor=(operation:PlatformModelTestOperation)=>({orgId:operation.request.orgId,operatorUserId:operation.operatorUserId});
export class PlatformTestAccounting implements PlatformModelTestAccounting {
 constructor(private readonly db:DatabasePort,private readonly repository:PgPlatformModelTestRepository,
  private readonly resolver:PlatformTestReservationResolver){}
 async reserve(operation:PlatformModelTestOperation):Promise<void>{
  await this.repository.withQueuedAccounting(actor(operation),operation.testId,async(scoped,metadata)=>{
   const prepared=await this.resolver.resolve(operation,scoped),input=prepared.reservation;
   if(metadata.testId!==operation.testId||operation.operatorUserId!==metadata.operatorUserId||input.requestId!==operation.testId||input.userId!==metadata.operatorUserId||metadata.orgId!==operation.request.orgId
    ||input.agentId!=null||input.maximumCostMicros>BigInt(operation.request.bounds.maximumCostMicros))throw new Error("TEST_ACCOUNTING_BINDING_INVALID");
   const purposes={text:"primary","text-to-speech":"primary","image-generation":"native-image","speech-to-text":"native-asr",embedding:"retrieval-embedding",rerank:"retrieval-rerank"} as const;
   if(prepared.callPurpose!==purposes[operation.request.capability])throw new Error("TEST_PURPOSE_INVALID");
   const admission=await new PgAiAdmissionRepository(scoped).reserve(metadata.orgId,input);
   // Warning/degradation require their own explicit UX acknowledgement; tests do not bypass them.
   if(admission.decision!=="allowed"||admission.replay||admission.tokenWarning)throw new Error("TEST_ADMISSION_REFUSED");
   await new PgTokenUsageRepository(scoped).startRequest(metadata.orgId,{requestId:input.requestId,userId:metadata.operatorUserId,
    runId:null,platformTestId:operation.testId,executionAttemptId:null,projectId:null,threadId:null,agentId:null,modelProvider:input.modelProvider,
    modelId:input.modelId,startedAt:prepared.startedAt,callPurpose:prepared.callPurpose});
   return {physicalReceiptId:input.requestId,value:undefined};
  });
 }
 async releaseUndispatched(operation:PlatformModelTestOperation):Promise<void>{
  // A durable start marker is deliberately written before admission acknowledgement.
  // No zero-charge receipt or closed-before-dispatch proof exists here, so cancellation
  // preserves the hold. A timeout or service failure label never establishes free work.
  await this.repository.readAccountingMetadata(actor(operation),operation.testId);
 }
 async settle(operation:PlatformModelTestOperation):Promise<void>{
  const metadata=await this.repository.readAccountingMetadata(actor(operation),operation.testId);
  if(!metadata.physicalReceiptId)return;
  const admission=new PgAiAdmissionRepository(this.db);
  await recoverAiReceiptSettlement({recovery:admission,admission},toOrgId(operation.request.orgId),metadata.physicalReceiptId);
  await this.repository.refreshSettlement(actor(operation),operation.testId);
 }
 /** Mandatory check immediately before the single paid dispatch. */
 async assertDispatch(operation:PlatformModelTestOperation,physicalReceiptId:string):Promise<void>{
  const metadata=await this.repository.readAccountingMetadata(actor(operation),operation.testId);
  if(metadata.state!=="dispatching"||metadata.physicalReceiptId!==physicalReceiptId||physicalReceiptId!==operation.testId)
   throw new Error("TEST_DISPATCH_CLOSED");
 }
}
