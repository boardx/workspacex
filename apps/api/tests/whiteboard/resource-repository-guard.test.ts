/** #3926: enforce the premise of the private-whiteboard permission-lint exemption. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-repository.ts', import.meta.url), 'utf8');
const lint = readFileSync(new URL('../../scripts/lint-permission-paths.mjs', import.meta.url), 'utf8');
const expectedMethods = [
  'list', 'create', 'get', 'update', 'members', 'putMember', 'removeMember',
  'cleanupQuarantineAccessReceipts', 'issueQuarantineAccessReceipt', 'requestQuarantineRecovery',
];
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
  const allowedTables = new Set([
    'whiteboards', 'whiteboard_members', 'org_memberships',
    'organizations', 'whiteboard_quarantine_access_receipts', 'whiteboard_quarantine_recovery_requests',
  ]);
  const tables = new Set(sql.flatMap(query => [...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)]
    .map(match => match[1]!).filter(table => !['SET', 'OF'].includes(table.toUpperCase()))));
  if (tables.size !== allowedTables.size || [...tables].some(table => !allowedTables.has(table))) errors.push('table scope');
  if (/\bwithoutTenant\s*\(/.test(code)) errors.push('withoutTenant');
  if (methods.size !== expectedMethods.length || expectedMethods.some(name => !methods.has(name))) errors.push('method coverage');
  for (const [name, body] of methods) {
    if (!/return this\.db\.withTenant\(p\.orgId,/.test(body)) errors.push(`${name}: tenant context`);
  }
  if (!/const visible\s*=\s*`\(b\.owner_id=\$2 OR m\.user_id IS NOT NULL\)`/.test(code)) errors.push('visibility definition');
  if (!/LEFT JOIN whiteboard_members m ON m\.org_id=b\.org_id AND m\.board_id=b\.id AND m\.user_id=\$2/.test(code)) errors.push('membership scope');
  for (const name of ['list', 'get']) {
    const body = methods.get(name) ?? '';
    if (!/WHERE b\.org_id=\$1[^`]*\$\{visible\}/.test(body) || !body.includes('${membership}')) errors.push(`${name}: visibility predicate`);
    if (!/\[p\.orgId,\s*p\.userId/.test(body)) errors.push(`${name}: actor binding`);
  }
  for (const name of ['create', 'update', 'members', 'putMember', 'removeMember']) {
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
  const cleanup = methods.get('cleanupQuarantineAccessReceipts') ?? '';
  if (!cleanup.includes('cleanupAccessReceipts(s,p.orgId)')) errors.push('receipt cleanup: tenant binding');
  const issue = methods.get('issueQuarantineAccessReceipt') ?? '';
  if (!/FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR UPDATE/.test(issue)) errors.push('receipt issue: authorization lock');
  if (!issue.includes("b.owner_id=$2 OR m.role IN ('editor','viewer')") || !/\[p\.orgId,p\.userId,id,receiptId,sessionFingerprint,epoch,expiresAt\]/.test(issue)) {
    errors.push('receipt issue: actor proof');
  }
  const recovery = methods.get('requestQuarantineRecovery') ?? '';
  if (!recovery.includes('ar.actor_id=$2') || !recovery.includes('ar.session_fingerprint=$5') ||
    !recovery.includes('ar.epoch=$6') || !recovery.includes('ar.active=true') ||
    !/\[p\.orgId,p\.userId,id,input\.accessReceiptId,input\.sessionFingerprint,input\.epoch\]/.test(recovery)) {
    errors.push('recovery: exact access proof');
  }
  if (!recovery.includes('request_id=$3 OR receipt_id=$4 OR access_receipt_id=$5') ||
    !/\[p\.orgId,p\.userId,input\.requestId,input\.receiptId,input\.accessReceiptId\]/.test(recovery)) {
    errors.push('recovery: actor-scoped replay');
  }
  if (!/ar\.org_id=\$1 AND ar\.active=false/.test(code) ||
    !code.includes('rr.org_id=ar.org_id AND rr.access_receipt_id=ar.receipt_id')) {
    errors.push('receipt cleanup: retention scope');
  }
  return errors;
}
describe('whiteboard metadata repository permission exemption', () => {
  it('keeps its bounded table, tenant, visibility and owner predicates', () => {
    expect(audit(source)).toEqual([]);
    expect(lint).toContain('tests/whiteboard/resource-repository-guard.test.ts');
  });
  it('detects removal of a mutation owner predicate', () => {
    const mutated = source.replace('WHERE org_id=$1 AND owner_id=$2 AND id=$3 RETURNING', 'WHERE org_id=$1 AND id=$3 RETURNING');
    expect(mutated).not.toBe(source); expect(audit(mutated)).toContain('update: owner predicate');
  });
  it('detects an added table and unscoped tenant access', () => {
    expect(audit(`${source}\nconst injected = \`SELECT * FROM artifacts\`;`)).toContain('table scope');
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('))).toContain('withoutTenant');
  });
  it('detects removal of private-board read visibility', () => {
    const mutated = source.replace('AND ${visible} ORDER BY', 'ORDER BY');
    expect(mutated).not.toBe(source); expect(audit(mutated)).toContain('list: visibility predicate');
  });
  it('detects receipt issuance without the shared authorization lock', () => {
    const mutated = source.replace('FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE', 'FROM whiteboards WHERE org_id=$1 AND id=$2');
    expect(mutated).not.toBe(source); expect(audit(mutated)).toContain('receipt issue: authorization lock');
  });
  it('detects recovery proofs that stop binding the actor', () => {
    const mutated = source.replace('ar.actor_id=$2', 'true');
    expect(mutated).not.toBe(source); expect(audit(mutated)).toContain('recovery: exact access proof');
  });
});
