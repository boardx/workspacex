import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgWhiteboardRepository} from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import {PgWhiteboardPresentationRepository} from '../../src/infrastructure/whiteboard/pg-presentation-repository';
import {addOrgMember,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from '../support/db';
import {toOrgId} from '../../src/domain/org-id';
import type {WhiteboardPresentationState} from '@repo/contracts/whiteboard-operation';

const orgId=toOrgId('wb-presentation-concurrency');
const principal={orgId,userId:'presentation-owner'};
let db:PgDatabase,boardId:string;

beforeAll(async()=>{
  ensureDatabase();await migrateOnce();await resetOrgs(orgId);
  await seedOrg({orgId,projectId:'wb-presentation-project'});
  await addOrgMember(orgId,principal.userId,'consultant',null);
  db=new PgDatabase(appConfig());
  boardId=(await new PgWhiteboardRepository(db).create(principal,{requestId:randomUUID(),name:'Concurrent presentation'})).id;
},180_000);
afterAll(async()=>{await db?.close();await resetOrgs(orgId);});

describe('PostgreSQL presentation first-writer concurrency',()=>{
  it('persists exactly one initial state and rejects the loser instead of returning the winner as success',async()=>{
    const repo=new PgWhiteboardPresentationRepository();
    const state=(x:number):WhiteboardPresentationState=>({boardId,roomId:'room',revision:1,presenterId:principal.userId,viewport:{x,y:0,zoom:1},followers:[],updatedAt:'2026-09-27T00:00:00.000Z'});
    const attempts=await Promise.allSettled([1,2].map(x=>db.withTenant(orgId,session=>repo.save(session,principal,state(x)))));
    expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const rejected=attempts.find(result=>result.status==='rejected');
    expect(rejected).toMatchObject({status:'rejected',reason:expect.objectContaining({message:'BOARD_PRESENTATION_CONFLICT'})});
    const persisted=await db.withTenant(orgId,session=>repo.load(session,principal,boardId,'room',false));
    expect(persisted?.revision).toBe(1);
    expect([1,2]).toContain(persisted?.viewport.x);
  });
});
