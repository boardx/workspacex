import * as React from 'react';
import {it,expect,afterEach} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import {useChatAttemptErrors} from '@/lib/chat-workbench/use-chat-attempt-errors';
import {CreditConsumptionNotice} from '@/components/billing/credit-consumption-notice';
afterEach(cleanup);
let current:ReturnType<typeof useChatAttemptErrors>;
function Host({scope}:{scope:string}){const[error,setError]=React.useState<string|null>(null);current=useChatAttemptErrors(scope,()=>setError(null));return <><button onClick={()=>{current.fail(current.identity,{code:'CREDIT_REQUIRED'},'run-1');setError('old failure');}}>fail</button>{error&&<p data-testid="host-error">{error}</p>}<CreditConsumptionNotice/></>}
it('StrictMode replay and fast failures preserve current errors, retire old attempts and require matching run success',async()=>{
 render(<React.StrictMode><Host scope="org-a/thread-a"/></React.StrictMode>);
 await act(async()=>{await Promise.resolve();});fireEvent.click(screen.getByText('fail'));expect(screen.getByRole('alert')).toBeVisible();
 const old=current!.identity;let next:typeof old;
 act(()=>{next=current!.begin(true);});expect(screen.queryByTestId('host-error')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
 act(()=>{expect(current!.settle(next,'old-unbound')).toBe(false);expect(current!.fail(old,{code:'CREDIT_REQUIRED'},'run-1')).toBe(false);current!.bind(next,'run-2');current!.fail(next,{code:'CREDIT_REQUIRED'},'run-2');});
 expect(screen.getByRole('alert')).toBeVisible();
 act(()=>{expect(current!.settle(next,'run-1')).toBe(false);expect(current!.settle(next,'run-2')).toBe(true);});expect(screen.queryByRole('alert')).toBeNull();
 await act(async()=>{await Promise.resolve();});act(()=>{expect(current!.fail(next,{code:'CREDIT_REQUIRED'},'run-2')).toBe(false);});expect(screen.queryByRole('alert')).toBeNull();
});
it('scope changes clear host error before paint and fence captured dispatch callbacks',async()=>{
 const view=render(<Host scope="org-a/thread-a"/>);fireEvent.click(screen.getByText('fail'));const token=current!.identity;
 view.rerender(<Host scope="org-b/thread-a"/>);expect(screen.queryByTestId('host-error')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
 act(()=>{expect(current!.bind(token,'late-run')).toBe(false);expect(current!.fail(token,{code:'CREDIT_REQUIRED'},'late-run')).toBe(false);});
 await act(async()=>{await Promise.resolve();});expect(screen.queryByRole('alert')).toBeNull();
});
