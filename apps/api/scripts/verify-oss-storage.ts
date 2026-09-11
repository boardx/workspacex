import { randomUUID } from 'node:crypto';
import { ObjectExistsError } from '../src/application/artifact/ports';
import { createStorageBackends } from '../src/infrastructure/storage/create-object-store';

// Opt-in only. Never delete anything other than this invocation's random key.
async function main() {
  if (process.env.WORKSPACEX_OSS_SMOKE !== '1' || process.env.WORKSPACEX_OBJECT_STORE !== 'oss') {
    throw new Error('Set WORKSPACEX_OSS_SMOKE=1 and WORKSPACEX_OBJECT_STORE=oss');
  }
  const started = performance.now();
  const { objects, purge } = await createStorageBackends();
  const key = `verification/${randomUUID()}/probe.txt`;
  const bytes = Buffer.from('Workspacex OSS 云端验收\n');
  let attempted = false;
  let verified = false;
  try {
    attempted = true;
    await objects.putOnce(key, bytes, 'text/plain');
    const read = await objects.get(key);
    if (!read || !Buffer.from(read).equals(bytes)) throw new Error('Read integrity failed');
    const meta = await objects.head(key);
    if (meta?.sizeBytes !== bytes.length || !meta.mime.startsWith('text/plain')) throw new Error('Metadata failed');
    let duplicateRejected = false;
    try { await objects.putOnce(key, Buffer.from('replacement'), 'text/plain'); }
    catch (error) { if (error instanceof ObjectExistsError) duplicateRejected = true; else throw error; }
    if (!duplicateRejected) throw new Error('Overwrite was accepted');
    const original = await objects.get(key);
    if (!original || !Buffer.from(original).equals(bytes)) throw new Error('Original changed');
    verified = true;
  } finally {
    if (attempted) {
      const results = await purge.purgeAll([key]);
      if (!results[0]?.deleted || await objects.head(key) !== null) {
        // Object key is non-secret and allows targeted operator cleanup.
        console.error(JSON.stringify({ cleanup: 'failed', key }));
        throw new Error('Probe cleanup failed');
      }
    }
  }
  console.log(JSON.stringify({ ossVerified: verified, durationMs: Math.round(performance.now() - started),
    provisionVerified: false }));
}
main().catch(() => { console.error('OSS verification failed; check configuration, permissions and bucket state.'); process.exitCode = 1; });
