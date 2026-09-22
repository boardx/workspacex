#!/usr/bin/env node
// lint-contract-route-coverage.mjs —— issue #564 解决方案 2 第 1 条的仓库侧入口。
//
// issue #564 正文逐字点名了这个文件名（「或直接跑
// `node .harness/scripts/lint-contract-route-coverage.mjs`（随解决方案 2 落地）」）。
//
// 判据分两层，都不在本文件里：
//   · 「哪些 operation 缺路由」→ lib/contract-route-coverage{,-fs}.ts（issue #1177）
//   · 「比昨天多缺了哪些」    → lib/contract-route-ratchet.ts（纯函数 + fixture 单测）
// 这里只做三件事：读名单 → 调它们 → 按结果决定退出码。
//
// 退出码语义（与 lint-rewrite-coverage.mjs 一致，两道门是同一条链的上下游）：
//   0  没有新缺口（或输入不足以判定，此时降级为 WARN）
//   1  有新缺口 / 名单有陈旧或畸形条目 / `--strict` 下扫不全
//
// 旗标：
//   --strict  扫不全（incomplete）也退出非 0。PR 门控必须带它——一道 required check
//             在「没做判断」时给绿，就是 fail-open（#2490 的原话）。
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contractRouteCoverage } from "./lib/contract-route-coverage-fs.ts";
import { formatRatchet, judgeContractRouteRatchet } from "./lib/contract-route-ratchet.ts";

const STRICT = process.argv.slice(2).includes("--strict");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWLIST = join(ROOT, ".harness/state/contract-route-coverage-allowlist.json");

// 名单文件读不到 ⇒ 空名单 ⇒ 今天的 253 条缺口全部变成「新增」⇒ 当场红。
// 这是刻意的：棘轮的名单本身丢了，不该表现成「没有缺口」。
const doc = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, "utf8")) : { operations: [] };
const allowlist = doc.operations ?? [];

const verdict = judgeContractRouteRatchet({ report: contractRouteCoverage(), allowlist });
const out = formatRatchet(verdict, { strict: STRICT, allowlistSize: allowlist.length });

for (const line of out.stdout) console.log(line);
for (const line of out.stderr) (out.exitCode === 0 ? console.warn : console.error)(line);
process.exit(out.exitCode);
