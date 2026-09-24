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
const expectedMethods = ['access', 'document', 'head', 'load', 'append', 'writeCommands', 'writeCommandsInTransaction', 'commit', 'commitInTransaction', 'snapshot', 'activateNewBoard', 'publish', 'putAndVerify'];

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
  const allowedTables = new Set(['whiteboards', 'whiteboard_members', 'whiteboard_documents', 'whiteboard_updates', 'whiteboard_content_heads']);
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
});
