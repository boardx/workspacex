import type { PlatformModelTestRequest, PlatformModelTestResult, PlatformModelTestRecord } from "@repo/contracts/platform-model-test";

export interface PlatformModelTestActor { readonly operatorUserId:string; readonly orgId:string; }
export interface PlatformModelTestOperation extends Pick<PlatformModelTestRecord,"state"|"settlementState"|"result"|"failureReason"> {
 readonly testId:string;
 readonly operatorUserId:string;
 readonly request:PlatformModelTestRequest;
}
export class PlatformModelTestError extends Error {
 constructor(readonly code:"TEST_ID_CONFLICT"|"TEST_NOT_FOUND"|"TEST_FORBIDDEN"|"TEST_ADAPTER_DISABLED"|"TEST_ACCOUNTING_UNAVAILABLE"){super(code);}
}
/** Every method verifies real operator permission and immutable organization attribution.
 * Claim verifies the authenticated operator is a formal member and the billed user. Same UUID with another
 * actor/body conflicts. Only the transaction winner may dispatch; replay never calls a model.
 */
export interface PlatformModelTestRepository {
 claim(actor:PlatformModelTestActor,input:PlatformModelTestRequest):Promise<{operation:PlatformModelTestOperation;claimed:boolean}>;
 read(actor:PlatformModelTestActor,testId:string):Promise<PlatformModelTestOperation>;
 /** Atomic queued -> dispatching CAS; cancellation winning first returns false. */
 beginDispatch(actor:PlatformModelTestActor,testId:string):Promise<boolean>;
 /** Durable write precedes settlement callback. A write failure must never release a hold. */
 terminal(actor:PlatformModelTestActor,testId:string,terminal:{state:"succeeded"|"failed"|"unknown";result:PlatformModelTestResult|null;failureReason:PlatformModelTestRecord["failureReason"]}):Promise<void>;
 /** queued -> cancelled or dispatching -> unknown, never treats dispatched work as free. */
 cancel(actor:PlatformModelTestActor,testId:string):Promise<PlatformModelTestOperation>;
}
export interface PlatformModelTestAdapter {
 /** Trusted deployment binding, not an entry from the public catalog. */
 invoke(operation:PlatformModelTestOperation,signal?:AbortSignal):Promise<PlatformModelTestResult>;
}
export interface PlatformModelTestAdapterRegistry {
 resolve(operation:PlatformModelTestOperation):Promise<{enabled:true;adapter:PlatformModelTestAdapter}|{enabled:false;reason:string}>;
}
export interface PlatformModelTestAccounting {
 /** Actual immutable tariff/bounds and member attribution, independent of fake agent runs. */
 reserve(operation:PlatformModelTestOperation):Promise<void>;
 /** Requires atomic closed-before-dispatch proof for this same physical UUID.
  * A missing/unconfirmed proof retains the hold; not-found or stale state is insufficient. */
 releaseUndispatched(operation:PlatformModelTestOperation):Promise<void>;
 /** Same physical test UUID, metadata replay only. Missing usage retains conservative hold. */
 settle(operation:PlatformModelTestOperation):Promise<void>;
}
export interface PlatformModelTestDependencies {
 readonly repository:PlatformModelTestRepository;
 readonly adapters:PlatformModelTestAdapterRegistry;
 readonly accounting:PlatformModelTestAccounting;
}
export const PLATFORM_MODEL_TEST_SERVICE=Symbol("PlatformModelTestService");
