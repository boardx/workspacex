import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const repo=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-import-repository.ts',import.meta.url),'utf8');
const service=readFileSync(new URL('../../src/application/whiteboard/import-service.ts',import.meta.url),'utf8');
describe('whiteboard import permission boundary',()=>{
  it('keeps the adapter on one metadata table and every executed query tenant/board scoped',()=>{const tables=[...repo.matchAll(/(?:FROM|INTO|UPDATE)\s+([a-z_]+)/gi)].map(match=>match[1]);expect(new Set(tables)).toEqual(new Set(['whiteboard_imports']));expect(repo).toContain('this.db.withTenant(p.orgId');expect(repo).not.toContain('withoutTenant');expect(repo.match(/\$\{select\} WHERE org_id=\$1 AND board_id=\$2/g)?.length).toBeGreaterThanOrEqual(2);expect(repo).not.toMatch(/\$\{select\}(?! WHERE org_id=\$1 AND board_id=\$2)/);});
  it('authorizes through the private board before every public service operation',()=>{for(const method of ['upload','preflight','execute','getStatus','getReport']){const body=service.match(new RegExp(`async ${method}\\([^]*?(?=\\n  async |\\n})`))?.[0]??'';expect(body,method).toContain('await this.access(principal,boardId)');}expect(service).toContain("if(board.role==='viewer')");expect(service).toContain("if(board.archived)");});
});
