#!/usr/bin/env node
/**
 * lint-work-stack-gates.mjs —— Work Stack 发布门 G0–G4 的门脚本入口（EV03，ADR-119 #3，04-eval-gates R3.5）。
 *
 * 判定逻辑与 IO 在 apps/api（application/work-eval/work-stack-gates.ts 判定、
 * infrastructure/work-eval/fs-work-stack-gates.ts 发现与读取），因为它要复用 @repo/contracts 的 Zod 契约
 * 与 `harness eval` 的版本 digest 算法（同一事实一处算）。本文件只转发 argv、原样透传退出码。
 * 反证测试：apps/api/tests/work-eval/gates-counterproof.test.ts（坏 fixture 各自判 fail，判 pass 即红）。
 *
 * 用法：pnpm run lint:work-stack-gates [-- --entity S003] [--json]
 */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const r = spawnSync(join(ROOT, "apps/api/node_modules/.bin/tsx"), [join(ROOT, "apps/api/scripts/work-stack-gates.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
