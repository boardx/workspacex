/** Mechanical premises for the private-board workshop repository permission exemption. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-workshop-repository.ts', import.meta.url), 'utf8');
const lint = readFileSync(new URL('../../scripts/lint-permission-paths.mjs', import.meta.url), 'utf8');
const publicMethods = ['comments', 'addComment', 'deleteComment', 'draft', 'saveDraft', 'publishDraft', 'votes', 'createVote', 'castVote', 'closeVote', 'timer', 'startTimer', 'stopTimer'];
const expectedMethods = ['requireObjects', 'access', ...publicMethods, 'voteView', 'readTimer'];

function inspect(code: string): { methods: Map<string, string>; tables: Set<string>; sql: string[] } {
  const file = ts.createSourceFile('pg-workshop-repository.ts', code, ts.ScriptTarget.Latest, true);
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
  const allowedTables = new Set(['whiteboard_documents', 'whiteboards', 'org_memberships', 'whiteboard_members', 'whiteboard_comments', 'whiteboard_private_drafts', 'whiteboard_draft_publications', 'whiteboard_ballots', 'whiteboard_votes', 'whiteboard_timers']);
  if (tables.size !== allowedTables.size || [...tables].some(table => !allowedTables.has(table))) errors.push('table scope');
  if (sql.some(query => /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:whiteboard_|org_memberships)/i.test(query) && !/\borg_id\b/i.test(query))) errors.push('tenant SQL scope');
  if (/\bwithoutTenant\s*\(/.test(code)) errors.push('withoutTenant');
  if (methods.size !== expectedMethods.length || expectedMethods.some(name => !methods.has(name))) errors.push('method coverage');
  for (const name of publicMethods) {
    const body = methods.get(name) ?? '';
    if (!body.includes('this.db.withTenant(p.orgId,')) errors.push(`${name}: tenant transaction`);
    const auth = body.indexOf('this.access(s,p,boardId');
    const content = ['s.query', 'this.requireObjects', 'this.voteView', 'this.readTimer', 'this.collaboration']
      .map(anchor => body.indexOf(anchor)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1;
    if (auth < 0 || content < 0 || auth > content) errors.push(`${name}: board authorization`);
  }

  const access = methods.get('access') ?? '';
  if (!/FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR UPDATE/.test(access)) errors.push('board tenant lock');
  if (!/FROM org_memberships o LEFT JOIN whiteboard_members m/.test(access) || !/m\.org_id=o\.org_id AND m\.user_id=o\.user_id AND m\.board_id=\$2/.test(access)) errors.push('membership join scope');
  if (!/WHERE o\.org_id=\$1 AND o\.user_id=\$3/.test(access) || !/\[p\.orgId,boardId,p\.userId,board\.owner_id\]/.test(access)) errors.push('membership actor scope');
  if (!/\(\$3=\$4 OR m\.user_id IS NOT NULL\)/.test(access) || !/member\.rows\[0\]\?\.role \?\? null/.test(access)) errors.push('membership fail closed');
  if (!/write && board\.archived/.test(access)) errors.push('archived write gate');

  for (const name of ['addComment', 'createVote', 'castVote']) {
    const body = methods.get(name) ?? '';
    if (body.indexOf('this.access(s,p,boardId,true)') < 0 || body.indexOf('this.access(s,p,boardId,true)') > body.indexOf('this.requireObjects(s,p,boardId')) errors.push(`${name}: lock before object validation`);
  }
  const draft = methods.get('draft') ?? '', saveDraft = methods.get('saveDraft') ?? '', publish = methods.get('publishDraft') ?? '';
  if (!/user_id=\$3/.test(draft) || !/\[p\.orgId,boardId,p\.userId\]/.test(draft)) errors.push('draft: actor scope');
  if (!/VALUES\(\$1,\$2,\$3,\$4,\$5\)/.test(saveDraft) || !/\[p\.orgId,boardId,p\.userId,input\.text,revision\]/.test(saveDraft)) errors.push('draft: actor write binding');
  if (!/role==='viewer'/.test(publish) || !/user_id=\$3 AND request_id=\$4/.test(publish)) errors.push('publish: role and actor receipt scope');
  const addComment = methods.get('addComment') ?? '', removeComment = methods.get('deleteComment') ?? '';
  if (!/role==='viewer'/.test(addComment)) errors.push('comment: viewer write gate');
  if (!/author_id=\$4 OR \$5/.test(removeComment) || !/p\.userId,role==='owner'/.test(removeComment)) errors.push('comment: author or owner delete');
  for (const name of ['createVote', 'closeVote', 'startTimer', 'stopTimer']) {
    if (!(methods.get(name) ?? '').includes("this.access(s,p,boardId,true)!=='owner'")) errors.push(`${name}: owner gate`);
  }
  const cast = methods.get('castVote') ?? '';
  if (!/user_id=\$4 AND request_id=\$5/.test(cast) || !/p\.userId,input\.requestId/.test(cast)) errors.push('ballot: actor receipt scope');
  return errors;
}

describe('whiteboard workshop repository permission exemption', () => {
  it('keeps tenant tables, board locks, role gates and actor-private rows bounded', () => {
    expect(audit(source)).toEqual([]);
    expect(lint).toContain('tests/whiteboard/workshop-repository-guard.test.ts');
  });
  it('rejects a workshop path that reaches content without board authorization', () => {
    const mutated = source.replace('if (!await this.access(s,p,boardId)) return null;', '/* authorization removed */');
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('comments: board authorization');
  });
  it('rejects private drafts no longer scoped to their actor', () => {
    const mutated = source.replace('AND user_id=$3\',[p.orgId,boardId,p.userId]', "',[p.orgId,boardId,p.userId]");
    expect(mutated).not.toBe(source);
    expect(audit(mutated)).toContain('draft: actor scope');
  });
  it('rejects tenant bypasses and a newly introduced table', () => {
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('))).toContain('withoutTenant');
    expect(audit(source.replace('WHERE org_id=$1 AND board_id=$2', 'WHERE board_id=$2'))).toContain('tenant SQL scope');
    expect(audit(`${source}\nvoid session.query(\`SELECT * FROM artifacts\`);`)).toContain('table scope');
  });
});
