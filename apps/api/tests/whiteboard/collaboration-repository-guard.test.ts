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
const restoreCascadeMigration = readFileSync(new URL('../../migrations/20260924001000_whiteboard_checkpoint_restore_cascade.sql', import.meta.url), 'utf8');
const lifecycleMigration = readFileSync(new URL('../../migrations/20260924001100_whiteboard_history_blob_intents.sql', import.meta.url), 'utf8');
const expectedMethods = ['access', 'document', 'head', 'load', 'append', 'writeCommands', 'historyHead', 'listHistoryCheckpoints',
  'createHistoryCheckpoint', 'previewHistoryCheckpoint', 'compareHistoryCheckpoints', 'restoreHistoryCheckpoint', 'copyHistoryCheckpoint', 'copyHistorySnapshot',
  'writeCommandsInTransaction', 'commit', 'commitInTransaction', 'historySource', 'stageHistoryBlob', 'finalizeHistoryIntent', 'publishHistoryRestoreContent', 'purgeHistoryRetention',
  'readHistoryBlob', 'snapshot', 'activateNewBoard', 'publish', 'historyCheckpointObjects', 'historyRestoreView',
  'readHistoryCheckpointBlob', 'putAndVerify'];

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
  const allowedTables = new Set(['whiteboards', 'whiteboard_members', 'whiteboard_documents', 'whiteboard_updates', 'whiteboard_content_heads', 'whiteboard_checkpoints', 'whiteboard_checkpoint_restores','whiteboard_history_blob_intents']);
  if (tables.size !== allowedTables.size || [...tables].some(table => !allowedTables.has(table))) errors.push('table scope');
  if (sql.some(query => /\b(?:FROM|JOIN|INTO|UPDATE)\s+whiteboard_/i.test(query) && !/\borg_id\b/i.test(query))) errors.push('tenant SQL scope');
  if (/\bwithoutTenant\s*\(/.test(code)) errors.push('withoutTenant');
  if (methods.size !== expectedMethods.length || expectedMethods.some(name => !methods.has(name))) errors.push('method coverage');

  const access = methods.get('access') ?? '';
  if (!/FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR \$\{write \? 'UPDATE' : 'SHARE'\}/.test(access)) errors.push('board tenant lock');
  if (!/FROM whiteboard_members WHERE org_id=\$1 AND board_id=\$2 AND user_id=\$3/.test(access)) errors.push('member actor scope');
  if (!/\[p\.orgId, boardId, p\.userId\]/.test(access)) errors.push('member actor binding');
  if (!/write && parsed\.data === 'viewer'/.test(access) || !/write && row\.archived/.test(access)) errors.push('write role/archive gate');

  for (const name of ['head', 'load', 'writeCommands', 'commit']) {
    if (!(methods.get(name) ?? '').includes('this.db.withTenant(p.orgId,')) errors.push(`${name}: tenant transaction`);
  }
  if (!(methods.get('append') ?? '').includes('return this.commit(')) errors.push('append: guarded commit path');
  if (!(methods.get('writeCommandsInTransaction') ?? '').includes('this.commitInTransaction(session, p, boardId')) errors.push('commands: guarded transaction path');

  const head = methods.get('head') ?? '';
  if (head.indexOf('this.access(session, p, boardId, false)') < 0 || head.indexOf('this.access(session, p, boardId, false)') > head.indexOf('FROM whiteboard_documents')) errors.push('head: authorize before read');
  const load = methods.get('load') ?? '';
  if (load.indexOf('this.access(session, p, boardId, false)') < 0 || load.indexOf('this.access(session, p, boardId, false)') > load.indexOf('this.document(session, p, boardId)')) errors.push('load: authorize before read');
  const commit = methods.get('commitInTransaction') ?? '';
  if (commit.indexOf('this.access(session, p, boardId, true)') < 0 || commit.indexOf('this.access(session, p, boardId, true)') > commit.indexOf('this.document(session, p, boardId)')) errors.push('commit: authorize before mutation');
  if (!/actor_id=\$4 AND update_id=\$5/.test(commit) || !/\[p\.orgId, boardId, epoch, p\.userId, updateId\]/.test(commit)) errors.push('idempotency actor scope');
  if (!/WHERE org_id=\$1 AND board_id=\$2/.test(commit)) errors.push('document mutation tenant scope');
  for (const name of ['historyHead','listHistoryCheckpoints','createHistoryCheckpoint','compareHistoryCheckpoints','restoreHistoryCheckpoint','historyCheckpointObjects']) {
    if (!(methods.get(name) ?? '').includes('this.db.withTenant(p.orgId,')) errors.push(`${name}: tenant transaction`);
  }
  const source = methods.get('historySource') ?? '';
  if (source.indexOf('this.access(session, p, boardId, write)') < 0 || source.indexOf('this.access(session, p, boardId, write)') > source.indexOf('this.document(session, p, boardId)')) errors.push('history source: authorize before content');
  const createHistory = methods.get('createHistoryCheckpoint') ?? '';
  if (createHistory.indexOf('this.historySource(session, p, boardId, true)') < 0 || createHistory.indexOf('this.historySource(session, p, boardId, true)') > createHistory.indexOf('FROM whiteboard_checkpoints')) errors.push('history create: authorize before metadata');
  const restoreHistory = methods.get('restoreHistoryCheckpoint') ?? '';
  if (restoreHistory.indexOf('this.historySource(session, p, boardId, true)') < 0 || restoreHistory.indexOf('this.historySource(session, p, boardId, true)') > restoreHistory.indexOf('FROM whiteboard_checkpoint_restores')) errors.push('history restore: authorize before replay');
  if (!/sourceContentDigest/.test(restoreHistory) || !/content_sha256/.test(restoreHistory)) errors.push('history restore: digest fence');
  if (restoreHistory.indexOf('restoredBoardIdForRequest(') < 0 || restoreHistory.indexOf('restoredBoardIdForRequest(') > restoreHistory.indexOf('this.publishHistoryRestoreContent(')) errors.push('history restore: stable target before publish');
  const stage = methods.get('stageHistoryBlob') ?? '';
  if (stage.indexOf('INSERT INTO whiteboard_history_blob_intents') < 0 || stage.indexOf('INSERT INTO whiteboard_history_blob_intents') > stage.indexOf('this.codec.encrypt(')) errors.push('history lifecycle: intent before encryption');
  if (stage.indexOf('UPDATE whiteboard_history_blob_intents SET blob_key=') < 0 || stage.indexOf('UPDATE whiteboard_history_blob_intents SET blob_key=') > stage.indexOf('this.putAndVerify(')) errors.push('history lifecycle: descriptor before put');
  const purge = methods.get('purgeHistoryRetention') ?? '';
  if (purge.indexOf('deleteIfMatch(') < 0 || purge.indexOf('deleteIfMatch(') > purge.indexOf("SET state='deleted'")) errors.push('history lifecycle: digest delete before tombstone');
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
    const mutated = source.replace('AND actor_id=$4 AND update_id=$5', 'AND update_id=$5');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('idempotency actor scope');
  });
  it('rejects tenant bypasses and a newly introduced table', () => {
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('))).toContain('withoutTenant');
    expect(audit(source.replace('WHERE org_id=$1 AND board_id=$2', 'WHERE board_id=$2'))).toContain('tenant SQL scope');
    expect(audit(`${source}\nvoid session.query(\`SELECT * FROM artifacts\`);`)).toContain('table scope');
  });
  it('rejects moving checkpoint reads ahead of fresh Board authorization', () => {
    const mutated = source.replace('await this.historySource(session, p, boardId, true);\n      const replay', 'const replay');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('history restore: authorize before replay');
  });
  it('keeps both tenant-composite restore provenance edges cascading on checkpoint cleanup', () => {
    const edges = [...restoreCascadeMigration.matchAll(/FOREIGN KEY \(org_id, (source|restored)_board_id, (source|restored)_checkpoint_id\)[\s\S]*?REFERENCES whiteboard_checkpoints\(org_id, board_id, checkpoint_id\)[\s\S]*?ON DELETE CASCADE/g)];
    expect(edges.map(match => match[1])).toEqual(['source', 'restored']);
    expect(restoreCascadeMigration).toContain("confrelid = 'whiteboard_checkpoints'::regclass");
    expect(restoreCascadeMigration).toContain("conrelid = 'whiteboard_checkpoint_restores'::regclass");
    expect([...restoreCascadeMigration.matchAll(/ON DELETE CASCADE/g)]).toHaveLength(2);
  });
  it('keeps crash recovery durable and tenant-scoped without an organization cascade', () => {
    expect(lifecycleMigration).toContain('UNIQUE (org_id,actor_id,operation_kind,request_id,blob_role)');
    expect(lifecycleMigration).toContain('FORCE ROW LEVEL SECURITY');
    expect(lifecycleMigration).not.toMatch(/REFERENCES\s+(organizations|whiteboards)/i);
    expect(audit(source.replace('restoredBoardIdForRequest(p.orgId,p.userId,boardId,checkpointId,parsed.data.requestId)', 'randomUUID()'))).toContain('history restore: stable target before publish');
    expect(audit(source.replace('await this.db.withTenant(p.orgId,async session=>{const changed=', 'await this.putAndVerify(p.orgId,key,encoded);\n    await this.db.withTenant(p.orgId,async session=>{const changed='))).toContain('history lifecycle: descriptor before put');
    expect(audit(source.replace('await this.blobs!.deleteIfMatch({tenantId:orgId,key:row.blob_key', "await session.query(`UPDATE whiteboard_history_blob_intents SET state='deleted' WHERE org_id=$1`,[orgId]);\n        await this.blobs!.deleteIfMatch({tenantId:orgId,key:row.blob_key"))).toContain('history lifecycle: digest delete before tombstone');
  });
});
