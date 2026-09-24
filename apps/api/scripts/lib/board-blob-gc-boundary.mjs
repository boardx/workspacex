import ts from 'typescript';
import { createHash } from 'node:crypto';

export const BOARD_BLOB_GC_REFERENCE_PATH = 'src/infrastructure/whiteboard/pg-board-blob-reference-guard.ts';
export const BOARD_BLOB_GC_COORDINATOR_PATH = 'src/infrastructure/whiteboard/pg-board-blob-sweep-coordinator.ts';
export const BOARD_BLOB_GC_BOUNDARIES = new Set([BOARD_BLOB_GC_REFERENCE_PATH, BOARD_BLOB_GC_COORDINATOR_PATH]);

const SPECS = {
  [BOARD_BLOB_GC_REFERENCE_PATH]: {
    hashes: ['52d41b07fc6fb6baf0ef4ab93c81b89753babf9ad34327591f18c48728774f92','11f471583b364248c3a22548ba186800af8d2a4c05ee0657c13d5051d01a20a9'],
    params: ['[input.tenantId,input.boardId]','[input.tenantId,input.boardId]'],
  },
  [BOARD_BLOB_GC_COORDINATOR_PATH]: {
    hashes: ['82d576868505568edd10969d95541f25e64688a80a6f4a9faf9d9f28996d6f92','1e6aad8d826fad97098668f16aa28e200de1c746fbde8d85628a91701af4c51e','177eeafe9e2016fe65259d24c104f8c4b0b006f5e2ad6b7838fde763991f1c5b'],
    params: ['[`board-blob-gc:${input.tenantId}:${input.boardId}`]','[input.tenantId,input.boardId]','[input.tenantId,input.boardId,started.toISOString(),finished.toISOString(),durationMs,result.examined,result.deleted,result.retained,result.changed,result.nextCursor??null]'],
  },
};

const digest = value => createHash('sha256').update(value.replace(/\s+/g,' ').trim()).digest('hex');

export function checkBoardBlobGcBoundary(path, source) {
  const spec = SPECS[path];
  if (!spec) return ['unknown Board blob GC boundary'];
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), calls = [], errors = [];
  const compact = node => node?.getText(ast).replace(/\s+/g,'');
  function visit(node) { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); } visit(ast);
  const queries = calls.filter(node => ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query');
  const actual = queries.map(node => {
    const sql = node.arguments[0];
    return {
      hash: sql && (ts.isStringLiteralLike(sql) || ts.isNoSubstitutionTemplateLiteral(sql)) ? digest(sql.text) : '',
      params: compact(node.arguments[1]),
    };
  });
  if (actual.length !== spec.hashes.length || actual.some((query, index) => query.hash !== spec.hashes[index] || query.params !== spec.params[index])) {
    errors.push('fixed tenant-scoped metadata SQL and parameter binding changed');
  }
  const tenant = calls.find(node => compact(node.expression) === 'this.db.withTenant');
  if (!tenant || compact(tenant.arguments[0]) !== 'toOrgId(input.tenantId)' || source.includes('.withoutTenant(')) {
    errors.push('tenant transaction boundary changed');
  }
  if (/\b(snapshot|ciphertext|plaintext)\b/i.test(source)) errors.push('Board content crossed the metadata-only boundary');
  if (path === BOARD_BLOB_GC_REFERENCE_PATH) {
    const lock = source.indexOf('FOR UPDATE'), roots = source.indexOf('whiteboard_blob_retention_roots'), inspect = source.indexOf('return inspect(');
    if (lock < 0 || roots < lock || inspect < roots || !source.includes("root_kind='legal_hold' OR retain_until>now()")) {
      errors.push('writer lock or backup/legal-hold root coverage changed');
    }
  } else {
    const lease = source.indexOf("if (!lease.rows[0]?.acquired)"), cadence = source.indexOf('started.getTime() - new Date(prior.rows[0].last_finished_at).getTime() < this.policy.minIntervalMs'),
      sweep = source.indexOf('const result = await this.sweep.run'), metrics = source.indexOf('INSERT INTO whiteboard_blob_gc_runs');
    if (lease < 0 || cadence < lease || sweep < cadence || metrics < sweep
      || !source.includes('input.cursor ?? prior.rows[0]?.next_cursor ?? undefined')
      || !source.includes('limit: this.policy.batchSize')) errors.push('lease, cadence, cursor or bounded sweep ordering changed');
  }
  return errors;
}
