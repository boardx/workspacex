import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {expect,it,vi} from 'vitest';
import {seedOrg,addOrgMember,resetOrgs,ensureDatabase,migrateOnce} from '../support/db';
import {addChatThread} from '../support/chat-db';
import {seedAgentRun} from '../support/agent-run-db';
import {toOrgId} from '../../src/domain/org-id';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {HttpSkillSandbox} from '../../src/infrastructure/skill/http-skill-sandbox';
import {maybeRunSkillScript} from '../../src/application/agent-run/run-skill-script';
import {ExecutionCapacity} from '../../../skill-sandbox/src/execution-capacity';
import {createSandboxServer} from '../../../skill-sandbox/src/server';

it('persisted Chat cancellation aborts a queued legacy request before any script starts',async()=>{
  await ensureDatabase();await migrateOnce();
  const org=toOrgId('sandbox-capacity-'+randomUUID()),run='run-'+randomUUID(),thread='thread-'+randomUUID(),actor='actor-'+randomUUID();
  const db=new PgDatabase(appConfig()),repo=new PgAgentRunRepository(db);
  const capacity=new ExecutionCapacity({concurrency:1,maxQueue:2,ownerConcurrency:1,ownerMaxQueue:1,queueWaitMs:3000});
  const server=createSandboxServer({capacity});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const blocker=capacity.run('blocker',()=>gate);
  try{
    await seedOrg({orgId:org,projectId:'project-'+org});await addOrgMember(org,actor,'consultant',null);
    await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:actor});
    await seedAgentRun({orgId:org,id:run,threadId:thread,authorId:actor,status:'running'});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const sandbox=new HttpSkillSandbox({baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`});
    const pending=maybeRunSkillScript({sandbox,objects:{} as never,regenerate:async()=>{throw new Error('must not retry');},
      cancelAtCheckpoint:()=>repo.cancelAtCheckpoint(org,run),log:()=>{}},
      {owner:{orgId:org,userId:actor},runId:run,pinnedSkillCount:1,reply:'```js\nconsole.log("must never execute")\n```'});
    await vi.waitFor(()=>expect(capacity.snapshot().queued).toBe(1));
    expect(await repo.requestCancellation(org,run)).toBe('cancel_requested');
    expect(await pending).toMatchObject({kind:'cancelled'});
    await vi.waitFor(()=>expect(capacity.snapshot().queued).toBe(0));
    release();await blocker;
    expect(capacity.snapshot()).toMatchObject({active:0,queued:0,completed:1,failed:0,cancelled:1});
    expect(await repo.requestCancellation(org,run)).toBe('cancelled');
  }finally{
    release();await blocker;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await db.close();await resetOrgs(org);
  }
});
