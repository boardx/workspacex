import * as React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {CreditConsumptionNotice} from '@/components/billing/credit-consumption-notice';
import {getAgentRun} from '@/lib/agent-run';
import {openAgentRunStream} from '@/lib/agent-run-stream';
const personal={code:'credit_required',ownerType:'user',ownerId:'owned-user',rechargePath:'/billing?purchase=1'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('polling a persisted personal refusal keeps the draft and offers personal recharge without retry',async()=>{
 const fetch=vi.fn(async()=>Response.json({status:'failed',error:'CREDIT_REQUIRED',creditFailure:personal}));vi.stubGlobal('fetch',fetch);
 render(<><textarea aria-label="草稿" defaultValue="保留问题"/><CreditConsumptionNotice/></>);
 await act(async()=>{await getAgentRun('persisted-run','fixture-token');});
 expect(screen.getByRole('link',{name:'前往充值'})).toHaveAttribute('href','/billing?purchase=1');
 expect(screen.getByRole('alert')).toHaveTextContent('个人 Credit');
 expect(screen.getByLabelText('草稿')).toHaveValue('保留问题');expect(fetch).toHaveBeenCalledTimes(1);
});
it('a public terminal SSE refusal preserves the same personal recharge action',async()=>{
 const fetch=vi.fn(async()=>new Response(`data: ${JSON.stringify({type:'final',status:'failed',error:'CREDIT_REQUIRED',creditFailure:personal})}\n\n`,{headers:{'content-type':'text/event-stream'}}));vi.stubGlobal('fetch',fetch);
 render(<CreditConsumptionNotice/>);const received:unknown[]=[];
 await act(async()=>{await openAgentRunStream('run',event=>{received.push(event);},{sessionToken:null});});
 expect(received).toEqual([expect.objectContaining({creditFailure:personal})]);
 expect(screen.getByRole('link',{name:'前往充值'})).toHaveAttribute('href','/billing?purchase=1');expect(fetch).toHaveBeenCalledTimes(1);
});
it('accounting unavailability ignores a stale personal recharge projection',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'failed',error:'CREDIT_ACCOUNTING_UNAVAILABLE',creditFailure:personal})));
 render(<CreditConsumptionNotice/>);await act(async()=>{await getAgentRun('run','fixture-token');});
 expect(screen.getByRole('alert')).toHaveTextContent('计费服务暂时不可用');expect(screen.queryByRole('link')).toBeNull();
});
it('a legacy or other-viewer run without owned payer identity never invents personal recharge',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'failed',error:'CREDIT_REQUIRED'})));
 render(<CreditConsumptionNotice/>);await act(async()=>{await getAgentRun('run','fixture-token');});
 expect(screen.getByRole('link',{name:'查看账户额度'})).toHaveAttribute('href','/billing');expect(screen.queryByRole('link',{name:'前往充值'})).toBeNull();
});
it('monthly quota guidance never turns an existing team stop into a payment instruction',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'failed',error:'CREDIT_REQUIRED',creditFailure:{code:'credit_required',ownerType:'team',ownerId:'org',rechargePath:'/billing?ownerType=team&ownerId=org&purchase=1',reason:'member_monthly_limit'}})));
 render(<CreditConsumptionNotice/>);await act(async()=>{await getAgentRun('run','fixture-token');});
 expect(screen.getByRole('alert')).toHaveTextContent('本月成员');expect(screen.queryByRole('link')).toBeNull();
});
