import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const repo=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-export-repository.ts',import.meta.url),'utf8');
const service=readFileSync(new URL('../../src/application/whiteboard/import-service.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../migrations/20260927113000_whiteboard_exports.sql',import.meta.url),'utf8');
describe('whiteboard standard export persistence boundary',()=>{
  it('stores only tenant-scoped metadata in PostgreSQL and never package bytes',()=>{expect(repo).toContain('this.db.withTenant(p.orgId');expect(repo).not.toContain('withoutTenant');expect(repo).not.toMatch(/bytea|contentBase64|package_bytes/i);expect(repo).toContain('object_key');expect(repo).toContain('sha256');expect(repo).toContain('size_bytes');});
  it('authorizes both creation and download before reading export metadata',()=>{for(const method of ['standardExport','downloadStandardExport']){const body=service.match(new RegExp(`async ${method}\\([^]*?(?=\\n  async |\\n})`))?.[0]??'';expect(body,method).toContain('await this.access(principal,boardId)');}expect(service).toContain("if(board.role==='viewer')");expect(service).toContain("if(board.archived)");});
  it('makes export pointers durable GC roots protected by RLS and the purge fence',()=>{expect(migration).toContain('ALTER TABLE whiteboard_exports FORCE ROW LEVEL SECURITY');expect(migration).toContain("UNION SELECT object_key,'export' FROM whiteboard_exports");expect(migration).toContain('CREATE TRIGGER whiteboard_export_root_guard');expect(migration).toContain('GRANT SELECT,INSERT ON whiteboard_exports TO app_rw');expect(migration).not.toContain('chr(0)');});
});
