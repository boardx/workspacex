/** Explicit pilot: prepare <receipt> <pr...> | open <receipt> | status <receipt>.
 * Never enqueues, merges, closes originals or projects their checks. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { classifyPr, classifyChecks, statusContextToCheck, parseClosesIssues, parseRefsIssues } from './lib/pr-queue';
import { loadCommitPolicy } from './lib/ci-check-policy.mjs';
import { gitAt, manifestDigest, prepareCandidate, verifyCandidateParents, verifyQueueMerge, validateMembers, splitFailure, type BatchMember } from './lib/batch-integration';
const cwd = process.cwd();
function pages(endpoint: string, key?: string): any[] {
    const result = [];
    for (let page = 1; page <= 20; page++) {
        const data = gh(['api', `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`]);
        const items = key ? data[key] : data;
        if (!Array.isArray(items))
            throw new Error('Invalid paginated API response');
        result.push(...items);
        if (items.length < 100)
            return result;
    }
    throw new Error('Pagination limit exceeded');
}
function ledgerPath() { return gitAt(cwd, ['rev-parse', '--git-path', 'batch-integration-rejections.json']); }
function ledger(): {
    digests: string[];
    heads: string[];
} { const p = ledgerPath(); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { digests: [], heads: [] }; }
function reject(r: Receipt) { r.rejected = splitFailure(r.digest, r.members); const l = ledger(); l.digests = [...new Set([...l.digests, composition(r)])]; l.heads = [...new Set([...l.heads, ...r.rejected.blockedHeads])]; persist(ledgerPath(), l as any); }
function composition(r: Receipt) { return manifestDigest({ base: r.base, members: r.members.map(m => ({ number: m.number, head: m.head })) }); }
function assertNotRejected(r: Receipt) {
    const refs = [`refs/tags/batch-rejected/${composition(r)}`, ...r.members.map(m => `refs/tags/batch-rejected-head/${m.head}`)];
    if (gitAt(cwd, ['ls-remote', 'origin', ...refs]))
        throw new Error('Rejected combination/singleton head on remote');
    const l = ledger();
    if (l.digests.includes(composition(r)) || r.members.some(m => l.heads.includes(m.head)))
        throw new Error('Rejected combination/singleton head; fix before retry');
}
const gh = (args: string[]) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));
const repository = () => gh(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner as string;
const fields = 'number,author,body,state,isDraft,headRefOid,headRepositoryOwner,headRepository,baseRefName,mergeStateStatus,mergeable,reviewDecision,labels,statusCheckRollup,reviews,files,url';
function view(n: number) {
    const p = gh(['pr', 'view', String(n), '--json', fields]);
    const [owner, name] = repository().split('/');
    p.mergeQueueEntry = gh(['api', 'graphql', '-f', `query=query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${n}) { mergeQueueEntry { id headCommit { oid } } } } }`]).data.repository.pullRequest.mergeQueueEntry;
    return p;
}
function policyAt(sha: string) { return loadCommitPolicy(sha, (cmd: string) => { const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', timeout: 30000 }); return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }; }); }
function member(p: any, repo: string, policy: any): BatchMember {
    const checks = p.statusCheckRollup.map((c: any) => c.name ? { name: c.name, status: c.status, conclusion: c.conclusion } : statusContextToCheck(c.context, c.state));
    const classification = classifyPr({ number: p.number, author: p.author.login, isDraft: p.isDraft, headSha: p.headRefOid, closesIssues: parseClosesIssues(p.body ?? ''), refsIssues: parseRefsIssues(p.body ?? ''), mergeStateStatus: p.mergeStateStatus, checks, verdictLabels: p.labels.map((l: any) => l.name), formalReviews: p.reviews.map((r: any) => ({ author: r.author?.login, state: r.state, commit: r.commit?.oid })) }, policy);
    return { number: p.number, head: p.headRefOid, base: p.baseRefName, repository: `${p.headRepositoryOwner.login}/${p.headRepository.name}`, draft: p.isDraft, queued: !!p.mergeQueueEntry, approved: p.reviewDecision === 'APPROVED' && p.reviews.some((r: any) => r.state === 'APPROVED' && r.commit?.oid === p.headRefOid && r.author?.login !== p.author.login), ready: p.state === 'OPEN' && p.mergeable === 'MERGEABLE' && classification.state === 'READY_TO_MERGE', paths: p.files.map((f: any) => f.path).sort() };
}
interface Receipt {
    version: 1;
    repository: string;
    base: string;
    members: BatchMember[];
    candidate: {
        commit: string;
        tree: string;
    };
    digest: string;
    branch: string;
    createdAt: string;
    pr?: number;
    rejected?: ReturnType<typeof splitFailure>;
    receiptTag?: string;
    mergeEvidence?: unknown;
    queueSnapshot?: any;
}
function core(r: Receipt) { return { version: r.version, repository: r.repository, base: r.base, members: r.members, candidate: r.candidate }; }
function persist(path: string, r: Receipt) { const temp = path + `.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(r, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, path); }
function read(path: string): Receipt {
    const r = JSON.parse(readFileSync(path, 'utf8'));
    if (r.version !== 1 || manifestDigest(core(r)) !== r.digest || r.branch !== `codex/batch-${r.digest.slice(0, 20)}`)
        throw new Error('Invalid receipt digest');
    return r;
}
function base(repo: string) { return gh(['api', `repos/${repo}/git/ref/heads/develop`]).object.sha as string; }
function fetch(repo: string, sha: string) { gitAt(cwd, ['fetch', '--no-tags', `https://github.com/${repo}.git`, sha]); }
function fresh(r: Receipt) {
    assertNotRejected(r);
    verifyCandidateParents(cwd, r.base, r.members.map(m => m.head), r.candidate.commit);
    if (repository() !== r.repository || base(r.repository) !== r.base)
        throw new Error('Repository/base changed; prepare fresh receipt');
    const policy = policyAt(r.base);
    const live = r.members.map(m => member(view(m.number), r.repository, policy));
    validateMembers(live, r.repository);
    if (manifestDigest(live) !== manifestDigest(r.members))
        throw new Error('Member facts changed; prepare fresh receipt');
    if (gitAt(cwd, ['rev-parse', `${r.candidate.commit}^{tree}`]) !== r.candidate.tree)
        throw new Error('Candidate tree mismatch');
    const actual = gitAt(cwd, ['diff', '--name-only', r.base, r.candidate.commit]).split('\n').filter(Boolean).sort();
    const union = [...new Set(r.members.flatMap(m => m.paths))].sort();
    if (JSON.stringify(actual) !== JSON.stringify(union))
        throw new Error('Candidate path union mismatch');
    for (const m of r.members)
        gitAt(cwd, ['merge-base', '--is-ancestor', m.head, r.candidate.commit]);
    if (prepareCandidate(cwd, r.base, r.members.map(m => m.head)).tree !== r.candidate.tree)
        throw new Error('Candidate differs from exact ordered merge');
    const active = gh(['pr', 'list', '--repo', r.repository, '--state', 'open', '--base', 'develop', '--limit', '1000', '--json', 'number,body']);
    if (active.some((p: any) => p.number !== r.pr && r.members.some(m => p.body.includes(`Batch member #${m.number} @`))))
        throw new Error('Member already in active integration PR');
}
function seal(r: Receipt) {
    const tagName = `batch-receipt/${r.digest}`;
    const object = gitAt(cwd, ['mktag'], `object ${r.candidate.commit}\ntype commit\ntag ${tagName}\ntagger WorkspaceX Batch <batch@workspacex.invalid> 0 +0000\n\n${JSON.stringify(core(r))}\n`);
    if (r.receiptTag && r.receiptTag !== object)
        throw new Error('Receipt seal changed');
    r.receiptTag = object;
    return { object, ref: `refs/tags/${tagName}` };
}
function verifySeal(r: Receipt) {
    const sealed = seal(r);
    const remote = gitAt(cwd, ['ls-remote', 'origin', sealed.ref]).split(/\s+/)[0];
    if (remote !== sealed.object)
        throw new Error('Remote immutable receipt missing/changed');
}
const marker = (r: Receipt) => `<!-- batch-integration:${r.digest} -->`;
async function main() {
    const [action, path, ...numbers] = process.argv.slice(2);
    if (!path)
        throw new Error('Usage: prepare <new-receipt.json> <PR...> | open/status <receipt.json>');
    if (action === 'prepare') {
        if (existsSync(path))
            throw new Error('Receipt exists; use a new path');
        const repo = repository(), baseSha = base(repo);
        fetch(repo, baseSha);
        const policy = policyAt(baseSha);
        const members = numbers.map(n => member(view(Number(n)), repo, policy));
        validateMembers(members, repo);
        // Existing active integration PRs are immutable; never append a member.
        const active = gh(['pr', 'list', '--repo', repo, '--state', 'open', '--base', 'develop', '--limit', '1000', '--json', 'body']);
        if (active.some((p: any) => members.some(m => p.body.includes(`Batch member #${m.number} @`))))
            throw new Error('Member already belongs to active batch');
        for (const m of members)
            fetch(repo, m.head);
        const candidate = prepareCandidate(cwd, baseSha, members.map(m => m.head));
        const r = { version: 1, repository: repo, base: baseSha, members, candidate } as Receipt;
        r.digest = manifestDigest(core(r));
        r.branch = `codex/batch-${r.digest.slice(0, 20)}`;
        r.createdAt = new Date().toISOString();
        fresh(r);
        persist(path, r);
        console.log(JSON.stringify(r, null, 2));
        return;
    }
    let r = read(path);
    if (action === 'reject') {
        if (numbers.join(' ') !== '--apply' || !r.pr)
            throw new Error('reject requires integration PR and --apply');
        execFileSync(process.execPath, [...process.execArgv, process.argv[1], 'status', path], { cwd, stdio: 'pipe', timeout: 120000 });
        r = read(path);
        const p = view(r.pr);
        if (p.headRefOid !== r.candidate.commit || !(classifyChecks(p.statusCheckRollup.map((c: any) => c.name ? { name: c.name, status: c.status, conclusion: c.conclusion } : statusContextToCheck(c.context, c.state)), policyAt(r.base)).changes.length || (r.queueSnapshot?.jobs?.length && classifyChecks(r.queueSnapshot.jobs.map((j: any) => ({ name: j.name, status: j.status, conclusion: j.conclusion })), policyAt(r.base)).changes.length)))
            throw new Error('No proven failed candidate');
        reject(r);
        persist(path, r);
        const names = [`batch-rejected/${composition(r)}`, ...r.rejected!.blockedHeads.map(h => `batch-rejected-head/${h}`)];
        const refspecs = names.map(name => { const object = gitAt(cwd, ['mktag'], `object ${r.candidate.commit}\ntype commit\ntag ${name}\ntagger WorkspaceX Batch <batch@workspacex.invalid> 0 +0000\n\n${JSON.stringify({ digest: r.digest, rejected: r.rejected, checks: p.statusCheckRollup, queueEvidence: r.queueSnapshot })}\n`); return `${object}:refs/tags/${name}`; });
        gitAt(cwd, ['push', '--atomic', 'origin', ...refspecs]);
        console.log(JSON.stringify(r.rejected));
        return;
    }
    if (action === 'split') {
        if (numbers.join(' ') !== '--apply' || !r.rejected || r.members.length < 2)
            throw new Error('split requires recorded failed multi-member receipt and --apply');
        const p = view(r.pr!);
        if (p.state === 'OPEN')
            throw new Error('Close failed integration PR first; split cannot replace active batch');
        // Release only this rejected, closed candidate's member reservations.
        for (const m of r.members) {
            const ref = `refs/heads/codex/batch-lock-${m.number}-${m.head}`;
            const current = gitAt(cwd, ['ls-remote', 'origin', ref]).split(/\s+/)[0];
            if (current && current !== r.candidate.commit) {
                const child = `${path}.split-${m.number}.json`;
                if (!existsSync(child) || read(child).candidate.commit !== current)
                    throw new Error('Member reservation belongs to another batch');
                continue;
            }
            if (current)
                gitAt(cwd, ['push', `--force-with-lease=${ref}:${r.candidate.commit}`, 'origin', `:${ref}`]);
        }
        const results = [];
        for (const m of r.members) {
            const output = `${path}.split-${m.number}.json`;
            if (!existsSync(output))
                execFileSync(process.execPath, [...process.execArgv, process.argv[1], 'prepare', output, String(m.number)], { cwd, stdio: 'pipe', timeout: 120000 });
            execFileSync(process.execPath, [...process.execArgv, process.argv[1], 'open', output], { cwd, stdio: 'pipe', timeout: 120000 });
            results.push(read(output));
        }
        console.log(JSON.stringify(results, null, 2));
        return;
    }
    if (action === 'reconcile') {
        if (!r.pr)
            throw new Error('Missing integration PR');
        verifyCandidateParents(cwd, r.base, r.members.map(m => m.head), r.candidate.commit);
        verifySeal(r);
        const pr = gh(['api', `repos/${r.repository}/pulls/${r.pr}`]);
        if (!pr.merged || pr.head.sha !== r.candidate.commit || !pr.body.includes(marker(r)) || pr.base.ref !== 'develop')
            throw new Error('Integration PR not merged with frozen head');
        const source = pr.merge_commit_sha;
        fetch(r.repository, source);
        const commit = gh(['api', `repos/${r.repository}/git/commits/${source}`]);
        const associated = pages(`repos/${r.repository}/commits/${source}/pulls`).filter(p => p.merged_at && p.merge_commit_sha === source && p.base.ref === 'develop').map(p => p.number);
        const currentRuns = pages(`repos/${r.repository}/actions/runs?head_sha=${source}&event=merge_group`, 'workflow_runs').filter(run => ['.github/workflows/harness-verify.yml', '.github/workflows/backend-gates.yml', '.github/workflows/harness-acceptance.yml'].includes(run.path)).map(run => gh(['api', `repos/${r.repository}/actions/runs/${run.id}`]));
        const attempts = currentRuns.flatMap(run => { if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || run.run_attempt > 10)
            throw new Error('Attempt history limit'); return Array.from({ length: run.run_attempt }, (_v, i) => { const attempt = gh(['api', `repos/${r.repository}/actions/runs/${run.id}/attempts/${i + 1}`]); if (attempt.id !== run.id || attempt.run_attempt !== i + 1)
            throw new Error('Unknown run attempt identity'); return attempt; }); }).filter(run => Number.isFinite(Date.parse(run.run_started_at)) && Date.parse(run.run_started_at) <= Date.parse(pr.merged_at));
        const newer = (a: any, b: any) => Date.parse(a.run_started_at) > Date.parse(b.run_started_at) || (a.run_started_at === b.run_started_at && (a.id > b.id || (a.id === b.id && a.run_attempt > b.run_attempt)));
        const runs = attempts.filter((run, _i, all) => !all.some(other => other.workflow_id === run.workflow_id && newer(other, run)));
        const jobs = runs.flatMap(run => pages(`repos/${r.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'));
        const expectedTree = gitAt(cwd, ['merge-tree', '--write-tree', commit.parents[0].sha, r.candidate.commit]).split('\n')[0];
        const proof = { source, head: r.candidate.commit, tree: expectedTree, actualTree: commit.tree.sha, parents: commit.parents.map(p => p.sha), associated, pr: r.pr, repository: r.repository, mergedAt: pr.merged_at, mergedBy: pr.merged_by?.login, runs, jobs };
        verifyQueueMerge(proof, policyAt(source));
        for (const run of currentRuns)
            if (manifestDigest(gh(['api', `repos/${r.repository}/actions/runs/${run.id}`])) !== manifestDigest(run))
                throw new Error('Queue attempt changed during collection');
        for (const m of r.members)
            gitAt(cwd, ['merge-base', '--is-ancestor', m.head, source]);
        r.mergeEvidence = { ...proof, receiptDigest: r.digest, evidenceDigest: manifestDigest(proof), originals: r.members.map(m => {
                const p = gh(['api', `repos/${r.repository}/pulls/${m.number}`]);
                if (p.head.sha !== m.head)
                    throw new Error('Original member head changed after batch preparation');
                return { number: m.number, head: p.head.sha, state: p.state, merged: p.merged, mergeCommit: p.merge_commit_sha };
            }), releaseAdmission: 'separate promotion gate; not asserted' };
        persist(path, r);
        console.log(JSON.stringify(r.mergeEvidence, null, 2));
        return;
    }
    if (action === 'open') {
        if (r.rejected)
            throw new Error('Rejected receipt cannot reopen; prepare fresh split receipt');
        fresh(r);
        const existing = gh(['pr', 'list', '--repo', r.repository, '--head', r.branch, '--state', 'all', '--json', 'number,body,state,headRefOid,baseRefName']);
        if (existing.length) {
            if (existing.length !== 1 || existing[0].state !== 'OPEN' || existing[0].headRefOid !== r.candidate.commit || existing[0].baseRefName !== 'develop' || !existing[0].body.includes(marker(r)) || !existing[0].body.includes(JSON.stringify(core(r), null, 2)))
                throw new Error('Branch collision or closed/changed integration PR');
            verifySeal(r);
            r.pr = existing[0].number;
            persist(path, r);
            console.log(JSON.stringify(existing));
            return;
        }
        // Non-force push refuses any collision. No queue or branch protection bypass.
        const sealed = seal(r);
        const prior = gitAt(cwd, ['ls-remote', 'origin', `refs/heads/${r.branch}`, sealed.ref]).split('\n').filter(Boolean);
        if (prior.some(line => { const [sha, ref] = line.split(/\s+/); return sha !== (ref === sealed.ref ? sealed.object : r.candidate.commit); }))
            throw new Error('Remote candidate branch/tag collision');
        const locks = r.members.map(m => `refs/heads/codex/batch-lock-${m.number}-${m.head}`);
        const missing = locks.filter(ref => { const current = gitAt(cwd, ['ls-remote', 'origin', ref]).split(/\s+/)[0]; if (current && current !== r.candidate.commit)
            throw new Error('Member reserved by another batch'); return !current; });
        gitAt(cwd, ['push', '--atomic', ...missing.map(ref => `--force-with-lease=${ref}:`), 'origin', `${r.candidate.commit}:refs/heads/${r.branch}`, `${sealed.object}:${sealed.ref}`, ...missing.map(ref => `${r.candidate.commit}:${ref}`)]);
        persist(path, r);
        verifySeal(r);
        fresh(r);
        const body = `Integration pilot; preserves original PR/issue identity. Refs #6387. Originals must not borrow this PR's checks or be marked passing.\n\n${marker(r)}\n${r.members.map(m => `Batch member #${m.number} @ ${m.head}`).join('\n')}\n\nFrozen receipt:\n\x60\x60\x60json\n${JSON.stringify(core(r), null, 2)}\n\x60\x60\x60\n\nNative queue entry requires coordinator review. Release association proof is pending live verification.`;
        const url = execFileSync('gh', ['pr', 'create', '--repo', r.repository, '--base', 'develop', '--head', r.branch, '--title', `Integration batch ${r.digest.slice(0, 12)}`, '--body', body], { encoding: 'utf8', timeout: 30000 }).trim();
        r.pr = Number(url.split('/').pop());
        persist(path, r);
        console.log(url);
        return;
    }
    if (action === 'status') {
        if (!r.pr)
            throw new Error('Receipt has no PR');
        const p = view(r.pr);
        if (p.headRefOid !== r.candidate.commit || !p.body.includes(marker(r)) || !p.body.includes(JSON.stringify(core(r), null, 2)))
            throw new Error('Published candidate/manifest changed');
        const discovered = p.mergeQueueEntry?.headCommit?.oid ? [] : pages(`repos/${r.repository}/actions/runs?event=merge_group`, 'workflow_runs').filter(run => new RegExp(`^gh-readonly-queue/develop/pr-${r.pr}-[a-f0-9]{7,40}$`).test(run.head_branch) && Date.parse(run.created_at) >= Date.parse(r.createdAt)).sort((a, b) => b.id - a.id);
        const queueHead = p.mergeQueueEntry?.headCommit?.oid ?? discovered[0]?.head_sha;
        r.queueSnapshot = null; // Never treat a receipt's editable observation as evidence.
        let queueChecks: any[] = [];
        if (queueHead) {
            if (!/^[a-f0-9]{40}$/.test(queueHead))
                throw new Error('Invalid queue candidate');
            fetch(r.repository, queueHead);
            gitAt(cwd, ['merge-base', '--is-ancestor', r.candidate.commit, queueHead]);
            const runs = pages(`repos/${r.repository}/actions/runs?head_sha=${queueHead}&event=merge_group`, 'workflow_runs').filter((run, _i, all) => !all.some(other => other.workflow_id === run.workflow_id && other.id > run.id)).map(run => gh(['api', `repos/${r.repository}/actions/runs/${run.id}`]));
            if (runs.some(run => !Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 || run.event !== 'merge_group' || run.head_sha !== queueHead || run.repository?.full_name !== r.repository || !new RegExp(`^gh-readonly-queue/develop/pr-${r.pr}-[a-f0-9]{7,40}$`).test(run.head_branch)))
                throw new Error('Invalid queue candidate runs');
            const jobs = runs.flatMap(run => { const jobs = pages(`repos/${r.repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'); if (jobs.some(j => !Number.isSafeInteger(j.id) || j.id < 1 || j.run_id !== run.id || j.run_attempt !== run.run_attempt))
                throw new Error('Unknown queue job identity'); return jobs; });
            if (jobs.some(j => j.head_sha !== queueHead))
                throw new Error('Queue jobs target changed');
            for (const run of runs)
                if (manifestDigest(gh(['api', `repos/${r.repository}/actions/runs/${run.id}`])) !== manifestDigest(run))
                    throw new Error('Queue attempt changed during status');
            r.queueSnapshot = { head: queueHead, runs, jobs };
            persist(path, r);
            queueChecks = jobs.map(j => ({ name: j.name, status: j.status, conclusion: j.conclusion }));
        }
        persist(path, r);
        const prChecks = p.statusCheckRollup.map((c: any) => c.name ? { name: c.name, status: c.status, conclusion: c.conclusion } : statusContextToCheck(c.context, c.state));
        const failed = classifyChecks(prChecks, policyAt(r.base)).changes.length > 0 || (queueChecks.length > 0 && classifyChecks(queueChecks, policyAt(r.base)).changes.length > 0);
        if (failed) {
            reject(r);
            persist(path, r);
            console.log(JSON.stringify(r.rejected, null, 2));
            return;
        }
        fresh(r);
        console.log(JSON.stringify({ pr: r.pr, digest: r.digest, head: r.candidate.commit, tree: r.candidate.tree, state: p.state, note: 'No completion claim: coordinator must verify native queue tested SHA/tree and source admission after merge.' }, null, 2));
        return;
    }
    throw new Error('Unknown action');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
