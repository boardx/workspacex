/**
 * subagent-orphans.ts —— gen-subagents 生成物的「孤儿方向」判定。
 *
 * 背景（2026-09-09 实测反证）：CI 的防漂移门控是
 *   pnpm harness gen-subagents && git diff --exit-code .claude/agents .codex/agents
 * 它只能看见「已跟踪文件被改写」这一个方向。把 `.harness/agents/rev-uiux.yaml`
 * 删掉再跑一次生成，`.claude/agents/rev-uiux.md` 和 `.codex/agents/rev-uiux.toml`
 * 原封不动留在原地，`git diff` 依旧干净 —— 门控全绿，而生成目录里躺着一个
 * 没有单一事实源的手写副本。规范说「同一事实不得声明在两处」，这条路径正好
 * 造出第二处。
 *
 * 修法：生成器自己负责让生成目录**恰好等于**源集合。多出来的文件被删掉，
 * `git diff --exit-code` 立刻看见这次删除并变红 —— 门控这才真的在判两个方向。
 *
 * 纯函数、无 IO：调用方负责 readdir 和 unlink。
 */

export interface OrphanScanInput {
  /** 源规格解析出的 agent name 集合（.harness/agents/*.yaml + roles/*.yaml）。 */
  readonly expectedNames: readonly string[];
  /** `.claude/agents/` 下的文件名（含扩展名）。 */
  readonly claudeFiles: readonly string[];
  /** `.codex/agents/` 下的文件名（含扩展名）。 */
  readonly codexFiles: readonly string[];
}

export interface OrphanFinding {
  /** 相对仓库根的路径，可直接喂给 unlink。 */
  readonly path: string;
  /** 该文件本该由哪个 name 生成。 */
  readonly name: string;
}

/**
 * 找出生成目录里没有对应源规格的文件。
 * 只看 `.md`（Claude）与 `.toml`（Codex）—— 其它扩展名不是本生成器的产物，
 * 不归本函数管，免得误删别人放在那里的东西。
 */
export function findOrphanArtifacts(input: OrphanScanInput): OrphanFinding[] {
  const expected = new Set(input.expectedNames);
  const findings: OrphanFinding[] = [];

  const scan = (files: readonly string[], ext: string, dir: string): void => {
    for (const file of [...files].sort()) {
      if (!file.endsWith(ext)) continue;
      const name = file.slice(0, -ext.length);
      if (expected.has(name)) continue;
      findings.push({ path: `${dir}/${file}`, name });
    }
  };

  scan(input.claudeFiles, ".md", ".claude/agents");
  scan(input.codexFiles, ".toml", ".codex/agents");
  return findings;
}
