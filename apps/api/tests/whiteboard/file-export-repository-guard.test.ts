import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const repository=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-file-export-repository.ts',import.meta.url),'utf8');
const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-file-export-source.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../migrations/20260924000900_whiteboard_file_export_audit.sql',import.meta.url),'utf8');
const sqlTables=(text:string)=>{const code=text.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\n]*/g,' ');return new Set([...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-z_][a-z0-9_]*)/gi)].map(match=>match[1]!.toLowerCase()).filter(name=>!['candidate','changed','of','the'].includes(name)&&!name.startsWith('kernel_')));};
function assertRepositoryBoundary(text:string){expect([...sqlTables(text)].sort()).toEqual(['whiteboard_file_export_jobs','whiteboard_members','whiteboard_transfer_audit','whiteboards']);expect(text).toContain('j.org_id=$1 AND j.actor_id=$2 AND j.id=$3');expect(text).toContain('b.owner_id=$2 OR m.user_id IS NOT NULL');}
describe('Board file export repository authorization',()=>{
  it('keeps every job query tenant scoped and rechecks current Board membership',()=>{
    assertRepositoryBoundary(repository);expect(repository.match(/b\.owner_id=\$2 OR m\.user_id IS NOT NULL/g)?.length).toBeGreaterThanOrEqual(4);
    for(const method of ['create','claimNext','renew','complete','finish','find','cancel','claimCleanup','finishCleanup'])expect(repository).toContain(`async ${method}(`);
    expect(repository.match(/withoutTenant/g)?.length).toBe(3);expect(repository).toContain('kernel_claim_whiteboard_file_export');expect(repository).toContain('kernel_claim_whiteboard_file_export_cleanup');
  });
  it('creates jobs only through an authorized owner/member SELECT',()=>{
    expect(repository).toContain('INSERT INTO whiteboard_file_export_jobs');expect(repository).toContain('FROM whiteboards b LEFT JOIN whiteboard_members m');expect(repository).toContain('b.owner_id=$3 OR m.user_id IS NOT NULL');expect(repository).toContain('FOR UPDATE OF b');
  });
  it('exports only the public Y.Doc and records only the caller own private-draft omission',()=>{
    expect([...sqlTables(source)].sort()).toEqual(['whiteboard_members','whiteboard_private_drafts','whiteboards']);expect(source).not.toMatch(/SELECT\s+(?:[^;]*,)?\s*(?:d\.)?text\b/i);expect(source).toContain('d.user_id=$3');expect(source).toContain('validator.objects');expect(source).toContain('b.owner_id=$3 OR m.user_id IS NOT NULL');
  });
  it('mutation counterproof rejects a widened table or removed membership predicate',()=>{
    expect(()=>assertRepositoryBoundary(repository.replace('whiteboards b','organizations b'))).toThrow();expect(()=>assertRepositoryBoundary(repository.replaceAll('b.owner_id=$2 OR m.user_id IS NOT NULL','TRUE'))).toThrow();
  });
  it('pins global admission, lease recovery, cleanup and retention in durable SQL',()=>{
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('whiteboard-file-export-admission',0))");expect(migration).toContain("active.status='running' AND active.lease_expires_at>clock_timestamp()");expect(migration).toContain("j.status='running' AND j.lease_expires_at<=clock_timestamp()");expect(migration).toContain("artifact_state='cleanup_pending'");expect(repository).toContain('BOARD_FILE_EXPORT_LIMITS.retainedJobs');
  });
});
