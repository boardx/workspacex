// gate-mutation-probe.ts — `pnpm harness gate-probe`
//
// 执行器：对 lib/gate-mutation-spec.ts 登记的每道门，
//   ① 干净树上跑一遍（必须绿）
//   ② 逐条施加变异后再跑（必须红）
// 全程在**临时 detached worktree** 里进行，工作树不被写入一个字节。
//
// 为什么要这个：见 lib/gate-mutation-spec.ts 头注释与 issue #1573。
// 一句话——「门是绿的」和「门在守东西」是两件事，本仓已九次把前者当后者。
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Args } from "./lib/args";
import { log } from "./lib/log";
import {
  GATE_SPECS,
  probePassed,
  summarize,
  type MutationIo,
  type MutationOutcome,
  type ProbeReport,
} from "./lib/gate-mutation-spec";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

function makeIo(root: string): MutationIo {
  return {
    read: (rel) => readFileSync(join(root, rel), "utf8"),
    write: (rel, content) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    },
    exists: (rel) => existsSync(join(root, rel)),
    gitAdd: (rel) => execFileSync("git", ["add", "-f", "--", rel], { cwd: root }),
  };
}

/** 跑一道门，返回退出码。门自身的输出不打到用户面前——只有结论重要。 */
function runGate(root: string, argv: readonly string[]): number {
  try {
    execFileSync("pnpm", ["exec", ...argv], { cwd: root, stdio: "pipe" });
    return 0;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

/** 把 worktree 恢复到干净状态。变异之间必须互不污染。 */
function resetWorktree(root: string): void {
  execFileSync("git", ["reset", "-q"], { cwd: root });
  execFileSync("git", ["checkout", "-q", "--", "."], { cwd: root });
  execFileSync("git", ["clean", "-qfd"], { cwd: root });
}

export function gateMutationProbe(args: Args): void {
  const only = args.opts.gate;
  const specs = only ? GATE_SPECS.filter((s) => s.gate === only) : GATE_SPECS;
  if (specs.length === 0) {
    log.err(`没有匹配的门：${only}。已登记：${GATE_SPECS.map((s) => s.gate).join(", ")}`);
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), "gate-probe-"));
  const wt = join(tmp, "wt");
  log.step(`建临时 worktree（工作树不受影响）：${wt}`);
  execFileSync("git", ["worktree", "add", "-q", "--detach", wt, "HEAD"], { cwd: REPO_ROOT });
  // 变异探针只跑 harness 自己的门，复用主仓 node_modules 即可，不重新 install。
  execFileSync("ln", ["-sfn", join(REPO_ROOT, "node_modules"), join(wt, "node_modules")]);

  const report: ProbeReport = { baselineFailures: [], outcomes: [] };
  const io = makeIo(wt);

  try {
    for (const spec of specs) {
      const hasData = spec.guards(wt, io);
      const baseline = runGate(wt, spec.run);
      if (baseline !== 0) {
        report.baselineFailures.push({ gate: spec.gate, exitCode: baseline });
        log.err(`${spec.gate}: 干净树上就是红的（exit ${baseline}）——变异反证无从谈起`);
        continue;
      }

      for (const m of spec.mutations) {
        let outcome: MutationOutcome;
        if (!hasData) {
          outcome = { gate: spec.gate, mutation: m.name, verdict: "NO_DATA", exitCode: null };
        } else {
          const applied = m.apply(wt, io);
          if (!applied) {
            outcome = { gate: spec.gate, mutation: m.name, verdict: "INEFFECTIVE", exitCode: null };
          } else {
            const code = runGate(wt, spec.run);
            outcome = {
              gate: spec.gate,
              mutation: m.name,
              verdict: code === 0 ? "MISSED" : "CAUGHT",
              exitCode: code,
            };
          }
          resetWorktree(wt);
        }
        report.outcomes.push(outcome);
        const mark = { CAUGHT: "✓", MISSED: "✗", INEFFECTIVE: "!", NO_DATA: "·" }[
          outcome.verdict
        ];
        log.info(`  ${mark} ${spec.gate.padEnd(18)} ${m.name.padEnd(30)} ${outcome.verdict}`);
      }
    }
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: REPO_ROOT });
    rmSync(tmp, { recursive: true, force: true });
  }

  const s = summarize(report);
  log.info("");
  log.info(
    `捕获 ${s.CAUGHT} · 漏过 ${s.MISSED} · 变异未生效 ${s.INEFFECTIVE} · 无数据可判 ${s.NO_DATA}`,
  );
  if (s.NO_DATA > 0) {
    log.warn(
      `${s.NO_DATA} 条变异因为「这道门守的数据不存在」无法施加——门守着空气，` +
        `这是 #1567 要量化的事实，不判失败但必须被看见。`,
    );
  }
  if (probePassed(report)) {
    // 措辞刻意区分：0 捕获 + 全 NO_DATA 也满足 probePassed，但说成"全部变异均被
    // 捕获"就是谎报——反证 C（2026-08-18）当场撞到过。没抓到任何东西时必须说没抓到。
    if (s.CAUGHT === 0) {
      log.warn(
        `gate-probe: ${specs.length} 道门，${s.NO_DATA} 条变异无数据可施加，` +
          `**没有捕获任何东西**——这不是"通过"，是"没测到"。`,
      );
      return;
    }
    log.ok(
      `gate-probe: ${specs.length} 道门，${s.CAUGHT} 条变异全部被捕获` +
        (s.NO_DATA > 0 ? `（另有 ${s.NO_DATA} 条无数据可判）` : ""),
    );
    return;
  }
  for (const f of report.baselineFailures) log.err(`基线红：${f.gate}（exit ${f.exitCode}）`);
  for (const o of report.outcomes) {
    if (o.verdict === "MISSED")
      log.err(`漏过：${o.gate} / ${o.mutation}——注入了这道门本应拦住的缺陷，它仍然绿`);
    if (o.verdict === "INEFFECTIVE")
      log.err(`变异未生效：${o.gate} / ${o.mutation}——探针自身坏了，不是门的问题，先修探针`);
  }
  process.exit(1);
}
