/**
 * contract-route-ratchet.ts —— 「契约 → 路由」棘轮（issue #564 解决方案 2 第 1 条）。
 *
 * ## 它和 `contract-route-coverage.ts` 的分工：判据只有一份
 *
 * **本文件不判断任何一条 operation 有没有路由。** 那件事的唯一判据在
 * `contract-route-coverage.ts`（issue #1177）：契约解析、NestJS 路由解析、路径形状匹配、
 * 束是否进入判定范围，全部在那边，本文件只消费它输出的 `CoverageReport`。
 * 根 `AGENTS.md`：**同一事实不得声明在两处**——本仓已五次因此漂移。如果这里再写一遍
 * 「什么算有路由」，两份判据会在第一次 controller 写法变化时分叉，而分叉的那天
 * 两边都还是绿的。
 *
 * 分工一句话：**#1177 回答「今天缺哪些」，本文件回答「比昨天多缺了哪些」**。
 *
 * ## 为什么是棘轮，不是全绿门
 *
 * issue #564 正文逐字：253 条缺口今天补不完，写个全绿门只会被放宽到能过为止
 * ——那就是又造一个空转的门。棘轮今天就能合：当前缺口记进 allowlist，名单**只能变短**；
 * 新增一条声明了 path 却没接线的 operation → 当场红。
 *
 * 这与 `rewrite-coverage.ts`（#539，route ↔ rewrite 那一路）是同一个形状，刻意照抄：
 * 两道门守的是同一条链的上下游（契约 → 路由 → rewrite → 前端够得到），
 * 形状一致才能让读的人不必分别理解两套语义。
 *
 * ## 三类名单条目，分开处理（这是本文件唯一的新判断）
 *
 * 对 allowlist 里的每一条，按它所属束**今天在不在判定范围内**分流：
 *
 *   · **仍是缺口**（束在范围内 ∧ 报告里有这条 gap）→ 正常豁免，什么都不做。
 *   · **已经不是缺口**（束在范围内 ∧ 报告里没有这条 gap）→ **stale，判红**，要求删掉。
 *     留着一条已经补好的豁免，等于给未来的回归留一扇没人看守的门（#539 原话）。
 *   · **束今天不判**（`inScope: false`）→ **dormant，保留，不判红**。
 *
 * 第三类是本文件相对 #539 多出来的一层，它不是可有可无的：#1177 的判定范围是**束级**
 * 近似，一个束里只要新进一个 `not_started` feature，整束都会退出判定范围，
 * 它名下的缺口会从报告里整批消失。若把它们当 stale 要求删除，后果是——
 *
 *   ① 棘轮被**静默放宽**：名单变短看起来像在进步，实际是判据缩了；
 *   ② 那个束将来重新进入范围时，这批老缺口会被读成「新增」，当场红在一个
 *      什么都没做错的 PR 上。
 *
 * 也就是说，「名单里这条不在今天的 gaps 里」是一个**静态痕迹**，它有两种完全相反的
 * 成因（补好了 / 不判了），必须去读会随状况改变的信号（束的 `inScope`）才能区分。
 * 这正是根 `AGENTS.md`「静态痕迹 ≠ 动态事实」那一条。
 *
 * ⚠ 代价要说清楚：dormant 条目不会被自动清理，束被删掉或改名后它的条目会一直躺在名单里。
 * 这份残留**只能**遮住一个不存在的束里的 operation，所以是可接受的压舱物；
 * 而反过来（误删）遮住的是真实回归。两害相权取其轻，选的是这一边。
 *
 * ## 扫不全就不判（fail-closed，方向是「不下结论」）
 *
 * 同 #539 / #2490：扫到 0 条路由、或 0 个束进入判定范围时，**拒绝做否定性判断**——
 * 这种输入下「名单里的条目全都不是缺口了」会被读成一次巨大的进步，实际是扫描器坏了。
 * 报 `incomplete`，只读模式降级 WARN，`--strict`（PR 门控）下退出非 0。
 * 一道 required check 在「没做判断」时给绿，就是 fail-open。
 */
import type { CoverageGap, CoverageReport } from "./contract-route-coverage";

/** 名单条目的形状：`<束>:<operation 名>`。 */
export const ENTRY_SEPARATOR = ":";

export interface EntryRef {
  readonly bundle: string;
  readonly operation: string;
}

/**
 * 条目身份**只由束 + operation 名构成，不含 method/path**。
 *
 * 契约里改 path 属于改设计，那时这条会被读成「新缺口」而变红——这是故意的：
 * 改了路径而仍然没有路由，是一件该被人看见一眼的事，删一行名单的成本很低。
 * 反过来，把 path 写进 key 的话，名单会在每次路径微调时批量变红，红多了就会被整体放宽。
 */
export function gapKey(ref: EntryRef): string {
  return `${ref.bundle}${ENTRY_SEPARATOR}${ref.operation}`;
}

/** 解析一条名单条目。形状不对 → null（调用方判红，见 `malformedEntries`）。 */
export function parseEntry(entry: string): EntryRef | null {
  const at = entry.indexOf(ENTRY_SEPARATOR);
  if (at <= 0 || at === entry.length - 1) return null;
  const bundle = entry.slice(0, at).trim();
  const operation = entry.slice(at + 1).trim();
  if (bundle === "" || operation === "") return null;
  return { bundle, operation };
}

export interface RatchetInput {
  /** `contract-route-coverage` 的判定结果——本文件唯一的事实来源。 */
  readonly report: CoverageReport;
  /** 棘轮名单：`<束>:<operation>`。只能变短。 */
  readonly allowlist: readonly string[];
}

export interface RatchetVerdict {
  /** true = 输入不足以判定，调用方必须降级为 WARN 而不是报「没有新缺口」。 */
  readonly incomplete: boolean;
  readonly incompleteReason: string | null;
  /** 不在名单里的缺口 —— 棘轮变长了，判红。 */
  readonly newGaps: readonly CoverageGap[];
  /** 名单里、束仍在判定范围内、但今天已经不是缺口 —— 判红，要求删条目。 */
  readonly staleEntries: readonly string[];
  /** 名单里、但所属束今天不进入判定范围 —— 保留，不判红（见文件头注第三类）。 */
  readonly dormantEntries: readonly string[];
  /** 形状不对的条目 —— 判红：它永远匹配不上任何缺口，只会变成永久压舱物。 */
  readonly malformedEntries: readonly string[];
  /** 名单里今天仍然对应一条真实缺口的条目数。 */
  readonly activeEntries: number;
}

/** 本次判定是否应当让调用方非 0 退出（`incomplete` 的处置交给调用方，见 `--strict`）。 */
export function ratchetFailed(v: RatchetVerdict): boolean {
  return v.newGaps.length > 0 || v.staleEntries.length > 0 || v.malformedEntries.length > 0;
}

export function judgeContractRouteRatchet(input: RatchetInput): RatchetVerdict {
  const { report, allowlist } = input;

  const empty = (reason: string): RatchetVerdict => ({
    incomplete: true,
    incompleteReason: reason,
    newGaps: [],
    staleEntries: [],
    dormantEntries: [],
    malformedEntries: [],
    activeEntries: 0,
  });

  // 扫不全就不判。空结果最可能的成因是「扫描器坏了 / 文件挪了」，
  // 而不是「这个仓库真的一条路由都没有」。
  if (report.routesParsed === 0) {
    return empty("interface 侧解析出 0 条路由——扫描器或路径失效，拒绝据此判定「名单可以变短」");
  }
  const inScope = report.bundles.filter((b) => b.inScope);
  if (inScope.length === 0) {
    return empty("0 个契约束进入判定范围——签核/feature 清单读不到时，整份名单会被误判成陈旧");
  }
  if (report.operationsInScope === 0) {
    return empty("判定范围里 0 条 operation——契约解析可能失效，拒绝据此判定缺口");
  }

  const inScopeBundles = new Set(inScope.map((b) => b.bundle));
  const gapByKey = new Map<string, CoverageGap>();
  for (const g of report.gaps) gapByKey.set(gapKey(g), g);

  const allowed = new Set<string>();
  const stale: string[] = [];
  const dormant: string[] = [];
  const malformed: string[] = [];
  let active = 0;

  for (const raw of allowlist) {
    const ref = parseEntry(raw);
    if (ref === null) {
      malformed.push(raw);
      continue;
    }
    const key = gapKey(ref);
    allowed.add(key);
    if (gapByKey.has(key)) {
      active += 1;
      continue;
    }
    // 不在今天的 gaps 里 —— 两种相反的成因，靠束的 inScope 区分，见文件头注。
    if (inScopeBundles.has(ref.bundle)) stale.push(raw);
    else dormant.push(raw);
  }

  const newGaps = report.gaps.filter((g) => !allowed.has(gapKey(g)));

  return {
    incomplete: false,
    incompleteReason: null,
    newGaps,
    staleEntries: stale,
    dormantEntries: dormant,
    malformedEntries: malformed,
    activeEntries: active,
  };
}

/* ───────────────────────── 输出（与退出码同源，便于直接单测） ───────────────────────── */

export interface RatchetOutput {
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/**
 * 把判定渲染成命令行输出 + 退出码。
 *
 * 刻意放在纯函数里：`--strict` 的语义（扫不全时红还是绿）是这道门最容易被静默改坏的
 * 一行，放在 `.mjs` 里就只能靠 spawn 才能测，而 spawn 测不到「扫不全」这个分支
 * ——除非给脚本加一个能指向假仓库的旗标，那本身就是一个绕过面。
 */
export function formatRatchet(v: RatchetVerdict, opts: { strict: boolean; allowlistSize: number }): RatchetOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];

  if (v.incomplete) {
    stderr.push(`! [contract-route-ratchet] 扫不全，本次不判定：${v.incompleteReason}`);
    stderr.push("  这不是「通过」，是「没做判断」——请修扫描器或路径，别让它一直静默。");
    if (opts.strict) {
      stderr.push("✗ [contract-route-ratchet] --strict：门控模式下「没做判断」不能当绿，退出非 0。");
      return { exitCode: 1, stdout, stderr };
    }
    return { exitCode: 0, stdout, stderr };
  }

  if (v.newGaps.length > 0) {
    stderr.push(
      `✗ [contract-route-ratchet] ${v.newGaps.length} 条契约 operation 声明了 path，` +
        "但 apps/api/src/interface/ 里没有对应路由，且不在棘轮名单里：",
    );
    for (const g of v.newGaps) {
      stderr.push(`   · [${g.phase}] ${g.bundle}  ${g.method} ${g.path}  （${g.operation} @ ${g.contractFile}）`);
    }
    stderr.push("");
    stderr.push("   棘轮只减不增：要么在 apps/api/src/interface/ 里把路由接上，");
    stderr.push("   要么——只有在这条确实不该现在接线时——由人把它加进");
    stderr.push("   .harness/state/contract-route-coverage-allowlist.json 并在 PR 里写明为什么。");
    stderr.push("   逐条看全量清单：pnpm harness contract-routes");
  }

  if (v.staleEntries.length > 0) {
    stderr.push(
      `✗ [contract-route-ratchet] 名单里有 ${v.staleEntries.length} 条已经不缺了，请删掉：` +
        v.staleEntries.join("、"),
    );
    stderr.push("   （这些条目所属的束今天仍在判定范围内，缺口消失＝路由补上了。）");
    stderr.push("   留着一条已补好的豁免，等于给未来的回归留一扇没人看守的门。");
  }

  if (v.malformedEntries.length > 0) {
    stderr.push(
      `✗ [contract-route-ratchet] 名单里有 ${v.malformedEntries.length} 条形状不对（应为 \`<束>:<operation>\`）：` +
        v.malformedEntries.join("、"),
    );
    stderr.push("   形状不对的条目永远匹配不上任何缺口，只会变成没人敢删的永久压舱物。");
  }

  if (ratchetFailed(v)) return { exitCode: 1, stdout, stderr };

  stdout.push(
    `✓ [contract-route-ratchet] 没有新增的「契约有、路由没有」：` +
      `名单 ${opts.allowlistSize} 条，其中 ${v.activeEntries} 条今天仍是缺口` +
      (v.dormantEntries.length > 0 ? `、${v.dormantEntries.length} 条所属束今天不判（保留）` : "") +
      "。",
  );
  if (v.dormantEntries.length > 0) {
    stdout.push(
      `  休眠条目（所属束有 not_started / 未签核等原因不进入判定范围，不算陈旧）：${v.dormantEntries.join("、")}`,
    );
  }
  return { exitCode: 0, stdout, stderr };
}
