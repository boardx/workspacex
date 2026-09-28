import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {expect, type APIRequestContext, type Page} from '@playwright/test';
import {apiOrigin} from './board-acceptance-support';

const root = resolve(__dirname, '../../..');
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function runtimeSourceIdentity() {
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  const sha = git('rev-parse', 'HEAD'), dirty = git('status', '--porcelain', '--untracked-files=all');
  expect(sha).toMatch(/^[a-f0-9]{40}$/); expect(dirty, 'Acceptance requires exact clean source').toBe('');
  if (process.env.BOARD_ACCEPTANCE_SHA) expect(sha).toBe(process.env.BOARD_ACCEPTANCE_SHA);
  return sha;
}
/** Observe HTTP bytes only; never intercept, mock or rewrite application requests. */
export function observeRuntimeChunks(page: Page) {
  const records = new Map<string, {url: string; sha256: string; localSha256: string}>();
  const pending: Promise<void>[] = [], errors: string[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/_next/static/') || !url.pathname.endsWith('.js')) return;
    const promise = (async () => {
      try {
        const relative = decodeURIComponent(url.pathname.slice('/_next/'.length));
        const path = resolve(root, 'apps/web/.next-fullstack-e2e', relative);
        if (!path.startsWith(resolve(root, 'apps/web/.next-fullstack-e2e/static') + '/')) throw new Error('UNSAFE_CHUNK_PATH');
        // Playwright implements `response.body()` through CDP
        // `Network.getResponseBody`. A navigation can dispose that request before
        // CDP serves the bytes, even though the immutable chunk was loaded and
        // executed successfully. Fetch the same content-addressed chunk URL over
        // HTTP instead; this still proves the bytes served by the fresh runtime,
        // while making collection independent of the page's navigation lifetime.
        const [servedResponse, local] = await Promise.all([
          fetch(response.url(), {cache: 'no-store'}),
          readFile(path),
        ]);
        if (!servedResponse.ok) throw new Error(`RUNTIME_CHUNK_FETCH_${servedResponse.status}`);
        const served = Buffer.from(await servedResponse.arrayBuffer());
        const servedHash = sha256(served), localHash = sha256(local);
        if (servedHash !== localHash) throw new Error('RUNTIME_CHUNK_MISMATCH');
        records.set(url.pathname, {url: url.pathname, sha256: servedHash, localSha256: localHash});
      } catch (error) { errors.push(error instanceof Error ? error.message : 'CHUNK_READ_FAILED'); }
    })();
    pending.push(promise);
  });
  return async () => {await Promise.all(pending); expect(errors).toEqual([]); expect(records.size).toBeGreaterThan(0); return [...records.values()];};
}
export async function verifyRuntimeIdentity(api: APIRequestContext, beforeSha: string, chunks: Awaited<ReturnType<ReturnType<typeof observeRuntimeChunks>>>) {
  expect(runtimeSourceIdentity()).toBe(beforeSha);
  const expectedMarker = process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER;
  expect(expectedMarker, 'Run through the fresh-server acceptance config').toMatch(/^[a-f0-9-]{36}$/);
  const response = await api.get(`${apiOrigin()}/healthz`); expect(response.ok()).toBe(true);
  const health = await response.json() as {deploymentMarker?: string}; expect(health.deploymentMarker).toBe(expectedMarker);
  const path = resolve(root, 'apps/web/.next-fullstack-e2e/BUILD_ID');
  const [buildId, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  const startedAt = process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT ?? '';
  expect(Number.isFinite(Date.parse(startedAt))).toBe(true);
  expect(info.mtimeMs, 'An old build cannot satisfy this run').toBeGreaterThanOrEqual(Date.parse(startedAt));
  return {sha: beforeSha, buildSha: beforeSha, dirty: false, method: 'fresh-server-marker-and-built-chunk-hashes',
    deploymentMarker: health.deploymentMarker!, runStartedAt: startedAt, buildCreatedAt: info.mtime.toISOString(), buildId: buildId.trim(), chunks};
}
