import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(await readFile(resolve(root, '.harness/config/trusted-workflow-action-audits.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const sources = catalog.audits.flatMap(audit => [audit.source, ...(audit.kind === 'composite' ? audit.nested.map(item => item.source) : [])]);

for (const source of sources) {
  const response = await fetch(source.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${source.sourceUrl}: upstream returned HTTP ${response.status}`);
  const upstream = Buffer.from(await response.arrayBuffer());
  const vendored = await readFile(resolve(root, source.snapshotPath));
  if (digest(upstream) !== source.sha256) throw new Error(`${source.sourceUrl}: upstream exact-commit digest differs from the trusted catalog`);
  if (!upstream.equals(vendored)) throw new Error(`${source.snapshotPath}: vendored bytes differ from immutable upstream`);
  console.log(`✓ ${source.repository}@${source.commit}:${source.actionPath}`);
}
