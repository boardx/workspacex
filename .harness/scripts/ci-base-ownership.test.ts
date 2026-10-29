import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('CI base does not repeat full compile owner but retains all tests; local full base stays complete',()=>{
 const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
 expect(scripts['verify:ci-base:raw']).not.toContain('typecheck lint');
 expect(scripts['verify:ci-base:raw']).toBe('pnpm run verify:harness:raw && turbo run test --continue --concurrency=1 --log-order=stream');
 expect(scripts['verify:base:raw']).toContain('turbo run typecheck lint --continue');
 expect(scripts['verify:ci-base']).toContain('with-test-isolation.ts');
});
