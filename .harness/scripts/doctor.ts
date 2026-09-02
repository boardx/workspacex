// doctor.ts — 审计链一致性体检（ADR-012）。
// 背景：p23 交付（PR #517）连续三轮被 Block，根因不是代码，而是审计链断裂——
// evidence 是裸时间戳、派生视图与 feature_list 矛盾、passing feature 挂在 sprint:null
// 上导致 --sprint 门控覆盖不到。这些断裂全部可以机器判定，却没有任何工具在 push 前
// 判定它们。本命令补上这个缺口：把"reviewer 逐字节人肉验"变成"一条命令跑完"。
//
// 用法：pnpm harness doctor [--phase NN]   （默认体检 roadmap 里的全部 phase）
// 退出码：有 FAIL = 1（供 pre-push hook / CI 门控用）；只有 WARN = 0。
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findPhaseDir, sprintDir, PROGRESS_PATH, REPO_ROOT, STATE_DIR } from "./lib/paths";
import { loadFeatureList, countByStatus } from "./lib/features";
import { loadRoadmap } from "./lib/roadmap";
import { resolveSpecRef } from "./lib/spec-ref";
import { checkFingerprint, isLegacyEvidence } from "./lib/evidence-fingerprint";
import { auditSignoff } from "./lib/design-signoff";
import { auditPhaseReadiness, type EvidenceProof, type ReadinessEvidenceKind } from "./lib/phase-readiness";
import { loadReferencedEvidenceProof, loadPhaseReadiness } from "./lib/phase-readiness-fs";
import {
  allowlistKey, staleFeatureEvidenceEntries, type AllowlistKey, type PhaseFeatures,
} from "./lib/feature-evidence-ratchet";
import { sh } from "./lib/sh";
import { evidenceLogRelPath, isEvidenceCommitIntegrated } from "./lib/evidence-integration";
import { describeIssueListFailure, listAllIssues } from "./lib/github-issues";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import type { Feature } from "./lib/types";

const FEATURE_EVIDENCE_ALLOWLIST_PATH = join(STATE_DIR, "feature-evidence-allowlist.json");

/** #1136 棘轮名单读取。缺文件视为空名单（拒绝任何非标准 evidence），不是「跳过检查」。 */
function readFeatureEvidenceAllowlist(): readonly AllowlistKey[] {
  if (!existsSync(FEATURE_EVIDENCE_ALLOWLIST_PATH)) return [];
  const doc = JSON.parse(readFileSync(FEATURE_EVIDENCE_ALLOWLIST_PATH, "utf8")) as { entries?: unknown };
  return Array.isArray(doc.entries) ? (doc.entries as AllowlistKey[]) : [];
}

interface Finding {
  level: "FAIL" | "WARN" | "INFO";
  phase: string;
  msg: string;
}

// 「实现是否已在 main 上」的判据抽到 lib/evidence-integration.ts（#1557）：sync 关 issue
// 与本文件 ③ 共用同一份，不再各判一套。re-export 保住既有调用方/测试的导入路径。
export { isEvidenceCommitIntegrated };

/** Phase runtime/E2E readiness is a separate state machine. Feature counts are
 * inputs to its transition gate, never a derived readiness result (#392). */
function checkPhaseReadiness(phaseId: string, findings: Finding[]): void {
  let state;
  try {
    state = loadPhaseReadiness(phaseId);
  } catch (error) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `runtime/E2E readiness：${(error as Error).message}` });
    return;
  }
  const features = loadFeatureList(phaseId).features;
  const proofs: EvidenceProof[] = [];
  if (state.status === "ready") {
    for (const kind of ["runtime", "e2e"] as const satisfies readonly ReadinessEvidenceKind[]) {
      const ref = state.evidence[kind];
      if (!ref) continue;
      const loaded = loadReferencedEvidenceProof(ref, { phase: phaseId, kind });
      if (!loaded.ok) {
        findings.push({ level: "FAIL", phase: phaseId, msg: `runtime/E2E readiness：${loaded.error}` });
        continue;
      }
      proofs.push(loaded.proof);
    }
  }
  const audit = auditPhaseReadiness(state, features, proofs);
  for (const msg of audit.fails) findings.push({ level: "FAIL", phase: phaseId, msg: `runtime/E2E readiness：${msg}` });
  for (const msg of audit.warns) findings.push({ level: "WARN", phase: phaseId, msg: `runtime/E2E readiness：${msg}` });
  if (audit.status === "ready" && audit.fails.length === 0) {
    findings.push({
      level: "INFO",
      phase: phaseId,
      msg: `runtime/E2E READY @ ${state.target_commit!.slice(0, 8)}（独立证据门已通过；非 passing 数量推断）`,
    });
  }
}

/** evidence 字段的合规形态：`evidence/<Fxx>.verify.log @ <ISO时间>`（verify --sprint 产出） */
const EVIDENCE_PATH_RE = /^evidence\/(F\d+)\.verify\.log @ /;
/** 裸 ISO 时间戳（--phase 模式的历史产物，ADR-012 起视为不合规证据） */
const BARE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function checkPassingEvidence(
  phaseId: string,
  f: Feature,
  findings: Finding[],
  evidenceAllowlist: ReadonlySet<AllowlistKey>,
): void {
  if (!f.evidence) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 是 passing 但 evidence 为空——"没有证据=没有完成"` });
    return;
  }
  if (BARE_TIMESTAMP_RE.test(f.evidence.trim())) {
    findings.push({
      level: "FAIL",
      phase: phaseId,
      msg: `${f.id} 的 evidence 是裸时间戳（"${f.evidence}"）——这是 verify --phase 模式的历史产物，不是证据。用 pnpm harness verify --sprint ${phaseId}/<sprint> --backfill-evidence 补真实日志`,
    });
    return;
  }
  if (!EVIDENCE_PATH_RE.test(f.evidence)) {
    // #1136：自由文本 evidence 此前只 WARN，实测这一档能让手改 status=passing
    // 绕过完成定义、doctor 仍全绿。棘轮门（同 #539 rewrite-coverage-allowlist 的
    // 只许收缩模式）：不在 allowlist 里 ⇒ 直接 FAIL；在 allowlist 里 ⇒ 存量豁免。
    const key = allowlistKey(phaseId, f.id);
    if (evidenceAllowlist.has(key)) {
      findings.push({ level: "WARN", phase: phaseId, msg: `${f.id} 的 evidence 非标准形态（"${f.evidence.slice(0, 60)}"）——存量豁免（见 feature-evidence-allowlist.json），待清理` });
    } else {
      findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 的 evidence 非标准形态（"${f.evidence.slice(0, 60)}"），无法机器校验，也不在存量豁免名单里——完成定义不接受一句人话当证据。用 pnpm harness verify --sprint ${phaseId}/<sprint> --backfill-evidence 补真实日志` });
    }
    return;
  }
  // 标准形态 → 文件必须真实存在、非空、且记录了成功退出码
  if (!f.sprint) {
    findings.push({
      level: "FAIL",
      phase: phaseId,
      msg: `${f.id} 是 passing 但 sprint 为 null——evidence 路径无法解析，且 --sprint 门控永远覆盖不到它。给它补 sprint 归属`,
    });
    return;
  }
  const logPath = join(sprintDir(phaseId, f.sprint), "evidence", `${f.id}.verify.log`);
  if (!existsSync(logPath)) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 的 evidence 指向 ${logPath}，但文件不存在` });
    return;
  }
  const size = statSync(logPath).size;
  if (size === 0) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 的 evidence 日志是 0 字节空文件（${logPath}）——空文件不是证据` });
    return;
  }
  const content = readFileSync(logPath, "utf8");
  const rel = relative(REPO_ROOT, logPath);
  if (!content.includes("[exit 0]")) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 的 evidence 日志里没有任何 [exit 0] 记录（${logPath}）——日志存在但看不到成功执行` });
  }
  if (content.includes("[BACKFILL: 重跑未通过")) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 的 evidence 标注了补跑未通过，需人工核实这条 passing 是否成立` });
  }
  // 到这里为止，全部检查都只看日志"长得像不像证据"——而 2026-07-29 的承重测试证明，
  // 手写一份 5 行、含 [exit 0] 的日志就能全过（见 .harness/state/quality-document.md）。
  // 指纹把日志和"verify 真的跑过并落盘"绑定起来。
  const fp = checkFingerprint(content);
  if (fp.kind === "tampered") {
    findings.push({
      level: "FAIL",
      phase: phaseId,
      msg: `${f.id} 的 evidence 日志正文与 verify 落盘时的指纹不一致（${rel}）——日志在产出之后被改过。别手动编辑证据日志，重跑 pnpm harness verify --sprint ${phaseId}/${f.sprint}`,
    });
  } else if (fp.kind === "missing") {
    findings.push(
      isLegacyEvidence(phaseId, f.id)
        ? {
            level: "WARN",
            phase: phaseId,
            msg: `${f.id} 的 evidence 日志没有 verify 指纹（指纹门控上线前的历史存量，已在 evidence-legacy.json 豁免）——跑 pnpm harness verify --sprint ${phaseId}/${f.sprint} --backfill-evidence 补上后把它从名单里删掉`,
          }
        : {
            level: "FAIL",
            phase: phaseId,
            msg: `${f.id} 的 evidence 日志没有 verify 指纹（${rel}）——它不是 pnpm harness verify 产出的。手写的日志不是证据；跑 pnpm harness verify --sprint ${phaseId}/${f.sprint}`,
          },
    );
  }
  // 磁盘上存在还不够：必须被 git 跟踪，否则本地体检通过、origin 上依然断链
  // （全仓 85 FAIL 的最大来源正是"verify 落盘了日志但从未 commit"）。
  if (sh(`git ls-files --error-unmatch "${rel}"`).code !== 0) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 的 evidence 日志只在本地磁盘、未提交进 git（${rel}）——git add 它，否则 origin 上证据链是断的` });
  }
}

/** PROGRESS.md 的该 phase 行必须与 feature_list 实时计数一致（派生视图不许漂移） */
function checkProgressRow(phaseId: string, findings: Finding[]): void {
  if (!existsSync(PROGRESS_PATH)) return;
  const fl = loadFeatureList(phaseId);
  const c = countByStatus(fl.features);
  const row = readFileSync(PROGRESS_PATH, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`| ${phaseId} `));
  if (!row) {
    findings.push({ level: "WARN", phase: phaseId, msg: `PROGRESS.md 里没有 ${phaseId} 行（新 phase 未聚合过？跑一次 verify/sync 即可）` });
    return;
  }
  // 行格式：| id | name | status | not_started | in_progress | blocked | passing |
  const cells = row.split("|").map((s) => s.trim());
  const [ns, ip, blk, pass] = cells.slice(4, 8).map((n) => Number(n));
  if (ns !== c.not_started || ip !== c.in_progress || blk !== c.blocked || pass !== c.passing) {
    findings.push({
      level: "FAIL",
      phase: phaseId,
      msg:
        `PROGRESS.md 与 feature_list 矛盾：PROGRESS 行 =（not_started ${ns} / in_progress ${ip} / blocked ${blk} / passing ${pass}），` +
        `feature_list 实际 =（${c.not_started} / ${c.in_progress} / ${c.blocked} / ${c.passing}）。` +
        `派生视图漂移 = verify 没走完整路径。跑 pnpm harness verify --sprint ${phaseId}/<sprint> 重新聚合`,
    });
  }
}

/** roadmap 阶段状态与实际进度的粗一致性（有 passing 却still not_started = 漂移） */
function checkRoadmapDrift(phaseId: string, findings: Finding[]): void {
  const rm = loadRoadmap();
  const p = rm.phases.find((x) => x.id === phaseId);
  if (!p) return;
  const c = countByStatus(loadFeatureList(phaseId).features);
  if (p.status === "not_started" && c.passing > 0) {
    findings.push({ level: "WARN", phase: phaseId, msg: `roadmap 标 not_started 但已有 ${c.passing} 个 passing——阶段状态漂移，对齐一下（惯例见 fb9307d）` });
  }
  if (p.status === "done" && c.passing < loadFeatureList(phaseId).features.length) {
    findings.push({ level: "WARN", phase: phaseId, msg: `roadmap 标 done 但并非全部 passing——检查是否早标了` });
  }
}

/** in_progress 却没有 owner，且同阶段存在有 owner 的并行开发 = 派发孤儿（p23 F04/F08 事故形态） */
function checkOrphanInProgress(phaseId: string, findings: Finding[]): void {
  const fl = loadFeatureList(phaseId);
  const active = fl.features.filter((f) => f.status === "in_progress");
  const orphans = active.filter((f) => !f.owner);
  if (orphans.length > 0 && active.some((f) => !!f.owner)) {
    findings.push({
      level: "WARN",
      phase: phaseId,
      msg: `多 agent 并行阶段存在无 owner 的 in_progress：${orphans.map((f) => f.id).join(", ")}——认领断档（claim 被 ADR-001 拒后没有回补），用 pnpm harness claim 补 owner`,
    });
  }
}

/** spec_ref 门控（人类拍板 2026-07-19）。只查 in_progress——claim/verify 已经在
 *  两端把关，这里是"审阅时再确认一次"的第三道门，不对已 passing 的历史存量倒查
 *  （216 个历史 feature 从未被要求过 spec_ref，倒查会制造无意义的 FAIL 风暴，
 *  与 passing_is_irreversible 的精神相悖）。in_progress 说明有人正在动它，
 *  此时缺 story 是 FAIL 级——按闭环要求，不该走到这一步都还没有。 */
function checkSpecRef(phaseId: string, f: Feature, findings: Finding[]): void {
  if (f.status !== "in_progress") return;
  const r = resolveSpecRef(phaseId, f.spec_ref);
  if (!r.ok) {
    findings.push({ level: "FAIL", phase: phaseId, msg: `${f.id} 正在 in_progress 但没有可追溯的 story：${r.reason}` });
  }
}


/**
 * 签核链体检（ADR-023 决策六）。
 *
 * doctor 覆盖了证据链、派生视图链、GitHub 可见性链——**签核链是唯一没覆盖的那条**。
 * 而它恰恰是最脆的：`new-sprint` 那道门只在建 sprint 那一刻问一次，
 * 之后 feature 的归属、束的 covers、一致性复核的范围都还能改，没有任何东西回头看。
 * 于是 phase-00 出现了「F18–F22 靠一份从没看过它们的复核解锁开工」。
 *
 * 这里查的是**已经开工或已经完成的** feature（in_progress / passing）——
 * 它们是「已经发生的放行」，正是要回头核对的对象。not_started 由 claim 那道门管。
 *
 * 分级：结构性缺陷与非法签核判 FAIL（它们让「这个设计被人看过了」不成立）；
 * 签名毛边一类判 WARN。沿用既有 `--strict` 约定：strict 只影响「必须已合入 main」，
 * 签核链两种模式一致——签核不存在「时点还没到」的问题，签了就是签了。
 */
function checkSignoffChain(phaseId: string, findings: Finding[]): void {
  let active: string[];
  try {
    active = loadFeatureList(phaseId)
      .features.filter((f) => f.status === "in_progress" || f.status === "passing")
      .map((f) => f.id);
  } catch {
    return;
  }
  // "audit" 模式：见 design-signoff.ts 的 UNSTARTED_PHASE_IS_WARN。
  // 与 "gate" 模式的唯一差别是「零契约束 ∧ 一条 feature 都没开工」由 FAIL 降为 WARN；
  // 其余所有判定逐字相同（同一个函数，不是第二份实现）。
  const audit = auditSignoff(phaseId, active, new Date(), "audit");
  if (!audit.applicable) return; // 该阶段没有 contracts/，未采用契约束流程
  for (const msg of audit.fails) findings.push({ level: "FAIL", phase: phaseId, msg: `签核链：${msg}` });
  for (const msg of audit.warns) findings.push({ level: "WARN", phase: phaseId, msg: `签核链：${msg}` });
}


/* ── GitHub 可见性门控（2026-07-29 新增）─────────────────────────────────────
 *
 * 规范早就有了：`sync-github.ts` 生成的 issue 正文里逐字写着
 * 「分支 `worker/<owner>-<phase>-<feature>-<slug>`，PR 关联本 issue（`Closes #N`）」。
 *
 * **但没有任何东西检查它。** 于是 8 个 feature 一路做到 passing，其中 5 个连 issue
 * 都没有，全部靠直接合进分支再批量 PR。规范不是缺失的，是**没有门控**——
 * 这正是本项目自己那条：「没有脚本的规范条目视为未落地」。
 *
 * 下面四条把它变成会红的东西（④ 是 2026-09-02 #1557 补的反向检查）。
 * ────────────────────────────────────────────────────────────────────────── */

/** issue 正文里的投影 marker，与 sync-github.ts 保持一致 */
function issueMarker(phaseId: string, featureId: string): string {
  return `<!-- harness-feature: ${phaseId}/${featureId} -->`;
}

export interface GhIssue {
  number: number;
  state: string;
  body: string;
  /** gh 的 `stateReason`：COMPLETED / NOT_PLANNED / REOPENED（老版本 gh 可能不带该字段） */
  stateReason?: string | null;
}

/**
 * 一次拉全部 issue（含已关闭），避免逐 feature 查询把 API 打爆。
 *
 * ## ⚠ 2026-08-05：这里原本写死 `--limit 300`，而它在仓库长到 302 个 issue 那天开始说谎
 *
 * `gh issue list` 按**编号从新到旧**返回。上限 300 意味着**最老的那几个被悄悄丢掉** ——
 * 而 phase-00 的 feature 恰恰对应最早那批 issue（F14 是 `#1`）。
 *
 * 后果不是「少查了几条」，是 **doctor 报「F14 已领入 sprint 但 GitHub 上没有对应 issue」
 * 并把审计链判为断裂**。同一份代码 05:25 还绿、05:28 就红，中间没有任何相关改动 ——
 * 那一刻只是新开的 issue 把 `#1` 挤出了窗口。main 因此连红四次，而每一条红都指向
 * 一个**并不存在**的审计链断裂。
 *
 * ## 修法不是「换一个更大的数字」
 *
 * 任何固定上限都会在某一天再次静默截断，而且下一次同样没有人看得出来 ——
 * 上一次它伪装成「F14 缺 issue」，下一次会伪装成别的东西。
 *
 * ⇒ **把截断本身变成一个会报错的事件**：请求一个远高于现实规模的上限，
 *   并断言返回条数没有触到它。触到了就说明还是被截了，此时**宁可返回 null
 *   降级为 WARN，也不要拿一份残缺清单去判「这个 feature 没有 issue」** ——
 *   用不完整的数据做否定性判断，正是本仓一整天在抓的那种「红得不对」。
 */
// 清单加载已收敛到 lib/github-issues.ts（#2483）：sync 的同款 `--limit 500` 停了一个月没跟上
// 这里 2026-08-05 的修法，同一件事两处各写一套正是漂移的来源。这里只保留 doctor 的降级语义。
function loadIssues(): GhIssue[] | null {
  const r = listAllIssues({ cwd: REPO_ROOT });
  if (r.kind === "ok") return r.issues;
  if (r.kind === "truncated") {
    // 触顶 ⇒ 可能被截断 ⇒ 这份清单不足以支撑「某个 feature 没有 issue」这种否定性判断。
    // 走 stdout：doctor 其余的 ✗/⚠ 都在这条流上，另开一条会让它在 CI 日志里
    // 与上下文脱节，也让「跳过了这项检查」这件事更难被看见。
    process.stdout.write(
      `⚠ [doctor] ${describeIssueListFailure(r)}——本次跳过「开发任务必须在 issue 上可见」的检查，而不是用残缺清单误判。\n`,
    );
  }
  return null; // 没装 gh / 没登录 / 离线：降级为 WARN，不阻断本地开发
}

function findIssue(issues: GhIssue[], phaseId: string, f: Feature): GhIssue | undefined {
  return issues.find((i) => i.body?.includes(issueMarker(phaseId, f.id)));
}

/**
 * ① 领了 sprint 的 feature 必须有 issue。
 *
 * 「开发任务必须在 GitHub 上可见」这条，落到机器上就是这一句。
 * 没有 issue 的开发 = 只有做的人知道在做什么。
 */
function checkIssueExists(phaseId: string, f: Feature, issues: GhIssue[], findings: Finding[]): void {
  if (!f.sprint) return; // 未领取的 feature 不要求有 issue
  if (findIssue(issues, phaseId, f)) return;
  findings.push({
    level: "FAIL",
    phase: phaseId,
    msg: `${f.id} 已领入 sprint ${f.sprint} 但 GitHub 上没有对应 issue —— 跑 \`pnpm harness sync --phase ${phaseId} --apply\``,
  });
}

/**
 * ② passing 的 feature，它的 issue 必须已关闭 —— 否则看板上永远显示在做。
 *
 * ⚠ 与 ③ 同样的鸡生蛋：issue 由 PR 的 `Closes #N` 关闭，而 PR 要先 push 才能开。
 *   ⇒ pre-push 是 WARN，CI（`--strict`）才是 FAIL。第一版两条都写成 FAIL，都撞上了。
 */
function checkIssueClosed(
  phaseId: string,
  f: Feature,
  issues: GhIssue[],
  findings: Finding[],
  level: "FAIL" | "WARN",
): void {
  if (f.status !== "passing") return;
  const issue = findIssue(issues, phaseId, f);
  if (!issue || issue.state === "CLOSED") return;
  findings.push({
    level,
    phase: phaseId,
    msg: `${f.id} 是 passing 但 issue #${issue.number} 仍 OPEN —— 跑 sync --apply，或确认 PR 是否带了 \`Closes #${issue.number}\``,
  });
}

/**
 * ④ 反向：issue 已关闭，feature 却还没 passing —— issue 被误关，或 verify 从未回写。
 *
 * ② 只抓「passing 但 issue 仍 OPEN」，方向是单向的：#1557 的两次事故
 * （#1487–#1489 背后没有任何 PR；#1553–#1555 在 PR 开出来之前就被关）都发生在另一侧——
 * issue 已 CLOSED，看板上它「做完了」，仓库里它还是 in_progress，而 #526 定的
 * 「不自动重开」让这种误关永远不会自纠。误关之后审计链看起来反而更干净，
 * 这正是 static-trace-vs-live-fact.md 说的那种静态痕迹。
 *
 * 判据用 feature_list 的 status（权威），不用 label（投影，且 #1676 之前会残留）。
 * NOT_PLANNED 关闭是人类明确放弃，不算漂移。
 *
 * ⚠ 级别：**两种模式都是 WARN**，不是 strict-FAIL。2026-09-02 引入时实测 main 上已有
 *   ≥5 条 in_progress feature 的 issue 处于 CLOSED（01/F34 #87、01/F50 #121、
 *   01/F195 #1433、04/F06 #2447、11/F04 #1649），直接 FAIL 会让每一条 PR 当场红。
 *   先把它变成看得见的东西；清完存量后再升 FAIL（与 ②③ 对齐），那一步另开 issue。
 */
export function judgeClosedIssueDrift(
  f: Pick<Feature, "id" | "status">,
  issue: Pick<GhIssue, "number" | "state" | "stateReason"> | undefined,
): string | null {
  if (!issue || issue.state !== "CLOSED") return null;
  if (f.status === "passing") return null;
  if ((issue.stateReason ?? "").toUpperCase() === "NOT_PLANNED") return null;
  return (
    `${f.id} 的 issue #${issue.number} 已关闭，但 feature 仍是 ${f.status} —— ` +
    `issue 被误关（旧版 sync 按本地 passing 关闭 / PR 提前 Closes）或 verify 从未回写；` +
    `重开 issue，或跑 pnpm harness verify 让状态真的转 passing`
  );
}

function checkIssueClosedButNotDone(phaseId: string, f: Feature, issues: GhIssue[], findings: Finding[]): void {
  const msg = judgeClosedIssueDrift(f, findIssue(issues, phaseId, f));
  if (msg) findings.push({ level: "WARN", phase: phaseId, msg });
}

/**
 * ③ passing 的实现必须**已经在 main 上**。
 *
 * 这一条是「走 PR 合并到 main」的可执行形式，而且刻意用 git 本地判定而不是问 GitHub：
 * 一个 feature 标了 passing、证据也齐，但代码只在某个分支上——那它对别人不存在。
 *
 * 判据是「证据日志所在的那个 commit 是 origin/main 的祖先」。
 * 用证据日志而不是任意代码文件，因为它是 verify 门控写出来的，必然与那次通过对应。
 *
 * ⚠ **pre-push 时它必须是 WARN，不能是 FAIL** —— 否则鸡生蛋：
 *   要合进 main 就得先开 PR，要开 PR 就得先 push，而 push 被「还没进 main」拦住。
 *   第一版就是 FAIL，我当场撞上了。
 *   ⇒ 默认 WARN；CI（合到 main 之后）用 `--strict` 判 FAIL。
 *   这不是放松标准，是把标准放在**它能被满足的那个时点**。
 */
function checkMergedToMain(
  phaseId: string,
  f: Feature,
  findings: Finding[],
  level: "FAIL" | "WARN",
): void {
  if (f.status !== "passing") return;
  const rel = evidenceLogRelPath(phaseId, f);
  if (rel === null) return;
  const head = sh(`git log -1 --format=%H -- ${JSON.stringify(rel)}`, REPO_ROOT);
  if (head.code !== 0 || !head.stdout.trim()) {
    findings.push({
      level: "WARN",
      phase: phaseId,
      msg: `${f.id} 的证据日志 ${rel} 不在 git 历史里 —— 无法判定是否已合入 main`,
    });
    return;
  }
  const commit = head.stdout.trim();
  if (isEvidenceCommitIntegrated(commit)) return;
  findings.push({
    level,
    phase: phaseId,
    msg: `${f.id} 是 passing 但实现（${commit.slice(0, 8)}）还不在 origin/main 上 —— 开 PR 合并，别停在分支上`,
  });
}

export function doctor(args: Args): void {
  const only = args.opts["phase"] ?? null;
  /** `--strict`：把「必须已合入 main」升为 FAIL。CI 用；pre-push 不用（见 checkMergedToMain） */
  const strict = args.flags["strict"] === true;
  const rm = loadRoadmap();
  const phaseIds = (only ? [only] : rm.phases.map((p) => p.id)).filter((id) => {
    try {
      findPhaseDir(id);
      return true;
    } catch {
      return false; // roadmap 里已规划但还没 scaffold 的 phase，跳过
    }
  });

  const findings: Finding[] = [];
  // GitHub 侧一次拉全，离线时降级为一条 WARN 而不是阻断本地开发
  const issues = loadIssues();
  if (issues === null) {
    findings.push({
      level: "WARN",
      phase: "-",
      msg: "读不到 GitHub issue（gh 未登录 / 离线）—— 本次跳过「开发任务必须在 issue 上可见」的检查",
    });
  }
  const evidenceAllowlist = readFeatureEvidenceAllowlist();
  const evidenceAllowlistSet = new Set(evidenceAllowlist);
  // #1136 棘轮体检的输入：只收本次真正扫到的 phase，避免 `--phase 01` 这类局部
  // 运行把「没扫到的 phase」误判成「不再需要」——那会把陈旧检查变成假阳性门。
  const scannedForRatchet: PhaseFeatures[] = [];

  for (const id of phaseIds) {
    let fl;
    try {
      fl = loadFeatureList(id);
    } catch {
      continue; // 没有 feature_list 的 phase（纯 requirements 期）不体检
    }
    scannedForRatchet.push({ phaseId: id, features: fl.features });
    for (const f of fl.features) {
      if (f.status === "passing") {
        checkPassingEvidence(id, f, findings, evidenceAllowlistSet);
        checkMergedToMain(id, f, findings, strict ? "FAIL" : "WARN");
      }
      checkSpecRef(id, f, findings);
      if (issues) {
        checkIssueExists(id, f, issues, findings);
        checkIssueClosed(id, f, issues, findings, strict ? "FAIL" : "WARN");
        checkIssueClosedButNotDone(id, f, issues, findings);
      }
    }
    checkProgressRow(id, findings);
    checkRoadmapDrift(id, findings);
    checkOrphanInProgress(id, findings);
    checkSignoffChain(id, findings);
    checkPhaseReadiness(id, findings);
  }

  // 棘轮只许收缩：只对本次实际扫到的 phase 判陈旧，不动没扫到的那部分名单。
  const scannedPhaseIds = new Set(scannedForRatchet.map((p) => p.phaseId));
  const inScopeAllowlist = evidenceAllowlist.filter((key) => scannedPhaseIds.has(key.split("/")[0] ?? ""));
  for (const stale of staleFeatureEvidenceEntries(scannedForRatchet, inScopeAllowlist)) {
    findings.push({
      level: "FAIL",
      phase: stale.split("/")[0] ?? "-",
      msg: `feature-evidence-allowlist.json 里的 "${stale}" 已陈旧（对应 feature 已不再是「passing + 自由文本 evidence」）——请删掉这一条，留着会遮住未来的回归`,
    });
  }

  const fails = findings.filter((f) => f.level === "FAIL");
  const warns = findings.filter((f) => f.level === "WARN");
  const infos = findings.filter((f) => f.level === "INFO");
  for (const f of fails) log.err(`[${f.phase}] ${f.msg}`);
  for (const f of warns) log.info(`⚠ [${f.phase}] ${f.msg}`);
  for (const f of infos) log.info(`· [${f.phase}] ${f.msg}`);
  log.info(`doctor：体检 ${phaseIds.length} 个 phase — ${fails.length} FAIL / ${warns.length} WARN`);
  if (fails.length) {
    log.err("审计链存在断裂。FAIL 项修复前不要开 PR / 交 review——reviewer 会用同样的标准 Block。");
    process.exitCode = 1;
  } else {
    log.ok(
      "审计链完整：所有 passing 都有真实非空证据、有对应 issue 且已合入 main，" +
        "派生视图与源一致，已开工的 feature 都在一份真正复核过它的签核范围内；" +
        "phase runtime/E2E readiness 已按独立状态与证据门审计（不会由 passing 数量推断）。",
    );
  }
}
