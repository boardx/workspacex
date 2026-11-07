import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('bundles login and session clients without loading the entire contract registry', async () => {
  // Use the compiler already supplied by the installed Vitest/Vite toolchain.
  const fromVitest = createRequire(createRequire(import.meta.url).resolve('vitest/package.json'));
  const fromVite = createRequire(fromVitest.resolve('vite/package.json'));
  const { build } = fromVite('esbuild');
  const { metafile } = await build({
    entryPoints: [resolve('lib/auth.ts'), resolve('lib/session-api.ts')],
    bundle: true,
    platform: 'browser',
    outdir: 'unused-test-output',
    write: false,
    metafile: true,
    // Next dev does not eliminate the unused namespaces from the registry.
    treeShaking: false,
  });
  const inputs = Object.keys(metafile.inputs);
  expect(inputs.filter(path => /packages\/contracts\/src\/index\.ts$/.test(path))).toEqual([]);
  expect(inputs.some(path => /packages\/contracts\/src\/auth\.ts$/.test(path))).toBe(true);
  expect(inputs.some(path => /packages\/contracts\/src\/identity\.ts$/.test(path))).toBe(true);
});
