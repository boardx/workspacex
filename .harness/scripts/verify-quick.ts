#!/usr/bin/env -S pnpm exec tsx
// verify-quick.ts — `pnpm run verify:quick`（ADR-106 batch-1/6，issue #1273）
//
// 定向测试 + affected typecheck/lint/test。给日常小改动用，不是全仓 `verify:release`
// 的替代——它只覆盖本次改动实际影响到的包，不覆盖 `.harness` 控制平面的 19 个 lint
// doctor（那部分是 `verify:harness` 的范围，两者互补，不是子集关系）。
//
// 逻辑与 init.sh 生成的 pre-push hook 相同（拿 merge-base、设 TURBO_SCM_BASE、跑
// `turbo run typecheck lint test --affected`），刻意保留成独立实现：pre-push
// 的收敛（复用本脚本而不是各自维护一份 bash）是 issue #1276 的范围，本次不动
// pre-push，避免两个 issue 互相纠缠、review 责任不清。
import { execFileSync } from "node:child_process";

function sh(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function resolveBaseSha(): string {
  let base = sh("git", ["merge-base", "origin/main", "HEAD"]);
  if (base) return base;

  // 拿不到 merge-base：先 fetch 一次再试——不静默退化成全仓验证（ADR-106 明确要求）。
  console.error("[verify:quick] 解析不到与 origin/main 的 merge-base，先 fetch 一次再试……");
  execFileSync("git", ["fetch", "origin", "main", "--quiet"], { stdio: "inherit" });
  base = sh("git", ["merge-base", "origin/main", "HEAD"]);
  if (base) return base;

  console.error(
    "[verify:quick] fetch 后仍解析不到 merge-base（网络不通，或 origin/main 引用异常）——" +
      "这是环境错误，不是「没有改动」，拒绝假装可以继续。",
  );
  console.error("  排查：git remote -v；git fetch origin main；确认当前分支确实是从 main 分出去的。");
  process.exit(1);
}

function main(): void {
  const baseSha = resolveBaseSha();
  console.log(`[verify:quick] base=${baseSha}（相对 origin/main 的改动面，turbo --affected）`);

  try {
    execFileSync(
      "pnpm",
      ["exec", "tsx", ".harness/scripts/with-test-isolation.ts", "--", "pnpm", "turbo", "run", "typecheck", "lint", "test", "--affected"],
      {
        stdio: "inherit",
        env: { ...process.env, TURBO_SCM_BASE: baseSha },
      },
    );
  } catch (err) {
    // execFileSync 抛的是带完整 stdout/stderr 的 Error 对象——stdio:"inherit" 下
    // 子进程输出已经打印过了，这里只需要把失败退出码原样传出去，不要再吐一遍
    // Node 的原始堆栈，那对判断"验证到底哪步失败"没有信息量。
    const status = (err as { status?: number }).status;
    process.exit(typeof status === "number" ? status : 1);
  }
}

main();
