import * as React from 'react';
import {afterEach,it,expect} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {MessageAttachments} from '@/components/chat/chat-composer-attachments';
import {CreditConsumptionNotice} from '@/components/billing/credit-consumption-notice';
afterEach(cleanup);
const attachment={id:'attachment',filename:'notes.txt',mime:'text/plain',bytes:20,createdAt:'2026-10-23T00:00:00Z',extractionStatus:'failed' as const,extractionError:'credit_required' as const};
it('a persisted attachment credit failure remains visible with the uploaded file and ownerless admin guidance',()=>{
 render(<><MessageAttachments threadId="thread" attachments={[attachment]}/><CreditConsumptionNotice/></>);
 expect(screen.getByRole('button',{name:/notes.txt/})).toBeTruthy();expect(screen.getByText(/额度不足，附件尚未完成内容解析/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'查看处理指引'}));
 expect(screen.getByRole('alert').textContent).toContain('计费账户');expect(screen.queryByRole('link',{name:'前往充值'})).toBeNull();
});
it('accounting outage gives no misleading personal recharge action',()=>{
 render(<MessageAttachments threadId="thread" attachments={[{...attachment,extractionError:'credit_accounting_unavailable'}]}/>);
 expect(screen.getByText(/计费服务暂时不可用，附件内容尚未解析/)).toBeTruthy();expect(screen.queryByRole('link',{name:'前往充值'})).toBeNull();
});
