/** #3926: enforce the premise of the private-whiteboard permission-lint exemption. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-repository.ts', import.meta.url), 'utf8');
const lint = readFileSync(new URL('../../scripts/lint-permission-paths.mjs', import.meta.url), 'utf8');
const expectedMethods = ['list', 'create', 'get', 'update', 'permanentlyDelete', 'members', 'putMember', 'removeMember', 'mentionableMembers'];
function audit(code: string): string[] {
  const file = ts.createSourceFile('repository.ts', code, ts.ScriptTarget.Latest, true);
  const methods = new Map<string, string>(), sql: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && node.name) methods.set(node.name.getText(file), node.getText(file));
    if (ts.isNoSubstitutionTemplateLiteral(node)) sql.push(node.text);
    if (ts.isTemplateExpression(node)) sql.push(node.head.text + node.templateSpans.map(span => span.literal.text).join(' '));
    ts.forEachChild(node, visit);
  }
  visit(file);
  const errors: string[] = [];
  const allowedTables = new Set(['whiteboards', 'whiteboard_members', 'org_memberships', 'whiteboard_tags', 'whiteboard_tag_bindings', 'whiteboard_delete_receipts', 'credentials']);
  const tables = new Set(sql.flatMap(query => [...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map(match => match[1]!).filter(table => table.toUpperCase() !== 'SET')));
  if (tables.size !== allowedTables.size || [...tables].some(table => !allowedTables.has(table))) errors.push('table scope');
  if (/\bwithoutTenant\s*\(/.test(code)) errors.push('withoutTenant');
  if (methods.size !== expectedMethods.length || expectedMethods.some(name => !methods.has(name))) errors.push('method coverage');
  for (const [name, body] of methods) {
    if (!/return this\.db\.withTenant\(p\.orgId,/.test(body)) errors.push(`${name}: tenant context`);
  }
  if (!/const visible\s*=\s*`\(b\.owner_id=\$2 OR m\.user_id IS NOT NULL\)`/.test(code)) errors.push('visibility definition');
  if (!/LEFT JOIN whiteboard_members m ON m\.org_id=b\.org_id AND m\.board_id=b\.id AND m\.user_id=\$2/.test(code)) errors.push('membership scope');
  for (const name of ['list', 'get', 'mentionableMembers']) {
    const body = methods.get(name) ?? '';
    if (!/WHERE b\.org_id=\$1[^`]*\$\{visible\}/.test(body) || !body.includes('${membership}')) errors.push(`${name}: visibility predicate`);
    if (!/\[p\.orgId,\s*p\.userId/.test(body)) errors.push(`${name}: actor binding`);
  }
  for (const name of ['create', 'update', 'permanentlyDelete', 'members', 'putMember', 'removeMember']) {
    const body = methods.get(name) ?? '';
    if (!/WHERE (?:b\.)?org_id=\$1 AND (?:b\.)?owner_id=\$2/.test(body)) errors.push(`${name}: owner predicate`);
    if (!/\[p\.orgId,\s*p\.userId/.test(body)) errors.push(`${name}: owner binding`);
  }
  const create = methods.get('create') ?? '';
  if (!/INSERT INTO whiteboards\(id,org_id,owner_id,request_id,name\)/.test(create) || !/\[randomUUID\(\),\s*p\.orgId,\s*p\.userId,/.test(create)) errors.push('create: ownership assignment');
  const grant = methods.get('putMember') ?? '';
  if (!/JOIN org_memberships om ON om\.org_id=b\.org_id AND om\.user_id=\$4/.test(grant) || !grant.includes('b.owner_id<>$4')) errors.push('grant: same tenant and immutable owner');
  for (const name of ['putMember', 'removeMember']) {
    if (!(methods.get(name) ?? '').includes('FOR UPDATE')) errors.push(`${name}: authorization lock`);
  }
  const mention = methods.get('mentionableMembers') ?? '';
  for (const predicate of ['om.org_id=b.org_id', 'c.user_id=b.owner_id', 'target.org_id=b.org_id AND target.board_id=b.id AND target.user_id=c.user_id', 'caller.org_id=b.org_id AND caller.user_id=$2']) {
    if (!mention.includes(predicate)) errors.push('mention: scoped active membership');
  }
  if (/c\.(?:email|password|session)/.test(mention)) errors.push('mention: excessive disclosure');
  return errors;
}
describe('whiteboard metadata repository permission exemption', () => {
  it('keeps its bounded table, tenant, visibility and owner predicates', () => {
    expect(audit(source)).toEqual([]);
    expect(lint).toContain('tests/whiteboard/resource-repository-guard.test.ts');
  });
  it('detects mention scope removal and extra credential disclosure', () => {
    expect(audit(source.replace('caller.org_id=b.org_id AND caller.user_id=$2', 'true'))).toContain('mention: scoped active membership');
    expect(audit(source.replace('c.display_name', 'c.email'))).toContain('mention: excessive disclosure');
  });
  it('detects removal of a mutation owner predicate', () => {
    const mutated = source.replaceAll('owner_id=$2', 'owner_id<>$2');
    expect(mutated).not.toBe(source); expect(audit(mutated)).toContain('update: owner predicate');
  });
  it('detects an added table and unscoped tenant access', () => {
    expect(audit(`${source}\nconst injected = \`SELECT * FROM artifacts\`;`)).toContain('table scope');
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('))).toContain('withoutTenant');
  });
  it('detects removal of private-board read visibility', () => {
    const mutated = source.replace('AND ${visible}\n', 'AND true\n');
    expect(mutated).not.toBe(source); expect(audit(mutated)).toContain('list: visibility predicate');
  });
});

describe('mention directory execution boundary (no database substitute claims)', () => {
  it('returns only validated names from a single tenant-bound query', async () => {
    const { PgWhiteboardRepository } = await import('../../src/infrastructure/whiteboard/pg-whiteboard-repository');
    const { toOrgId } = await import('../../src/domain/org-id');
    const principal = { orgId: toOrgId('mention-test-org'), userId: 'reader' };
    let calls = 0;
    const db = { withTenant: async (orgId: unknown, callback: (session: unknown) => unknown) => {
      expect(orgId).toBe(principal.orgId);
      return callback({ query: async (sql: string, params: unknown[]) => {
        calls++; expect(params).toEqual([principal.orgId, 'reader', 'board']);
        expect(sql).toContain('(b.owner_id=$2 OR m.user_id IS NOT NULL)');
        return { rows: [{ items: [{ userId: 'member', displayName: '真实姓名' }] }], rowCount: 1 };
      } });
    } } as unknown as import('../../src/application/ports/database.port').DatabasePort;
    expect(await new PgWhiteboardRepository(db).mentionableMembers(principal, 'board')).toEqual([{userId:'member',displayName:'真实姓名'}]);
    expect(calls).toBe(1);
  });
  it('keeps missing and inaccessible results indistinguishable', async () => {
    const { PgWhiteboardRepository } = await import('../../src/infrastructure/whiteboard/pg-whiteboard-repository');
    const { toOrgId } = await import('../../src/domain/org-id');
    const db = { withTenant: async (_orgId: unknown, callback: (session: unknown) => unknown) => callback({query:async()=>({rows:[],rowCount:0})}) } as unknown as import('../../src/application/ports/database.port').DatabasePort;
    expect(await new PgWhiteboardRepository(db).mentionableMembers({orgId:toOrgId('other-org'),userId:'revoked'}, 'board')).toBeNull();
  });
});
