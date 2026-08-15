// verify.ts — 逐条执行 feature.verification；全部通过 + base verify 通过才门控 passing。
// 这是"通过状态门控"的唯一实现。agent 不能自己改 passing。
// ADR-012 D5：只有 --sprint 模式能把 status 翻成 passing（证据落盘 + 派生视图刷新
// 与翻转原子绑定）；--phase/--feature 模式仅作调试观察，验证通过也不改 status。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sprintDir } from "./lib/paths";
import { appendFingerprint } from "./lib/evidence-fingerprint";
import {
  loadFeatureList,
  saveFeatureList,
  featuresForSprint,
  assertSingleInProgress,
  writeActiveFeatures,
} from "./lib/features";
import { refreshProgress } from "./lib/progress";
import { loadHarnessConfig } from "./lib/config";
import { resolveSpecRef } from "./lib/spec-ref";
import { sh } from "./lib/sh";
import { req } from "./lib/args";
import { computeFingerprint, currentSha, lookupCredential, recordCredential } from "./lib/verify-cache";
import { log, die } from "./lib/log";
import type { Args } from "./lib/args";
import type { Feature } from "./lib/types";
import { ensureReservedTestIsolation } from "./lib/test-isolation";

export async function verify(args: Args): Promise<void> {
  // One verify invocation owns one isolation scope. Every feature command and the final
  // base gate inherit the same DB/Redis/compose namespace from this single helper.
  // #468：同 with-test-isolation —— 端口向 OS 预留，起子命令前释放。
  const reservation = await ensureReservedTestIsolation(process.env);
  const isolation = reservation.env;
  await reservation.release();
  Object.assign(process.env, isolation, {
    WORKSPACEX_VERIFY_OUTER_DB: isolation.WORKSPACEX_DB,
    WORKSPACEX_VERIFY_OUTER_COMPOSE: isolation.COMPOSE_PROJECT_NAME,
  });
  const cfg = loadHarnessConfig();

  // --sprint NN/MM  或  --phase NN --feature F01
  let phaseId: string, sprintId: string | null = null, only: string | null = null;
  if (args.opts["sprint"]) {
    const parts = req(args, "sprint").split("/");
    phaseId = parts[0]!;
    sprintId = parts[1] ?? null;
  } else {
    phaseId = req(args, "phase");
  }
  only = args.opts["feature"] ?? null;

  const fl = loadFeatureList(phaseId);

  // 门控：同一时刻只允许一个 in_progress（读 config）
  if (cfg.gates.single_in_progress) {
    assertSingleInProgress(fl);
  }

  let targets: Feature[] = sprintId ? featuresForSprint(fl, sprintId) : fl.features;
  if (only) targets = targets.filter((f) => f.id === only);
  if (!targets.length) die("没有匹配的 feature 可验证");

  // --backfill-evidence：仅补写已 passing feature 的真实证据日志（重跑 verification 命令），
  // 绝不改动 status —— 用于修复"verify 曾在非 --sprint 模式下运行、从未落盘证据"的历史缺口。
  // 只在 --sprint 模式下开放，因为只有这条路径才会真的落盘日志文件；--phase 裸时间戳模式
  // 正是被修复的 bug 本身，不应继续被用来产出"证据"。
  const backfillEvidence = args.flags["backfill-evidence"] === true;
  if (backfillEvidence && !sprintId) die("--backfill-evidence 仅支持 --sprint 模式（需要落盘证据目录）");

  let promoted = 0, failed = 0;
  for (const f of targets) {
    if (f.status === "passing" && !backfillEvidence) {
      log.info(`${f.id} 已 passing，跳过（不可逆）`);
      continue;
    }
    const isBackfill = f.status === "passing" && backfillEvidence;
    log.step(`${isBackfill ? "补写证据" : "验证"} ${f.id} — ${f.title}`);
    const logs: string[] = [];
    let ok = true;

    // 0) spec_ref 门控（人类拍板 2026-07-19）：不给已 passing 的历史存量补跑
    // （isBackfill 只修证据、不重新评判 spec，passing_is_irreversible 精神一致）；
    // 对任何"正在被推向 passing"的 feature，没有可追溯的 story 就地拒绝——
    // claim 时已经查过一次，这里是防"claim 后 requirements 文件被删/改坏"的第二道门。
    if (!isBackfill && cfg.gates.spec_ref_required) {
      const specCheck = resolveSpecRef(phaseId, f.spec_ref);
      if (!specCheck.ok) {
        ok = false;
        logs.push(`[SPEC_REF] ${specCheck.reason}`);
        log.err(`${f.id} 缺少可追溯的 story：${specCheck.reason}`);
      }
    }

    // 1) 逐条执行 feature.verification
    if (ok) {
      for (const cmd of f.verification) {
        const r = sh(cmd);
        logs.push(`$ ${cmd}\n[exit ${r.code}]\n${r.stdout}${r.stderr}`);
        if (r.code !== 0) {
          ok = false;
          log.err(`失败: ${cmd}`);
          if (cfg.verification.fail_fast) break;
        } else {
          log.ok(`通过: ${cmd}`);
        }
      }
    }

    if (isBackfill) {
      // 补写模式：不判 base verify，不动 status；只落真实日志 + 更新 evidence 指针。
      // 若重跑发现命令实际失败，如实记录，绝不悄悄抹平——status 仍保持 passing 不动，
      // 留给人工核实这条 passing 判定当初是否有效。
      const ev = join(sprintDir(phaseId, sprintId!), "evidence", `${f.id}.verify.log`);
      writeFileSync(ev, appendFingerprint(logs.join("\n\n")), "utf8");
      f.evidence = `evidence/${f.id}.verify.log @ ${new Date().toISOString()}${ok ? "" : " [BACKFILL: 重跑未通过，请人工核实]"}`;
      if (ok) log.ok(`${f.id} 补写证据完成，重跑通过`);
      else log.err(`${f.id} 补写时重跑未通过——status 不变，已在 evidence 中标注，需人工核实`);
      continue;
    }

    // 2) 如果 feature verification 全部通过，且 config 要求 base verify，额外运行基础验证
    //    同一 SHA + 同一命令 + 工作树无变化时复用上次结果（ADR-106 batch-1/6，#1275）——
    //    verificationType 目前固定用 base_verify_cmd 本身当 key：不同 profile 会有不同的
    //    命令字符串，天然不会互相误命中；等 #1274 落地风险分档后，profile 名字会替代
    //    命令字符串成为更稳定的 key，这里到时候一起改，不重复发明一套。
    if (ok && cfg.verification.require_base_pass) {
      const baseCmd = cfg.verification.base_verify_cmd;
      const sha = currentSha();
      const fingerprint = computeFingerprint(sha);
      const cached = lookupCredential(baseCmd, sha, fingerprint);
      let br: { code: number; stdout: string; stderr: string };
      if (cached) {
        log.step(`命中缓存凭证，跳过基础验证（require_base_pass=true）: ${baseCmd}`);
        log.info(`  上次执行于 ${cached.completedAt}，退出码=${cached.exitCode}`);
        br = { code: cached.exitCode, stdout: "", stderr: cached.exitCode === 0 ? "" : "[verify-cache] 复用上次失败结果，未重新执行" };
      } else {
        log.step(`运行基础验证（require_base_pass=true）: ${baseCmd}`);
        br = sh(baseCmd);
        recordCredential({
          sha,
          fingerprint,
          verificationType: baseCmd,
          command: baseCmd,
          exitCode: br.code,
          completedAt: new Date().toISOString(),
        });
      }
      logs.push(`\n[BASE VERIFY] $ ${baseCmd}\n[exit ${br.code}]\n${br.stdout}${br.stderr}`);
      if (br.code !== 0) {
        ok = false;
        log.err(`基础验证失败，拒绝将 ${f.id} 升为 passing`);
        log.err(`请先修复: ${baseCmd}`);
      } else {
        log.ok(`基础验证通过`);
      }
    }

    // 3) 证据落盘到 sprint evidence
    if (sprintId) {
      const ev = join(sprintDir(phaseId, sprintId), "evidence", `${f.id}.verify.log`);
      writeFileSync(ev, appendFingerprint(logs.join("\n\n")), "utf8");
    }

    if (ok) {
      if (!sprintId) {
        // ADR-012 D5：--phase 模式不落证据日志、不刷派生视图——曾产出"门控真实通过
        // 但审计链断裂"的假 passing（P23 事件，见 docs/postmortems/postmortem-p23-false-passing.md）。
        // 该模式保留为调试观察用途，翻转 passing 一律走 --sprint。
        log.info(`${f.id} 验证全部通过，但 --phase 模式不翻转 passing（无证据落盘）。`);
        log.info(`  正式门控请跑: pnpm harness verify --sprint ${phaseId}/<MM>`);
        continue;
      }
      f.status = "passing";
      f.evidence = `evidence/${f.id}.verify.log @ ${new Date().toISOString()}`;
      promoted++;
      log.ok(`门控通过 -> ${f.id} = passing`);
    } else {
      // 2026-08-12（#1030 人类 Accept）：失败**不产生任何状态转移**。
      // 旧行为 `not_started → in_progress` 是静默认领：sprint 全量 verify 会把
      // 不属于本次任务的 feature 翻成 in_progress 并写回权威清单，制造
      // 「owner 名下 N 个 in_progress」的幽灵违规，被 assertSingleInProgress
      // 拦下后**整条 sprint 的 verify 对所有人停摆**（2026-08-12 夜真实发生，
      // 因果链五步见 #1030）。开工动作只属于 `harness claim`；
      // 通过转 passing 是本函数唯一合法的状态转移。
      failed++;
    }
  }

  saveFeatureList(phaseId, fl);
  if (sprintId) writeActiveFeatures(phaseId, sprintId, fl);
  refreshProgress();
  if (backfillEvidence) {
    log.info(`补写证据完成：共处理 ${targets.filter((f) => f.status === "passing").length} 个已 passing feature。`);
  } else {
    log.info(`完成：${promoted} 个升级为 passing，${failed} 个未通过。`);
  }
  if (failed) process.exitCode = 1;
}
