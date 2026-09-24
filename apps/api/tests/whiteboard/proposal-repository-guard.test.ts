/** Mechanical premises for the private-board proposal repository permission exemption. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-proposal-repository.ts', import.meta.url), 'utf8');
const lint = readFileSync(new URL('../../scripts/lint-permission-paths.mjs', import.meta.url), 'utf8');
const kernel = readFileSync(new URL('../../src/kernel.module.ts', import.meta.url), 'utf8');
const expectedMethods = ['access', 'list', 'insert', 'create', 'createFromAgentRun', 'decide', 'batchDecide'];

function inspect(code: string): { methods: Map<string, string>; tables: Set<string>; sql: string[] } {
  const file = ts.createSourceFile('pg-proposal-repository.ts', code, ts.ScriptTarget.Latest, true);
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
  const allowedTables = new Set(['whiteboards', 'org_memberships', 'whiteboard_members', 'whiteboard_proposals', 'whiteboard_proposal_decisions', 'whiteboard_documents', 'agent_runs', 'chat_messages', 'agents']);
  if (tables.size !== allowedTables.size || [...tables].some(table => !allowedTables.has(table))) errors.push('table scope');
  if (sql.some(query => /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:whiteboard_|org_memberships)/i.test(query) && !/\borg_id\b/i.test(query))) errors.push('tenant SQL scope');
  if (/\bwithoutTenant\s*\(/.test(code)) errors.push('withoutTenant');
  if (methods.size !== expectedMethods.length || expectedMethods.some(name => !methods.has(name))) errors.push('method coverage');
  for (const name of ['list', 'decide', 'batchDecide']) {
    const body = methods.get(name) ?? '';
    if (!body.includes('this.db.withTenant(p.orgId,')) errors.push(`${name}: tenant transaction`);
    const auth = body.indexOf('this.access(s,p,boardId,');
    const content = body.search(/\b(?:FROM|INTO|UPDATE)\s+whiteboard_proposals/);
    if (auth < 0 || content < 0 || auth > content) errors.push(`${name}: authorize before content`);
  }
  const insert = methods.get('insert') ?? '';
  const insertAuth=insert.indexOf('this.access(s,p,boardId,true)'),insertContent=insert.search(/\b(?:FROM|INTO)\s+whiteboard_proposals/);
  if(insertAuth<0||insertContent<0||insertAuth>insertContent)errors.push('insert: authorize before content');
  for(const name of ['create','createFromAgentRun']){const body=methods.get(name)??'';if(!body.includes('this.db.withTenant(')||!body.includes('this.insert('))errors.push(`${name}: trusted transaction delegation`);}
  const access = methods.get('access') ?? '';
  const writeBoardSql="'SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE'";
  const readBoardSql="'SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2'";
  if (!access.includes('const board=write') || !access.includes(writeBoardSql) || !access.includes(readBoardSql) || access.indexOf(writeBoardSql)>access.indexOf(readBoardSql)) errors.push('write-only board lock');
  if (!/FROM org_memberships o/.test(access) || !/m\.org_id=o\.org_id AND m\.user_id=o\.user_id AND m\.board_id=\$2/.test(access)) errors.push('membership join scope');
  if (!/WHERE o\.org_id=\$1 AND o\.user_id=\$3/.test(access) || !/\[p\.orgId,boardId,p\.userId,b\.owner_id\]/.test(access)) errors.push('membership actor scope');
  if (!/write&&b\.archived/.test(access) || !/!write\|\|role\.rows\[0\]\.role!==\s*'viewer'/.test(access)) errors.push('write role/archive gate');

  if (!/submitted_by=\$3 AND request_id=\$4/.test(insert) || !/\[p\.orgId,boardId,p\.userId,input\.requestId\]/.test(insert)) errors.push('create: actor receipt scope');
  if (!/p\.userId,input\.requestId,hash/.test(insert)) errors.push('create: submitter binding');
  const quota = insert.indexOf("SELECT count(*) FROM whiteboard_proposals");
  const boardLock = access.indexOf('FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE');
  if (boardLock < 0 || quota < 0 || insert.indexOf('this.access(s,p,boardId,true)') > quota) errors.push('create: serialized quota');
  const decide = methods.get('decide') ?? '';
  if (!/WHERE org_id=\$1 AND board_id=\$2 AND id=\$3 FOR UPDATE/.test(decide)) errors.push('decide: proposal row lock');
  if (!/writeCommandsInTransaction\(s,p,boardId/.test(decide)) errors.push('decide: same transaction mutation');
  const batch=methods.get('batchDecide')??'';
  if(!/id=ANY\(\$3::uuid\[\]\).*FOR UPDATE/.test(batch))errors.push('batch: proposal row locks');
  if(!/whiteboard_proposal_decisions/.test(batch)||!/actor_id=\$3 AND request_id=\$4/.test(batch))errors.push('batch: actor receipt scope');
  if(!/writeCommandsInTransaction\(s,p,boardId/.test(batch))errors.push('batch: same transaction mutation');
  const agent=methods.get('createFromAgentRun')??'';
  if(!/FROM agent_runs r JOIN chat_messages m/.test(agent)||!/m\.author_kind='human'/.test(agent)||!/run\.actor_id/.test(agent))errors.push('agent: trusted durable run context');
  return errors;
}

describe('whiteboard proposal repository permission exemption', () => {
  it('keeps board ACL, tenant transaction and proposal receipt predicates bounded', () => {
    expect(audit(source)).toEqual([]);
    expect(lint).toContain('tests/whiteboard/proposal-repository-guard.test.ts');
    expect(source).not.toContain('new PgWhiteboardCollaborationStore');
    expect(source).toContain('private readonly collaboration:WhiteboardCollaborationStore');
    expect(kernel).toContain('new PgProposalRepository(db, collaboration)');
    expect(kernel).toMatch(/provide: WHITEBOARD_PROPOSALS,[\s\S]*?inject: \[DATABASE_PORT, WHITEBOARD_COLLABORATION_STORE\]/);
  });
  it('rejects content reads moved ahead of board authorization', () => {
    const mutated = source.replace('if(!await this.access(s,p,boardId,false))return null;', '/* authorization removed */');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('list: authorize before content');
    expect(audit(source.replace('if(!await this.access(s,p,boardId,true))return null;', '/* insert authorization removed */'))).toContain('insert: authorize before content');
  });
  it('rejects idempotency receipts shared between different submitters', () => {
    const mutated = source.replace('AND submitted_by=$3 AND request_id=$4', 'AND request_id=$4');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('create: actor receipt scope');
  });
  it('rejects caller-derived AI attribution and non-atomic batch decisions',()=>{
    expect(audit(source.replace("m.author_kind='human'","m.author_kind<>'blocked'"))).toContain('agent: trusted durable run context');
    expect(audit(source.replace('ORDER BY id FOR UPDATE','ORDER BY id'))).toContain('batch: proposal row locks');
    expect(audit(source.replace('AND actor_id=$3 AND request_id=$4','AND request_id=$4'))).toContain('batch: actor receipt scope');
  });
  it('rejects tenant bypasses and a newly introduced table', () => {
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('))).toContain('withoutTenant');
    expect(audit(source.replace('WHERE org_id=$1 AND board_id=$2', 'WHERE board_id=$2'))).toContain('tenant SQL scope');
    expect(audit(`${source}\nvoid session.query(\`SELECT * FROM survey_templates\`);`)).toContain('table scope');
  });
  it('rejects locks removed from proposal decisions or quota accounting', () => {
    const unlockedDecision = source.replace('AND id=$3 FOR UPDATE', 'AND id=$3');
    expect(unlockedDecision).not.toBe(source);
    expect(audit(unlockedDecision)).toContain('decide: proposal row lock');
    const unlockedBoard = source.replace('FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE', 'FROM whiteboards WHERE org_id=$1 AND id=$2');
    expect(unlockedBoard).not.toBe(source);
    expect(audit(unlockedBoard)).toContain('create: serialized quota');
    expect(audit(unlockedBoard)).toContain('write-only board lock');
    const lockedRead = source.replace("'SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2',[p.orgId,boardId]);", "'SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE',[p.orgId,boardId]);");
    expect(lockedRead).not.toBe(source);
    expect(audit(lockedRead)).toContain('write-only board lock');
  });
});
