import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardDiscussion } from '../../src/infrastructure/whiteboard/pg-whiteboard-discussion';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

const orgId=toOrgId('wb-discussion-3977-a'),otherOrg=toOrgId('wb-discussion-3977-b');
const actor=(userId:string,org=orgId):Principal=>({userId,orgId:org});
const owner=actor('wb-discussion-owner'),editor=actor('wb-discussion-editor'),viewer=actor('wb-discussion-viewer'),outsider=actor(owner.userId,otherOrg);
let db:PgDatabase,boards:PgWhiteboardRepository,discussion:PgWhiteboardDiscussion;

beforeAll(async()=>{
  ensureDatabase();await migrateOnce();await resetOrgs(orgId,otherOrg);
  await seedOrg({orgId,projectId:'wb-discussion-project-a'});await seedOrg({orgId:otherOrg,projectId:'wb-discussion-project-b'});
  for(const principal of [owner,editor,viewer,outsider])await addOrgMember(principal.orgId,principal.userId,'consultant',null);
  db=new PgDatabase(appConfig());boards=new PgWhiteboardRepository(db);discussion=new PgWhiteboardDiscussion(db);
});
afterAll(async()=>{await db?.close();await resetOrgs(orgId,otherOrg);});

describe('whiteboard discussions on real PostgreSQL',()=>{
  it('persists mentions, replies and tasks while enforcing payload-bound idempotency',async()=>{
    const board=await boards.create(owner,{requestId:randomUUID(),name:'讨论白板'});
    await boards.putMember(owner,board.id,{userId:editor.userId,role:'editor'});await boards.putMember(owner,board.id,{userId:viewer.userId,role:'viewer'});
    const requestId=randomUUID(),input={requestId,anchor:{kind:'point' as const,x:10,y:20},body:'请 owner 看一下',mentionUserIds:[owner.userId]};
    const thread=await discussion.create(editor,board.id,input);expect(thread).toMatchObject({boardId:board.id,comments:[{body:input.body,mentionUserIds:[owner.userId]}]});
    expect(await discussion.create(editor,board.id,input)).toEqual(thread);
    await expect(discussion.create(editor,board.id,{...input,body:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    const notifications=await db.withTenant(orgId,s=>s.query<{n:string}>(`SELECT count(*)::text n FROM user_notifications WHERE org_id=$1 AND user_id=$2 AND source_key LIKE 'whiteboard-comment:%'`,[orgId,owner.userId]));
    expect(notifications.rows[0]?.n).toBe('1');

    const replyRequest=randomUUID(),reply={requestId:replyRequest,body:'收到',mentionUserIds:[] as string[]};
    const replied=await discussion.reply(editor,board.id,thread!.id,reply);expect(replied?.comments).toHaveLength(2);
    expect((await discussion.reply(editor,board.id,thread!.id,reply))?.comments).toHaveLength(2);
    await expect(discussion.reply(editor,board.id,thread!.id,{...reply,body:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});

    const taskRequest=randomUUID(),taskInput={requestId:taskRequest,assigneeId:owner.userId,dueAt:null};
    const tasked=await discussion.createTask(editor,board.id,thread!.id,taskInput);expect(tasked?.task).toMatchObject({assigneeId:owner.userId,status:'open',sourceCommentId:thread!.comments[0]!.id});
    expect((await discussion.createTask(editor,board.id,thread!.id,taskInput))?.task?.id).toBe(tasked?.task?.id);
    await expect(discussion.createTask(editor,board.id,thread!.id,{...taskInput,assigneeId:editor.userId})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(await discussion.create(viewer,board.id,{...input,requestId:randomUUID()})).toBeNull();
    expect((await discussion.list(viewer,board.id))?.items[0]?.id).toBe(thread?.id);
  });

  it('fails closed after revocation, across tenants and for archived writes',async()=>{
    const board=await boards.create(owner,{requestId:randomUUID(),name:'权限白板'});await boards.putMember(owner,board.id,{userId:editor.userId,role:'editor'});
    const thread=await discussion.create(editor,board.id,{requestId:randomUUID(),anchor:{kind:'point',x:0,y:0},body:'before revoke',mentionUserIds:[]});expect(thread).toBeTruthy();
    await boards.removeMember(owner,board.id,editor.userId);expect(await discussion.list(editor,board.id)).toBeNull();expect(await discussion.list(outsider,board.id)).toBeNull();
    await boards.update(owner,board.id,{archived:true});expect((await discussion.list(owner,board.id))?.items).toHaveLength(1);
    expect(await discussion.reply(owner,board.id,thread!.id,{requestId:randomUUID(),body:'archived',mentionUserIds:[]})).toBeNull();
  });
});
