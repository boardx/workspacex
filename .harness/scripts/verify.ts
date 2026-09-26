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
import { describeMissingTargets, missingVerificationTargets } from "./lib/verification-targets";
import { sh } from "./lib/sh";
import { req } from "./lib/args";
import { cacheReadDisabled, computeFingerprint, currentSha, lookupCredential, recordCredential } from "./lib/verify-cache";
import { collectChangedFiles, resolveVerifyProfile } from "./lib/verify-risk";
import { describeSkipped, nonOwnerWriteWarning, partitionByWriteScope } from "./lib/verify-evidence-scope";
import type { EvidenceScopeOptions } from "./lib/verify-evidence-scope";
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

  // #1025（coord-main 2026-08-12 批）：只对**本次任务对象**做写操作。
  // 旧行为把扫到的每一个 feature 的 evidence 日志覆写成本次运行的输出（失败也照写），
  // 于是 sprint 里并存的其他 owner 的审计材料被静默替换成别人的失败日志
  // （2026-08-12 dev-project 收口 F158 时连续覆写 F34/F50，实录见 #1025）。
  // 默认只认 `--feature` 点名的、或 `--owner` 名下的；要动别人的必须显式 `--all`。
  const scope: EvidenceScopeOptions = {
    only,
    owner: args.opts["owner"] ?? null,
    all: args.flags["all"] === true,
  };
  const { inScope, skipped } = partitionByWriteScope(targets, scope);
  const skipNote = describeSkipped(skipped, scope);
  if (skipNote) log.warn(skipNote);
  if (!inScope.length) die("没有属于本次任务对象的 feature 可验证（见上一行跳过说明）");
  targets = inScope;

  // --backfill-evidence：仅补写已 passing feature 的真实证据日志（重跑 verification 命令），
  // 绝不改动 status —— 用于修复"verify 曾在非 --sprint 模式下运行、从未落盘证据"的历史缺口。
  // 只在 --sprint 模式下开放，因为只有这条路径才会真的落盘日志文件；--phase 裸时间戳模式
  // 正是被修复的 bug 本身，不应继续被用来产出"证据"。
  const backfillEvidence = args.flags["backfill-evidence"] === true;
  if (backfillEvidence && !sprintId) die("--backfill-evidence 仅支持 --sprint 模式（需要落盘证据目录）");

  // #1332：风险由**本次改动碰了哪些文件**决定，是改动的属性而非 feature 的属性，
  // 所以整轮只收集一次，循环内所有 feature 共用同一个判定。
  const changedFiles = collectChangedFiles();

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

    // 0.5) 指向物存在性门控（#965）：verification 声称要跑的测试文件必须真的在仓库里。
    //
    // 为什么不能只靠「命令跑不绿」兜住——2026-09-21 实测，两条独立的路径都能让
    // 「声称的测试文件不存在」一路绿到 passing：
    //   ① vitest 的路径参数是**子串过滤器**不是文件名。
    //      `pnpm --filter @repo/contracts exec vitest run tests/contract-shape.test.ts tests/__nope__.test.ts`
    //      → `Test Files  1 passed (1)` **exit 0**（同一条命令只给那个不存在的路径时 exit 1）。
    //      声称跑两个、实际跑一个，退出码看不出差别，而本函数只看退出码。
    //   ② 命令在 agent worktree 里跑绿，测试文件却没被提交（F166 的证据日志就是这样，
    //      见 verification-target-allowlist.json 的取证）。
    // ⇒ 判据必须独立于退出码：先问「指向物在不在」，再谈「跑没跑绿」。
    //
    // 只在「正在被推向 passing」的路径上生效，跳过补写模式（isBackfill 同 spec_ref 门控的
    // 理由：补写不重新评判，只如实记录）。还没实现的 feature 在清单里先写下将来要建的测试
    // 路径是本仓的正常用法（`lint-verification-can-fail.mjs` 为此**故意**不查存在性），
    // 它在这里判红不改变任何结果：那条 verification 本来就跑不绿，而失败不产生状态转移
    // （见下方 2026-08-12 那条注释）。差别只在报错说的是哪件事——
    // 「你声称的测试文件不存在」比 vitest 的 `No test files found` 指得准。
    if (ok && !isBackfill) {
      const missing = missingVerificationTargets(f);
      if (missing.length > 0) {
        ok = false;
        const detail = describeMissingTargets(f.id, missing);
        logs.push(`[VERIFICATION_TARGET]\n${detail}`);
        log.err(detail);
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
      const backfillWarning = nonOwnerWriteWarning(f, scope, ok);
      if (backfillWarning) log.warn(backfillWarning);
      f.evidence = `evidence/${f.id}.verify.log @ ${new Date().toISOString()}${ok ? "" : " [BACKFILL: 重跑未通过，请人工核实]"}`;
      if (ok) log.ok(`${f.id} 补写证据完成，重跑通过`);
      else log.err(`${f.id} 补写时重跑未通过——status 不变，已在 evidence 中标注，需人工核实`);
      continue;
    }

    // 2) 如果 feature verification 全部通过，按风险分档额外运行基础验证
    //    （ADR-106 batch-1/6，#1274：取代原来的全局布尔 require_base_pass），
    //    同一 SHA + 同一 profile + 工作树无变化时复用上次结果（ADR-106 batch-1/6，#1275）——
    //    这里用 profile 的 level 当缓存 key（不是命令字符串本身）：#1275 落地时
    //    #1274 还没合，只能先用命令字符串当 key；#1274 一起合入后按预告改成
    //    level，更稳定（同一档位换了命令实现也还是同一档、缓存语义不受影响）。
    if (ok) {
      const { level, cmd: baseCmd, matched, failClosedReason } = resolveVerifyProfile(
        changedFiles,
        cfg.verification,
      );
      if (failClosedReason) {
        log.info(`  ⚠ 拿不到改动清单（${failClosedReason}）——fail-closed 按 high_risk 处理`);
      } else if (matched.length > 0) {
        const shown = matched.slice(0, 3).map((m) => `${m.path} ⟵ ${m.pattern}`).join("; ");
        log.info(`  高风险命中 ${matched.length} 处：${shown}${matched.length > 3 ? " …" : ""}`);
      }
      const sha = currentSha();
      const fingerprint = computeFingerprint(sha);
      // #1334：只有成功结果会被写进凭证（recordCredential 拒绝非零退出码），
      // 所以命中即通过——不存在"重放一个失败结果"的路径。基础设施抖动导致的
      // 失败因此永远会被重跑，不会被钉死。
      const cached = cacheReadDisabled() ? null : lookupCredential(level, sha, fingerprint);
      let br: { code: number; stdout: string; stderr: string };
      if (cached) {
        log.step(`命中缓存凭证，跳过基础验证（风险档=${level}）: ${baseCmd}`);
        log.info(`  上次通过于 ${cached.completedAt}（WORKSPACEX_VERIFY_NO_CACHE=1 可强制重跑）`);
        br = { code: cached.exitCode, stdout: "", stderr: "" };
      } else {
        log.step(`运行基础验证（风险档=${level}）: ${baseCmd}`);
        br = sh(baseCmd);
        recordCredential({
          sha,
          fingerprint,
          verificationType: level,
          command: baseCmd,
          exitCode: br.code,
          completedAt: new Date().toISOString(),
        });
      }
      const riskNote = failClosedReason
        ? `fail-closed: ${failClosedReason}`
        : matched.length > 0
          ? `matched: ${matched.map((m) => `${m.path}⟵${m.pattern}`).join(", ")}`
          : "no high-risk path touched";
      logs.push(`\n[BASE VERIFY] (risk=${level}; ${riskNote}) $ ${baseCmd}\n[exit ${br.code}]\n${br.stdout}${br.stderr}`);
      if (br.code !== 0) {
        ok = false;
        log.err(`基础验证失败，拒绝将 ${f.id} 升为 passing`);
        log.err(`请先修复: ${baseCmd}`);
      } else {
        log.ok(`基础验证通过（${level}）`);
      }
    }

    // 3) 证据落盘到 sprint evidence
    //    这里写的一定是本次任务对象（作用域在循环外已按 #1025 收窄）；
    //    经 --all / --feature 写到别人名下且未通过时，额外出声提醒。
    if (sprintId) {
      const ev = join(sprintDir(phaseId, sprintId), "evidence", `${f.id}.verify.log`);
      writeFileSync(ev, appendFingerprint(logs.join("\n\n")), "utf8");
      const warning = nonOwnerWriteWarning(f, scope, ok);
      if (warning) log.warn(warning);
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
