import { AsyncLocalStorage } from "node:async_hooks";
import type { OrgId } from "../../domain/org-id";
export class RunLeaseLostError extends Error { constructor(){super("agent_run_lease_lost");} }
export interface RunLease { readonly orgId:OrgId; readonly runId:string; readonly epoch:number; readonly verify:()=>Promise<void> }
const leaseContext=new AsyncLocalStorage<RunLease>();
export function currentRunLease(){return leaseContext.getStore();}
export function withRunLease<T>(lease:RunLease,work:()=>Promise<T>):Promise<T>{return leaseContext.run(lease,work);}
/** Call immediately before outbound side effects. An already dispatched operation is
 * never replayed during takeover; its existing remote run is reconciled read-only. */
export async function assertCurrentRunLease():Promise<void>{await currentRunLease()?.verify();}
