// graph-authority-doctor.ts — H3A-009 的仓库侧入口。
//
// pnpm harness graph-authority doctor
//
// 判定逻辑在 lib/graph-authority.ts（纯函数，喂 fixture 单测）。这里只做：
// 对每条已知投影路径跑 `git ls-files --` → 交给判定函数 → 按结果决定退出码。
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "./lib/paths";
import { KNOWN_PROJECTION_PATHS, findTrackedProjections, type ProjectionCheckInput } from "./lib/graph-authority";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

function gitLsFiles(pathspec: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--", pathspec], { cwd: REPO_ROOT, encoding: "utf8" });
    return out.split("\n").filter((line) => line.length > 0);
  } catch (e) {
    // git ls-files 对不存在的路径也返回空、退出码 0——真正失败（比如不在 git
    // 仓库里）应该让调用方看见，不是被这里吞掉伪装成"干净"。
    throw new Error(`git ls-files 失败（pathspec="${pathspec}"）：${(e as Error).message}`);
  }
}

export function graphAuthorityDoctor(_args: Args): void {
  const results: ProjectionCheckInput[] = KNOWN_PROJECTION_PATHS.map((p) => ({
    path: p.path,
    trackedFiles: gitLsFiles(p.path),
  }));

  const findings = findTrackedProjections(results);

  if (findings.length === 0) {
    log.ok(`[graph-authority doctor] ${KNOWN_PROJECTION_PATHS.length} 条已知投影路径全部干净（未被 Git 追踪）`);
    process.exitCode = 0;
    return;
  }

  log.err(`[graph-authority doctor] FAIL —— ${findings.length} 条投影路径被 Git 追踪：`);
  for (const f of findings) log.err(`   ${f.path}: ${f.message}`);
  process.exitCode = 1;
}
