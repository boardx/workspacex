import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const repository=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-file-export-repository.ts',import.meta.url),'utf8');
const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-file-export-source.ts',import.meta.url),'utf8');
describe('Board file export repository authorization',()=>{
  it('keeps every job query tenant scoped and rechecks current Board membership',()=>{
    expect(repository).not.toContain('withoutTenant');expect(repository).toContain('b.owner_id=$2 OR m.user_id IS NOT NULL');expect(repository).toContain('j.org_id=$1 AND j.actor_id=$2 AND j.id=$3');
    expect(repository.match(/this\.access\(session,p,/g)?.length).toBeGreaterThanOrEqual(5);
  });
  it('creates jobs only through an authorized owner/member SELECT',()=>{
    expect(repository).toContain('INSERT INTO whiteboard_file_export_jobs');expect(repository).toContain('FROM whiteboards b LEFT JOIN whiteboard_members m');expect(repository).toContain('b.owner_id=$4 OR m.user_id IS NOT NULL');
  });
  it('exports only the public Y.Doc and never queries private workshop draft bodies or counts',()=>{
    expect(source).not.toContain('whiteboard_private_drafts');expect(source).not.toMatch(/SELECT\s+text/i);expect(source).toContain('validator.objects');expect(source).toContain('b.owner_id=$3 OR m.user_id IS NOT NULL');
  });
});
