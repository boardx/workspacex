/** Positive proof only: false/unknown always retains the existing deployment path. */
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Exact independent release-control entrypoints. No apps/, packages/, dependencies,
// generic scripts/, or deployment wrapper exemptions. New files require review.
export const CONTROL_PATHS = new Set([
  '.github/workflows/cloud-build-only.yml',
  '.github/workflows/export-cn-image-archives.yml',
  '.github/workflows/archive-bridge-tests.yml',
  '.github/workflows/build-cn-release-artifacts.yml',
  '.github/workflows/prepare-cn-release.yml',
  '.github/workflows/release-cn.yml',
  '.github/workflows/CLOUD-BUILD-ONLY.md',
  '.github/workflows/RELEASE-DRAFT.md',
  'scripts/cn_image_archive.py',
  'scripts/export-cn-image-archives.py',
  'scripts/cn_archive_oss.py',
  'scripts/transfer-cn-image-archives.py',
  '.harness/scripts/vm/import-cn-image-archives.py',
  'tests/test_cn_image_archive.py',
  'tests/test_cn_archive_real_cli.py',
  'tests/test_cn_archive_oss.py',
  'docs/verification/cloud-release-oidc/archive-bridge.md',
  'docs/verification/cloud-release-oidc/manual-prepare-gate.md',
]);

export function proveControlOnly({ eventName, ref, sha, event, git }) {
  const no = reason => ({ skip: false, reason });
  if (eventName !== 'push' || ref !== 'refs/heads/main') return no('not-main-push');
  const before = event?.before;
  if (!/^[0-9a-f]{40}$/.test(before ?? '') || /^0+$/.test(before) ||
      !/^[0-9a-f]{40}$/.test(sha ?? '') || event?.after !== sha ||
      event?.ref !== ref || event?.deleted || event?.forced || before === sha) return no('unproven-event-range');
  try {
    if (git(['rev-parse', 'HEAD']).trim() !== sha) return no('checkout-mismatch');
    git(['cat-file', '-e', `${before}^{commit}`]);
    git(['cat-file', '-e', `${sha}^{commit}`]);
    git(['merge-base', '--is-ancestor', before, sha]);
    const fields = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', before, sha]).split('\0');
    if (fields.pop() !== '' || !fields.length || fields.length % 2) return no('invalid-diff');
    for (let i = 0; i < fields.length; i += 2) {
      // Deletes, renames (represented as delete+add), mode changes, unknown names
      // and non-ASCII/control path spellings cannot establish a skip proof.
      const status = fields[i], path = fields[i + 1];
      if (!['A', 'M'].includes(status) || !CONTROL_PATHS.has(path)) return no('deployment-required-path');
      if (status === 'M') {
        const oldMode = git(['ls-tree', before, '--', path]).split(' ')[0];
        const newMode = git(['ls-tree', sha, '--', path]).split(' ')[0];
        if (oldMode !== newMode) return no('mode-change');
      }
      const mode = git(['ls-tree', sha, '--', path]);
      if (!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(mode)) return no('non-regular-path');
    }
    return { skip: true, reason: 'exact-control-only-range' };
  } catch { return no('git-proof-unavailable'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let proof = { skip: false, reason: 'event-proof-unavailable' };
  try {
    proof = proveControlOnly({ eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      git: args => execFileSync('git', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) });
  } catch { /* missing event inputs retain deployment */ }
  console.log(JSON.stringify(proof));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip_devapp=${proof.skip}\n`);
}
