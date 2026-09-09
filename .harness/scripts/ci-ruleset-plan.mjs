/** Render a reviewable ruleset update; this tool never writes to GitHub. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CURRENT_POLICY } from './lib/ci-check-policy.mjs';

export function rulesetPlan(current, actionsAppId, requiredChecks = CURRENT_POLICY.requiredChecks) {
  if (!Number.isInteger(actionsAppId) || actionsAppId <= 0 || !current?.name || !current.conditions || !Array.isArray(current.rules)) throw new Error('Missing verified ruleset or Actions app identity');
  if (current.rules.some(rule => rule.type === 'required_status_checks' || rule.type === 'pull_request')) throw new Error('Existing merge rules require explicit reconciliation');
  if ((current.bypass_actors ?? []).length) throw new Error('Versioned history requires a ruleset without bypass actors');
  return {
    name: current.name, target: 'branch', enforcement: 'active',
    bypass_actors: current.bypass_actors ?? [], conditions: current.conditions,
    rules: [...current.rules,
      { type: 'pull_request', parameters: { allowed_merge_methods: CURRENT_POLICY.allowedMergeMethods, required_approving_review_count: 0, require_extra_approval_for_unattributed_changes: true, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: true } },
      { type: 'required_status_checks', parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: requiredChecks.map(context => ({ context, integration_id: actionsAppId })),
      } },
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(rulesetPlan(JSON.parse(readFileSync(process.argv[2], 'utf8')), Number(process.argv[3])), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
