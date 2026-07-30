#!/usr/bin/env node
/**
 * lint-verification-can-fail.mjs —— feature_list 的 `verification` **必须真的会红**
 *
 * 管的是什么：`phases/<phase>/feature_list.json` 里每一条 verification 命令，
 * 都必须是「它验的东西不成立时会非 0 退出」的命令。恒 0 的命令不是弱验证，
 * 它是**假绿**：`verify.ts` 只看退出码（`sh(cmd)` → `r.code !== 0`），
 * 所以一条恒 0 的命令 = 那个 feature 可以零实现转 passing。
 *
 * 为什么这道门控必须存在（不是假设，是 2026-07-30 实测）：
 *   `pnpm --filter web vitest run <任意路径>` **恒 exit 0**——`apps/web/package.json`
 *   有 `test` 脚本、没有 `vitest` 脚本，pnpm 在「无匹配脚本」时安静退出 0。
 *   当时 21 个 feature / 84 点（F48–F68，人类已签核的 agent-runtime + skills 两束的全部）
 *   全部靠这个形态验收 ⇒ 今天就能整套全绿、零实现。
 *   而 `validate-fl.ts` 的 PLACEHOLDER 只认 echo / test -ef / ls / true / cat 五种，
 *   **看不见这一种**。「全绿但空转」在本仓第十次同形。
 *   ⇒ 判据不能是「像不像占位」，必须是「实测它会不会红」。
 *
 * 判定四条：
 *   ① 【静态·黑名单】命令不得命中 `UNTRUSTWORTHY_SHAPES`——一份**已知不可信形态**清单，
 *      每一条都写清是怎么被发现的。恒 0 与「结果不确定」都在内。
 *   ② 【静态·指向物存在性】`pnpm --filter <pkg> run <script>` 的 script 必须真在该包
 *      package.json 里（缺 script ⇒ pnpm exit 0，正是 ① 那条的同一机制）；
 *      脚本类命令的脚本文件必须存在；grep 的目标目录必须存在。
 *   ③ 【动态·实证会红】对每一种**形态**构造一个「必然失败」的变体并真的跑，
 *      要求它非 0 退出。恒 0 ⇒ 点名报红。
 *   ④ 【形态必须登记】无法归类的命令一律报红（「未登记形态」），
 *      而不是静默放过——放过等于给下一种恒 0 形态留了门。
 *
 * 「形态」的定义（③ 抽样的单位，必须写清否则抽样是自欺）：
 *   形态 = 命令去掉**指向物**之后剩下的骨架。指向物 = 会随 feature 变化、
 *   且「不存在时应当让命令变红」的那个操作数：
 *     · vitest 命令 → 测试文件路径      形态键 `vitest-file:<pkg>`
 *     · grep 命令   → 被搜的模式        形态键 `grep`
 *     · 脚本类命令  → 脚本文件路径      形态键 `script-file:<解释器>`
 *     · pnpm run    → 脚本名            形态键 `pnpm-script`（见下方「为什么它没有动态探针」）
 *   同一形态键下的所有命令共用一次探针：因为它们的失败传导路径**逐字相同**
 *   （同一个 pnpm/vitest/grep 调用形式），差异只在指向物。
 *   ⚠ 抽样只在形态**内部**抽，不在形态**之间**抽——全部形态都必须各被探一次，
 *   否则新形态可以躲过实证，而躲过实证正是 V-1 的成因。
 *
 * 为什么 `pnpm-script` 没有动态探针：把脚本名换成一个不存在的名字，pnpm 恰恰 **exit 0**
 *   ——这就是 V-1 的机制本身。所以这一类不靠探针，靠 ② 的静态存在性检查兜住：
 *   script 真的在 package.json 里，则退出码来自那个脚本本身。
 *
 * 用法：
 *   node .harness/scripts/lint-verification-can-fail.mjs [phase-dir-name …]
 *   不带参数 = 扫 phases/ 下全部 feature_list.json。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/* ────────────────────────────────────────────────────────────────────────────
 * ① 已知不可信形态清单
 *
 * 每一条都带 `discovered`：这份清单的价值全在于它记录了**怎么被发现的**。
 * 前五条是 validate-fl.ts:33-39 的原始 PLACEHOLDER（那里已改为 import 本清单，
 * 不再各写一份——「同一事实声明在两处」在本仓已五次真的漂移）。
 * ──────────────────────────────────────────────────────────────────────────── */
export const UNTRUSTWORTHY_SHAPES = [
  {
    name: "echo",
    kind: "always-zero",
    re: /^echo\s/i,
    why: "echo 永远成功；它打印一句话，不验证任何行为。",
    discovered: "harness 模板自带（validate-fl.ts 初版 PLACEHOLDER 五条之一）",
  },
  {
    name: "test-exists",
    kind: "always-zero",
    re: /^test\s+-[ef]\s/i,
    why: "只断言文件存在。文件存在不等于行为正确——空文件也通过。",
    discovered: "harness 模板自带（PLACEHOLDER 五条之一）",
  },
  {
    name: "ls",
    kind: "always-zero",
    re: /^ls\s/i,
    why: "列目录；目录存在即 0，不验证内容。",
    discovered: "harness 模板自带（PLACEHOLDER 五条之一）",
  },
  {
    name: "literal-true",
    kind: "always-zero",
    re: /^true$/i,
    why: "字面恒真。",
    discovered: "harness 模板自带（PLACEHOLDER 五条之一）",
  },
  {
    name: "cat",
    kind: "always-zero",
    re: /^cat\s/i,
    why: "打印文件内容；文件可读即 0。",
    discovered: "harness 模板自带（PLACEHOLDER 五条之一）",
  },
  {
    name: "pnpm-filter-missing-exec",
    kind: "always-zero",
    re: /^pnpm\s+(?:--filter\s+\S+\s+)+(?!exec\b|run\b|dlx\b)\S/,
    why:
      "`pnpm --filter <pkg> vitest run X` 被 pnpm 当作「跑 <pkg> 的 vitest 脚本」；" +
      "该包没有这个脚本，pnpm 在无匹配脚本时**安静退出 0**，任意垃圾路径都判通过。" +
      "正确写法是插入 `exec`：`pnpm --filter <pkg> exec vitest run X`（缺文件时 exit 1，phase-00 全部 22 个 passing 用的就是它）。",
    discovered:
      "2026-07-30 需求分析师审计 V-1：实测「真实路径 exit=0 / 垃圾路径 exit=0」；" +
      "当时 21 个 feature / 84 点（F48–F68，已签核的 agent-runtime + skills 两束全部）靠它验收。",
  },
  {
    name: "swallowed-exit-code",
    kind: "always-zero",
    re: /(\|\|\s*(true|:|exit\s+0)|;\s*(true|exit\s+0))\s*$/,
    why: "`|| true` / `; true` / `; exit 0` 把失败吞掉，命令永远 0。",
    discovered:
      "2026-07-30 与 V-1 同批登记：verify-ui-states.sh 内部就有一处正当的 `|| true`" +
      "（set -e 下 grep 无命中会终止脚本），说明这个写法在本仓真的会被想到——" +
      "写在 verification 里就是假绿。",
  },
  {
    name: "node-dash-e-import",
    kind: "always-zero",
    re: /^node\s+-e\s/,
    why:
      "`node -e \"const s=require('…')\"` 只是把模块 import 进来就结束——import 成功即 exit 0，" +
      "它一条断言都没有。Node 22 起 require 一个 .ts 文件也能成功（类型擦除默认开启），" +
      "所以连「模块能不能被解析」这层弱保证都不成立地绿着。" +
      "verification 里不写内联脚本：要断言就写成测试文件或一个会红的门控脚本。",
    discovered:
      "2026-07-30 本门控上线时实测：phase-03 F04 的 " +
      "`node -e \"const s=require('./apps/web/lib/withdrawal-flow.ts');\"` **exit 0**。" +
      "该 feature 声称「断言全文无『24小时』」，而这条命令根本不看文件内容。" +
      "已改为 `node apps/web/scripts/lint-withdrawal-flow.mjs`（真的会红的单一事实源门控）。",
  },
  {
    name: "root-scope-vitest",
    kind: "nondeterministic",
    re: /^pnpm\s+(?:exec\s+)?vitest\s+run\b/,
    why:
      "从仓库根跑 vitest：根目录没有 tests/、没有 vitest.config.ts，而 vitest 的路径参数是" +
      "**子串匹配**——它会命中 `.claude/worktrees/agent-*/apps/*/tests/**` 里的多份仓库副本。" +
      "⇒ 同一条 verification 的结果取决于当下有几个 agent worktree。它不是恒 0，但它不确定，" +
      "而不确定的门控与假绿等价：绿了不知道绿的是谁。",
    discovered:
      "2026-07-30 需求分析师审计 V-3/V-4：`pnpm vitest run tests/kernel/rbac-two-layer.test.ts` " +
      "在共享 checkout 上实测 `26 failed | 1 passed (27)`，在干净 worktree 上 `1 passed (1)`。" +
      "当时 phase-01 有 219 条这种形态。",
  },
];

/* ── 工作区包名 → 目录 ──────────────────────────────────────────────────────
 * ⚠ `--filter` 接受的**两种**写法都要认：包名（`@repo/api`）与目录名（`api`）。
 *   仓里两种都在用（phase-00 全用 `--filter api`，契约包用 `--filter @repo/contracts`）。
 *   第一版只按 package.json 的 name 建索引，于是把 phase-00 全部 146 条判成「包不存在」——
 *   一个只认一半写法的门控会用假红逼人把正确的命令改坏。
 * ──────────────────────────────────────────────────────────────────────────── */
export function workspacePackages(root = ROOT) {
  const map = new Map();
  for (const group of ["apps", "packages"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const pj = join(base, d, "package.json");
      if (!existsSync(pj)) continue;
      try {
        const { name, scripts } = JSON.parse(readFileSync(pj, "utf8"));
        const entry = { dir: join(group, d), scripts: scripts ?? {} };
        if (name) map.set(name, entry);
        map.set(d, entry); // 目录名写法

      } catch {
        /* 坏 package.json 由别的门控管 */
      }
    }
  }
  return map;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 形态归类 + 「必然失败」变体构造
 *
 * 返回 { shape, probe, checks } —— checks 是静态存在性检查项（② 用）。
 * 归类不了 ⇒ 返回 null，调用方报「未登记形态」。
 * ──────────────────────────────────────────────────────────────────────────── */
const PROBE_TOKEN = "__verification_gate_probe_absent__";

export function classify(cmd) {
  const c = cmd.trim();

  // vitest：pnpm --filter <pkg> exec vitest run <path>
  let m = /^pnpm\s+--filter\s+(\S+)\s+exec\s+vitest\s+run\s+(\S+)\s*$/.exec(c);
  if (m) {
    const [, pkg, path] = m;
    return {
      shape: `vitest-file:${pkg}`,
      probe: `pnpm --filter ${pkg} exec vitest run tests/${PROBE_TOKEN}.test.ts`,
      checks: [{ type: "package", pkg }, { type: "test-file", pkg, path }],
    };
  }

  // pnpm run：pnpm --filter <pkg> run <script>
  m = /^pnpm\s+--filter\s+(\S+)\s+run\s+([\w:.-]+)\s*$/.exec(c);
  if (m) {
    const [, pkg, script] = m;
    return {
      shape: "pnpm-script",
      probe: null, // 见文件头「为什么 pnpm-script 没有动态探针」
      checks: [{ type: "package", pkg }, { type: "package-script", pkg, script }],
    };
  }

  // pnpm run + 位置参数（如 `pnpm --filter web run e2e tests/e2e/x.spec.ts`）：
  // 与上一条的区别是它**有指向物**（那个路径），所以这一类可以也必须有动态探针。
  m = /^pnpm\s+--filter\s+(\S+)\s+run\s+([\w:.-]+)\s+(\S+)\s*$/.exec(c);
  if (m) {
    const [, pkg, script, arg] = m;
    return {
      shape: `pnpm-script-arg:${pkg}:${script}`,
      probe: `pnpm --filter ${pkg} run ${script} ${dirname(arg)}/${PROBE_TOKEN}${extname(arg)}`,
      checks: [{ type: "package", pkg }, { type: "package-script", pkg, script }],
    };
  }

  // grep：grep -rq '<pattern>' <dir>
  m = /^grep\s+(-\S+\s+)*('[^']*'|"[^"]*"|\S+)\s+(\S+)\s*$/.exec(c);
  if (m) {
    const dir = m[3];
    return {
      shape: "grep",
      probe: `grep -rq '${PROBE_TOKEN}' ${dir}`,
      checks: [{ type: "path", path: dir }],
    };
  }

  // 脚本类：[bash|sh|node|tsx|pnpm exec tsx] <repo-relative script path> [args…]
  m = /^(bash\s+|sh\s+|node\s+|npx\s+tsx\s+|pnpm\s+exec\s+tsx\s+)?((?:apps|packages|scripts|\.harness)\/\S+\.(?:sh|mjs|js|cjs|ts))(\s.*)?$/.exec(
    c,
  );
  if (m) {
    const interp = (m[1] ?? "direct ").trim() || "direct";
    const path = m[2];
    const rest = m[3] ?? "";
    const absent = `${dirname(path)}/${PROBE_TOKEN}${extname(path)}`;
    return {
      shape: `script-file:${interp}`,
      probe: `${m[1] ?? ""}${absent}${rest}`,
      checks: [{ type: "path", path }],
    };
  }

  return null;
}

/* ── 探针执行（可注入，便于反证套件模拟「探针恒 0」）────────────────────── */
function realProbe(cmd, root) {
  const r = spawnSync("bash", ["-c", cmd], { cwd: root, encoding: "utf8" });
  return r.status ?? 1;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 主体
 * ──────────────────────────────────────────────────────────────────────────── */
export function lintVerificationCanFail({
  root = ROOT,
  phasesRoot = join(root, "phases"),
  only = [],
  featureLists = null, // 反证套件直接喂 [{ phase, features }]
  runProbe = realProbe,
} = {}) {
  const errors = [];
  const pkgs = workspacePackages(root);

  const lists =
    featureLists ??
    (existsSync(phasesRoot) ? readdirSync(phasesRoot) : [])
      .filter((d) => (only.length ? only.includes(d) : true))
      .map((d) => ({ dir: d, fl: join(phasesRoot, d, "feature_list.json") }))
      .filter((x) => existsSync(x.fl))
      .map((x) => ({ phase: x.dir, ...JSON.parse(readFileSync(x.fl, "utf8")) }));

  if (lists.length === 0) {
    errors.push(
      "[无清单] 一个 feature_list.json 都没找到。空集会让本门控平凡为真——" +
        "宁可红，不可假绿（AGENTS.md 完成定义 / 纪律第 10 条）。",
    );
    return { errors, rows: [], probes: [] };
  }

  /** 形态键 → { probe, 首次出现的 feature/命令 } */
  const shapes = new Map();
  const rows = [];

  for (const list of lists) {
    const feats = list.features ?? [];
    let cmdCount = 0;
    for (const f of feats) {
      for (const raw of f.verification ?? []) {
        cmdCount++;
        const cmd = String(raw).trim();
        const at = `${list.phase} ${f.id}`;

        /* ① 黑名单 */
        const hit = UNTRUSTWORTHY_SHAPES.find((s) => s.re.test(cmd));
        if (hit) {
          errors.push(
            `[${hit.kind === "always-zero" ? "恒 0" : "结果不确定"}:${hit.name}] ${at} 的 verification 不可信：\n` +
              `    $ ${cmd}\n` +
              `    为什么：${hit.why}\n` +
              `    怎么发现的：${hit.discovered}`,
          );
          continue;
        }

        /* ④ 形态必须登记 */
        const cls = classify(cmd);
        if (!cls) {
          errors.push(
            `[未登记形态] ${at}：\n` +
              `    $ ${cmd}\n` +
              `    本门控不认识这个形态，因此无法证明它会红。要么改成已登记的形态，\n` +
              `    要么在 classify() 里登记它并给出「必然失败变体」的构造方式。\n` +
              `    静默放过等于给下一种恒 0 形态留门——V-1 就是这么进来的。`,
          );
          continue;
        }

        /* ② 静态存在性 */
        for (const chk of cls.checks) {
          if (chk.type === "package" && !pkgs.has(chk.pkg)) {
            errors.push(
              `[包不存在] ${at}：\`--filter ${chk.pkg}\` 在工作区里没有这个包。\n    $ ${cmd}`,
            );
          }
          if (chk.type === "package-script") {
            const p = pkgs.get(chk.pkg);
            if (p && !(chk.script in p.scripts)) {
              errors.push(
                `[脚本不存在→恒 0] ${at}：${chk.pkg} 的 package.json 里没有 \`${chk.script}\` 脚本。\n` +
                  `    $ ${cmd}\n` +
                  `    pnpm 在无匹配脚本时退出 0 —— 这条会永远绿。这正是 V-1 的机制。`,
              );
            }
          }
          if (chk.type === "path" && !existsSync(join(root, chk.path))) {
            errors.push(
              `[指向物不存在] ${at}：命令引用的 ${chk.path} 不存在。\n    $ ${cmd}`,
            );
          }
          // chk.type === "test-file" 是**故意不报错**的：
          // 测试文件还没写 = 该 feature 还没实现，这条 verification 应当红，
          // 而它确实会红（vitest 收集不到文件 exit 1）。报错会把「未实现」误判成「清单写错」。
        }

        if (cls.probe && !shapes.has(cls.shape)) {
          shapes.set(cls.shape, { probe: cls.probe, at, sample: cmd });
        } else if (!cls.probe && !shapes.has(cls.shape)) {
          shapes.set(cls.shape, { probe: null, at, sample: cmd });
        }
      }
    }
    rows.push({ phase: list.phase, features: feats.length, commands: cmdCount });
  }

  /* ③ 动态实证：每种形态一次 */
  const probes = [];
  for (const [shape, info] of shapes) {
    if (!info.probe) {
      probes.push({ shape, skipped: true, reason: "见文件头：换脚本名恰恰 exit 0，靠 ② 静态兜住" });
      continue;
    }
    const code = runProbe(info.probe, root);
    probes.push({ shape, probe: info.probe, code });
    if (code === 0) {
      errors.push(
        `[恒 0:实证] 形态 \`${shape}\` 的「必然失败变体」竟然 exit 0 —— 该形态的所有 verification 都是假绿。\n` +
          `    探针：$ ${info.probe}\n` +
          `    样本：$ ${info.sample}   （首次出现于 ${info.at}）\n` +
          `    「指向物不存在时命令仍然绿」意味着 verify.ts 读到的通过与实现无关。`,
      );
    }
  }

  return { errors, rows, probes };
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith("lint-verification-can-fail.mjs")) {
  const { errors, rows, probes } = lintVerificationCanFail({ only: process.argv.slice(2) });
  for (const r of rows) {
    console.log(`  · ${r.phase.padEnd(34)} ${String(r.features).padStart(4)} feature / ${r.commands} 条 verification`);
  }
  for (const p of probes) {
    if (p.skipped) console.log(`  ~ 形态 ${p.shape.padEnd(28)} 无动态探针（${p.reason}）`);
    else console.log(`  ${p.code === 0 ? "✗" : "✓"} 形态 ${p.shape.padEnd(28)} 必然失败变体 exit ${p.code}`);
  }
  if (errors.length) {
    console.error("");
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(
      `\n❌ lint-verification-can-fail: ${errors.length} 处不可信的 verification。` +
        `\n   verify.ts 只看退出码：一条恒 0 的命令 = 那个 feature 可以零实现转 passing。`,
    );
    process.exit(1);
  }
  console.log(
    `✅ lint-verification-can-fail: ${rows.reduce((a, r) => a + r.commands, 0)} 条 verification 全部属于已登记形态，` +
      `${probes.filter((p) => !p.skipped).length} 种形态实测「指向物不存在时会非 0 退出」`,
  );
}
