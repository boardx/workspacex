import { describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgWorkshopRepository } from '../../src/infrastructure/whiteboard/pg-workshop-repository';
import type { DatabasePort,TenantSession } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';

// Narrow negative-boundary tests: a missing snapshot/target must never reach INSERT.
// Real worker decoding and PostgreSQL transactions are covered in their own suites.
describe('workshop object-reference fail-closed boundary',()=>{
  it.each([false,true])('rejects invalid targets without side effects (snapshot present: %s)',async(snapshotPresent)=>{
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes('SELECT owner_id'))return{rows:[{owner_id:'owner',archived:false}]};
      if(sql.includes('FROM org_memberships'))return{rows:[{role:'owner'}]};
      if(sql.includes('FROM whiteboard_comments'))return{rows:[]};
      if(sql.includes('SELECT snapshot'))return{rows:snapshotPresent?[{snapshot:Buffer.from([0,0])}]:[]};
      throw new Error(`Unexpected SQL after rejected reference: ${sql}`);
    });
    const session={query} as unknown as TenantSession;
    const db={withTenant:async(_org:unknown,run:(s:TenantSession)=>Promise<unknown>)=>run(session)} as DatabasePort;
    const validator=new WorkerWhiteboardUpdateValidator();
    const inspect=vi.spyOn(validator,'objectIds').mockResolvedValue(['live_note']);
    const repo=new PgWorkshopRepository(db,validator);
    await expect(repo.addComment({orgId:toOrgId('org'),userId:'owner'},randomUUID(),{requestId:randomUUID(),objectId:'missing',text:'x'})).rejects.toThrow('OBJECT_NOT_FOUND');
    expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
    expect(inspect).toHaveBeenCalledTimes(snapshotPresent?1:0);
    inspect.mockRestore();
  });
});
