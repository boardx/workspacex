import {AsyncLocalStorage} from "node:async_hooks";
import type {Principal} from "../../domain/principal";
/** Server authenticated/execution ownership only. Never construct from model arguments. */
export type CreditExecutionSubject=Readonly<Principal>;
const subjects=new AsyncLocalStorage<CreditExecutionSubject>();
export function currentCreditSubject():CreditExecutionSubject|undefined{return subjects.getStore();}
export function withCreditSubject<T>(subject:CreditExecutionSubject,work:()=>T):T{
 return subjects.run(Object.freeze({userId:subject.userId,orgId:subject.orgId}),work);
}
