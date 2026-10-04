import type {OrgId} from '../../domain/org-id';
/** Private server-derived authority; never parsed from audio/tool/browser payloads. */
export type AsrAccountingContext=
 |{readonly kind:'run';readonly orgId:OrgId;readonly runId:string;readonly attemptId:string;readonly leaseEpoch:number}
 |{readonly kind:'personal-capture';readonly orgId:OrgId;readonly ownerUserId:string;readonly transcriptionId:string;readonly captureId:string}
 |{readonly kind:'recording';readonly orgId:OrgId;readonly userId:string;readonly sessionId:string}
 |{readonly kind:'draft';readonly orgId:OrgId;readonly userId:string};
export interface AsrRequestAccounting {
 start(context:AsrAccountingContext,input:{requestId:string;modelProvider:string;modelId:string;startedAt:string}):Promise<{terminal(input:{endedAt:string;outcome:'succeeded'|'failed';queuedDurationMs:bigint|null}):Promise<void>}>;
}
