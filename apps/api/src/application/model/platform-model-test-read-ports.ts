import {PlatformModelTestRecord, type PlatformModelTestCandidate} from "@repo/contracts/platform-model-test";
import type {PlatformModelTestActor,PlatformModelTestOperation} from "./platform-model-test-ports";
export interface PlatformModelTestReadPort {
 /** Requires operator plus formal membership; only trusted registered deployment candidates. */
 candidates(actor:PlatformModelTestActor):Promise<readonly PlatformModelTestCandidate[]>;
 /** Same-org/operator, physical receipt and tariff attribution, no unreported estimates as facts. */
 readUsageProjection(actor:PlatformModelTestActor,testId:string):Promise<PlatformModelTestRecord["usage"]>;
}
export const PLATFORM_MODEL_TEST_READ=Symbol("PlatformModelTestReadPort");
/** Explicit public projection excludes prompt, principal, connection and credential metadata. */
export function platformModelTestRecord(operation:PlatformModelTestOperation,usage:PlatformModelTestRecord["usage"]):PlatformModelTestRecord{
 return PlatformModelTestRecord.parse({testId:operation.testId,orgId:operation.request.orgId,modelId:operation.request.modelId,
  capability:operation.request.capability,state:operation.state,settlementState:operation.settlementState,result:operation.result,failureReason:operation.failureReason,usage});
}
