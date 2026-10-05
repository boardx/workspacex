import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealReleaseCandidate, verifySealedReleaseCandidate } from '../../../packages/cloud-deploy/src/release-candidate.js';
import { releaseTag, frozenTagBinding, validateFrozenTag } from './cn-frozen-release-identity.mjs';

const source = '9b25bfa65662b96c0826fe67506b562ea46aa6d0';
const baseline = 'ba6343199f3c834d6a198f83d0c771614292c82b';
const release = '2026.10.3-cn.1';
const attemptId = 'gha-5321-1';
const digest = 'c'.repeat(64);
const services = ['web', 'api', 'agent', 'sandbox', 'postgres', 'redis'];
const manifest = { schemaVersion: 1, sourceRevision: source, release, platform: 'linux/amd64',
  images: Object.fromEntries(services.map(service => [service, { image: `registry.test/workspacex/${service}@sha256:${digest}` }])) };
const bytes = Buffer.from(JSON.stringify(manifest) + '\n');
const seal = sealReleaseCandidate(bytes, new Date('2026-10-04T00:00:00Z'));
const binding = { releaseSourceSha: source, expectedMainCnSha: baseline, attemptId,
  receiptSha256: digest, governanceReceiptSha256: digest, mainSourceEvidenceSha256: digest,
  manifestSha256: seal.manifestSha256, baselineSha256: digest,
  images: Object.fromEntries(services.slice(0, 4).map(service => [service, `sha256:${digest}`])),
  devappEvidenceSha256: digest, devappWorkflowRunId: 5321 };
const tag = releaseTag(source, attemptId);
const tagObject = { tag, object: { type: 'commit', sha: source }, message: JSON.stringify(frozenTagBinding(binding)) };

describe('fixed 9b manifest and annotated tag freeze', () => {
  it('reuses the exact manifest byte seal and binds the CAS baseline', () => {
    expect(verifySealedReleaseCandidate(seal, bytes, source).manifest.release).toBe(release);
    expect(seal.manifestSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(frozenTagBinding(binding).expectedMainCnSha).toBe(baseline);
    validateFrozenTag(tagObject, tag, binding);
    expect(JSON.stringify(frozenTagBinding(binding))).toBe(tagObject.message);
  });
  it('rejects baseline, attempt, source and manifest substitutions under the frozen tag', () => {
    for (const patch of [{ expectedMainCnSha: 'd'.repeat(40) }, { attemptId: 'gha-other' },
      { releaseSourceSha: 'd'.repeat(40) }, { manifestSha256: 'd'.repeat(64) },
      { images: { ...binding.images, api: `sha256:${'d'.repeat(64)}` } }]) {
      expect(() => validateFrozenTag(tagObject, tag, { ...binding, ...patch })).toThrow('FROZEN_RELEASE_TAG_CHANGED');
    }
  });
  it('rejects release, source, image and whitespace changes against the original seal', () => {
    const substitutions = [ { ...manifest, release: '2026.10.3-cn.2' },
      { ...manifest, sourceRevision: baseline },
      { ...manifest, images: { ...manifest.images, api: { image: `registry.test/workspacex/api@sha256:${'d'.repeat(64)}` } } } ];
    for (const value of substitutions) expect(() => verifySealedReleaseCandidate(seal, Buffer.from(JSON.stringify(value) + '\n'), source)).toThrow('RELEASE_CANDIDATE_MANIFEST_MISMATCH');
    expect(() => verifySealedReleaseCandidate(seal, Buffer.concat([bytes, Buffer.from(' ')]), source)).toThrow('RELEASE_CANDIDATE_MANIFEST_MISMATCH');
  });
  it('does not freeze mutable tags or an incomplete six image closure', () => {
    const mutable = { ...manifest, images: { ...manifest.images, web: { image: 'registry.test/workspacex/web:latest' } } };
    expect(() => sealReleaseCandidate(Buffer.from(JSON.stringify(mutable)))).toThrow('INVALID_RELEASE_MANIFEST');
    const incomplete = structuredClone(manifest);
    delete incomplete.images.redis;
    expect(() => sealReleaseCandidate(Buffer.from(JSON.stringify(incomplete)))).toThrow('INVALID_RELEASE_MANIFEST');
  });
});
