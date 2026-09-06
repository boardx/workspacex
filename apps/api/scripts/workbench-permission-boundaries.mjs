/** Narrow control-plane exceptions. Each admitted file is checked again on every lint
 * invocation; disclosure stays at the existing authenticated application boundary. */
export const workbenchBoundaries = new Map([
  ['src/infrastructure/artifacts-steering/accept-message-artifact-run-launcher.ts', {
    tables:['agent_runs','agent_run_artifact_context'],
    reason:'Internal continuation write path: reads only source agent identity and accepted context binding. Caller discloses the source version first; acceptHumanMessage rechecks write authority before any run creation.',
    checks:[[null,/SELECT agent_id FROM agent_runs WHERE org_id=\$1 AND id=\$2 AND thread_id=\$3/],
      [null,/await acceptHumanMessage\(this\.deps, \{ orgId,userId: input\.userId,threadId: input\.threadId/],
      ['src/application/artifacts-steering/continue-artifact.ts',/discloseDecided\([\s\S]*?if \(!isDisclosed\(disclosedVersion\)\) throw[\s\S]*?deps\.launcher\.launch/]],
  }],
  ['src/infrastructure/artifacts-steering/pg-artifact-continuation-reader.ts', {
    tables:['agent_run_artifact_context','agent_artifacts','agent_artifact_versions'],
    reason:'Executor-only input materialization of an already authorized immutable continuation. Tenant and pinned version joins constrain storage reads; no external response exposes the storage key.',
    checks:[[null,/a\.org_id=c\.org_id AND a\.id=c\.artifact_id/],
      [null,/v\.org_id=c\.org_id AND v\.artifact_id=c\.artifact_id AND v\.version=c\.based_on_version/],
      [null,/WHERE c\.org_id=\$1 AND c\.run_id=\$2/],
      ['src/application/agent-run/execute-run.ts',/artifactContinuations\?\.prepare\(orgId, run\.runId\)/]],
  }],
  ['src/infrastructure/artifacts-steering/register-run-artifacts.ts', {
    tables:['agent_run_artifact_context','agent_artifacts','agent_artifact_versions','agent_run_steps','chat_message_attachments','agent_runs','chat_messages'],
    reason:'Internal writeback transaction helper; only registers actual attachments from the same tenant/thread/message/object key. Public artifact/version disclosure remains in read-artifact and its guarded repository.',
    checks:[[null,/WHERE org_id=\$1 AND thread_id=\$2 AND message_id=\$3 AND storage_ref=\$4/],
      [null,/JOIN chat_messages m ON m\.org_id=r\.org_id AND m\.id=r\.input_message_id WHERE r\.org_id=\$2 AND r\.id=\$5/],
      ['src/infrastructure/agent-run/pg-agent-run-repository.ts',/await registerRunArtifacts\(s, \{ orgId, runId: input\.runId, threadId: input\.threadId, messageId/]],
  }],
  ['src/infrastructure/agent-run/pg-interjection-store.ts', {
    tables:['agent_run_interjections','agent_runs'],
    reason:'Run-owned FIFO control state. Public list is behind the existing guarded run read; kernel poll authenticates its service key. No new ACL object is invented.',
    checks:[['src/interface/controllers/agent-run.controller.ts',/async interjectionStatus[\s\S]*?await this\.run\(principal,\s*runId\);\s*return \{items:await this\.interjections\.listPublic/],
      ['src/interface/controllers/run-interjection.controller.ts',/async poll\([\s\S]*?this\.assertInternalKey\(key\);[\s\S]*?this\.runs\.findLocator[\s\S]*?this\.queue\.pollForKernel/],
      [null,/WHERE i\.org_id=\$1 AND i\.run_id=\$2/]],
  }],
  ['src/infrastructure/agent-run/pg-parent-run-control.ts', {
    tables:['agent_runs','agent_run_steps'],
    reason:'Reads facts from which cancellation and tool authorization decisions are made. Returns authority decisions, never content; guarding those facts with the decision would be circular.',
    checks:[[null,/FROM agent_runs r WHERE r\.org_id=\$1 AND r\.id=\$2 FOR UPDATE OF r/],
      [null,/r\.lease_epoch=\$3 AND r\.lease_expires_at>now\(\)/],
      ['src/interface/controllers/run-interjection.controller.ts',/async checkTool\([\s\S]*?this\.assertInternalKey\(key\);[\s\S]*?this\.authority\.check/]],
  }],
  ['src/infrastructure/agent-run/pg-run-recovery.ts', {
    tables:['agent_runs','agent_run_steps'],
    reason:'System-only lease reconciliation, no requesting user and no returned tenant content. Existing remote runs are read, outputs reenter the guarded run writeback.',
    checks:[[null,/WHERE r\.org_id=\$1/],[null,/FOR UPDATE SKIP LOCKED/],[null,/await withRunLease\(/],[null,/reconcileExistingRun\(/],[null,/return candidates\.length;/]],
  }],
  ['src/infrastructure/chat-queue/thread-message-queue.ts', {
    tables:['thread_message_queue','agent_runs','chat_threads'],
    reason:'Actor-owned pending input is not an ACL artifact. Every browser operation authorizes the actual thread and scopes actor_id; dispatch reuses acceptHumanMessage to recheck current permissions. The only global scan returns tenant IDs, not messages.',
    checks:[[null,/async list\([\s\S]*?await this\.authorize\(orgId,userId,threadId\);/],
      [null,/async enqueue\([\s\S]*?await this\.authorize\(orgId,userId,threadId,true\);/],
      [null,/async cancel\([\s\S]*?await this\.authorize\(orgId,userId,threadId,true\);/],
      [null,/resolveVisibility\(this\.deps,\{orgId,userId,threadId,projectId:facts\.projectId\}\)/],
      [null,/WHERE org_id=\$1 AND thread_id=\$2 AND actor_id=\$3/],
      [null,/await acceptHumanMessage\(this\.deps,\{orgId,userId:row\.actor_id,threadId:row\.thread_id/]],
  }],
  ['src/infrastructure/db/pg-database.ts', {
    tables:['agent_runs'],
    reason:'Lease fencing reads only the current run identity inside the transaction and never returns the row. This is infrastructure for enforcing ownership, not a content read API.',
    checks:[[null,/SELECT id FROM agent_runs WHERE org_id=\$1 AND id=\$2\s+AND lease_epoch=\$3 AND lease_expires_at>now\(\) FOR UPDATE/],
      [null,/if\(!ownership\.rows\.length\)throw new RunLeaseLostError\(\)/],
      [null,/set_config\('app.current_org', \$1, true\)/]],
  }],
]);

export function verifyWorkbenchBoundaries(read, tenantTables) {
  const failures=[];
  for(const [path,rule] of workbenchBoundaries){
    const source=read(path);
    for(const match of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) {
      const table=match[1].toLowerCase();
      if(tenantTables.has(table)&&!rule.tables.includes(table)) failures.push(`${path}: unexpected tenant table ${table}`);
    }
    if(path!=='src/infrastructure/db/pg-database.ts'&&path!=='src/infrastructure/chat-queue/thread-message-queue.ts'&&source.includes('.withoutTenant(')) failures.push(`${path}: global read is forbidden`);
    if(path.includes('chat-queue') && [...source.matchAll(/\.withoutTenant\(/g)].length!==1) failures.push(`${path}: global scan must be the single tenant-ID discovery`);
    if(path.includes('chat-queue')) {
      const browserOperations=source.slice(0,source.indexOf('  async pump('));
      for(const query of browserOperations.matchAll(/`([^`]+)`/g)) {
        if(/\b(?:SELECT|UPDATE)\b/i.test(query[1]) && /thread_message_queue/.test(query[1]) && !/actor_id=\$3/.test(query[1])) failures.push(`${path}: browser queue read/mutation lost actor scope`);
      }
    }
    for(const [file,pattern] of rule.checks)if(!pattern.test(file?read(file):source))failures.push(`${path}: authority invariant missing (${file??path}: ${pattern})`);
  }
  return failures;
}
