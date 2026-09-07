import {describe,it,expect} from 'vitest';
import {ScheduleNotification,ScheduleNotificationReadInput,ScheduleNotificationReadOutput,ScheduleNotificationListOutput} from '../src/schedule-notifications';
const id='00000000-0000-4000-8000-000000000001';
const fact={factId:id,scheduleId:id,code:'authorization_revoked',acceptedAt:'2026-09-09T00:00:00.000Z',readAt:null};
describe('schedule notifications',()=>{
 it('carries only stable failure facts, not inaccessible task content',()=>{
  expect(ScheduleNotification.parse(fact)).toEqual(fact);
  expect(ScheduleNotificationReadOutput.parse({read:true})).toEqual({read:true});
  for(const field of ['instruction','title','threadId','userId','orgId'])expect(ScheduleNotification.safeParse({...fact,[field]:'secret'}).success).toBe(false);
 });
 it('does not accept model-selected recipient authority or an unbounded page',()=>{
  expect(ScheduleNotificationReadInput.safeParse({factId:id,userId:'another-user'}).success).toBe(false);
  expect(ScheduleNotificationListOutput.safeParse({notifications:Array(51).fill(fact)}).success).toBe(false);
 });
});
