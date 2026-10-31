import * as React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,within,fireEvent} from "@testing-library/react";
import {BillingOverview} from "@/components/billing/billing-overview";
const period={credits:20000,remainingCredits:15000,periodStart:"2026-10-01T00:00:00Z",periodEnd:"2099-11-01T00:00:00Z"};
function setup(history:unknown={items:[],hasMore:false}){
 vi.stubGlobal("fetch",vi.fn((url:string)=>{
  const path=new URL(url).pathname;
  const data=path.endsWith('/history')?history:path.endsWith('/config')?{enabledProviders:['wechat']}:path.endsWith('/wallet')?{wallet:{ownerType:'user',ownerId:'user-a',balance:15100,availableBalance:15100,permanentBalance:100,subscriptionCredits:15000,totalPurchased:100,totalGranted:20000,updatedAt:'2026-10-31T00:00:00Z'}}:{status:'active',planRef:'monthly_pass_v1',currentPeriodEnd:period.periodEnd,cancelAtPeriodEnd:false,purchaseMode:'manual_monthly',creditGrant:{status:'granted',grant:period}};
  return Promise.resolve(new Response(JSON.stringify(data),{status:200}));
 }));
 return render(<BillingOverview userId="user-a" sessionToken="session-a"/>);
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps permanent credit separate from subscription credit with remaining percentage',async()=>{
 setup();const card=await screen.findByTestId('billing-wallet-balance');expect(card.textContent).toContain('100');expect(card.textContent).not.toContain('15,100');
 expect((await screen.findByRole('progressbar',{name:'本期剩余 credit'})).getAttribute('aria-valuenow')).toBe('75');
 const left=screen.getByTestId('billing-wallet-card');expect(within(left).getByRole('button',{name:'购买 credit'})).toBeTruthy();expect(within(left).getByRole('link',{name:'查看历史使用'}).getAttribute('href')).toBe('/usage');expect(within(left).queryByText('套餐余额')).toBeNull();
});
it('shows real subscription periods and preserves missing historical fees',async()=>{
 setup({items:[{id:'period-a',item:'Pro 月度订阅',periodStart:period.periodStart,periodEnd:period.periodEnd,amountMinor:18000,currency:'CNY'},{id:'period-b',item:'Pro 订阅',periodStart:null,periodEnd:period.periodEnd,amountMinor:null,currency:null}],hasMore:false});
 const table=await screen.findByRole('table',{name:'订阅历史'});expect(within(table).getByText('¥180.00')).toBeTruthy();expect(within(table).getAllByText('未记录').length).toBeGreaterThan(0);expect(within(table).getByText('Pro 订阅')).toBeTruthy();
});
it('does not turn a failed history read into an empty list',async()=>{
 setup();await screen.findByText('暂无订阅记录');vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(new Response('{}',{status:503}))));
 fireEvent.click(screen.getByRole('button',{name:'刷新订阅历史'}));expect(await screen.findByText('暂时无法查询订阅历史')).toBeTruthy();
});
it('paginates subscription history using a fixed page size and offers previous page',async()=>{
 const calls:number[]=[];
 setup();await screen.findByText('暂无订阅记录');
 vi.stubGlobal('fetch',vi.fn((url:string)=>{
  const query=new URL(url).searchParams;expect(query.get('limit')).toBe('5');const offset=Number(query.get('offset'));calls.push(offset);
  return Promise.resolve(new Response(JSON.stringify({items:[{id:`page-${offset}`,item:'Pro 月度订阅',periodStart:period.periodStart,periodEnd:period.periodEnd,amountMinor:null,currency:null}],hasMore:offset===0})));
 }));
 fireEvent.click(screen.getByRole('button',{name:'刷新订阅历史'}));await screen.findByRole('button',{name:'下一页'});fireEvent.click(screen.getByRole('button',{name:'下一页'}));
 await screen.findByRole('table',{name:'订阅历史'});expect(screen.getByRole('button',{name:'下一页'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'上一页'}));
 await screen.findByRole('table',{name:'订阅历史'});expect(calls).toEqual([0,5,0]);
});

it('resets history pagination when the account changes',async()=>{
 const row={id:'a',item:'Pro 月度订阅',periodStart:period.periodStart,periodEnd:period.periodEnd,amountMinor:null,currency:null};
 const view=setup({items:[row],hasMore:true});await screen.findByRole('table',{name:'订阅历史'});
 const original=globalThis.fetch,calls:Array<{token:string;offset:number}>=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit)=>{
  if(!new URL(url).pathname.endsWith('/history'))return original(url,options);
  const offset=Number(new URL(url).searchParams.get('offset')),token=(options.headers as Record<string,string>).Authorization;calls.push({token,offset});
  return Promise.resolve(new Response(JSON.stringify({items:token==='Bearer session-b'&&offset>0?[]:[row],hasMore:false})));
 }));
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await screen.findByRole('table',{name:'订阅历史'});
 view.rerender(<BillingOverview userId="user-b" sessionToken="session-b"/>);
 await screen.findByRole('table',{name:'订阅历史'});expect(calls.at(-1)).toEqual({token:'Bearer session-b',offset:0});
});
