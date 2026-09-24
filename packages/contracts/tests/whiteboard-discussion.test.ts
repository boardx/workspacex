import { describe,expect,it } from 'vitest';
import { CreateThread,Thread,UpdateTask,WHITEBOARD_DISCUSSION_LIMITS } from '../src/whiteboard-discussion';
const uuid='11111111-1111-4111-8111-111111111111';
describe('whiteboard discussion contract',()=>{
 it('bounds durable object anchors, bodies and mention fanout',()=>{
  expect(CreateThread.parse({requestId:uuid,anchor:{kind:'object',objectId:'sticky_1',label:'已删除的便签'},body:'决定',mentionUserIds:['member']})).toMatchObject({anchor:{objectId:'sticky_1'}});
  expect(()=>CreateThread.parse({requestId:uuid,anchor:{kind:'point',x:0,y:0},body:'x',mentionUserIds:Array(WHITEBOARD_DISCUSSION_LIMITS.mentions+1).fill('u')})).toThrow();
 });
 it('requires a non-empty task patch and retains a tombstone without content',()=>{
  expect(()=>UpdateTask.parse({})).toThrow();
  expect(Thread.parse({id:uuid,boardId:uuid,anchor:{kind:'object',objectId:'gone',label:'原始便签'},resolvedAt:null,createdAt:'2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z',comments:[{id:uuid,authorId:'u',body:'',mentionUserIds:[],createdAt:'2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z',editedAt:null,deletedAt:'2026-09-24T01:00:00.000Z'}],task:null}).anchor).toMatchObject({objectId:'gone',label:'原始便签'});
 });
});
