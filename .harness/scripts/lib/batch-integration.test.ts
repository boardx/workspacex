import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const dir of temporaryDirectories.splice(0))
        rmSync(dir, { recursive: true, force: true });
});
import { prepareCandidate, manifestDigest } from './batch-integration';
it('combines real independent heads without changing checkout and preserves ancestry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-'));
    temporaryDirectories.push(dir);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, 'base'), 'base');
    git('add', '.');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    const heads = [];
    for (const name of ['one', 'two']) {
        git('checkout', '--detach', base);
        writeFileSync(join(dir, name), name);
        git('add', '.');
        git('commit', '-m', name);
        heads.push(git('rev-parse', 'HEAD'));
    }
    const before = git('rev-parse', 'HEAD');
    const result = prepareCandidate(dir, base, heads);
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(git('ls-tree', '--name-only', result.commit).split('\n')).toEqual(['base', 'one', 'two']);
    for (const head of heads)
        expect(git('merge-base', '--is-ancestor', head, result.commit)).toBe('');
    expect(result.tree).toBe(git('rev-parse', `${result.commit}^{tree}`));
    expect(manifestDigest({ base, heads })).toBe(manifestDigest({ heads, base }));
});
import { validateMembers, splitFailure } from './batch-integration';
it('rejects queued, risky and changed members and splits without blaming all members', () => {
    const member = { number: 1, head: 'a'.repeat(40), base: 'develop', repository: 'org/repo', draft: false, queued: false, approved: true, ready: true, paths: ['apps/web/components/button.tsx'] };
    expect(() => validateMembers([member], 'org/repo')).not.toThrow();
    for (const change of [{ queued: true }, { paths: ['.github/workflows/ci.yml'] }, { approved: false }, { base: 'main' }])
        expect(() => validateMembers([{ ...member, ...change }], 'org/repo')).toThrow();
    expect(splitFailure('digest', [member, { ...member, number: 2, head: 'b'.repeat(40) }]).blockedHeads).toEqual([]);
    expect(splitFailure('digest', [member]).blockedHeads).toEqual([member.head]);
});
it('rejects nonimmutable SHA, duplicate heads and manifest tampering', () => {
    expect(() => prepareCandidate('.', 'HEAD', ['a'.repeat(40)])).toThrow('Immutable');
    expect(() => prepareCandidate('.', 'a'.repeat(40), ['b'.repeat(40), 'b'.repeat(40)])).toThrow('distinct');
    expect(manifestDigest({ base: 'a', heads: ['b', 'c'] })).not.toBe(manifestDigest({ base: 'a', heads: ['c', 'b'] }));
});
import { verifyQueueMerge } from './batch-integration';
it('binds merged commit, tree and current workflow attempt; rejects stale runs', () => {
    const source = 'a'.repeat(40), head = 'b'.repeat(40), tree = 'c'.repeat(40);
    const proof = { source, head, tree, parents: ['d'.repeat(40), head], actualTree: tree, associated: [7], pr: 7, repository: 'o/r', mergedAt: '2026-01-01T01:00:00Z', mergedBy: 'github-merge-queue[bot]', runs: [{ id: 1, workflow_id: 10, run_attempt: 2, run_started_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:30:00Z', event: 'merge_group', head_sha: source, repository: { full_name: 'o/r' }, head_branch: 'gh-readonly-queue/develop/pr-7-abcdef0', status: 'completed', conclusion: 'success' }], jobs: [{ id: 10, started_at: '2026-01-01T00:01:00Z', completed_at: '2026-01-01T00:20:00Z', run_id: 1, workflow_id: 10, run_attempt: 2, head_sha: source, status: 'completed', conclusion: 'success', name: 'test' }] };
    expect(() => verifyQueueMerge(proof, { version: 1, requiredChecks: ['test'] } as any)).not.toThrow();
    expect(() => verifyQueueMerge({ ...proof, jobs: [{ ...proof.jobs[0], run_attempt: 1 }] }, { version: 1, requiredChecks: ['test'] } as any)).toThrow();
    expect(() => verifyQueueMerge({ ...proof, runs: [{ ...proof.runs[0], run_started_at: '2026-01-02T00:00:00Z' }] }, { version: 1, requiredChecks: ['test'] } as any)).toThrow();
    expect(()=>verifyQueueMerge({...proof,jobs:[{...proof.jobs[0],run_id:undefined}]},{version:1,requiredChecks:['test']} as any)).toThrow();
    expect(()=>verifyQueueMerge({...proof,mergedBy:'human-maintainer'},{version:1,requiredChecks:['test']} as any)).toThrow();
    expect(() => verifyQueueMerge({ ...proof, actualTree: 'e'.repeat(40) }, { version: 1, requiredChecks: ['test'] } as any)).toThrow();
});
import { verifyCandidateParents } from './batch-integration';
it('rejects same-tree candidates with extra parent ancestry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-parents-'));
    temporaryDirectories.push(dir);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    git('init');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(dir, 'file'), 'base');
    git('add', '.');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'file'), 'member');
    git('add', '.');
    git('commit', '-m', 'member');
    const head = git('rev-parse', 'HEAD');
    const candidate = prepareCandidate(dir, base, [head]);
    expect(() => verifyCandidateParents(dir, base, [head], candidate.commit)).not.toThrow();
    const extra = git('commit-tree', candidate.tree, '-p', head, '-m', 'extra');
    const forged = git('commit-tree', candidate.tree, '-p', base, '-p', head, '-p', extra, '-m', 'forged');
    expect(() => verifyCandidateParents(dir, base, [head], forged)).toThrow('parent');
});
