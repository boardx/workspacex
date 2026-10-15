import { afterEach, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
// @ts-expect-error executable Next configuration has no declaration file
import config from '../next.config.mjs';
const before = { full: process.env.FULLSTACK_E2E_API_ORIGIN, chat: process.env.CHAT_READ_E2E_API_ORIGIN };
afterEach(() => { for (const [key, value] of [['FULLSTACK_E2E_API_ORIGIN', before.full], ['CHAT_READ_E2E_API_ORIGIN', before.chat]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
for (const prefixed of [false, true]) it(`proxies real report-file metadata/jobs/binary routes (${prefixed ? 'fullstack prefix' : 'same origin'})`, async () => {
  if (prefixed) process.env.FULLSTACK_E2E_API_ORIGIN = 'http://127.0.0.1:3207'; else delete process.env.FULLSTACK_E2E_API_ORIGIN;
  process.env.CHAT_READ_E2E_API_ORIGIN = 'http://127.0.0.1:3207';
  const { afterFiles } = await config.rewrites(); const prefix = prefixed ? '/__fullstack_api' : '';
  for (const path of ['/report-files', '/report-files/sources/interview/itv-1', '/report-files/job-1', '/report-files/job-1/download']) {
    const match = afterFiles.find((rule: { source: string }) => getPathMatch(rule.source)(prefix + path));
    expect(match?.destination).toMatch(/^http:\/\/127\.0\.0\.1:3207\/report-files/);
  }
});
