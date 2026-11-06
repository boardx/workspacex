import {describe,it,expect,vi} from 'vitest';
import {OrgAdminManagementController} from '../../src/interface/controllers/org-admin-management.controller';
import type {Principal} from '../../src/domain/principal';
import {SetMemberCreditQuota} from '@repo/contracts/member-credit-quota';
function controller(){
 const c=Object.create(OrgAdminManagementController.prototype) as OrgAdminManagementController;
 const readCreditQuotas=vi.fn().mockResolvedValue({enterprise:true});
 const setCreditQuota=vi.fn().mockResolvedValue({monthlyLimit:0});
 const requireOrgAdmin=vi.fn().mockResolvedValue({orgId:'org'});
 Object.assign(c,{quotas:{creditQuotas:{readCreditQuotas,setCreditQuota}},requireOrgAdmin});
 return {c,requireOrgAdmin,readCreditQuotas,setCreditQuota};
}
const principal={userId:'admin'} as Principal;
describe('Credit quota administrator routes',()=>{
 it('requires the canonical admin guard before reads and writes',async()=>{
  const f=controller();f.requireOrgAdmin.mockRejectedValue(new Error('FORBIDDEN'));
  await expect(f.c.creditQuotas('other-org',principal)).rejects.toThrow('FORBIDDEN');
  await expect(f.c.setCreditQuota('other-org','victim',{monthlyLimit:0},principal)).rejects.toThrow('FORBIDDEN');
  expect(f.readCreditQuotas).not.toHaveBeenCalled();expect(f.setCreditQuota).not.toHaveBeenCalled();
 });
 it('uses the guarded tenant and authenticated actor, preserving zero',async()=>{
  const f=controller();await f.c.setCreditQuota('org','member',{monthlyLimit:0},principal);
  expect(f.setCreditQuota).toHaveBeenCalledWith('org','member',0,'admin');
 });
 it('contract accepts default/custom/zero and rejects negative, decimal, overflow and injected actor',()=>{
  for(const n of [0,1000,2500])expect(SetMemberCreditQuota.safeParse({monthlyLimit:n}).success).toBe(true);
  for(const n of [-1,1.1,2147483648])expect(SetMemberCreditQuota.safeParse({monthlyLimit:n}).success).toBe(false);
  expect(SetMemberCreditQuota.safeParse({monthlyLimit:0,updatedBy:'someone'}).success).toBe(false);
 });
});
