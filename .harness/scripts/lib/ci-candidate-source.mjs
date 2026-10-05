/**
 * Read-only materialized-input measurement. This NEVER authenticates execution.
 * A Git tree binds repository bytes, not installed dependencies, discovered tests,
 * or the inputs a process actually read. Ordinary host probes always remain
 * verified=false/eligible=false. A separate trusted supervisor must authenticate
 * its own inventory and exact immutable source/dependency mounts at execution.
 * No package hooks, candidate config, test discovery, filter or dependency code
 * is imported or executed here. Unsupported inputs fail closed.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fingerprint } from './ci-candidate-evidence.mjs';

export const SOURCE_PROBE_VERSION = 1;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const LFS = /^version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\r?\n|$)/;
const BUDGET = { maxFiles: 100_000, maxBytes: 1024 * 1024 * 1024, maxFileBytes: 128 * 1024 * 1024 };
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export class SourceProbeError extends Error {
  constructor(reason) { super(reason); this.name = 'SourceProbeError'; this.reason = reason; }
}
const requireFact = (value, reason) => { if (!value) throw new SourceProbeError(reason); };
const safePath = path => typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const sorted = values => [...values].sort();
const statIdentity = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const snapshotStat = path => lstatSync(path, { bigint: true });
const modeOf = stat => Number(stat.mode & 0o777n);

/** Git plumbing only; suppress repository hooks/filters/fsmonitor and lazy fetch. */
function git(root, args) {
  const env = { ...process.env };
  // Inherited trace destinations can write files, and config/object/index
  // overrides can change the repository being read. None is a probe input.
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: '' });
  return execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false', '-C', root, ...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseTree(raw) {
  const entries = raw.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(record);
    requireFact(match && safePath(match[4]), 'unsupported_git_entry');
    const [, mode, type, oid, path] = match;
    requireFact(mode !== '160000' && type === 'blob', 'unsupported_submodule');
    return { path, mode, oid };
  });
  requireFact(entries.length > 0 && new Set(entries.map(entry => entry.path)).size === entries.length, 'empty_or_duplicate_git_tree');
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Independently reconstruct the Git Merkle tree; a supplied flat inventory is not trusted. */
export function gitTreeDigest(entries, algorithm = 'sha1') {
  requireFact(['sha1', 'sha256'].includes(algorithm) && Array.isArray(entries) && entries.length > 0, 'invalid_git_tree_inventory');
  const root = new Map();
  for (const entry of entries) {
    requireFact(entry && safePath(entry.path) && ['100644', '100755', '120000'].includes(entry.mode) && SHA.test(entry.oid ?? '') && entry.oid.length === (algorithm === 'sha1' ? 40 : 64), 'invalid_git_tree_inventory');
    const parts = entry.path.split('/'); let directory = root;
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Map());
      const child = directory.get(part); requireFact(child instanceof Map, 'conflicting_git_tree_inventory'); directory = child;
    }
    const name = parts.at(-1); requireFact(!directory.has(name), 'duplicate_or_conflicting_git_tree_inventory'); directory.set(name, entry);
  }
  const digest = directory => {
    const children = [...directory.entries()].map(([name, value]) => ({ name, mode: value instanceof Map ? '40000' : value.mode, oid: value instanceof Map ? digest(value) : value.oid, sort: Buffer.from(name + (value instanceof Map ? '/' : '\0')) }));
    children.sort((a, b) => Buffer.compare(a.sort, b.sort));
    const bytes = Buffer.concat(children.flatMap(child => [Buffer.from(`${child.mode} ${child.name}\0`), Buffer.from(child.oid, 'hex')]));
    return createHash(algorithm).update(Buffer.from(`tree ${bytes.length}\0`)).update(bytes).digest('hex');
  };
  return digest(root);
}

function indexEntries(raw) {
  return raw.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755|120000|160000) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t(.+)$/.exec(record);
    requireFact(match && match[3] === '0' && safePath(match[4]), 'unmerged_or_unsupported_index');
    return { path: match[4], mode: match[1], oid: match[2] };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Every ancestor must itself be an ordinary directory, never a symlink. */
function assertParents(root, path) {
  let parent = dirname(path);
  while (parent !== root) {
    requireFact(inside(root, parent), 'input_path_escape');
    const stat = snapshotStat(parent);
    requireFact(stat.isDirectory() && !stat.isSymbolicLink(), 'symlink_parent_or_non_directory');
    parent = dirname(parent);
  }
}

function readInput(root, absolute, allowedRoots, budget, tracked = null) {
  assertParents(root, absolute);
  const before = snapshotStat(absolute);
  requireFact(before.isFile() || before.isSymbolicLink(), 'unsupported_filesystem_input');
  requireFact(!before.isFile() || before.nlink === 1n, 'hardlinked_input_unsupported');
  let bytes, target = null;
  if (before.isSymbolicLink()) {
    bytes = readlinkSync(absolute, { encoding: 'buffer' });
    target = realpathSync(absolute);
    requireFact(allowedRoots.some(candidate => inside(candidate, target)), 'symlink_escape');
    requireFact(!inside(join(root, '.git'), target), 'symlink_to_git_metadata');
    requireFact(!isAbsolute(bytes.toString('utf8')), 'absolute_symlink_unsupported');
  } else {
    requireFact(before.size <= BigInt(budget.maxFileBytes), 'input_file_budget_exceeded');
    bytes = readFileSync(absolute);
    requireFact(!LFS.test(bytes.subarray(0, 200).toString('utf8')), 'unsupported_lfs_pointer');
  }
  budget.files += 1;
  budget.bytes += bytes.length;
  requireFact(budget.files <= budget.maxFiles && budget.bytes <= budget.maxBytes, 'input_scan_budget_exceeded');
  const after = snapshotStat(absolute);
  requireFact(statIdentity(before) === statIdentity(after), 'input_changed_during_read');
  const file = { path: relative(root, absolute).split(sep).join('/'), fsMode: modeOf(before), size: bytes.length, digest: sha256(bytes), type: before.isSymbolicLink() ? 'symlink' : 'file' };
  if (target !== null) file.target = relative(root, target).split(sep).join('/');
  if (tracked) {
    requireFact((tracked.mode === '120000') === before.isSymbolicLink(), 'tracked_input_type_drift');
    if (before.isFile()) requireFact((tracked.mode === '100755') === ((modeOf(before) & 0o111) !== 0), 'tracked_input_mode_drift');
    const algorithm = tracked.oid.length === 40 ? 'sha1' : 'sha256';
    const oid = createHash(algorithm).update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    requireFact(oid === tracked.oid, 'tracked_input_bytes_drift');
    file.gitMode = tracked.mode; file.oid = tracked.oid;
  }
  return { file, bytes, before: statIdentity(before), absolute };
}

function enumerate(root, excluded, budget, skipGit = true) {
  const result = [], directories = [], states = [];
  const visit = directory => {
    const before = snapshotStat(directory);
    requireFact(before.isDirectory() && !before.isSymbolicLink(), 'unsupported_input_directory');
    directories.push({ path: directory === root ? '.' : relative(root, directory).split(sep).join('/'), fsMode: modeOf(before), type: 'directory' });
    states.push({ absolute: directory, before: statIdentity(before) });
    for (const name of sorted(readdirSync(directory))) {
      const absolute = join(directory, name);
      const path = relative(root, absolute).split(sep).join('/');
      requireFact(safePath(path), 'unsupported_filesystem_path');
      if ((skipGit && path === '.git') || excluded.some(item => path === item || path.startsWith(`${item}/`))) continue;
      requireFact(result.length + directories.length < budget.maxFiles, 'input_scan_budget_exceeded');
      const stat = snapshotStat(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(absolute);
      else result.push(path);
    }
    requireFact(statIdentity(before) === statIdentity(snapshotStat(directory)), 'directory_changed_during_scan');
  };
  visit(root);
  return { paths: result.sort(), directories: directories.sort((a, b) => a.path.localeCompare(b.path)), states };
}

function expectedDirectories(paths) {
  const directories = new Set(['.']);
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== '.') { directories.add(parent.split(sep).join('/')); parent = dirname(parent); }
  }
  return sorted(directories);
}

function workspacePatterns(bytes) {
  const text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^packages:\s*(?:#.*)?$/.test(line));
  requireFact(start >= 0, 'workspace_package_patterns_missing');
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = /^\s+-\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*(?:#.*)?$/.exec(line);
    requireFact(match, 'unsupported_workspace_pattern_syntax');
    const pattern = match[1] ?? match[2] ?? match[3];
    requireFact(/^[a-zA-Z0-9_@./*+-]+$/.test(pattern) && !pattern.startsWith('/') && !pattern.split('/').some(part => part === '..' || part === '.') && !pattern.includes('***'), 'unsupported_workspace_pattern');
    patterns.push(pattern);
  }
  requireFact(patterns.length > 0, 'empty_workspace_package_patterns');
  return patterns.map(pattern => new RegExp(`^${pattern.split('/').map(part => part === '**' ? '(?:[^/]+/)*' : `${part.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}/`).join('')}package\\.json$`));
}

function classify(paths) {
  return {
    manifests: paths.filter(path => /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|requirements[^/]*\.txt)$/.test(path)),
    locks: paths.filter(path => /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|uv\.lock|Cargo\.lock|go\.sum|poetry\.lock)$/.test(path)),
    definitions: paths.filter(path => /(?:^|\/)(?:[^/]*config[^/]*|\.nvmrc|\.npmrc|\.pnpmfile\.[^/]+|\.gitattributes|\.gitignore)$/.test(path) || /^(?:\.github\/|\.harness\/|scripts\/|patches\/)/.test(path)),
    testFiles: paths.filter(path => /(?:\.(?:spec|test)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$)/.test(path)),
  };
}

function readInventory(value, tracked) {
  requireFact(value && (value.kind === undefined || value.kind === 'actual-test-inventory') && typeof value.suite === 'string' && value.suite.length > 0 && Array.isArray(value.tests) && value.tests.length > 0, 'actual_test_inventory_missing');
  const ids = new Set();
  const tests = value.tests.map(test => {
    requireFact(test && safePath(test.file) && tracked.has(test.file) && typeof test.project === 'string' && test.project.length > 0 && typeof test.id === 'string' && test.id.length > 0 && !/[\x00-\x1f\x7f]/.test(test.id), 'invalid_actual_test_inventory');
    const identity = JSON.stringify([test.file, test.project, test.id]);
    requireFact(!ids.has(identity), 'duplicate_actual_test_inventory'); ids.add(identity);
    return { file: test.file, project: test.project, id: test.id };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // Caller provenance is deliberately not accepted here. A supervisor binds this
  // collection to real runner discovery/execution; this probe cannot do so.
  return { kind: 'actual-test-inventory', suite: value.suite, count: tests.length, tests, digest: fingerprint(tests), verified: false };
}

/**
 * Returns a metadata probe even for a clean complete fixture. `complete` means
 * collection completeness ONLY. It never proves immutable mounts or execution.
 * Inventory metadata supplied by a caller cannot upgrade verified/eligible.
 */
export async function probeMaterializedSource(options = {}) {
  const result = { schemaVersion: SOURCE_PROBE_VERSION, kind: 'source-metadata-probe', verified: false, eligible: false, complete: false, executionClosure: null, reasons: [], source: null, dependencies: null, inventory: null };
  const add = reason => { if (!result.reasons.includes(reason)) result.reasons.push(reason); };
  try {
    const { root: inputRoot, expectedSha, expectedTree, testInventory } = options;
    requireFact(typeof inputRoot === 'string' && isAbsolute(inputRoot), 'absolute_source_root_required');
    const root = realpathSync(inputRoot);
    requireFact(resolve(inputRoot) === root && snapshotStat(root).isDirectory(), 'source_root_symlink_or_invalid');
    requireFact(SHA.test(expectedSha ?? '') && SHA.test(expectedTree ?? ''), 'expected_source_identity_missing');
    const limits = { ...BUDGET, ...(options.limits ?? {}) };
    requireFact(Object.keys(limits).length === 3 && Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0), 'invalid_source_scan_limits');
    const budget = { ...limits, files: 0, bytes: 0 };
    const exported = options.gitEntries !== undefined;
    let sha = expectedSha, tree = expectedTree, entries, rawTree, rawIndex, index;
    if (exported) {
      // The controller proves commit ancestry separately. Reconstructing this
      // Merkle tree independently proves that no path/mode/blob was omitted.
      requireFact(Array.isArray(options.gitEntries), 'invalid_git_tree_inventory');
      entries = options.gitEntries.map(entry => ({ path: entry.path, mode: entry.mode, oid: entry.oid })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      requireFact(gitTreeDigest(entries, tree.length === 40 ? 'sha1' : 'sha256') === tree, 'git_tree_inventory_mismatch');
      try { snapshotStat(join(root, '.git')); throw new SourceProbeError('git_metadata_in_execution_inputs'); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      index = null;
    } else {
      sha = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
      tree = git(root, ['rev-parse', '--verify', `${expectedSha}^{tree}`]).trim();
      requireFact(sha === expectedSha && tree === expectedTree, 'source_identity_drift');
      requireFact(git(root, ['rev-parse', '--show-toplevel']).trim() === root, 'source_root_not_git_toplevel');
      rawTree = git(root, ['ls-tree', '-r', '-z', '--full-tree', expectedSha]);
      entries = parseTree(rawTree);
      requireFact(gitTreeDigest(entries, tree.length === 40 ? 'sha1' : 'sha256') === tree, 'git_tree_inventory_mismatch');
      rawIndex = git(root, ['ls-files', '--stage', '-z']);
      index = indexEntries(rawIndex);
      requireFact(JSON.stringify(entries) === JSON.stringify(index), 'source_index_drift');
    }
    const tracked = new Map(entries.map(entry => [entry.path, entry]));
    const files = [], states = [], sourceBytes = new Map();
    for (const entry of entries) {
      let item;
      try { item = readInput(root, join(root, entry.path), [root], budget, entry); }
      catch (error) { if (error instanceof SourceProbeError) error.inputPath = entry.path; throw error; }
      files.push(item.file); states.push(item);
      if (/(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|\.gitattributes|[^/]+\.lock|pnpm-lock\.yaml|pyproject\.toml)$/.test(entry.path)) sourceBytes.set(entry.path, item.bytes);
    }
    for (const [path, bytes] of sourceBytes) if (path.endsWith('.gitattributes')) requireFact(!/(?:^|\s)filter=lfs(?:\s|$)/m.test(bytes.toString('utf8')), 'unsupported_lfs_attributes');
    requireFact(sourceBytes.has('package.json') && sourceBytes.has('pnpm-lock.yaml'), 'workspace_install_manifest_or_lock_missing');
    const allPaths = entries.map(entry => entry.path);
    result.source = { sha, tree, collection: exported ? 'materialized-git-export' : 'host-git-worktree', indexDigest: index === null ? null : fingerprint(index), entriesDigest: fingerprint(entries), materializedDigest: fingerprint(files), files, categories: classify(allPaths) };
    const patterns = sourceBytes.has('pnpm-workspace.yaml') ? workspacePatterns(sourceBytes.get('pnpm-workspace.yaml')) : [];
    const manifests = allPaths.filter(path => path === 'package.json' || patterns.some(pattern => pattern.test(path)));
    const roots = new Set(options.dependencyRoots ?? ['node_modules']);
    const noInstall = Array.isArray(options.dependencyRoots) && options.dependencyRoots.length === 0 && options.dependencyProfile === 'protected-no-install';
    requireFact((roots.size > 0 || noInstall) && [...roots].every(path => safePath(path) && !tracked.has(path) && /(?:^|\/)node_modules$/.test(path)), 'invalid_dependency_roots');
    for (const path of manifests) {
      const manifest = JSON.parse(sourceBytes.get(path).toString('utf8'));
      for (const section of DEPENDENCY_SECTIONS) for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        requireFact(/^(@[\w.-]+\/)?[\w.-]+$/.test(name) && typeof version === 'string', 'unsupported_dependency_manifest');
        requireFact(!/(?:git(?:\+|:)|https?:|ssh:|github:|gitlab:|bitbucket:|file:|link:|portal:|patch:)/i.test(version) && !/^[^:@\s/]+\/[^\s/]+(?:#.*)?$/.test(version), 'dynamic_external_dependency');
        requireFact(!version.includes(':') || /^(?:workspace|npm):/.test(version), 'unsupported_dependency_manifest');
        if (!version.startsWith('workspace:') && !noInstall) {
          const dependencyRoot = dirname(path) === '.' ? 'node_modules' : `${dirname(path)}/node_modules`;
          roots.add(dependencyRoot);
          requireFact(snapshotStat(join(root, dependencyRoot, name)).isDirectory() || snapshotStat(join(root, dependencyRoot, name)).isSymbolicLink(), 'materialized_dependency_missing');
        }
      }
    }
    const dependencyRoots = sorted(roots);
    const dependencyFiles = [], dependencyDirectories = [], dependencySnapshots = [];
    for (const path of dependencyRoots) {
      const absolute = join(root, path);
      assertParents(root, absolute);
      const stat = snapshotStat(absolute);
      requireFact(stat.isDirectory() && !stat.isSymbolicLink(), 'materialized_dependency_root_missing_or_symlink');
      const depPaths = enumerate(absolute, [], budget, false);
      requireFact(depPaths.paths.length > 0, 'materialized_dependencies_empty');
      dependencySnapshots.push({ absolute, paths: depPaths.paths, directories: depPaths.directories });
      dependencyDirectories.push(...depPaths.directories.map(directory => ({ ...directory, path: directory.path === '.' ? path : `${path}/${directory.path}` })));
      states.push(...depPaths.states);
      for (const depPath of depPaths.paths) {
        const item = readInput(root, join(absolute, depPath), [root], budget);
        dependencyFiles.push(item.file); states.push(item);
      }
    }
    const materialized = enumerate(root, dependencyRoots, budget);
    requireFact(JSON.stringify(materialized.paths) === JSON.stringify(sorted(allPaths)) && JSON.stringify(sorted(materialized.directories.map(directory => directory.path))) === JSON.stringify(expectedDirectories(allPaths)), 'untracked_or_ignored_input');
    states.push(...materialized.states);
    result.source.directories = materialized.directories;
    result.source.materializedDigest = fingerprint({ files, directories: materialized.directories });
    result.inventory = readInventory(testInventory, tracked);
    for (const item of states) requireFact(item.before === statIdentity(snapshotStat(item.absolute)), 'input_changed_during_scan');
    if (!exported) requireFact(git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim() === sha && git(root, ['ls-files', '--stage', '-z']) === rawIndex && git(root, ['ls-tree', '-r', '-z', '--full-tree', expectedSha]) === rawTree, 'source_or_index_changed_during_scan');
    else {
      try { snapshotStat(join(root, '.git')); throw new SourceProbeError('git_metadata_in_execution_inputs'); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const finalMaterialized = enumerate(root, dependencyRoots, budget);
    requireFact(JSON.stringify(finalMaterialized.paths) === JSON.stringify(materialized.paths) && JSON.stringify(finalMaterialized.directories) === JSON.stringify(materialized.directories), 'filesystem_changed_during_scan');
    for (const dependency of dependencySnapshots) {
      const finalDependency = enumerate(dependency.absolute, [], budget, false);
      requireFact(JSON.stringify(finalDependency.paths) === JSON.stringify(dependency.paths) && JSON.stringify(finalDependency.directories) === JSON.stringify(dependency.directories), 'dependencies_changed_during_scan');
    }
    result.dependencies = { profile: noInstall ? 'protected-no-install' : 'materialized-install', roots: dependencyRoots, count: dependencyFiles.length, bytes: dependencyFiles.reduce((sum, file) => sum + file.size, 0), digest: fingerprint({ files: dependencyFiles.sort((a, b) => a.path.localeCompare(b.path)), directories: dependencyDirectories }), files: dependencyFiles, directories: dependencyDirectories };
    result.complete = true;
  } catch (error) {
    add(error instanceof SourceProbeError ? error.reason : error?.code === 'ENOENT' ? 'materialized_input_missing' : 'source_probe_read_or_validation_error');
    if (safePath(error?.inputPath)) result.failedInput = error.inputPath;
  }
  // Host collection cannot prove immutability between measurement and use.
  // A JSON caller saying `verified:true`/`readOnly:true` is never authority.
  add('trusted_execution_supervisor_and_immutable_mounts_required');
  return result;
}

/** Filesystem-only API: absent entries fail before any Git process can run. */
export function probeMaterializedInputs(options = {}) {
  return probeMaterializedSource({ ...options, gitEntries: options?.gitEntries ?? null });
}
