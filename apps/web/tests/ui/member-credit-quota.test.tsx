import * as React from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {I18nProvider,useI18n} from '@/lib/i18n/provider';
const api=vi.hoisted(()=>({getMemberCreditQuotas:vi.fn(),setMemberCreditQuota:vi.fn(),setMemberCreditQuotas:vi.fn()}));
vi.mock('@/lib/live-member-credit-quota',()=>api);
import {MemberCreditQuotaPanel} from '@/components/admin/member-credit-quota-panel';
function Switch(){const {setLocale}=useI18n();return <button onClick={()=>setLocale('zh-CN')}>Chinese</button>;}
const snapshot={enterprise:true,defaultMonthlyLimit:5000,month:'2026-11',members:[{userId:'u',displayName:'Alice',email:'alice@example.test',monthlyLimit:5000,overridden:false,usedCredits:12.34,heldCredits:3.21}]};
beforeEach(()=>{api.getMemberCreditQuotas.mockReset().mockResolvedValue(snapshot);api.setMemberCreditQuota.mockReset().mockResolvedValue({monthlyLimit:0});});
afterEach(cleanup);
function show(){return render(<I18nProvider initialLocale="en"><Switch/><MemberCreditQuotaPanel orgId="org"/></I18nProvider>);}
it('shows true fractional credits and default monthly limit, switches language without fetching',async()=>{
 show();expect(await screen.findByTestId('member-credit-usage-u')).toHaveTextContent('12.34 / 5,000 Credits');
 expect(screen.getByText(/Reserved by active requests/)).toHaveTextContent('3.21');
 fireEvent.click(screen.getByText('Chinese'));
 expect(screen.getByTestId('member-credit-usage-u')).toHaveTextContent('本月已用 12.34 / 5,000 Credit');
 expect(api.getMemberCreditQuotas).toHaveBeenCalledTimes(1);
});
it('saves explicit zero and rejects blank, negative and fractional limits',async()=>{
 show();fireEvent.click(await screen.findByTestId('member-credit-adjust-u'));
 for(const invalid of ['', '-1', '1.5']){fireEvent.change(screen.getByTestId('member-credit-limit'),{target:{value:invalid}});fireEvent.click(screen.getByTestId('member-credit-save'));expect(api.setMemberCreditQuota).not.toHaveBeenCalled();}
 fireEvent.change(screen.getByTestId('member-credit-limit'),{target:{value:'0'}});fireEvent.click(screen.getByTestId('member-credit-save'));
 await waitFor(()=>expect(api.setMemberCreditQuota).toHaveBeenCalledWith('org','u',0));
});
it('does not present enterprise spending policy for ordinary organizations',async()=>{
 api.getMemberCreditQuotas.mockResolvedValue({...snapshot,enterprise:false,members:[]});show();
 await waitFor(()=>expect(api.getMemberCreditQuotas).toHaveBeenCalled());
 expect(screen.queryByTestId('admin-member-credit-quotas')).toBeNull();
});

import {CreditConsumptionNotice} from '@/components/billing/credit-consumption-notice';
it('monthly quota guidance preserves the draft and points to the administrator without a recharge action',async()=>{
 render(<><textarea aria-label="draft" defaultValue="Keep my question"/><CreditConsumptionNotice/></>);
 fireEvent(window,new CustomEvent('workspacex:credit-failure',{detail:{code:'credit_required',ownerType:'team',ownerId:'org',rechargePath:'/billing?ownerType=team&ownerId=org&purchase=1',reason:'member_monthly_limit'}}));
 expect(screen.getByRole('alert')).toHaveTextContent('联系组织管理员调整月度额度');
 expect(screen.queryByRole('link')).toBeNull();expect(screen.getByLabelText('draft')).toHaveValue('Keep my question');
});
it('untyped Chat credit errors explain the balance and monthly allowance before a payment action',()=>{
 render(<CreditConsumptionNotice/>);
 fireEvent(window,new CustomEvent('workspacex:credit-failure',{detail:{code:'CREDIT_REQUIRED'}}));
 expect(screen.getByRole('alert')).toHaveTextContent('余额或成员月度额度不足');
 expect(screen.getByRole('link')).toHaveTextContent('查看账户额度');
});
it('ordinary scoped wallet errors retain their original recharge action',()=>{
 render(<CreditConsumptionNotice/>);
 fireEvent(window,new CustomEvent('workspacex:credit-failure',{detail:{code:'credit_required',ownerType:'team',ownerId:'org',rechargePath:'/billing?ownerType=team&ownerId=org&purchase=1'}}));
 expect(screen.getByRole('link',{name:'为组织充值'})).toHaveAttribute('href','/billing?ownerType=team&ownerId=org&purchase=1');
});
it('keeps enterprise budget unlimited and filters actual member usage',async()=>{
 show();await screen.findByTestId('member-credit-usage-u');
 expect(screen.getByText('Unlimited')).toBeTruthy();
 expect(screen.getByText('4,984.45')).toBeTruthy();
 expect(screen.getByRole('progressbar')).toHaveAttribute('value','15.55');
 fireEvent.change(screen.getByLabelText('Search members by name or email'),{target:{value:'missing'}});
 expect(screen.queryByTestId('member-credit-usage-u')).toBeNull();
 fireEvent.change(screen.getByLabelText('Search members by name or email'),{target:{value:'alice@example'}});
 expect(screen.getByTestId('member-credit-usage-u')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Status'),{target:{value:'exhausted'}});
 expect(screen.queryByTestId('member-credit-usage-u')).toBeNull();
});
it('paginates members and resets to matching results after filtering',async()=>{
 api.getMemberCreditQuotas.mockResolvedValue({...snapshot,members:Array.from({length:11},(_,i)=>({...snapshot.members[0],userId:`u${i}`,displayName:`Member ${i}`,email:`member${i}@test.invalid`}))});
 show();await screen.findByTestId('member-credit-usage-u0');
 expect(screen.queryByTestId('member-credit-usage-u10')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Next'}));
 expect(screen.getByTestId('member-credit-usage-u10')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Search members by name or email'),{target:{value:'member0@'}});
 expect(screen.getByTestId('member-credit-usage-u0')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Next'})).toBeNull();
});

it('previews every member despite filtering and supports skipping or overriding conflicts',async()=>{
 const alice={...snapshot.members[0],usedCredits:2000,heldCredits:0};
 const bob={...alice,userId:'b',displayName:'Bob',usedCredits:500,heldCredits:0};
 api.getMemberCreditQuotas.mockResolvedValue({...snapshot,members:[alice,bob]});
 api.setMemberCreditQuotas.mockResolvedValue({updated:2});
 show();await screen.findByTestId('member-credit-usage-u');
 fireEvent.change(screen.getByLabelText('Search members by name or email'),{target:{value:'Alice'}});
 fireEvent.click(screen.getByRole('button',{name:'Adjust limits in bulk'}));
 fireEvent.change(document.getElementById('batch-credit-limit')!,{target:{value:'1000'}});
 fireEvent.click(screen.getByRole('button',{name:'Preview'}));
 expect(screen.getByText(/1 of 2 members will be updated/)).toBeTruthy();
 expect(api.setMemberCreditQuotas).not.toHaveBeenCalled();
 const exception=screen.getByLabelText('New limit for Alice (optional)');
 fireEvent.change(exception,{target:{value:'1999'}});
 expect(screen.getByRole('button',{name:'Save'})).toBeDisabled();
 fireEvent.change(exception,{target:{value:'2000'}});
 fireEvent.click(screen.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(api.setMemberCreditQuotas).toHaveBeenCalledWith('org',[
  {userId:'u',monthlyLimit:2000},{userId:'b',monthlyLimit:1000},
 ]));
});
