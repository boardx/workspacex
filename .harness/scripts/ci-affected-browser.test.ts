import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { needsWebBrowser } from './ci-affected-browser.mjs';

describe('affected web pixel-test browser prerequisite', () => {
  it('installs for a selected web test in both fork and same-repository plans', () => {
    for (const tasks of [[{taskId:'web#test'}], [{taskId:'@repo/api#test'}, {taskId:'web#test'}]]) {
      expect(needsWebBrowser({tasks})).toBe(true);
    }
  });
  it('does not install for docs, API-only, or web lint/typecheck', () => {
    for (const tasks of [[], [{taskId:'@repo/api#test'}], [{taskId:'web#lint'}, {taskId:'web#typecheck'}]]) {
      expect(needsWebBrowser({tasks})).toBe(false);
    }
    expect(() => needsWebBrowser({})).toThrow('tasks');
  });
  it('uses the same test filters and installs Chromium before testing in the same job', () => {
    const yaml=readFileSync('.github/workflows/harness-verify.yml','utf8');
    const job=yaml.split('  verify-affected:')[1]!.split('\n  # 全仓编译门')[0]!;
    expect(job).toContain("pnpm turbo run test --affected --filter='!@repo/api' --dry=json");
    expect(job).toContain('pnpm turbo run test --affected --dry=json');
    expect(job).toContain("if: steps.browserplan.outputs.web_test == 'true'");
    const install=job.indexOf('playwright install --with-deps chromium');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(job.indexOf('- name: 受影响模块 test'));
    expect(job).not.toContain('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
  });
});
