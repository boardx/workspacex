import * as React from 'react';
import {afterEach,it,expect} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {CreditConsumptionNotice} from '@/components/billing/credit-consumption-notice';
afterEach(cleanup);
const scope='["org-a","thread-a"]';
const context={scope,attempt:'attempt-1',runId:'failed-1'};
const failure=(ctx=context)=>fireEvent(window,new CustomEvent('workspacex:credit-failure',{detail:{code:'credit_required',noticeContext:ctx}}));
const lifecycle=(detail:object)=>fireEvent(window,new CustomEvent('workspacex:chat-credit-attempt',{detail}));
it('retires only the replaced attempt and rejects its delayed failures',()=>{
 render(<CreditConsumptionNotice/>);
 lifecycle({type:'activate',scope,attempt:'attempt-1'});failure();expect(screen.getByRole('alert')).toBeVisible();
 lifecycle({type:'begin',scope,attempt:'attempt-2'});expect(screen.queryByRole('alert')).toBeNull();
 failure();expect(screen.queryByRole('alert')).toBeNull();
 failure({...context,attempt:'attempt-2',runId:'new-2'});expect(screen.getByRole('alert')).toBeVisible();
 lifecycle({type:'settled',scope,attempt:'attempt-1',runId:'failed-1'});expect(screen.getByRole('alert')).toBeVisible();
 lifecycle({type:'settled',scope,attempt:'attempt-2',runId:'new-2'});expect(screen.queryByRole('alert')).toBeNull();
 failure({...context,attempt:'attempt-2',runId:'new-2'});expect(screen.queryByRole('alert')).toBeNull();
});
it('isolates route scope changes while preserving unrelated legacy module notices',()=>{
 render(<CreditConsumptionNotice/>);lifecycle({type:'activate',scope,attempt:'attempt-1'});failure();
 lifecycle({type:'activate',scope:'["org-b","thread-a"]',attempt:'attempt-b'});expect(screen.queryByRole('alert')).toBeNull();
 failure();expect(screen.queryByRole('alert')).toBeNull();
 fireEvent(window,new CustomEvent('workspacex:credit-failure',{detail:{code:'credit_accounting_unavailable'}}));expect(screen.getByRole('alert')).toBeVisible();
 lifecycle({type:'settled',scope:'["org-b","thread-a"]',attempt:'attempt-b',runId:'other'});expect(screen.getByRole('alert')).toBeVisible();
});
it('chat observation suppresses both HTTP and durable-view notifications while default non-chat reads remain compatible',async()=>{
 const {vi}=await import('vitest');const {getAgentRun}=await import('@/lib/agent-run');
 try{
  render(<CreditConsumptionNotice/>);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({code:'credit_required'}),{status:402})).mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({runId:'old',threadId:'thread',status:'failed',error:'CREDIT_REQUIRED'}),{status:200}))));
  await expect(getAgentRun('old','bearer',undefined,{notifyCredit:false})).rejects.toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
  await getAgentRun('old','bearer',undefined,{notifyCredit:false});expect(screen.queryByRole('alert')).toBeNull();
  await getAgentRun('old','bearer');expect(await screen.findByRole('alert')).toBeVisible();
 }finally{vi.unstubAllGlobals();}
});
