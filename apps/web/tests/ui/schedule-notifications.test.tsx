import * as React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {TaskNotifications} from '@/components/chat/workbench/task-notifications';
import {apiRequest} from '@/lib/api-client';
vi.mock('@/lib/api-client',()=>({apiRequest:vi.fn()}));
const api=vi.mocked(apiRequest);
const fact={factId:'00000000-0000-4000-8000-000000000001',scheduleId:'00000000-0000-4000-8000-000000000002',code:'authorization_revoked',acceptedAt:'2026-09-09T00:00:00.000Z',readAt:null};
const props={sessionToken:'test-token',onOpenThread:vi.fn(),onRefresh:vi.fn()};
/** 同一面板现在也拉全局通知中心（/notifications）；这些用例只数定时任务那条链路的请求。 */
const scheduleCalls=()=>api.mock.calls.filter(([path])=>String(path).startsWith('/schedule-notifications')).length;
const center={notifications:[],unreadCount:0};
beforeEach(()=>{api.mockReset();localStorage.clear();});
describe('server backed schedule notices on existing task surface',()=>{
 /** #3223 起提醒列表在弹层里，断言前先点开图标，否则"查不到"会是假绿。 */
 const openPopover=()=>fireEvent.click(screen.getByTestId('task-notifications-trigger'));

 it('shows fixed failure facts and only removes them after durable read acknowledgment',async()=>{
  let read=false,fail=true;
  api.mockImplementation(async(path,options)=>{
   if(path==='/notifications')return center;
   if(path.endsWith('/read')){expect(options?.body).toEqual({factId:fact.factId});if(fail)throw new Error('network');read=true;return {read:true};}
   expect(options?.sessionToken).toBe('test-token');return {notifications:read?[]:[fact]};
  });
  const view=render(<TaskNotifications {...props}/>);
  openPopover();
  await screen.findByText('定时任务已停止：访问权限已撤销');
  fireEvent.click(screen.getByRole('button',{name:'标为已读'}));
  await screen.findByText('定时任务提醒暂时无法同步，请稍后重试。');
  expect(screen.getByText('定时任务已停止：访问权限已撤销')).toBeInTheDocument();
  fail=false;fireEvent.click(screen.getByRole('button',{name:'标为已读'}));
  await waitFor(()=>expect(screen.queryByTestId('schedule-notification')).toBeNull());
  view.unmount();render(<TaskNotifications {...props}/>);
  openPopover();
  await waitFor(()=>expect(scheduleCalls()).toBe(4));expect(screen.queryByTestId('schedule-notification')).toBeNull();
  expect(props.onOpenThread).not.toHaveBeenCalled();
 });
 it('hides old account facts immediately and ignores its late HTTP response',async()=>{
  let finish:(value:unknown)=>void=()=>{};
  api.mockImplementation(async(path,options)=>path==='/notifications'?center:options?.sessionToken==='test-token'?await new Promise(resolve=>{finish=resolve;}):{notifications:[]});
  const view=render(<TaskNotifications {...props}/>);
  view.rerender(<TaskNotifications {...props} sessionToken='other-token'/>);
  openPopover();
  finish({notifications:[fact]});
  await waitFor(()=>expect(scheduleCalls()).toBe(2));
  expect(screen.queryByTestId('schedule-notification')).toBeNull();
 });
 it('does not make an anonymous notification request',()=>{
  render(<TaskNotifications {...props} sessionToken={undefined}/>);expect(api).not.toHaveBeenCalled();
 });
});
