import { createHash } from 'node:crypto';
import ts from 'typescript';

export const BOARD_BLOB_GC_REFERENCE_PATH = 'src/infrastructure/whiteboard/pg-board-blob-reference-guard.ts';
export const BOARD_BLOB_GC_COORDINATOR_PATH = 'src/infrastructure/whiteboard/pg-board-blob-sweep-coordinator.ts';
export const BOARD_BLOB_GC_BOUNDARIES = new Set([BOARD_BLOB_GC_REFERENCE_PATH, BOARD_BLOB_GC_COORDINATOR_PATH]);

const SPECS = {
  [BOARD_BLOB_GC_REFERENCE_PATH]: {
    className: 'PgBoardBlobReferenceGuard', methodName: 'withLockedManifestRoots',
    methodHash: '7565d9f023441d490edfd02c267b944aa078bacf7a930ba168178845866d2e8c',
    queries: [
      ['52d41b07fc6fb6baf0ef4ab93c81b89753babf9ad34327591f18c48728774f92', '[input.tenantId,input.boardId]'],
      ['11f471583b364248c3a22548ba186800af8d2a4c05ee0657c13d5051d01a20a9', '[input.tenantId,input.boardId]'],
    ],
  },
  [BOARD_BLOB_GC_COORDINATOR_PATH]: {
    className: 'PgBoardBlobSweepCoordinator', methodName: 'run',
    methodHash: 'ab54ba48f76d5c054f9b5849a6341dc13c1a7a14eb28764fcce4132a4b589d62',
    queries: [
      ['82d576868505568edd10969d95541f25e64688a80a6f4a9faf9d9f28996d6f92', '[`board-blob-gc:${input.tenantId}:${input.boardId}`]'],
      ['1e6aad8d826fad97098668f16aa28e200de1c746fbde8d85628a91701af4c51e', '[input.tenantId,input.boardId]'],
      ['177eeafe9e2016fe65259d24c104f8c4b0b006f5e2ad6b7838fde763991f1c5b', '[input.tenantId,input.boardId,started.toISOString(),finished.toISOString(),durationMs,result.examined,result.deleted,result.retained,result.changed,result.nextCursor??null]'],
    ],
  },
};

const digest = value => createHash('sha256').update(value).digest('hex');
const sqlDigest = value => digest(value.replace(/\s+/g, ' ').trim());
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function findAuditedMethod(ast, spec) {
  const matches = [];
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name?.text === spec.className) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name.getText(ast) === spec.methodName) matches.push(member);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return matches;
}

function isDirectSessionQuery(node) {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'session'
    && node.expression.name.text === 'query';
}

function isComputedQuery(node) {
  return ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)
    && node.expression.argumentExpression && ts.isStringLiteralLike(node.expression.argumentExpression)
    && node.expression.argumentExpression.text === 'query';
}

function writeTarget(node, ast) {
  if (ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind)) return node.left.getText(ast).replace(/\s+/g, '');
  if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
    return node.operand.getText(ast).replace(/\s+/g, '');
  }
  return undefined;
}

export function checkBoardBlobGcBoundary(path, source) {
  const spec = SPECS[path];
  if (!spec) return ['unknown Board blob GC boundary'];
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errors = ast.parseDiagnostics.length ? ['Board blob GC boundary has TypeScript parse errors'] : [];
  const methods = findAuditedMethod(ast, spec);
  if (methods.length !== 1) return [...errors, 'audited GC method is missing or duplicated'];
  const method = methods[0];
  const normalizedMethod = printer.printNode(ts.EmitHint.Unspecified, method, ast);
  if (digest(normalizedMethod) !== spec.methodHash) errors.push('audited GC method AST changed; re-audit its complete transaction and control flow');

  const allQueries = [], methodQueries = [], illegalWrites = [];
  let computedQuery = false;
  function visit(node, insideMethod = false) {
    const inMethod = insideMethod || node === method;
    if (isDirectSessionQuery(node)) { allQueries.push(node); if (inMethod) methodQueries.push(node); }
    if (isComputedQuery(node)) computedQuery = true;
    if (inMethod) {
      const target = writeTarget(node, ast);
      if (target && (target === 'input' || target.startsWith('input.') || target === 'this.policy'
        || target.startsWith('this.policy.') || target === 'result' || target.startsWith('result.'))) illegalWrites.push(target);
    }
    ts.forEachChild(node, child => visit(child, inMethod));
  }
  visit(ast);
  if (computedQuery || allQueries.length !== methodQueries.length) errors.push('all database reads must be direct session.query calls inside the audited method');
  if (illegalWrites.length) errors.push(`audited inputs, policy and sweep result are immutable: ${illegalWrites.join(', ')}`);

  const actual = methodQueries.map(node => {
    const sql = node.arguments[0];
    return [sql && ts.isNoSubstitutionTemplateLiteral(sql) ? sqlDigest(sql.text) : '',
      node.arguments[1]?.getText(ast).replace(/\s+/g, '') ?? ''];
  });
  if (actual.length !== spec.queries.length || actual.some((query, index) =>
    query[0] !== spec.queries[index][0] || query[1] !== spec.queries[index][1])) {
    errors.push('metadata-only SQL allowlist, direct query syntax or tenant parameter binding changed');
  }
  return errors;
}
