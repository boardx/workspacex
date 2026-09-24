import { createHash } from 'node:crypto';
import ts from 'typescript';

export const BOARD_BLOB_GC_REFERENCE_PATH = 'src/infrastructure/whiteboard/pg-board-blob-reference-guard.ts';
export const BOARD_BLOB_GC_COORDINATOR_PATH = 'src/infrastructure/whiteboard/pg-board-blob-sweep-coordinator.ts';
export const BOARD_BLOB_GC_BOUNDARIES = new Set([BOARD_BLOB_GC_REFERENCE_PATH, BOARD_BLOB_GC_COORDINATOR_PATH]);

const SPECS = {
  [BOARD_BLOB_GC_REFERENCE_PATH]: {
    className: 'PgBoardBlobReferenceGuard', methodName: 'withLockedManifestRoots',
    sourceHash: 'e19db9adf1b4c8bb64a9ba7ab5337810b3d202df1fd007720d075158eb4770cc',
    methodHash: '7565d9f023441d490edfd02c267b944aa078bacf7a930ba168178845866d2e8c',
    queries: [
      ['52d41b07fc6fb6baf0ef4ab93c81b89753babf9ad34327591f18c48728774f92', '[input.tenantId,input.boardId]'],
      ['11f471583b364248c3a22548ba186800af8d2a4c05ee0657c13d5051d01a20a9', '[input.tenantId,input.boardId]'],
    ],
  },
  [BOARD_BLOB_GC_COORDINATOR_PATH]: {
    className: 'PgBoardBlobSweepCoordinator', methodName: 'run',
    sourceHash: 'dc71d361d23bbd22c835077d6b3ba49821f94792d0f2c98e6471a1485ecd78c8',
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

function findAuditedClass(ast, spec) {
  const matches = [];
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name?.text === spec.className) matches.push(node);
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
  if (digest(printer.printFile(ast)) !== spec.sourceHash) errors.push('audited GC SourceFile AST changed; re-audit imports, class initialization and methods');
  const classes = findAuditedClass(ast, spec);
  if (classes.length !== 1) return [...errors, 'audited GC class is missing or duplicated'];
  const auditedClass = classes[0];
  const methods = auditedClass.members.filter(member => ts.isMethodDeclaration(member) && member.name.getText(ast) === spec.methodName);
  if (methods.length !== 1) return [...errors, 'audited GC method is missing or duplicated'];
  const method = methods[0];
  const normalizedMethod = printer.printNode(ts.EmitHint.Unspecified, method, ast);
  if (digest(normalizedMethod) !== spec.methodHash) errors.push('audited GC method AST changed; re-audit its complete transaction and control flow');

  const orgImports = ast.statements.filter(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '../../domain/org-id');
  const binding = orgImports[0]?.importClause?.namedBindings;
  const exactToOrgIdImport = orgImports.length === 1 && !orgImports[0].importClause?.isTypeOnly
    && binding && ts.isNamedImports(binding) && binding.elements.length === 1
    && binding.elements[0].name.text === 'toOrgId' && !binding.elements[0].propertyName && !binding.elements[0].isTypeOnly;
  let toOrgIdShadowed = false;
  function findShadow(node) {
    if (node !== binding?.elements[0] && 'name' in node && node.name && ts.isIdentifier(node.name) && node.name.text === 'toOrgId'
      && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node)
        || ts.isParameter(node) || ts.isFunctionExpression(node))) toOrgIdShadowed = true;
    ts.forEachChild(node, findShadow);
  }
  findShadow(ast);
  if (!exactToOrgIdImport || toOrgIdShadowed) errors.push('toOrgId must be the exact unaliased domain import with no local shadow');

  const allQueries = [], methodQueries = [], illegalWrites = [];
  let computedQuery = false;
  function visit(node, insideMethod = false, insideClass = false) {
    const inMethod = insideMethod || node === method, inClass = insideClass || node === auditedClass;
    if (isDirectSessionQuery(node)) { allQueries.push(node); if (inMethod) methodQueries.push(node); }
    if (isComputedQuery(node)) computedQuery = true;
    if (inClass) {
      const target = writeTarget(node, ast);
      if (target && (target === 'input' || target.startsWith('input.') || target === 'this.policy'
        || target.startsWith('this.policy.') || target === 'result' || target.startsWith('result.'))) illegalWrites.push(target);
    }
    ts.forEachChild(node, child => visit(child, inMethod, inClass));
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
