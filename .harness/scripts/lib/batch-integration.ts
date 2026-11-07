import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export function manifestDigest(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function gitAt(cwd: string, args: string[], input?: string): string { return execFileSync('git', args, { cwd, input, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }).trim(); }
/** Object-only construction: never changes the user's index, checkout or refs. */
export function prepareCandidate(cwd: string, base: string, heads: string[]): {
    commit: string;
    tree: string;
} {
    if (heads.length < 1 || heads.length > 3 || new Set(heads).size !== heads.length)
        throw new Error('Expected one to three distinct heads');
    for (const sha of [base, ...heads])
        if (!/^[a-f0-9]{40}$/.test(sha))
            throw new Error('Immutable full SHA required');
    let current = base;
    for (const head of heads) {
        const tree = gitAt(cwd, ['merge-tree', '--write-tree', current, head]).split('\n')[0];
        current = gitAt(cwd, ['-c', 'user.name=WorkspaceX Batch', '-c', 'user.email=batch@workspacex.invalid', 'commit-tree', tree, '-p', current, '-p', head], `Integrate frozen batch member ${head}\n`);
    }
    return { commit: current, tree: gitAt(cwd, ['rev-parse', `${current}^{tree}`]) };
}
export interface BatchMember {
    number: number;
    head: string;
    base: string;
    repository: string;
    draft: boolean;
    queued: boolean;
    approved: boolean;
    ready: boolean;
    paths: string[];
}
export function validateMembers(members: BatchMember[], repository: string): void {
    if (!members.length || members.length > 3 || new Set(members.map(m => m.number)).size !== members.length)
        throw new Error('Expected one to three distinct PRs');
    for (const m of members) {
        if (!Number.isSafeInteger(m.number) || m.number < 1 || !/^[a-f0-9]{40}$/.test(m.head) || m.repository !== repository || m.base !== 'develop' || m.draft || m.queued || !m.approved || !m.ready)
            throw new Error(`Ineligible member #${m.number}`);
        // Pilot is deliberately allowlisted. All control plane, identity, database and config changes stay standalone.
        if (!m.paths.length || m.paths.some(p => !/^apps\/web\/(components|app)\/.+\.(tsx|css)$/.test(p) || /(auth|identity|security|migration|schema|config|api)(\/|\.)/i.test(p)))
            throw new Error(`Standalone risk scope #${m.number}`);
    }
}
export function splitFailure(digest: string, members: BatchMember[]) { return { rejectedDigest: digest, blockedHeads: members.length === 1 ? members.map(m => m.head) : [], groups: members.length === 1 ? [] : members.map(m => [m.number]), action: members.length === 1 ? 'fix singleton before retry' : 'prepare each singleton with fresh eligibility; do not retry rejected digest' }; }
import { classifyChecks, type CheckPolicy } from './pr-queue';
import { reconstructMergeTimeChecks } from './pr-green';
/** GitHub-native merge proof; release promotion remains a separate admission gate. */
export function verifyQueueMerge(p: any, policy: CheckPolicy): void {
    if (p.parents.length !== 2 || p.parents[1] !== p.head || p.actualTree !== p.tree || p.associated.length !== 1 || p.associated[0] !== p.pr)
        throw new Error('Merged identity/tree/association mismatch');
    const deadline = Date.parse(p.mergedAt);
    if (!Number.isFinite(deadline) || !/^github-merge-queue(?:\[bot\])?$/.test(p.mergedBy ?? ''))
        throw new Error('Missing native merge identity/time');
    if (!p.runs.length || new Set(p.runs.map((r: any) => `${r.id}:${r.run_attempt}`)).size !== p.runs.length)
        throw new Error('Missing/duplicate queue runs');
    for (const r of p.runs) {
        if (!Number.isSafeInteger(r.id) || r.id < 1 || !Number.isSafeInteger(r.workflow_id) || r.workflow_id < 1 || r.event !== 'merge_group' || r.head_sha !== p.source || r.repository?.full_name !== p.repository || !new RegExp(`^gh-readonly-queue/develop/pr-${p.pr}-[a-f0-9]{7,40}$`).test(r.head_branch) || !Number.isSafeInteger(r.run_attempt) || r.run_attempt < 1 || r.status !== 'completed' || r.conclusion !== 'success' || !Number.isFinite(Date.parse(r.run_started_at)) || Date.parse(r.run_started_at) > deadline || !Number.isFinite(Date.parse(r.updated_at)) || Date.parse(r.updated_at) > deadline)
            throw new Error('Invalid queue run');
        const jobs = p.jobs.filter((j: any) => j.run_id === r.id && j.run_attempt === r.run_attempt);
        if (!jobs.length || jobs.some((j: any) => j.run_attempt !== r.run_attempt || j.head_sha !== p.source || j.status !== 'completed' || !Number.isSafeInteger(j.id) || !Number.isFinite(Date.parse(j.started_at)) || !Number.isFinite(Date.parse(j.completed_at)) || Date.parse(j.started_at) < Date.parse(r.run_started_at) || Date.parse(j.completed_at) > deadline))
            throw new Error('Invalid current-attempt jobs');
    }
    if (p.jobs.some((j: any) => !p.runs.some((r: any) => j.run_id === r.id && j.run_attempt === r.run_attempt)))
        throw new Error('Unbound job identity');
    const checks = reconstructMergeTimeChecks(p.jobs.map((j: any) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, startedAt: j.started_at, completedAt: j.completed_at })), p.mergedAt);
    const result = classifyChecks(checks, policy);
    if (result.blocked.length || result.changes.length || result.waitingCi.length)
        throw new Error('Queue CI incomplete: ' + JSON.stringify(result));
}
/** Tree equality alone cannot exclude extra, unreviewed history. */
export function verifyCandidateParents(cwd: string, base: string, heads: string[], candidate: string): void {
    let current = candidate;
    for (const head of [...heads].reverse()) {
        const parents = gitAt(cwd, ['show', '-s', '--format=%P', current]).split(' ');
        if (parents.length !== 2 || parents[1] !== head)
            throw new Error('Candidate parent chain differs from ordered manifest');
        current = parents[0];
    }
    if (current !== base)
        throw new Error('Candidate parent chain differs from frozen base');
}
