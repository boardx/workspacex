import type {OrgId} from '../../domain/org-id';
import type {ReportedUsage} from '../agent-run/ports';
/** The authenticated principal and checked local membership belong to the use case, not model args. */
export interface LocalModelAccountingContext {readonly orgId:OrgId;readonly userId:string;readonly capabilityId:string;readonly signal?:AbortSignal;}
export interface LocalRequestAccounting {
 start(context:LocalModelAccountingContext,input:{requestId:string;modelId:string;startedAt:string}):Promise<{terminal(input:{endedAt:string;outcome:'succeeded'|'failed';usage:ReportedUsage}):Promise<void>}>;
}
