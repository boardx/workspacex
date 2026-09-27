import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {boardAcceptanceMatrix} from './board-acceptance-matrix.mjs';

const root = resolve(import.meta.dirname, '../../..');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sha = process.env.BOARD_ACCEPTANCE_SHA;
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('INVALID_ACCEPTANCE_SHA');
if (process.argv.includes('--list')) {
  console.log(JSON.stringify({sha, approved: false, score: null, lanes: boardAcceptanceMatrix}, null, 2));
} else {
  if (git('rev-parse', 'HEAD') !== sha) throw new Error('HEAD_SHA_MISMATCH');
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('DIRTY_WORKTREE');
  // An env var is not proof of the running service build. Real producers must query
  // authenticated runtime build identity and attach it to their observed artifacts.
  const output = resolve(root, 'artifacts', 'board-acceptance', sha);
  mkdirSync(output, {recursive: true});
  const rows = boardAcceptanceMatrix.map(entry => ({lane: entry.lane, sha, dirty: false,
    buildSha: null, status: 'not-run', reason: entry.reason, requirement: entry.requirement}));
  writeFileSync(resolve(output, 'run.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.error('BOARD_ACCEPTANCE_NOT_RUN: real runtime identity, producers and evidence validators are not integrated');
  process.exitCode = 1;
}
