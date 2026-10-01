import { AsyncLocalStorage } from "node:async_hooks";
import type { OrgId } from "../../domain/org-id";
export class RunLeaseLostError extends Error { constructor(){super("agent_run_lease_lost");} }
export interface RunLease { readonly orgId:OrgId; readonly runId:string; readonly epoch:number; readonly verify:()=>Promise<void> }
const leaseContext=new AsyncLocalStorage<RunLease>();
export function currentRunLease(){return leaseContext.getStore();}
export function withRunLease<T>(lease:RunLease,work:()=>Promise<T>):Promise<T>{return leaseContext.run(lease,work);}
/** AG05：从某个 agent run 里派生、但生命周期独立的后台工作（Workflow 实例推进）不继承该 run 的租约围栏——
 * 否则 run 一结束，实例的每个事务都会被判 `agent_run_lease_lost`。 */
export function withoutRunLease<T>(work:()=>T):T{return leaseContext.exit(work);}
/** Call immediately before outbound side effects. An already dispatched operation is
 * never replayed during takeover; its existing remote run is reconciled read-only. */
export async function assertCurrentRunLease():Promise<void>{await currentRunLease()?.verify();}
