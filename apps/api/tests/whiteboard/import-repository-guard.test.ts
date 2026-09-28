import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const repo=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-import-repository.ts',import.meta.url),'utf8');
const service=readFileSync(new URL('../../src/application/whiteboard/import-service.ts',import.meta.url),'utf8');
describe('whiteboard import permission boundary',()=>{
  it('keeps import metadata and durable asset roots tenant scoped',()=>{const tables=[...repo.matchAll(/(?:FROM|INTO|UPDATE\s+(?!SET\b))\s*([a-z_]+)/gi)].map(match=>match[1]);expect(new Set(tables)).toEqual(new Set(['whiteboard_imports','whiteboard_asset_refs']));expect(repo).toContain('this.db.withTenant(p.orgId');expect(repo).not.toContain('withoutTenant');expect(repo.match(/\$\{select\} WHERE org_id=\$1 AND board_id=\$2/g)?.length).toBeGreaterThanOrEqual(2);expect(repo).not.toMatch(/\$\{select\}(?! WHERE org_id=\$1 AND board_id=\$2)/);expect(repo).toContain('whiteboard_asset_refs(org_id,board_id');});
  it('activates verified object keys without relying on a stealable single-import lease owner',()=>{expect(repo).toContain('WHERE org_id=$1 AND board_id=$2 AND object_key=ANY($3::text[])');expect(repo).not.toContain("SET state='active',activated_at=now(),lease_expires_at=NULL,released_at=NULL WHERE org_id=$1 AND board_id=$2 AND import_id=");});
  it('authorizes through the private board before every public service operation',()=>{for(const method of ['upload','preflight','execute','getStatus','getReport']){const body=service.match(new RegExp(`async ${method}\\([^]*?(?=\\n  async |\\n})`))?.[0]??'';expect(body,method).toContain('await this.access(principal,boardId)');}expect(service).toContain("if(!['owner','editor'].includes(board.role))");expect(service).toContain("if(board.archived)");});
});
