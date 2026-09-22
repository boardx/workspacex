// merge-queue.ts — 合并队列（GitHub merge queue）语义的**唯一事实源**（#3238）。
//
// 背景（人类 2026-09-09 指令）：每个前端 PR 都无差别跑完整后端验证，合并前还要
// 反复 rebase 追 main，排队与重复计算是当前最大的时延来源。方向是两件事一起做：
//   ① 合并候选组（merge_group）上跑**完整**必需验证 —— 真正代表「这个组合合入
//      main 之后」的状态，取代「PR head 曾经绿过 + 祈祷 main 没变」；
//   ② PR 上对**已证明的纯前端范围**跑快检 —— 但只有在 ① 真正启用之后才允许减，
//      否则就是单纯把验证删掉。
//
// 本文件只做纯判定（无 IO、无网络、可单测）。分层与 pr-queue.ts 一致：
//   lib/merge-queue.ts  纯判定（本文件）
//   workflow / CLI      取事实 → 喂给本文件 → 执行
//
// ⚠ 本文件**不**重新定义「绿」。check 的语义（哪些必需、红/空转/未出结论各算什么）
// 永远只有 lib/pr-queue.ts 的 classifyChecks 一份，required check 清单永远只有
// `.harness/config/ci-check-policy.json` 一份——AGENTS.md「同一事实不得声明在两处」。
// 这里回答的是另外五个问题：
//   1. 这次 workflow run **验证的到底是哪个 commit**（merge_group vs PR vs push）；
//   2. 这批改动**有没有被证明是纯前端**（保守失败关闭）；
//   3. 据此**该跑什么、什么可以推迟到候选组**（且推迟必须有理由、必须队列已启用）；
//   4. 合并该走**入队**还是**直接合并**（两者不是同一件事，不许混为一谈）；
//   5. 事后追溯时，「绿」的证据**是从哪个 commit 上读来的**（旧 PR head 的绿不算）。
import { REQUIRED_CHECKS, mergeAuthorization, type CoordMode, type PrQueueState } from "./pr-queue";

const SHA_RE = /^[0-9a-f]{40}$/;
/** git 的空树 SHA：push 事件里「分支刚建出来，没有上一个 commit」时 `before` 就是它。 */
export const ZERO_SHA = "0".repeat(40);

// ── ① 这次 run 验证的是哪个 commit ─────────────────────────────────────────

export type VerificationTrigger = "pull_request" | "merge_group" | "push" | "other";

/**
 * workflow run 能看到的事实（对应 GitHub 的 `github.*` 上下文）。
 * 字段刻意全部可选：**缺失是常态**，而「缺失时该怎么办」正是本模块要钉死的东西。
 */
export interface WorkflowEventFacts {
  /** `github.event_name` */
  eventName: string;
  /** `github.sha` */
  sha?: string | null;
  /** `github.event.before`（push 事件的上一个 commit） */
  before?: string | null;
  /** `github.base_ref`（只有 pull_request 有；merge_group 上是空的） */
  baseRef?: string | null;
  /** `github.event.pull_request.head.sha`（只有 pull_request 有） */
  pullRequestHeadSha?: string | null;
  /** `github.event.merge_group.head_sha`（只有 merge_group 有） */
  mergeGroupHeadSha?: string | null;
  /** `github.event.merge_group.base_sha`（只有 merge_group 有） */
  mergeGroupBaseSha?: string | null;
}

export interface VerifiedCommit {
  trigger: VerificationTrigger;
  /** 这次验证真正跑在哪个 commit 上 */
  headSha: string;
  /**
   * 这次验证的结论能不能代表「这个组合合入 main 之后」的状态。
   *
   * **只有 merge_group 为 true。** PR head 绿只证明「这个分支单独看是绿的」——
   * 它没有和此刻的 main、也没有和排在它前面的其它 PR 一起验证过。这条布尔值就是
   * 第 5 条（历史判定）的全部依据，别在别处另立一套说法。
   */
  provesMergeCandidate: boolean;
}

function requireSha(value: string | null | undefined, what: string): string {
  const sha = (value ?? "").trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error(`${what}：拿到的是 \`${value ?? "(缺失)"}\`，不是 40 位 commit SHA——查不到不等于没问题（fail-closed）`);
  return sha;
}

/**
 * 解析「这次 run 验证的是哪个 commit」。
 *
 * ⚠ merge_group 上 `github.event.pull_request.*` 与 `github.base_ref` **都是空的**
 * ——这是本 issue 第 1 条的全部要害。照抄 PR 分支的写法会得到空串，而空串在
 * shell / turbo 里不会报错，只会静悄悄地把 diff 基线变成「没有基线」。所以这里
 * 对每个事件各自声明它该读哪个字段，读不到就抛，不做任何「退回 github.sha」的
 * 兜底：兜底会让「我验证了正确的东西」变成一句不可证伪的话。
 */
export function resolveVerifiedCommit(facts: WorkflowEventFacts): VerifiedCommit {
  switch (facts.eventName) {
    case "merge_group":
      return {
        trigger: "merge_group",
        headSha: requireSha(facts.mergeGroupHeadSha, "merge_group 事件必须提供 merge_group.head_sha"),
        provesMergeCandidate: true,
      };
    case "pull_request":
      return {
        trigger: "pull_request",
        headSha: requireSha(facts.pullRequestHeadSha, "pull_request 事件必须提供 pull_request.head.sha"),
        provesMergeCandidate: false,
      };
    case "push":
      return { trigger: "push", headSha: requireSha(facts.sha, "push 事件必须提供 github.sha"), provesMergeCandidate: false };
    default:
      return { trigger: "other", headSha: requireSha(facts.sha, `事件 ${facts.eventName} 必须提供 github.sha`), provesMergeCandidate: false };
  }
}

/**
 * `turbo --affected` 的 diff 基线（`TURBO_SCM_BASE`）。
 *
 * 取不到基线时**抛错而不是返回空串**：空的 TURBO_SCM_BASE 会让 turbo 退回它自己的
 * 默认推断，于是「这次到底比了什么」成了跑完才知道、且没人会去看的事。
 */
export function resolveScmBase(facts: WorkflowEventFacts): string {
  switch (facts.eventName) {
    case "merge_group":
      return requireSha(facts.mergeGroupBaseSha, "merge_group 事件必须提供 merge_group.base_sha 作为 diff 基线");
    case "pull_request": {
      const base = (facts.baseRef ?? "").trim();
      if (base === "") throw new Error("pull_request 事件缺少 github.base_ref，无法确定 diff 基线");
      return `origin/${base}`;
    }
    case "push": {
      const before = requireSha(facts.before, "push 事件必须提供 github.event.before 作为 diff 基线");
      if (before === ZERO_SHA) throw new Error("push 事件的 before 是空 SHA（分支首次推送），无法确定 diff 基线");
      return before;
    }
    default:
      throw new Error(`事件 ${facts.eventName} 没有可证明的 diff 基线`);
  }
}

// ── ② 这批改动有没有被证明是纯前端 ────────────────────────────────────────

export type ChangeScope = "frontend-only" | "full";

export interface ChangeScopeVerdict {
  scope: ChangeScope;
  /** 判成 full 的**全部**理由——只报第一条会让人修一条发现还有三条 */
  reasons: string[];
}

/**
 * **已证明**的纯前端目录（允许清单）。清单之外的一切——包括看起来无害的新目录
 * ——一律完整验证。用允许清单而不是拒绝清单是刻意的：拒绝清单漏一项就是放行，
 * 允许清单漏一项只是多跑一趟。
 */
export const PROVEN_FRONTEND_PREFIXES: readonly string[] = [
  "apps/web/app/",
  "apps/web/components/",
  "apps/web/public/",
];

/**
 * 落在允许清单里、但**仍然**必须完整验证的洞。允许清单是按目录划的，目录里混着
 * 服务端代码：`apps/web/app/api/**` 是 Next.js route handler（真·后端 API），
 * `middleware.ts` 是权限拦截层，两者都不是「改了只影响像素」的东西。
 */
export const FRONTEND_CARVE_OUTS: readonly { readonly test: (path: string) => boolean; readonly why: string }[] = [
  { test: (p) => p.startsWith("apps/web/app/api/"), why: "Next.js route handler 是服务端 API 契约，不是纯前端" },
  { test: (p) => /(^|\/)middleware\.[cm]?[jt]sx?$/.test(p), why: "middleware 是权限/鉴权拦截层" },
  { test: (p) => /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/.test(p), why: "依赖/构建编排改动影响整仓" },
  { test: (p) => /(^|\/)(tsconfig[^/]*\.json|[^/]*\.config\.[cm]?[jt]s|\.nvmrc)$/.test(p), why: "构建/工具链配置改动影响整仓" },
  { test: (p) => /(^|\/)migrations?\//.test(p) || p.endsWith(".sql"), why: "数据库迁移必须完整验证" },
];

/**
 * 保守失败关闭的范围判定：**只有**每一个改动路径都落在允许清单、且不命中任何
 * carve-out 时，才判 `frontend-only`。
 *
 * 空清单判 full：「查不到改了什么」不等于「什么都没改」——同一条三态纪律见
 * `.harness/instructions/static-trace-vs-live-fact.md`。
 */
export function classifyChangeScope(paths: readonly string[]): ChangeScopeVerdict {
  if (paths.length === 0) {
    return { scope: "full", reasons: ["拿不到本次改动的文件清单——查不到不等于没改（fail-closed）"] };
  }
  const reasons: string[] = [];
  for (const raw of paths) {
    const path = raw.trim().replace(/^\.\//, "");
    if (path === "") {
      reasons.push("改动清单里有空路径——无法证明它属于纯前端范围");
      continue;
    }
    const carve = FRONTEND_CARVE_OUTS.find((rule) => rule.test(path));
    if (carve) {
      reasons.push(`\`${path}\`：${carve.why}`);
      continue;
    }
    if (!PROVEN_FRONTEND_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      reasons.push(`\`${path}\`：不在已证明的纯前端允许清单里——未知路径一律完整验证`);
    }
  }
  return reasons.length > 0 ? { scope: "full", reasons } : { scope: "frontend-only", reasons: [] };
}

// ── ③ 该跑什么、什么可以推迟到候选组 ──────────────────────────────────────

/** 任何触发下都必须真实执行的车道（静态检查 + 受影响模块 + 全仓编译 + 合并门禁）。 */
export const ALWAYS_EXECUTED_LANES: readonly string[] = [
  "verify-control-plane",
  "verify-affected",
  "verify-full-compile",
  "merge-gate",
  "gates-fast",
  "prototype-audit",
];

/**
 * 只有在**快检生效**时才允许推迟到候选组的车道：全部是要起真 Docker + Postgres
 * 的那几条，也正是「每个前端 PR 都无差别跑一遍」的成本所在。
 */
export const QUEUE_DEFERRABLE_LANES: readonly string[] = [
  "gates-test",
  "native-document-chain",
  "native-runtime-lane",
  "gates-runtime",
];

export interface VerificationPlanInput {
  trigger: VerificationTrigger;
  scope: ChangeScope;
  /** GitHub 合并队列**是否已经真的启用**。未启用时一律不许减验证。 */
  queueEnabled: boolean;
}

export interface VerificationPlan {
  trigger: VerificationTrigger;
  scope: ChangeScope;
  fastChecksEnabled: boolean;
  /** 本次必须真实出结论的 required check——**永远是策略里那五项**，快检不动这一层 */
  requiredChecks: readonly string[];
  /** 本次真实执行的车道 */
  executedLanes: readonly string[];
  /** 推迟到候选组执行的车道；非空时 justification 必须非空 */
  deferredLanes: readonly string[];
  /** 为什么允许推迟。**不是装饰**：assertPlanIsHonest 会因为它缺失而抛。 */
  justification: string | null;
  reasons: string[];
}

/**
 * 出这一次 run 的执行计划。
 *
 * 三条硬规则（对应 issue 第 2/3/4 条）：
 * - merge_group 永远跑完整验证——候选组就是「合入后长什么样」的唯一证据，在这里
 *   省任何一条，整套设计就失去意义。
 * - 队列没启用 ⇒ 永不减验证。快检的前提是「省下的那部分在候选组补上」，队列不在
 *   就没有「补上」这回事，减了就是纯减。
 * - 范围没被证明是纯前端 ⇒ 不减。判据见 classifyChangeScope（保守失败关闭）。
 */
export function planVerification(input: VerificationPlanInput): VerificationPlan {
  const reasons: string[] = [];
  let fastChecksEnabled = true;
  if (input.trigger === "merge_group") {
    fastChecksEnabled = false;
    reasons.push("merge_group 候选组必须跑完整必需验证——它是「合入之后」的唯一证据");
  }
  if (input.trigger !== "pull_request" && input.trigger !== "merge_group") {
    fastChecksEnabled = false;
    reasons.push(`${input.trigger} 事件不走 PR 快检`);
  }
  if (!input.queueEnabled) {
    fastChecksEnabled = false;
    reasons.push("合并队列尚未启用——队列启用前不得启用任何减少验证的快检（issue #3238 第 4 条）");
  }
  if (input.scope !== "frontend-only") {
    fastChecksEnabled = false;
    reasons.push("本次改动范围未被证明是纯前端——保守走完整验证");
  }

  const deferredLanes = fastChecksEnabled ? QUEUE_DEFERRABLE_LANES : [];
  const executedLanes = fastChecksEnabled
    ? ALWAYS_EXECUTED_LANES
    : [...ALWAYS_EXECUTED_LANES, ...QUEUE_DEFERRABLE_LANES];

  return {
    trigger: input.trigger,
    scope: input.scope,
    fastChecksEnabled,
    requiredChecks: REQUIRED_CHECKS,
    executedLanes,
    deferredLanes,
    justification: fastChecksEnabled
      ? "改动范围经 classifyChangeScope 证明为纯前端，且合并队列已启用——推迟的车道会在 merge_group 候选组上完整执行"
      : null,
    reasons,
  };
}

/**
 * 计划的自检：把「快检不许偷偷把门变空」这件事变成会抛异常的东西。
 *
 * 第 3 条要求「五项 required checks 保持真实，不能把任意 skipped 当 success」。
 * 光靠 review 看 workflow 的 `if:` 条件是看不住的——本仓已经九次出现「全绿但空转」。
 */
export function assertPlanIsHonest(plan: VerificationPlan, required: readonly string[] = REQUIRED_CHECKS): void {
  for (const name of required) {
    if (!plan.requiredChecks.includes(name)) {
      throw new Error(`计划漏掉了 required check \`${name}\`——快检可以少跑活，不可以少一道门`);
    }
  }
  if (plan.deferredLanes.length === 0) return;
  if (plan.trigger === "merge_group") {
    throw new Error("merge_group 候选组不得推迟任何车道——候选组是完整验证的唯一时点");
  }
  if (!plan.fastChecksEnabled) {
    throw new Error("快检未生效却推迟了车道——这是纯粹把验证删掉");
  }
  if (!plan.justification) {
    throw new Error("推迟车道必须写明理由（谁在什么时候把它补上）——没有理由的推迟就是 skipped 当 success");
  }
  for (const lane of plan.deferredLanes) {
    if (!QUEUE_DEFERRABLE_LANES.includes(lane)) {
      throw new Error(`车道 \`${lane}\` 不在可推迟清单里，不得推迟到候选组`);
    }
  }
}

// ── ④ 入队 vs 直接合并 ────────────────────────────────────────────────────

export type MergeRoute = "enqueue" | "direct";

export interface MergeRouteDecision {
  route: MergeRoute;
  allowed: boolean;
  reason: string;
}

/**
 * 合并路线判定。**本函数不合并任何东西**，与 pr-queue.ts 的 mergeAuthorization 同纪律。
 *
 * 授权与否完全委托给 mergeAuthorization（同一件事不允许第二份判据）；本函数只额外
 * 回答「该入队还是该直接合并」——队列启用之后两者**不是同义词**：直接合并跳过候选组
 * 验证，等于绕过这套设计要建立的唯一证据。
 */
export function resolveMergeRoute(input: { state: PrQueueState; mode: CoordMode; queueEnabled: boolean }): MergeRouteDecision {
  const auth = mergeAuthorization(input.state, input.mode);
  const route: MergeRoute = input.queueEnabled ? "enqueue" : "direct";
  if (!auth.allowed) return { route, allowed: false, reason: auth.reason };
  return {
    route,
    allowed: true,
    reason: input.queueEnabled
      ? "机械门禁全绿且人类在场：把 PR **加入合并队列**，由候选组跑完整验证后再合入——直接合并会跳过候选组验证"
      : auth.reason,
  };
}

/** 队列已启用时仍要求直接合并：返回拒绝理由；null = 没有队列，直接合并本来就是唯一路线。 */
export function directMergeRefusal(queueEnabled: boolean): string | null {
  return queueEnabled
    ? "合并队列已启用，直接合并会跳过候选组的完整验证——「这个组合合入 main 之后是绿的」将失去证据，必须走入队"
    : null;
}

// ── ⑤ 事后追溯：绿的证据是从哪个 commit 上读来的 ──────────────────────────

export interface QueueMergeEvidence {
  /** 这次合并是否经由合并队列 */
  mergedViaQueue: boolean;
  /** 实际被验证的候选组 commit（merge_group.head_sha）；查不到为 null */
  candidateSha: string | null;
  /** PR 自己的 head SHA */
  prHeadSha: string;
  /** 这批 check 观测是从哪个 commit 上读来的；查不到为 null */
  checksObservedOn: string | null;
}

/**
 * 第 5 条：历史判定必须证明**实际验证的候选组合**，查不到证据就失败。
 *
 * 队列合并之后，PR head 上那批绿是「这个分支单独看是绿的」，不是「这个组合合入
 * main 之后是绿的」——中间隔着排在它前面的其它 PR 和这期间的 main。拿前者冒充后者
 * 是确定性的假绿，和 pr-green.ts 头部列的三种「直接读 head 现在的 check」同类。
 *
 * 返回失败理由；null = 证据成立。
 */
export function queueEvidenceFailure(evidence: QueueMergeEvidence): string | null {
  if (!evidence.mergedViaQueue) return null; // 直接合并：PR head 就是被验证的那个 commit
  const candidate = (evidence.candidateSha ?? "").trim().toLowerCase();
  if (!SHA_RE.test(candidate)) {
    return "经合并队列合入，却查不到候选组 commit（merge_group.head_sha）——没有证据就是没有证据，不按绿处理";
  }
  const observed = (evidence.checksObservedOn ?? "").trim().toLowerCase();
  if (observed === candidate) return null;
  if (observed !== "" && observed === evidence.prHeadSha.trim().toLowerCase()) {
    return `check 证据读自 PR head \`${evidence.prHeadSha.slice(0, 12)}\`，而真正被验证的是候选组 \`${candidate.slice(0, 12)}\`——旧 PR head 的绿不能冒充新组合通过`;
  }
  return `check 证据读自 \`${evidence.checksObservedOn ?? "(缺失)"}\`，与候选组 \`${candidate.slice(0, 12)}\` 不是同一个 commit——无法证明验证的是实际合入的组合`;
}

// ── merge_group 上的 PR 号解析（供 merge-gate 在候选组上继续出结论）──────

/**
 * 从合并队列的 ref 与候选组 commit 标题里解析 PR 号。
 *
 * 两个来源都要：队列 ref 形如 `refs/heads/gh-readonly-queue/main/pr-123-<base sha>`，
 * 但一个候选组可以**批量**含多个 PR，ref 只写得下最后一个；其余的在 `base..head`
 * 区间各自的 commit 标题里（`… (#N)`）。
 *
 * 解析不出任何 PR 号时返回空数组——调用方必须据此**失败**，不得当成「这个组没有
 * 需要检查的 PR」放行（fail-closed）。
 */
export function parseMergeGroupPrNumbers(ref: string, commitSubjects: readonly string[]): number[] {
  const out = new Set<number>();
  const fromRef = /\/gh-readonly-queue\/[^/]+\/pr-(\d+)-[0-9a-f]{40}$/.exec(ref.trim());
  if (fromRef) out.add(Number(fromRef[1]));
  for (const subject of commitSubjects) {
    for (const m of subject.matchAll(/\(#(\d+)\)/g)) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}
