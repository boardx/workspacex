import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { whiteboardRoomSecret } from '../../src/infrastructure/whiteboard/room-secret';
import { PgWhiteboardRoomRepository } from '../../src/infrastructure/whiteboard/pg-room-repository';
import type { DatabasePort,TenantSession } from '../../src/application/ports/database.port';
import type { Principal } from '../../src/domain/principal';

const migration=readFileSync(new URL('../../migrations/20260924000300_whiteboard_room_display.sql',import.meta.url),'utf8');
const repoSource=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-room-repository.ts',import.meta.url),'utf8');
const controller=readFileSync(new URL('../../src/interface/controllers/whiteboard-room.controller.ts',import.meta.url),'utf8');
describe('whiteboard meeting-room security boundary',()=>{
  it('stores only hashes, forces tenant RLS, and keeps migrations replayable',()=>{
    expect(migration).not.toMatch(/\b(code|token)\s+text\b/);
    expect(migration).toContain('code_hash text NOT NULL');expect(migration).toContain('token_hash text NOT NULL UNIQUE');
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(5);
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(5);
    expect(migration.match(/DROP POLICY IF EXISTS/g)).toHaveLength(5);
  });
  it('has only two public read-only room-device routes and hides lookup failures',()=>{
    expect(controller.match(/@Public\(\)/g)).toHaveLength(2);
    expect(controller).toMatch(/@Public\(\) @Post\('\/whiteboard-room\/join'\)/);
    expect(controller).toMatch(/@Public\(\) @Post\('\/whiteboard-room\/:sessionId\/state'\)/);
    expect(controller).not.toMatch(/@Public\(\)[^\n]*@(Put|Delete)/);
    expect(controller).toContain("NotFoundException('room_pairing_unavailable')");
  });
  it('binds every query to tenant context and revalidates presenter, expiry, revocation and archive state',()=>{
    expect(repoSource).not.toContain('withoutTenant(');
    expect(repoSource).toContain('timingSafeEqual');
    expect(repoSource).toContain('consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()');
    expect(repoSource).toContain("rs.revoked_at IS NULL AND rs.expires_at>now() AND b.archived=false");
    expect(repoSource).toContain("b.owner_id=rs.presenter_id OR m.role='editor'");
    expect(repoSource).toContain("return {error:'rate_limited'}");
  });
  it('requires a dedicated production secret',()=>{
    expect(()=>whiteboardRoomSecret({NODE_ENV:'production'})).toThrow('WHITEBOARD_ROOM_SECRET');
    expect(whiteboardRoomSecret({NODE_ENV:'production',WHITEBOARD_ROOM_SECRET:'x'.repeat(32)})).toHaveLength(32);
  });
  it('defers production secret validation until a room operation uses it',async()=>{
    const session:TenantSession={query:async()=>({rows:[]})};
    const db={withTenant:<T>(_org:string,fn:(s:TenantSession)=>Promise<T>)=>fn(session),withoutTenant:<T>(fn:(s:TenantSession)=>Promise<T>)=>fn(session),close:async()=>undefined} satisfies DatabasePort;
    const rooms=new PgWhiteboardRoomRepository(db,()=>whiteboardRoomSecret({NODE_ENV:'production'}));
    expect(()=>rooms).not.toThrow();
    await expect(rooms.join({orgId:'org-1',pairingId:'11111111-1111-4111-8111-111111111111',code:'BAD-CODE'},'source')).rejects.toThrow('WHITEBOARD_ROOM_SECRET');
  });
  it('derives an idempotent code while sending only its hash to persistence',async()=>{
    const pairingId='11111111-1111-4111-8111-111111111111',boardId='22222222-2222-4222-8222-222222222222';
    const writes:readonly unknown[][]=[];
    const session:TenantSession={query:async<R>(sql:string,params:readonly unknown[]=[])=>{
      if(sql.includes('SELECT b.owner_id'))return {rows:[{owner_id:'user-1',archived:false,role:'owner'} as R]};
      if(sql.includes('INSERT INTO whiteboard_room_pairings')){(writes as unknown[][]).push(params as unknown[]);return {rows:[]};}
      if(sql.includes('SELECT id,board_id,expires_at'))return {rows:[{id:pairingId,board_id:boardId,expires_at:new Date('2030-01-01T00:00:00.000Z')} as R]};
      return {rows:[]};
    }};
    const db={withTenant:<T>(_org:string,fn:(s:TenantSession)=>Promise<T>)=>fn(session),withoutTenant:<T>(fn:(s:TenantSession)=>Promise<T>)=>fn(session),close:async()=>undefined} satisfies DatabasePort;
    const rooms=new PgWhiteboardRoomRepository(db,'s'.repeat(32));
    const principal={orgId:'org-1',userId:'user-1'} as Principal;
    const one=await rooms.createPairing(principal,boardId,{requestId:'33333333-3333-4333-8333-333333333333'});
    const two=await rooms.createPairing(principal,boardId,{requestId:'33333333-3333-4333-8333-333333333333'});
    expect(one.code).toBe(two.code);expect(one.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(writes[0]).not.toContain(one.code);expect(String(writes[0]?.[5])).toMatch(/^[a-f0-9]{64}$/);
  });
  it('commits failed-code counters before returning a generic failure',async()=>{
    let committed=false,attemptWritten=false;
    const session:TenantSession={query:async<R>(sql:string)=>{
      if(sql.includes('FROM whiteboard_room_pairings'))return {rows:[{id:'11111111-1111-4111-8111-111111111111',board_id:'22222222-2222-4222-8222-222222222222',created_by:'u',code_hash:'0'.repeat(64),expires_at:new Date('2030-01-01')} as R]};
      if(sql.includes('INSERT INTO whiteboard_room_pairing_attempts')){attemptWritten=true;return {rows:[]};}
      if(sql.includes('COALESCE(max(attempts)'))return {rows:[{source_attempts:1,total_attempts:1} as R]};
      return {rows:[]};
    }};
    const db={withTenant:async<T>(_org:string,fn:(s:TenantSession)=>Promise<T>)=>{const value=await fn(session);committed=true;return value;},withoutTenant:<T>(fn:(s:TenantSession)=>Promise<T>)=>fn(session),close:async()=>undefined} satisfies DatabasePort;
    const rooms=new PgWhiteboardRoomRepository(db,'s'.repeat(32));
    await expect(rooms.join({orgId:'org-1',pairingId:'11111111-1111-4111-8111-111111111111',code:'BAD-CODE'},'source')).rejects.toThrow('not_found');
    expect(attemptWritten).toBe(true);expect(committed).toBe(true);
  });
});
