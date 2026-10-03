import { execFileSync } from 'node:child_process';

export function listRuntimeSourceFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--', 'apps/api', 'apps/web', 'packages', 'scripts/local-session', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', '.npmrc', '.nvmrc'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}
