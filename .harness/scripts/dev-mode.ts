// dev-mode.ts — `pnpm harness dev-mode seed`：种下 4 个开发模式预设账号，让 agent
// 不用先在 apps/api 里手翻 tsx 命令、手记 WORKSPACEX_DEV_MODE 环境变量。
//
// 唯一事实源仍是 `packages/dev-mode-accounts`（账号本身）与
// `apps/api/scripts/seed-dev-mode-accounts.ts`（真正落库的逻辑）——本文件只是把已有的
// `WORKSPACEX_DEV_MODE=1 pnpm --filter api exec tsx scripts/seed-dev-mode-accounts.ts`
// 包成 harness 的一条子命令，不重复它的门控/幂等逻辑。见
// `.harness/instructions/dev-mode-testing.md`。
import { sh } from "./lib/sh";
import { log, die } from "./lib/log";
import type { Args } from "./lib/args";

export function devMode(args: Args): void {
  const sub = args._[0];
  if (sub !== "seed") {
    die(`未知子命令 "dev-mode ${sub ?? ""}"。可用：seed（种下 4 个预设账号）`);
  }

  log.step("种开发模式预设账号（admin/lead/consultant/compliance，见 @repo/dev-mode-accounts）");
  const r = sh(
    "WORKSPACEX_DEV_MODE=1 pnpm --filter api exec tsx scripts/seed-dev-mode-accounts.ts",
  );
  process.stdout.write(r.stdout);
  if (r.code !== 0) {
    die(`种子脚本失败（exit ${r.code}）——常见原因：本地 Postgres 未起，或未设置连接串（见 apps/api/scripts/seed-dev-account.ts 同款前置条件）`);
  }
  log.ok("开发模式预设账号已就绪，用法见 .harness/instructions/dev-mode-testing.md");
}
