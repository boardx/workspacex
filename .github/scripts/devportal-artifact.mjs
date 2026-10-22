/** Bind a Pages archive to its trusted producer; verification never deploys anything. */
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function assertIdentity(identity) {
  if (!/^[a-f0-9]{40}$/.test(identity?.sourceSha ?? '') ||
      !/^[1-9]\d*$/.test(identity?.runId ?? '') || !/^[1-9]\d*$/.test(identity?.runAttempt ?? '')) {
    throw new Error('INVALID_ARTIFACT_IDENTITY');
  }
}

export function verificationIdentity(env) {
  const identity = { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
    runAttempt: env.DEVPORTAL_PRODUCER_ATTEMPT };
  assertIdentity(identity);
  return identity;
}

function withRegularFile(path, consume) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('ARTIFACT_FILE_REQUIRED');
    return consume(fd);
  } finally { closeSync(fd); }
}

function archiveHash(directory) {
  return withRegularFile(join(directory, 'pages.tar.gz'), fd => {
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let size;
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, size));
    return hash.digest('hex');
  });
}

export function sealArchive(directory, identity) {
  assertIdentity(identity);
  const manifest = { schemaVersion: 1, sourceSha: identity.sourceSha, runId: identity.runId,
    runAttempt: identity.runAttempt, archiveSha256: archiveHash(directory) };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`, { flag: 'wx', mode: 0o600 });
  return manifest;
}

export function verifyArchive(directory, identity) {
  assertIdentity(identity);
  const manifest = withRegularFile(join(directory, 'manifest.json'), fd => {
    if (fstatSync(fd).size > 4096) throw new Error('ARTIFACT_MANIFEST_TOO_LARGE');
    return JSON.parse(readFileSync(fd, 'utf8'));
  });
  if (manifest?.schemaVersion !== 1 || manifest.sourceSha !== identity.sourceSha ||
      manifest.runId !== identity.runId || manifest.runAttempt !== identity.runAttempt ||
      !/^[a-f0-9]{64}$/.test(manifest.archiveSha256 ?? '') || manifest.archiveSha256 !== archiveHash(directory)) {
    throw new Error('ARTIFACT_BINDING_MISMATCH');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const operation = process.argv[2];
    if (!['seal', 'verify'].includes(operation) || !process.env.DEVPORTAL_ARTIFACT_DIR) throw new Error('INVALID_ARTIFACT_OPERATION');
    const identity = operation === 'verify' ? verificationIdentity(process.env) :
      { sourceSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
    (operation === 'seal' ? sealArchive : verifyArchive)(process.env.DEVPORTAL_ARTIFACT_DIR, identity);
    console.log(`Devportal artifact ${operation}: passed`);
  } catch {
    console.error('Devportal artifact verification failed');
    process.exitCode = 1;
  }
}
