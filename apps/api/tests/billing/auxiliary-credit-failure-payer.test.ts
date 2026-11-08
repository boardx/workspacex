import {expect,it} from 'vitest';
import {PgAuxiliaryModelAccounting} from '../../src/infrastructure/billing/pg-auxiliary-model-accounting';
import {toOrgId} from '../../src/domain/org-id';
const db={withTenant:async(_org:unknown,work:(s:unknown)=>Promise<unknown>)=>work({query:async()=>({rows:[{user_id:'owned-user'}]})})};
it('auxiliary refusal uses the actual personal fallback payer, not a new organization plan lookup',async()=>{
 const failure=await new PgAuxiliaryModelAccounting(db as never).failure(toOrgId('owned-org'),'op','credit_required',undefined,{ownerType:'user',ownerId:'owned-user'});
 expect(failure).toMatchObject({code:'credit_required',ownerType:'user',ownerId:'owned-user',rechargePath:'/billing?purchase=1'});
});
it.each([{ownerType:'user',ownerId:'other-user'},{ownerType:'team',ownerId:'other-org'}] as const)('rejects a private payer outside the owned operation: %s',async payer=>{
 await expect(new PgAuxiliaryModelAccounting(db as never).failure(toOrgId('owned-org'),'op','credit_required',undefined,payer)).rejects.toMatchObject({code:'credit_accounting_unavailable'});
});
