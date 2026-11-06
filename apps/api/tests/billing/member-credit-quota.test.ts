import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {describe,it,expect,vi} from 'vitest';
import {assertMemberCreditQuota, readMemberCreditUsage} from '../../src/infrastructure/billing/member-credit-quota';
import type {TenantSession} from '../../src/application/ports/database.port';
import type {OrgId} from '../../src/domain/org-id';
const org='org' as OrgId;
function session(plan='enterprise',quota:string|null=null,used='0',held='0',kind='organization',billingGeneration:string|null=generation) {
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('organization_plans')?[{plan,kind,billing_generation:billingGeneration}]:sql.includes('monthly_limit')?[{monthly_limit:quota}]:[{used_hundredths:used,held_hundredths:held,unbounded:'0'}]}));
 return {query} as unknown as TenantSession;
}
describe('enterprise member monthly Credit admission',()=>{
 it('defaults existing and new unconfigured members to 1000 without creating funds',async()=>{
  const s=session();await expect(assertMemberCreditQuota(s,org,'user',100000n,true)).resolves.toBe(100000n);
  expect(vi.mocked(s.query).mock.calls.every(([sql])=>!/(INSERT|UPDATE)/.test(sql))).toBe(true);
  await expect(assertMemberCreditQuota(s,org,'user',100001n,true)).rejects.toMatchObject({code:'credit_required'});
 });
 it('preserves explicit zero and custom override',async()=>{
  await expect(assertMemberCreditQuota(session('enterprise','0'),org,'user',1n,true)).rejects.toMatchObject({code:'credit_required'});
  await expect(assertMemberCreditQuota(session('enterprise','2500'),org,'user',200000n,true)).resolves.toBe(200000n);
 });
 it('counts actual credit debits and outstanding reservations before another admission',async()=>{
  await expect(assertMemberCreditQuota(session('enterprise',null,'90000','9000'),org,'user',1001n,true)).rejects.toMatchObject({code:'credit_required'});
  await expect(assertMemberCreditQuota(session('enterprise',null,'90000','9000'),org,'user',1000n,true)).resolves.toBe(1000n);
 });
 it('holds remaining allowance for unbounded calls and preserves ordinary-plan policy',async()=>{
  await expect(assertMemberCreditQuota(session(),org,'user',0n,false)).resolves.toBe(100000n);
  await expect(assertMemberCreditQuota(session('enterprise',null,'50000','25000'),org,'user',0n,false)).resolves.toBe(25000n);
  await expect(assertMemberCreditQuota(session('enterprise','0'),org,'user',0n,false)).rejects.toMatchObject({code:'credit_required',reason:'member_monthly_limit'});
  await expect(assertMemberCreditQuota(session('enterprise',null,'0','100000'),org,'user',0n,false)).rejects.toMatchObject({code:'credit_required'});
  await expect(assertMemberCreditQuota(session('ordinary'),org,'user',999999n,false)).resolves.toBe(999999n);
 });
 it('reads ledger settlement month in explicit UTC and retains holds across month boundaries',async()=>{
  const s=session();await readMemberCreditUsage(s,org,'user');
  const sql=vi.mocked(s.query).mock.calls.map(([q])=>q).join(' ');
  expect(sql).toContain('credit_transactions');expect(sql).toContain("AT TIME ZONE 'UTC'");
  expect(sql).toContain("state <> 'settled'");expect(sql).toContain('GREATEST');
 });
});

import {creditErrorGuidance} from '../../src/interface/credit-error-guidance';
import {CreditConsumptionError} from '../../src/application/billing/credit-consumption';
import {CreditRequiredBody} from '@repo/contracts/billing-consumption';
it('preserves typed member-limit guidance while keeping ordinary wallet failures unchanged',()=>{
 const member=new CreditConsumptionError('credit_required','team','org','member_monthly_credit_quota_exceeded','member_monthly_limit');
 expect(creditErrorGuidance(member)).toMatchObject({reason:'CREDIT_REQUIRED',credit:{reason:'member_monthly_limit'}});
 const wallet=creditErrorGuidance(new CreditConsumptionError('credit_required','user','user'));
 expect(wallet).toEqual({reason:'CREDIT_REQUIRED',credit:{code:'credit_required',ownerType:'user',ownerId:'user',rechargePath:'/billing?purchase=1'}});
 expect(CreditRequiredBody.safeParse({code:'credit_required',ownerType:'team',ownerId:'org',rechargePath:'/billing',reason:'upstream-custom'}).success).toBe(false);
});

it('does not enforce member defaults in personal-local even if stale Enterprise metadata exists',async()=>{
 await expect(assertMemberCreditQuota(session('enterprise',null,'0','0','personal-local'),org,'user',999999n,false)).resolves.toBe(999999n);
});

it.each([null,'stale-generation'])('does not apply an Enterprise member cap to missing/stale billing generation %s',async billingGeneration=>{
 await expect(assertMemberCreditQuota(session('enterprise','0','0','0','organization',billingGeneration),org,'user',999999n,false)).resolves.toBe(999999n);
});
