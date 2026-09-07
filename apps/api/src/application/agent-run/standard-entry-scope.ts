import type {ToolExecutionCheck} from './tool-execution-authority';
import type {OrgId} from '../../domain/org-id';
export const STANDARD_ENTRY_SCOPE=Symbol('StandardEntryScope');
export interface StandardEntryScope {
 run<T>(runId:string,input:Omit<ToolExecutionCheck,'orgId'|'parentRunId'>&{orgId:string},consume:(actor:{orgId:OrgId;userId:string})=>Promise<T>):Promise<T>;
}
