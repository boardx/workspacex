import { parseArgs } from "./lib/args";
import { log } from "./lib/log";
import { newPhase } from "./new-phase";
import { newAdr } from "./new-adr";
import { newSprint } from "./new-sprint";
import { verify } from "./verify";
import { syncGithub } from "./sync-github";
import { genSubagents } from "./gen-subagents";
import { claim } from "./claim";
import { migrateLabels } from "./migrate-labels";
import { sweepUnblock } from "./sweep-unblock";
import { sweepWorktrees } from "./sweep-worktrees";
import { sweepDocker } from "./sweep-docker";
import { cycleReport } from "./cycle-report";
import { tick } from "./tick";
import { depGraph } from "./dep-graph";
import { doctor } from "./doctor";
import { phaseReadiness } from "./phase-readiness";
import { prQueue } from "./pr-queue";
import { templatesAllocate } from "./templates-allocate";
import { templatesDoctor } from "./templates-doctor";
import { terminologyDoctor } from "./terminology-doctor";
import { lockStatus, lockAcquire, lockHeartbeat, lockRelease } from "./coordinator-lock";
import { moduleLockStatus, moduleLockAcquire, moduleLockHeartbeat, moduleLockRelease } from "./module-lock";
import { graphCommand } from "./graph-command";

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

// Wrapped in an async function only because lock-acquire/heartbeat/release now
// optionally await a coord-service dual-write (Phase 3) — every other command
// is still called synchronously below, unchanged from before.
async function main(): Promise<void> {
  switch (cmd) {
    case "new-phase":     newPhase(args); break;
    case "new-adr":       newAdr(args); break;
    case "new-sprint":    newSprint(args); break;
    case "board":         await import("./phase-board.mjs"); break;
    case "verify":        await verify(args); break;
    case "sync":          syncGithub(args); break;
    case "gen-subagents": genSubagents(args); break;
    case "claim":         claim(args); break;
    case "migrate-labels": migrateLabels(args); break;
    case "sweep-unblock":  sweepUnblock(args); break;
    case "sweep-worktrees": sweepWorktrees(args); break;
    case "sweep-docker":    sweepDocker(args); break;
    case "dep-graph":      depGraph(args); break;
    case "graph":          graphCommand(args); break;
    case "doctor":         doctor(args); break;
    case "phase-readiness": phaseReadiness(args); break;
    case "pr-queue":       prQueue(args); break;
    case "templates": {
      // PROP-HARNESS-MODEL-001 §12 的 UX 是 `pnpm harness templates <sub>`（两词），
      // 与本文件其余命令的单词/连字符风格不同——刻意跟随 Proposal 原文，不改它的
      // 目标 UX 来迁就仓库既有约定。子命令路由在这里做，判定逻辑仍在各自文件里。
      const sub = args._[0];
      const subArgs = { ...args, _: args._.slice(1) };
      if (sub === "doctor") { templatesDoctor(subArgs); break; }
      if (sub === "allocate") { templatesAllocate(subArgs); break; }
      log.err(`未知子命令 "templates ${sub ?? ""}"。可用：doctor / allocate`);
      process.exitCode = 1;
      break;
    }
    case "terminology": {
      // H3A-006/007/008（PROP-HARNESS-AGENT-001）。跟 "templates" 同一 UX
      // 风格：`pnpm harness terminology <sub>`，子命令路由在这里，判定逻辑
      // 在各自文件里。目前只有一个子命令，先按同款结构留出扩展位。
      const sub = args._[0];
      const subArgs = { ...args, _: args._.slice(1) };
      if (sub === "doctor") { terminologyDoctor(subArgs); break; }
      log.err(`未知子命令 "terminology ${sub ?? ""}"。可用：doctor`);
      process.exitCode = 1;
      break;
    }
    case "cycle-report":   await cycleReport(args); break;
    case "tick":           await tick(args); break;
    case "lock-status":    await lockStatus(args); break;
    case "lock-acquire":   await lockAcquire(args); break;
    case "lock-heartbeat": await lockHeartbeat(args); break;
    case "lock-release":   await lockRelease(args); break;
    case "module-lock-status":    await moduleLockStatus(args); break;
    case "module-lock-acquire":   await moduleLockAcquire(args); break;
    case "module-lock-heartbeat": await moduleLockHeartbeat(args); break;
    case "module-lock-release":   await moduleLockRelease(args); break;
    default:
      log.info("用法:");
      log.info("  pnpm harness new-phase     --id NN --name <name> [--slug <s>] [--goal <g>] [--ui]");
      log.info("                             --ui：有界面的阶段，scaffold UI 先行确认关卡（ADR-003）");
      log.info("  pnpm harness new-adr       --title \"<slug 标题>\" [--id ADR-NNN] [--layer methodology|project]");
      log.info("                             # 原子取号 + scaffold + README 索引登记（占号即登记，防撞号）");
      log.info("  pnpm harness new-sprint    --phase NN --id MM [--goal <g>] [--features F01,F02]");
      log.info("  pnpm harness verify        --sprint NN/MM | --phase NN [--feature F01] [--owner <id>]");
      log.info("  pnpm harness sync          --phase NN [--apply]");
      log.info("  pnpm harness gen-subagents             # 从 .harness/agents/*.yaml 生成 Claude + Codex subagents");
      log.info("  pnpm harness claim         --phase NN --feature F01 --owner <agent-id>");
      log.info("  pnpm harness migrate-labels            # 收敛线上 label 到规范 status:*（ADR-004）；加 --apply 执行");
      log.info("  pnpm harness sweep-unblock [--dry-run]                 # depends_on 全 passing 的 blocked → not_started");
      log.info("  pnpm harness sweep-worktrees [--threshold-minutes N]   # 巡检未提交改动的 worker worktree（默认阈值 60）");
      log.info("  pnpm harness sweep-docker [--apply]                    # 巡检孤儿 docker compose 栈（ADR-007）；--apply 实际清理");
      log.info("  pnpm harness dep-graph                                 # 生成 .harness/state/dep-graph.md 依赖图快照");
      log.info("  pnpm harness graph compile [--no-cache]               # 从权威源确定性编译 Graph Snapshot");
      log.info("  pnpm harness graph validate [--no-cache]              # 校验类型、引用、端点与依赖环");
      log.info("  pnpm harness doctor [--phase NN]                       # 审计链体检：passing 证据真实性 + 派生视图一致性（ADR-012）");
      log.info("  pnpm harness phase-readiness --phase NN                # 查看独立 runtime/E2E readiness");
      log.info("  pnpm harness phase-readiness --phase NN --to ready --actor <id> --target-commit <sha> --runtime-evidence <json> --e2e-evidence <json>");
      log.info("  pnpm harness phase-readiness --phase NN --to not_ready --actor <id> --reason <text>");
      log.info("  pnpm harness cycle-report                              # C-cycle 周期健康表（只读，见 work-cycle-proposal.md）");
      log.info("  pnpm harness pr-queue [--pr N] [--json] [--attended]    # PR 队列状态机（只读，#451）；无 --attended 一律不授权合并");
      log.info("  pnpm harness pr-queue --post-merge N [--deployment-tracked]  # 合并后收尾核验：merged + commit 在 main + issue 已关闭");
      log.info("  pnpm harness tick [--session <id>] [--json]            # 每个 loop 跑这条：权威时钟+漂移告警+续租约+收件箱（ADR-014）");
      log.info("  pnpm harness lock-status");
      log.info("  pnpm harness lock-acquire   --session <id> [--force] [--note <text>]");
      log.info("  pnpm harness lock-heartbeat --session <id>");
      log.info("  pnpm harness lock-release   --session <id> [--force]");
      log.info("  pnpm harness module-lock-status    --module <name>");
      log.info("  pnpm harness module-lock-acquire   --module <name> --session <agent-id>");
      log.info("  pnpm harness module-lock-heartbeat --module <name> --session <agent-id>");
      log.info("  pnpm harness module-lock-release   --module <name> --session <agent-id>");
      log.info("  pnpm harness templates doctor                          # PROP-HARNESS-MODEL-001 Epic E1：模板实例唯一性/生命周期/引用完整性体检");
      log.info("  pnpm harness templates allocate --domain <3位大写域码> --name \"<name>\" [--owner <id>] [--authority <text>] [--consumers a,b]");
      log.info("                             # 原子取号 + 登记进 registry.yaml（占号即登记，防撞号，同 new-adr 思路）");
      log.info("  pnpm harness terminology doctor                        # PROP-HARNESS-AGENT-001 H3A-006/007/008：术语注册表 + 兼容映射结构校验");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e: unknown) => {
  log.err((e as Error).message);
  process.exit(1);
});
