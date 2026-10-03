import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? (() => { throw new Error('output directory required'); })());
if (output.startsWith(root + '/') || output === root) throw new Error('package outside the source directory');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sha) throw new Error('checkout differs from event SHA');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', 'apps/home'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('tracked home sources are dirty');
if (!readFileSync(resolve(root, 'index.html'), 'utf8').includes('href="https://www.boardx.us/"')) throw new Error('production canonical missing');
mkdirSync(output, { recursive: false });
for (const name of ['index.html', 'privacy.html', '404.html', '_headers', '_redirects', 'robots.txt', 'sitemap.xml', 'assets', 'zh', '.well-known']) {
  cpSync(resolve(root, name), resolve(output, name), { recursive: true, filter: source => !source.endsWith('/.sources.json') });
}
writeFileSync(resolve(output, '.well-known/workspacex-release.json'), JSON.stringify({ commit: sha, project: 'workspacex-home' }) + '\n');
console.log(`Packaged ${sha} for workspacex-home`);
