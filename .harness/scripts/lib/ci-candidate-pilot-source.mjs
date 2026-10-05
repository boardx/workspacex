/** Git objects, not checkout filters or archive attributes, define pilot input. */
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fingerprint } from './ci-candidate-evidence.mjs';

const SHA = /^[a-f0-9]{40}$/;
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_FILE = 32 * 1024 ** 2;
const requireFact = (value, reason) => { if (!value) throw new Error(reason); };
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const safeRepositoryPath = path => typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part && !['.', '..', '.git'].includes(part.toLowerCase()));

function gitInvocation(root, args) {
  const env = { PATH: process.env.PATH, HOME: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: '' };
  return { args: ['--no-replace-objects', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', root, ...args], env };
}
function git(root, args) {
  const invocation = gitInvocation(root, args);
  return execFileSync('git', invocation.args, { env: invocation.env, maxBuffer: 32 * 1024 ** 2 });
}

class Bytes {
  constructor(stream) { this.iterator = stream[Symbol.asyncIterator](); this.pending = Buffer.alloc(0); }
  async take(length, consume = null) {
    const parts = [];
    while (length > 0) {
      if (!this.pending.length) {
        const next = await this.iterator.next();
        requireFact(!next.done, 'git_batch_truncated');
        this.pending = next.value;
      }
      const count = Math.min(length, this.pending.length);
      const bytes = this.pending.subarray(0, count);
      if (consume) consume(bytes); else parts.push(bytes);
      this.pending = this.pending.subarray(count); length -= count;
    }
    return consume ? null : Buffer.concat(parts);
  }
  async line() {
    const parts = [];
    let size = 0;
    while (true) {
      const byte = await this.take(1);
      if (byte[0] === 10) return Buffer.concat(parts).toString('ascii');
      parts.push(byte); requireFact(++size < 200, 'git_batch_header_invalid');
    }
  }
  async end() {
    requireFact(this.pending.length === 0, 'git_batch_extra_output');
    requireFact((await this.iterator.next()).done, 'git_batch_extra_output');
  }
}

export async function materializeGitInput({ repositoryRoot, candidateSha, destination, definitionBlobs = [] }) {
  requireFact(SHA.test(candidateSha ?? ''), 'candidate_sha_invalid');
  const repository = realpathSync(repositoryRoot);
  requireFact(!existsSync(destination), 'materialized_destination_already_exists');
  const tree = git(repository, ['rev-parse', '--verify', `${candidateSha}^{tree}`]).toString('ascii').trim();
  requireFact(SHA.test(tree), 'candidate_tree_invalid');
  const commit = git(repository, ['cat-file', 'commit', candidateSha]);
  requireFact(createHash('sha1').update(`commit ${commit.length}\0`).update(commit).digest('hex') === candidateSha, 'candidate_commit_bytes_invalid');
  const headers = commit.toString('utf8').split('\n\n')[0].split('\n');
  requireFact(headers[0] === `tree ${tree}`, 'candidate_commit_tree_mismatch');
  const parents = headers.filter(line => line.startsWith('parent ')).map(line => line.slice(7));
  requireFact(parents.every(parent => SHA.test(parent)) && new Set(parents).size === parents.length, 'candidate_commit_parents_invalid');
  const raw = git(repository, ['ls-tree', '-r', '-z', '--full-tree', candidateSha]);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const entries = text.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(record);
    requireFact(match && safeRepositoryPath(match[4]), 'unsafe_git_input_path');
    requireFact(match[1] !== '160000' && match[2] === 'blob', 'unsupported_gitlink');
    return { path: match[4], mode: match[1], oid: match[3] };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  requireFact(entries.length > 0 && entries.length <= 100_000 && new Set(entries.map(entry => entry.path)).size === entries.length, 'git_tree_empty_duplicate_or_over_budget');
  const paths = new Map(entries.map(entry => [entry.path, entry]));
  for (const pin of definitionBlobs) requireFact(safeRepositoryPath(pin.path) && SHA.test(pin.oid) && paths.get(pin.path)?.oid === pin.oid, 'protected_test_definition_changed');
  for (const entry of entries) {
    let parent = dirname(entry.path);
    while (parent !== '.') { requireFact(!paths.has(parent), 'git_input_parent_is_file_or_link'); parent = dirname(parent); }
  }
  mkdirSync(destination, { mode: 0o700 });
  const invocation = gitInvocation(repository, ['cat-file', '--batch']);
  const child = spawn('git', invocation.args, { env: invocation.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString(); });
  const completion = new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code)); });
  completion.catch(() => {}); // the reader reports errors before awaiting exit
  child.stdin.end(entries.map(entry => entry.oid).join('\n') + '\n');
  const reader = new Bytes(child.stdout);
  const files = [], links = [];
  let totalBytes = 0;
  try {
    for (const entry of entries) {
      const match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(await reader.line());
      requireFact(match && match[1] === entry.oid, 'git_batch_object_identity_changed');
      const size = Number(match[2]);
      requireFact(Number.isSafeInteger(size) && size <= MAX_FILE && (totalBytes += size) <= MAX_BYTES, 'git_input_byte_budget_exceeded');
      const absolute = join(destination, entry.path);
      mkdirSync(dirname(absolute), { recursive: true, mode: 0o755 });
      const blobHash = createHash('sha1').update(`blob ${size}\0`);
      const fileHash = createHash('sha256');
      let prefix = Buffer.alloc(0);
      let linkBytes = Buffer.alloc(0);
      const fd = entry.mode === '120000' ? null : openSync(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        await reader.take(size, bytes => {
          blobHash.update(bytes); fileHash.update(bytes);
          if (prefix.length < 200) prefix = Buffer.concat([prefix, bytes.subarray(0, 200 - prefix.length)]);
          if (fd === null) linkBytes = Buffer.concat([linkBytes, bytes]); else writeSync(fd, bytes);
        });
      } finally { if (fd !== null) closeSync(fd); }
      requireFact(blobHash.digest('hex') === entry.oid, 'git_blob_hash_mismatch');
      requireFact(!/^version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\r?\n|$)/.test(prefix.toString('utf8')), 'unsupported_lfs_pointer');
      requireFact((await reader.take(1))[0] === 10, 'git_batch_object_terminator_invalid');
      if (entry.mode === '120000') {
        requireFact(size < 4096, 'unsafe_git_symlink');
        const target = new TextDecoder('utf-8', { fatal: true }).decode(linkBytes);
        requireFact(target && !isAbsolute(target) && !target.includes('\\') && !/[\x00-\x1f\x7f]/.test(target), 'unsafe_git_symlink');
        const resolved = resolve(dirname(absolute), target);
        requireFact(resolved.startsWith(`${resolve(destination)}${sep}`), 'escaping_git_symlink');
        links.push({ absolute, target });
      } else {
        if (entry.path.endsWith('.gitattributes')) requireFact(!/(?:^|\s)filter=lfs(?:\s|$)/m.test(readFileSync(absolute, 'utf8')), 'unsupported_lfs_attributes');
        chmodSync(absolute, entry.mode === '100755' ? 0o555 : 0o444);
      }
      files.push({ ...entry, size, sha256: `sha256:${fileHash.digest('hex')}` });
    }
    await reader.end();
    requireFact(await completion === 0, 'git_batch_failed');
    for (const link of links) symlinkSync(link.target, link.absolute);
    for (const link of links) requireFact(realpathSync(link.absolute).startsWith(`${realpathSync(destination)}${sep}`), 'escaping_or_dangling_git_symlink');
    const verify = verifyGitInput({ root: destination, entries });
    const lockDirectories = path => { for (const name of readdirSync(path)) { const child = join(path, name); if (lstatSync(child).isDirectory()) lockDirectories(child); } chmodSync(path, 0o555); };
    lockDirectories(destination);
    return { sha: candidateSha, tree, parents, entries, entriesFingerprint: fingerprint(entries), materializedFingerprint: verify.fingerprint, fileCount: entries.length, totalBytes, files };
  } catch (error) {
    child.kill('SIGKILL'); child.stdin.destroy(); child.stdout.destroy(); await completion.catch(() => {});
    throw error;
  }
}

export function verifyGitInput({ root, entries }) {
  const expected = new Map(entries.map(entry => [entry.path, entry]));
  const directories = new Set();
  for (const entry of entries) { let parent = dirname(entry.path); while (parent !== '.') { directories.add(parent); parent = dirname(parent); } }
  const actual = [], files = [];
  const walk = directory => {
    const stat = lstatSync(directory);
    requireFact(stat.isDirectory() && !stat.isSymbolicLink(), 'materialized_input_directory_invalid');
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = relative(root, absolute).split(sep).join('/');
      requireFact(safeRepositoryPath(path), 'unsafe_materialized_input_path');
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) { requireFact(directories.has(path), 'extra_materialized_directory'); walk(absolute); continue; }
      const entry = expected.get(path);
      requireFact(entry && stat.nlink === 1 && (stat.isFile() || stat.isSymbolicLink()), 'extra_or_special_materialized_input');
      requireFact((entry.mode === '120000') === stat.isSymbolicLink(), 'materialized_input_type_changed');
      if (stat.isFile()) requireFact((entry.mode === '100755') === ((stat.mode & 0o111) !== 0), 'materialized_input_mode_changed');
      const bytes = stat.isSymbolicLink() ? readlinkSync(absolute, { encoding: 'buffer' }) : readFileSync(absolute);
      if (stat.isSymbolicLink()) requireFact(realpathSync(absolute).startsWith(`${realpathSync(root)}${sep}`), 'escaping_materialized_symlink');
      requireFact(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === entry.oid, 'materialized_input_bytes_changed');
      actual.push(path); files.push({ ...entry, size: bytes.length, sha256: digest(bytes) });
    }
  };
  walk(root);
  requireFact(actual.length === entries.length, 'materialized_input_missing');
  return { complete: true, fileCount: files.length, fingerprint: fingerprint(files.sort((a, b) => a.path < b.path ? -1 : 1)), files };
}
