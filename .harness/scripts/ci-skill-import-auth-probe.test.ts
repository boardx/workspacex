import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { probeSkillImportAuthentication } from './ci-skill-import-auth-probe.mjs';

async function run(options: { mode?: string; status?: number; limit?: number; remaining?: number; absent?: boolean } = {}) {
  const logs: string[] = [];
  let calls = 0;
  const request = (url: string, init: { headers: Record<string, string>; timeout: number }, callback: (res: EventEmitter) => void) => {
    calls++;
    expect(url).toBe('https://api.github.com/rate_limit');
    expect(init.headers.authorization).toBe('Bearer FAKE');
    expect(init.timeout).toBe(15_000);
    const req = new EventEmitter() as EventEmitter & { destroy(): void };
    req.destroy = () => { req.emit('error', new Error('FAKE')); req.emit('close'); };
    queueMicrotask(() => {
      if (options.mode === 'timeout') { req.emit('timeout'); return; }
      if (options.mode === 'request-error') { req.destroy(); return; }
      const res = Object.assign(new EventEmitter(), { statusCode: options.status ?? 200 });
      callback(res);
      if (options.mode === 'aborted') { res.emit('aborted'); res.emit('close'); return; }
      if (options.mode === 'close') { res.emit('close'); return; }
      if (options.mode === 'response-error') { res.emit('error', new Error('FAKE')); return; }
      const body = options.mode === 'oversize' ? 'FAKE'.repeat(17_000) : options.mode === 'invalid' ? 'FAKE' : JSON.stringify({ resources: { core: { limit: options.limit ?? 5000, remaining: options.remaining ?? 10 } } });
      res.emit('data', Buffer.from(body)); res.emit('end'); res.emit('close'); req.emit('close');
    });
    return req;
  };
  const code = await probeSkillImportAuthentication({ GH_TOKEN: 'ADMIN', GITHUB_TOKEN: 'ADMIN', ...(options.absent ? {} : { WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: 'FAKE' }) }, request, (x: string) => logs.push(x));
  expect(logs).toHaveLength(1);
  expect(logs.join('')).not.toContain('FAKE');
  expect(logs.join('')).not.toContain('ADMIN');
  return { code, result: JSON.parse(logs[0]!), calls };
}

describe('dedicated public Skill import authentication probe', () => {
  it('skips absent dedicated credentials without borrowing runner tokens', async () => {
    const actual = await run({ absent: true });
    expect(actual).toMatchObject({ code: 0, calls: 0, result: { skipped: true, authenticatedQuota: false, quotaAvailable: false } });
  });
  it('proves authentication and available quota only from validated response', async () => {
    expect(await run()).toMatchObject({ code: 0, result: { authenticatedQuota: true, quotaAvailable: true, limit: 5000, remaining: 10 } });
    expect(await run({ remaining: 0 })).toMatchObject({ code: 0, result: { authenticatedQuota: true, quotaAvailable: false } });
  });
  it.each([{ status: 401 }, { limit: 60 }, { remaining: -1 }, { remaining: 5001 }, { remaining: 1.5 }, { limit: 5000.5 }])('rejects invalid quota/status %j', async options => {
    expect(await run(options)).toMatchObject({ code: 1, result: { authenticatedQuota: false, quotaAvailable: false } });
  });
  it.each(['timeout', 'request-error', 'aborted', 'close', 'response-error', 'oversize', 'invalid'])('fails closed once for %s without logging response or errors', async mode => {
    expect(await run({ mode })).toMatchObject({ code: 1, result: { authenticatedQuota: false, quotaAvailable: false } });
  });
  it('workflow uses only the dedicated secret in the probe step', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/harness-verify.yml', import.meta.url), 'utf8');
    const step = workflow.slice(workflow.indexOf('      - name: Verify dedicated public Skill import authentication'), workflow.indexOf('      # Optional public-repository'));
    expect(step).toContain('WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: ${{ secrets.WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN }}');
    expect(step).not.toContain('github.token');
    expect(step).toContain('node .harness/scripts/ci-skill-import-auth-probe.mjs');
  });
});
