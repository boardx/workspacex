import { describe,it,expect } from 'vitest';
import { deriveTestIsolation } from '../../../../.harness/scripts/lib/test-isolation';
import { readFileSync } from 'node:fs';
import { assertProposalDatabaseBinding,requireNotFound,assertProposalStorageDrill,assertRestoredDatabase,requireEvidence,proposalDrillFailure } from '../../scripts/board-proposal-storage-drill-guards';
const env={BOARD_PROPOSAL_STORAGE_DRILL:'1',WORKSPACEX_ISOLATION_ID:'isolated-session',WORKSPACEX_DB:'wsx_0123456789abcdefabcd',PGDATABASE:'wsx_0123456789abcdefabcd',PGHOST:'127.0.0.1',COMPOSE_PROJECT_NAME:'owned-test',STARTER_POSTGRES_CONTAINER:'owned-container',BOARD_PROPOSAL_DRILL_DIRECTORY:'/private/tmp/private-proof'};
describe('real PG proposal storage producer gates (does not execute producer)',()=>{
 it('requires explicit owned local isolation before any fixture mutation',()=>{
  expect(()=>assertProposalStorageDrill(env)).not.toThrow();
  for(const change of [{BOARD_PROPOSAL_STORAGE_DRILL:'0'},{WORKSPACEX_ISOLATION_ID:''},{WORKSPACEX_DB:'workspacex'},{PGDATABASE:'other'},{PGHOST:'remote.example'},{WORKSPACEX_DEPLOY_PROFILE:'production'},{COMPOSE_PROJECT_NAME:''},{BOARD_PROPOSAL_DRILL_DIRECTORY:''}])expect(()=>assertProposalStorageDrill({...env,...change})).toThrow();
 });
 it('accepts only a generated restored DB identity',()=>{
  expect(()=>assertRestoredDatabase('wsx_drill_0123456789abcdefabcd')).not.toThrow();
  for(const name of ['workspacex','wsx_drill_; DROP DATABASE x','wsx_drill_123',null])expect(()=>assertRestoredDatabase(name)).toThrow();
 });
 it('failed evidence stays failure and diagnostics exclude arbitrary error text',()=>{
  expect(()=>requireEvidence(false,'CHECK_FAILED')).toThrow('CHECK_FAILED');
  expect(proposalDrillFailure('verify',{code:'23514',message:'private text'})).toEqual({status:'failed',stage:'verify',code:'23514'});
  expect(JSON.stringify(proposalDrillFailure('verify',new Error('postgres://user:secret@host PRIVATE_BODY')))).not.toMatch(/secret|PRIVATE_BODY|postgres/);
 });
 it('keeps the real-path acceptance assertions wired, not replaced by simulated repositories',()=>{
  const source=readFileSync(new URL('../../scripts/board-proposal-storage-drill.ts',import.meta.url),'utf8');
  for(const checkpoint of ['new PgDatabase','new FsObjectStore','s.proposals.confirmWithUndo','s.proposals.undo','s.operations.execute','s.operations.undo','s.repository.lock','INTENTIONAL_MIGRATION_ROLLBACK','legacyRetryMigrated','proposalReferences(restoredDb','sourceHistoryBlobCount>0','portable.export','portable.import','PORTABLE_AI_AUTHORITY_COPIED'])expect(source).toContain(checkpoint);
  expect(source).not.toMatch(/vi\.mock|mockResolvedValue|new Map\(/);
 });
});

describe('database binding and portable permission negative gates',()=>{
 const root='/private/tmp/isolated-proof',isolated={...env,...deriveTestIsolation({worktreePath:root,isolationId:'proof'})};
 const container={id:'owned-container',project:isolated.COMPOSE_PROJECT_NAME,service:'postgres',running:true,ports:[{HostIp:'127.0.0.1',HostPort:isolated.PGPORT}]};
 const config={host:isolated.PGHOST,port:Number(isolated.PGPORT),database:isolated.PGDATABASE};
 it('binds actual published PG port, compose identity and both connection configurations',()=>{
  expect(()=>assertProposalDatabaseBinding(isolated,root,container,[config,config])).not.toThrow();
  for(const change of [{PGPORT:String(Number(isolated.PGPORT)+1)},{WORKSPACEX_ISOLATION_SEED:'another'},{COMPOSE_PROJECT_NAME:'another'},{WORKSPACEX_DB:'wsx_'+'f'.repeat(20)}])expect(()=>assertProposalDatabaseBinding({...isolated,...change},root,container,[config,config])).toThrow();
  for(const change of [{running:false},{service:'other'},{project:'other'},{ports:[]}])expect(()=>assertProposalDatabaseBinding(isolated,root,{...container,...change},[config,config])).toThrow();
  expect(()=>assertProposalDatabaseBinding(isolated,root,container,[config,{...config,port:1}])).toThrow();
 });
 it('requires database verification before importing fixtures or ensureDatabase',()=>{
  const source=readFileSync(new URL('../../scripts/board-proposal-storage-drill.ts',import.meta.url),'utf8');
  expect(source.indexOf('assertProposalDatabaseBinding(process.env')).toBeLessThan(source.indexOf("await import('../tests/support/db')"));
  expect(source.indexOf('assertProposalDatabaseBinding(process.env')).toBeLessThan(source.indexOf('ensureDatabase();'));
  expect(source).toContain('portable.export(p,boardId)');
  expect(source).not.toContain('portable.export(p,joint.boardId)');
  for(const call of ['s.proposals.read(p,portableBoard,proposalId)','s.proposals.undo(p,portableBoard,proposalId','s.operations.undo(p,portableBoard,genericOperationId'])expect(source).toContain(call);
 });
 it('accepts only actual NOT_FOUND rejection, never success or dependency/revision errors',async()=>{
  await expect(requireNotFound(async()=>{throw{code:'NOT_FOUND'};})).resolves.toBeUndefined();
  await expect(requireNotFound(async()=>({ok:true}))).rejects.toThrow('OLD_AUTHORITY_NOT_REJECTED');
  for(const code of ['STALE_REVISION','DEPENDENCY_UNAVAILABLE','FORBIDDEN'])await expect(requireNotFound(async()=>{throw{code};})).rejects.toEqual({code});
 });
});
