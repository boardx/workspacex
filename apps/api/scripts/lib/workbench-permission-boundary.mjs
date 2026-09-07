import ts from 'typescript';

/** Recognize two specific existing boundaries, not arbitrary guard imports. */
export const WORKBENCH_BOUNDARIES = new Set([
  'src/infrastructure/chat-queue/thread-message-queue.ts',
  'src/infrastructure/db/pg-database.ts',
]);
export function checkWorkbenchPermissionBoundary(path, source) {
  const errors = [];
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const methods = new Map();
  const queries = [];
  const visit = node => {
    if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.body?.getText(ast) ?? '');
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) queries.push(arg.text);
      else if (!path.endsWith('pg-database.ts')) errors.push('queue SQL must be static');
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  if (path.endsWith('pg-database.ts')) {
    const ownership = queries.filter(q => /\bFROM\s+agent_runs\b/i.test(q));
    if (ownership.length !== 1 || !/^SELECT id FROM agent_runs WHERE org_id=\$1 AND id=\$2\s+AND lease_epoch=\$3 AND lease_expires_at>now\(\) FOR UPDATE$/.test(ownership[0])) errors.push('lease query must disclose only id under exact tenant/epoch/expiry fencing');
    if (!/if\(orgId!==lease.orgId\)throw new RunLeaseLostError\(\)/.test(source)
      || !/if\(!ownership.rows.length\)throw new RunLeaseLostError\(\)/.test(source)) errors.push('lease rejection missing');
    const tenantSql = queries.filter(q => /\b(?:FROM|JOIN)\s+(?!(?:agent_runs|_kernel_migrations|pg_class|pg_namespace)\b)\w+/i.test(q));
    if (tenantSql.length) errors.push('database boundary gained another row query');
    return errors;
  }
  for (const name of methods.keys()) if (!['constructor','onModuleInit','onModuleDestroy','authorize','list','enqueue','cancel','pump'].includes(name)) errors.push(`new queue method requires review: ${name}`);
  const auth = methods.get('authorize') ?? '';
  if (!/await resolveVisibility\(this.deps,\{orgId,userId,threadId,projectId:facts.projectId\}\)/.test(auth)
      || !/access.kind!=="allow"/.test(auth) || !/access.actor.projectRole==="observer"/.test(auth)
      || !/access.thread.archived/.test(auth) || !/throw new QueueNotVisibleError\(\)/.test(auth)) errors.push('queue visibility/write decision missing');
  for (const method of ['list','enqueue','cancel']) {
    const body = methods.get(method) ?? '';
    const expected = `await this.authorize(orgId,userId,threadId${method === 'list' ? '' : ',true'});`;
    if (!body.trimStart().startsWith('{\n    ' + expected)) errors.push(`${method} must authorize before any operation`);
  }
  const pump = methods.get('pump') ?? '';
  if (!/await acceptHumanMessage\(this.deps,\{orgId,userId:row.actor_id,threadId:row.thread_id,/.test(pump)
      || !/queuedMessageId:row.id/.test(pump)) errors.push('pump must reauthorize the persisted actor through acceptance');
  for (const sql of queries) {
    if (sql === 'SELECT org_id FROM kernel_message_queue_orgs()') continue;
    if (!/\borg_id(?:\s*=|\s*,)/i.test(sql)) errors.push('queue SQL lacks tenant scope');
    for (const [,table] of sql.replace(/FOR UPDATE/gi,'').matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) {
      if (!['thread_message_queue','agent_runs','chat_threads'].includes(table)) errors.push(`unexpected table ${table}`);
    }
  }
  return errors;
}
