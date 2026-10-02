import base from '/Users/shenyangjun/.codex/worktrees/pr-readiness-files/workspacex/apps/api/vitest.whiteboard-unit.config.ts';
export default {...base, resolve:{...base.resolve, alias:Object.entries(base.resolve.alias).map(([find,replacement])=>({find:find==='@repo/contracts'?/^@repo\/contracts$/:find,replacement}))}};
