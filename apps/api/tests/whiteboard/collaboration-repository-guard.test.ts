/**
 * Mechanical premises for the private-board collaboration store's permission-lint exemption.
 * This is source analysis on purpose: it runs without PostgreSQL and makes the SQL/lock shape
 * that protects every Yjs snapshot and update a CI invariant.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-collaboration-store.ts', import.meta.url), 'utf8');
const lint = readFileSync(new URL('../../scripts/lint-permission-paths.mjs', import.meta.url), 'utf8');
const expectedMethods = ['access', 'document', 'head', 'load', 'append', 'restoreDeletion', 'writeCommands', 'writeCommandsInTransaction', 'commit', 'commitInTransaction', 'objectPrefix', 'readStored', 'writeStored', 'documentBytes', 'updateBytes', 'loadInTransaction', 'backfillLegacyBoard', 'backfillLegacyUpdatesInTransaction', 'backfillStorageInTransaction', 'compensateInTransaction'];

function inspect(code: string): { methods: Map<string, string>; tables: Set<string>; sql: string[] } {
  const file = ts.createSourceFile('pg-collaboration-store.ts', code, ts.ScriptTarget.Latest, true);
  const methods = new Map<string, string>();
  const sql: string[] = [];
  const queryText = (node: ts.Expression | undefined): string | undefined => {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => span.literal.text).join(' ');
    return undefined;
  };
  function visit(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && node.name) methods.set(node.name.getText(file), node.getText(file));
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
      const text = queryText(node.arguments[0]);
      if (text) sql.push(text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const tables = new Set(sql.flatMap(query => {
    const referenced = [...query.matchAll(/\b(?:FROM|JOIN|INTO)\s+(\w+)/gi)].map(match => match[1]!.toLowerCase());
    const updated = /^\s*UPDATE\s+(\w+)/i.exec(query)?.[1]?.toLowerCase();
    return updated ? [...referenced, updated] : referenced;
  }));
  return { methods, tables, sql };
}

function audit(code: string): string[] {
  const { methods, tables, sql } = inspect(code);
  const errors: string[] = [];
  const allowedTables = new Set(['whiteboards', 'whiteboard_members', 'whiteboard_documents', 'whiteboard_updates', 'whiteboard_comment_threads', 'whiteboard_collaboration_events', 'whiteboard_deletion_receipts']);
  if (tables.size !== allowedTables.size || [...tables].some(table => !allowedTables.has(table))) errors.push('table scope');
  if (sql.some(query => /\b(?:FROM|JOIN|INTO|UPDATE)\s+whiteboard_/i.test(query) && !/\borg_id\b/i.test(query))) errors.push('tenant SQL scope');
  if (/\bwithoutTenant\s*\(/.test(code)) errors.push('withoutTenant');
  if (methods.size !== expectedMethods.length || expectedMethods.some(name => !methods.has(name))) errors.push('method coverage');

  const access = methods.get('access') ?? '';
  if (!/FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR \$\{write \? 'UPDATE' : 'SHARE'\}/.test(access)) errors.push('board tenant lock');
  if (!/FROM whiteboard_members WHERE org_id=\$1 AND board_id=\$2 AND user_id=\$3/.test(access)) errors.push('member actor scope');
  if (!/\[p\.orgId, boardId, p\.userId\]/.test(access)) errors.push('member actor binding');
  if (!/write && parsed\.data !== 'owner' && parsed\.data !== 'editor'/.test(access) || !/write && row\.archived/.test(access)) errors.push('write role/archive gate');

  for (const name of ['head', 'load', 'writeCommands', 'commit', 'restoreDeletion']) {
    if (!(methods.get(name) ?? '').replace(/\s+/g, '').includes('this.db.withTenant(p.orgId,')) errors.push(`${name}: tenant transaction`);
  }
  if (!(methods.get('append') ?? '').includes('return this.commit(')) errors.push('append: guarded commit path');
  if (!(methods.get('writeCommandsInTransaction') ?? '').includes('this.commitInTransaction(session, p, boardId')) errors.push('commands: guarded transaction path');

  const head = methods.get('head') ?? '';
  if (head.indexOf('this.access(session, p, boardId, false)') < 0 || head.indexOf('this.access(session, p, boardId, false)') > head.indexOf('SELECT epoch,seq FROM whiteboard_documents')) errors.push('head: authorize before read');
  const load = (methods.get('loadInTransaction') ?? '').replace(/\s+/g, '');
  if (!(methods.get('load') ?? '').includes('session => this.loadInTransaction(session,p,boardId,stateVector)')) errors.push('load: guarded transaction delegation');
  if (load.indexOf('this.access(session,p,boardId,false)') < 0 || load.indexOf('this.access(session,p,boardId,false)') > load.indexOf('this.document(session,p,boardId)')) errors.push('load: authorize before read');
  const commit = methods.get('commitInTransaction') ?? '';
  if (commit.indexOf('this.access(session, p, boardId, true)') < 0 || commit.indexOf('this.access(session, p, boardId, true)') > commit.indexOf('this.document(session, p, boardId, true)')) errors.push('commit: authorize before mutation');
  if (!/actor_id=\$4 AND update_id=\$5/.test(commit) || !/\[p\.orgId, boardId, epoch, attributedActorId, updateId\]/.test(commit)) errors.push('idempotency actor scope');
  if (!/WHERE org_id=\$1 AND board_id=\$2/.test(commit)) errors.push('document mutation tenant scope');
  const compact = (name: string) => (methods.get(name) ?? '').replace(/\s+/g, '');
  const replayBytes=compact('updateBytes');
  if(inspect(methods.get('updateBytes')??'').sql.some(query=>/whiteboard_updates/.test(query)&&!query.replace(/\s+/g,'').includes('actor_id=$4ANDupdate_id=$5'))||!replayBytes.includes('[p.orgId,boardId,epoch,actorId,updateId]'))errors.push('replay migration actor scope');
  if (!commit.includes('attributedActorId = p.userId')) errors.push('idempotency default human actor');
  if (!compact('compensateInTransaction').includes('returnthis.commitInTransaction(session,p,boardId,') || !compact('compensateInTransaction').includes('undefined,input.actorId)')) errors.push('compensation: guarded actor transaction');
  const backfill=compact('backfillLegacyBoard');
  if (!backfill.includes('this.db.withTenant(p.orgId,') || backfill.indexOf('awaitthis.access(session,p,boardId,false)')<0 || backfill.indexOf('awaitthis.access(session,p,boardId,false)')>backfill.indexOf('this.backfillLegacyUpdatesInTransaction(')) errors.push('backfill: authorize before read');
  const maintenance=compact('backfillStorageInTransaction');
  if (maintenance.indexOf('awaitlockBoardStorageMaintenance(session,p,boardId)')<0 || maintenance.indexOf('awaitlockBoardStorageMaintenance(session,p,boardId)')>maintenance.indexOf('session.query')) errors.push('maintenance: authorize before write');
  const restore = (methods.get('restoreDeletion') ?? '').replace(/\s+/g, '');
  if (!restore.includes('awaitthis.access(session,p,boardId,true)') || restore.indexOf('awaitthis.access') > restore.indexOf('SELECTproof')) errors.push('restore: fresh authorization');
  if (!restore.includes('actor_id=$4ANDdelete_gesture_id=$5FORUPDATE') || !restore.includes('[p.orgId,boardId,input.epoch,p.userId,input.deleteGestureId]')) errors.push('restore: actor-bound receipt lock');
  if (!restore.includes('this.validator.restoreDeletion!(snapshot,receipt.proof,receipt.changes,')) errors.push('restore: server receipt proof');
  if (!restore.includes("thrownewFault('COMMENT_CONFLICT')")) errors.push('restore: comment revision CAS');
  return errors;
}

describe('whiteboard collaboration repository permission exemption', () => {
  it('keeps tenant tables, ACL predicates, row locks and transaction ordering bounded', () => {
    expect(audit(source)).toEqual([]);
    expect(lint).toContain('tests/whiteboard/collaboration-repository-guard.test.ts');
  });
  it('rejects removal of authorization before a document mutation', () => {
    const mutated = source.replace('await this.access(session, p, boardId, true);', '/* authorization removed */');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('commit: authorize before mutation');
  });
  it('rejects an idempotency lookup no longer scoped to the actor', () => {
    const mutated = source.replaceAll('AND actor_id=$4 AND update_id=$5', 'AND update_id=$5');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('idempotency actor scope');
  });
  it('rejects unscoped legacy replay migration',()=>{
    const mutated=source.replace('AND actor_id=$4 AND update_id=$5','AND update_id=$5');
    expect(audit(mutated)).toContain('replay migration actor scope');
  });
  it('rejects restore authorization and proof bypasses', () => {
    expect(audit(source.replace('await this.access(session,p,boardId,true)', 'void 0'))).toContain('restore: fresh authorization');
    expect(audit(source.replace('actor_id=$4 AND delete_gesture_id=$5 FOR UPDATE', 'delete_gesture_id=$5 FOR UPDATE'))).toContain('restore: actor-bound receipt lock');
    expect(audit(source.replace('this.validator.restoreDeletion!(snapshot,receipt.proof,receipt.changes,', 'this.validator.restoreDeletion!(snapshot,input)'))).toContain('restore: server receipt proof');
  });
  it('rejects tenant bypasses and a newly introduced table', () => {
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('))).toContain('withoutTenant');
    expect(audit(source.replace('WHERE org_id=$1 AND board_id=$2', 'WHERE board_id=$2'))).toContain('tenant SQL scope');
    expect(audit(`${source}\nvoid session.query(\`SELECT * FROM artifacts\`);`)).toContain('table scope');
  });
});

it('rejects delegated read, compensation actor and maintenance guard bypasses',()=>{
 expect(audit(source.replace('this.access(session,p,boardId,false)','void 0'))).toContain('load: authorize before read');
 expect(audit(source.replaceAll('undefined,input.actorId)','undefined,p.userId)'))).toContain('compensation: guarded actor transaction');
 expect(audit(source.replace('await lockBoardStorageMaintenance(session,p,boardId)','void 0'))).toContain('maintenance: authorize before write');
 expect(audit(source.replace('[p.orgId, boardId, epoch, attributedActorId, updateId]','[p.orgId, boardId, epoch, p.userId, updateId]'))).toContain('idempotency actor scope');
});
