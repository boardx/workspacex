/** #4242: load-bearing proof for the board content-copy permission-lint exception. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error production lint helpers are intentionally plain ESM.
import { verifyWhiteboardPermissionBoundaries } from '../../scripts/whiteboard-permission-boundaries.mjs';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-board-content-copy-store.ts',import.meta.url),'utf8');
const tagSource = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-tag-repository.ts',import.meta.url),'utf8');
const boundarySource = readFileSync(new URL('../../scripts/whiteboard-permission-boundaries.mjs',import.meta.url),'utf8');
const kernelSource = readFileSync(new URL('../../src/kernel.module.ts',import.meta.url),'utf8');
const targetPath = 'src/infrastructure/whiteboard/pg-board-content-copy-store.ts';
const tenantTables = new Set(['org_memberships','whiteboards','whiteboard_members','whiteboard_documents','whiteboard_duplicate_requests','whiteboard_tag_bindings','whiteboard_tags']);
const sqlTables = (code: string) => [...code
  .replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/\/\/.*$/gm,'')
  .matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)/gi)]
  .map(match => match[1]!.toLowerCase());

function audit(code: string): string[] {
  const errors: string[] = [], allowed = new Set([
    'whiteboards','whiteboard_members','whiteboard_documents','whiteboard_duplicate_requests','whiteboard_tag_bindings','whiteboard_tags','unnest',
  ]);
  for (const table of sqlTables(code)) if (!allowed.has(table)) errors.push(`unexpected table ${table}`);
  if (code.includes('withoutTenant')) errors.push('withoutTenant');
  if (!/return this\.db\.withTenant\(p\.orgId, async session =>/.test(code)) errors.push('tenant transaction');
  if (!/b\.org_id=\$1 AND b\.id=\$3 AND \(b\.owner_id=\$2 OR m\.user_id IS NOT NULL\) FOR SHARE OF b/.test(code)) errors.push('source actor lock');
  if (!/m\.org_id=b\.org_id AND m\.board_id=b\.id AND m\.user_id=\$2/.test(code)) errors.push('membership scope');
  if (!/INSERT INTO whiteboard_documents\(org_id,board_id\).*ON CONFLICT\(org_id,board_id\) DO NOTHING/s.test(code)) errors.push('source document tenant init');
  if (!/SELECT epoch,seq,snapshot FROM whiteboard_documents[\s\S]*WHERE org_id=\$1 AND board_id=\$2 FOR SHARE/.test(code)) errors.push('versioned source capture');
  if (!/ON CONFLICT\(org_id,actor_id,request_id\) DO NOTHING RETURNING job_id/.test(code)) errors.push('concurrent idempotency claim');
  if (!/job\.request_hash !== hash \|\| job\.source_board_id !== sourceBoardId/.test(code)) errors.push('replay payload binding');
  if (!/job\.status !== 'completed' \|\| !job\.target_board_id/.test(code)) errors.push('completed-only replay');
  if (!/input\.expectedSource[\s\S]*captured\.source\.epoch[\s\S]*captured\.source\.seq/.test(code)) errors.push('source compare-and-swap');
  if (!/FROM whiteboard_tag_bindings bt[\s\S]*JOIN whiteboard_tags t[\s\S]*t\.deleted_at IS NULL[\s\S]*FOR SHARE OF t/.test(code)) errors.push('tag-copy deletion lock');
  const ordered = ['await this.assertVisible(session,p,sourceBoardId)','await this.lockSourceTags(session,p,sourceBoardId)','await this.capture(session,p,sourceBoardId)','await this.assertTagsUnchanged(session,p,sourceBoardId,sourceTagIds)']
    .map(step => code.indexOf(step));
  if (ordered.some(index => index < 0) || ordered.some((index,position) => position > 0 && ordered[position - 1]! >= index)) errors.push('tag-before-board lock order');
  if (code.indexOf('const captured = await this.capture') > code.indexOf('const targetBoardId = randomUUID()')) errors.push('capture before target');
  if (code.indexOf('prepared = prepare(captured)') > code.indexOf('INSERT INTO whiteboards')) errors.push('canonical prepare before target');
  if (!/INSERT INTO whiteboards\(id,org_id,owner_id,request_id,name,tags_revision\)[\s\S]*\[targetBoardId,p\.orgId,p\.userId,input\.targetName\]/.test(code)) errors.push('target ownership');
  if (!/INSERT INTO whiteboard_documents\(org_id,board_id,epoch,seq,snapshot\) VALUES\(\$1,\$2,1,0,\$3\)[\s\S]*Buffer\.from\(prepared\.snapshot\)/.test(code)) errors.push('independent target baseline');
  if (/INSERT INTO whiteboard_updates/i.test(code)) errors.push('source update-log copy');
  if (!/WHERE b\.org_id=\$1 AND b\.id=\$3 AND b\.owner_id=\$2/.test(code)) errors.push('target receipt actor scope');
  return errors;
}
function productionAudit(code: string): string[] {
  return verifyWhiteboardPermissionBoundaries((path: string) => path === targetPath ? code : tagSource,tenantTables)
    .filter((failure: string) => failure.startsWith(`${targetPath}:`));
}

describe('board content-copy permission boundary', () => {
  it('pins tenant tables, actor authorization, source CAS, idempotency and independent publication', () => {
    expect(audit(source)).toEqual([]);
    expect(productionAudit(source)).toEqual([]);
    expect(boundarySource).toContain(targetPath);
    expect(boundarySource).toContain('tests/whiteboard/board-content-copy-guard.test.ts');
    expect(kernelSource).toMatch(/provide: BOARD_CONTENT_COPY_PORT,[\s\S]*new PgBoardContentCopyStore\(db\)[\s\S]*provide: DUPLICATE_BOARD_SERVICE,[\s\S]*new DuplicateBoard\(content\)[\s\S]*inject: \[BOARD_CONTENT_COPY_PORT\]/);
  });

  it.each([
    ['source membership', (code: string) => code.replaceAll('m.user_id=$2','m.user_id=$4')],
    ['tenant transaction', (code: string) => code.replace('this.db.withTenant','this.db.withoutTenant')],
    ['idempotency', (code: string) => code.replace('ON CONFLICT(org_id,actor_id,request_id) DO NOTHING RETURNING job_id','RETURNING job_id')],
    ['source CAS', (code: string) => code.replaceAll('input.expectedSource','input.noExpectedSource')],
    ['tag-before-board lock order', (code: string) => code.replace(
      'const sourceTagIds = await this.lockSourceTags(session,p,sourceBoardId);\n      const captured = await this.capture(session,p,sourceBoardId);',
      'const captured = await this.capture(session,p,sourceBoardId);\n      const sourceTagIds = await this.lockSourceTags(session,p,sourceBoardId);',
    )],
    ['target ownership', (code: string) => code.replace('[targetBoardId,p.orgId,p.userId,input.targetName]','[targetBoardId,p.orgId,"other",input.targetName]')],
    ['target version axis', (code: string) => code.replace('VALUES($1,$2,1,0,$3)','VALUES($1,$2,captured.source.epoch,captured.source.seq,$3)')],
  ])('detects removal of %s', (_label, mutate) => {
    const changed = mutate(source);
    expect([...audit(changed),...productionAudit(changed)]).not.toEqual([]);
  });
});
