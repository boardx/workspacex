/** Pure, fail-closed promotion identity policy. Run only from a trusted base checkout. */
export const PROMOTION_TARGETS = ['main', 'main-us'];
const SHA = /^[a-f0-9]{40}$/;
export function promotionIdentity({ eventName, repository, sha, event, candidateTree, sourceTree, mergeTree, policyUnchanged }) {
  if (!SHA.test(sha ?? '') || !SHA.test(candidateTree ?? '') || !SHA.test(sourceTree ?? '') || candidateTree !== sourceTree || policyUnchanged !== true) return null;
  const pr = event?.pull_request;
  if (eventName === 'pull_request') {
    if (!pr || pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository || pr.head.ref !== 'develop' || !PROMOTION_TARGETS.includes(pr.base.ref) || !SHA.test(pr.head.sha ?? '') || mergeTree !== candidateTree) return null;
    return { sourceSha: pr.head.sha, target: pr.base.ref };
  }
  if (eventName === 'push') {
    const target = event?.ref?.replace(/^refs\/heads\//, '');
    if (!PROMOTION_TARGETS.includes(target) || event.after !== sha || !pr || pr.merged !== true || pr.merge_commit_sha !== sha || pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository || pr.head.ref !== 'develop' || pr.base.ref !== target || !SHA.test(pr.head.sha ?? '')) return null;
    return { sourceSha: pr.head.sha, target };
  }
  return null;
}
/** Both independent workflows must attest their latest, completed current attempt. */
export function workflowEvidence({ run, currentRun, jobs, required, workflowId, path, sourceSha, now = Date.now(), maxAgeMs = 24 * 60 * 60_000 }) {
  if (!run || !currentRun || !Array.isArray(jobs) || !Array.isArray(required) || !required.length || !SHA.test(sourceSha ?? '') || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) return false;
  if (run.head_sha !== sourceSha || run.event !== 'push' || run.head_branch !== 'develop' || run.workflow_id !== workflowId || run.path !== path || run.status !== 'completed' || run.conclusion !== 'success') return false;
  const created = Date.parse(run.created_at);
  if (!Number.isFinite(created) || created > now || now - created > maxAgeMs) return false;
  for (const key of ['id', 'run_attempt', 'head_sha', 'event', 'head_branch', 'workflow_id', 'path', 'status', 'conclusion']) if (currentRun[key] !== run[key]) return false;
  return required.every(name => {
    const matches = jobs.filter(job => job.name === name);
    return matches.length === 1 && matches[0].run_id === run.id && matches[0].run_attempt === run.run_attempt && matches[0].head_sha === sourceSha && matches[0].status === 'completed' && matches[0].conclusion === 'success';
  });
}
