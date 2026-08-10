/**
 * core-loop-readiness.ts —— CLR（Core Loop Readiness），issue #814。
 *
 * 人类 2026-08-09 指令："你要代表我有一个全面的解决方案，你要统一所有的 agent 的
 * 工作，要有一个统一的衡量的标准"。
 *
 * ## 这个文件解决的不是"再加一套评分卡"
 *
 * 本仓已经有三套尺子在量 chat：`chat-main-fidelity-rubric.md` 的 D1-D10（项目对话
 * 视觉保真）与 P1-P10（个人对话），以及 `chat-ux-acceptance-criteria.md` 的十项
 * （行为体验）。第四套只会让"到底哪条判据说了算"更糟——那份行为标准自己就逐字
 * 禁止过合并评分卡。
 *
 * 所以本文件**一个判据都不定义**。它做两件既有文件都做不到的事：
 *
 *   1. **把分散的分数聚合成一个数**，采用本仓已有的
 *      `feature_list.json`（权威）→ `active-features.json`（脚本派生只读视图）
 *      同一模式：判据留在各自 rubric，分数记录集中在
 *      `.harness/state/core-loop-readiness.json`，总分盘由本文件派生、禁止手写。
 *   2. **补上唯一一条没有任何尺子在量的维度：可达性（track R）**。
 *
 * ## 为什么必须有 track R —— "12/12 全绿"与"用户说不能用"同时为真
 *
 * `core-loop.spec.ts` 12/12 绿，同一天人类在 devapp 实测录音不可用。两者都不假：
 * **八步闭环是在"种子脚本已替用户创建好前置数据"的世界里绿的**。规格自己的注释
 * 逐字承认过这些让步（引用为证，不是推测）：
 *
 *   · `core-loop.spec.ts:782`  "今天没有任何产品路径造得出一个议程环节"（#627）
 *   · `core-loop.spec.ts:598`  "被挂的那个 skill 由夹具种成「已启用」"（#552）
 *   · `core-loop.spec.ts:518`  "契约里没有写授权格子的操作"（录音授权矩阵）
 *
 * 每一条都诚实地写在代码里，但没有任何东西把它们汇总成一个看得见的数字，于是
 * "绿"持续掩盖"用户走不到"。track R 的全部作用就是让这些让步**可计数**。
 *
 * ## 聚合规则：R 是天花板，不是加数
 *
 *     CLR = min( R , mean(B, V-D, V-P) )
 *
 * 用户走不到的地方，做得再好也等于 0。四项平均会让"一个漂亮但走不到的功能"拿
 * 高分——那正是今天的处境，而这条规则让"刷分"和"修对的东西"变成同一件事。
 *
 * ⚠ 诚实标注——这条公式是**本 issue 引入的设计决定**，不是从既有文档推导出来的。
 *   既有三份 rubric 都没有规定彼此如何合成（这正是它们各说各话的原因）。如果人类
 *   日后改判权重或改成别的合成方式，改这里，不要在别处再写一份。
 *
 * ## 四道机械门（每道在 `.test.ts` 里都有反证）
 *
 * 本仓已九次出现"全绿但空转"的门（见记忆纪律：写完门控立刻造反证），所以这四道
 * 门每一道都必须能被"故意破坏一次"打红：
 *
 *   G1 未评分记 0，不记"未知"——空着不等于满分
 *   G2 过期分数记 0——评分 SHA 之后该 track 的 watch 路径有改动即过期
 *   G3 自评不算分——scored_by ∈ allowed_scorers 且 ≠ implemented_by
 *   G4 无证据不算分——evidence 为空即 0
 *
 * G2 的存在理由是记忆里那条实测教训："grep 不会告诉你树是旧的"。一个 6 轮之前
 * 测出来的分数在今天的 main 上没有任何证明力，把它当成"最后已知良好"继续计入，
 * 就是用过期证据冒充当前事实。
 *
 * ## 范围边界
 *
 * 本文件是**纯函数**：不读 git、不读文件系统、不发网络请求。"哪些文件在 scored_sha
 * 之后改过"由调用方（`core-loop-readiness-doctor.ts`）用 git 查出来后作为
 * `changedSince` 传进来。理由与 `pr-queue.ts` 把 GitHub 查询留在外面同一条：
 * 判定逻辑要能在单测里被穷举，而 I/O 不能。
 */

/** 一条 track 的分数记录。`score === null` 表示从未评分（G1 → 记 0）。 */
export interface TrackRecord {
  /** 人类可读名，只用于渲染。 */
  readonly name: string;
  /** 判据的权威出处（文件路径 + 锚点）。本文件不复制判据内容，只指过去。 */
  readonly authority: string;
  /** 允许给这条 track 打分的角色 id（G3）。 */
  readonly allowed_scorers: readonly string[];
  /** 满分，固定 10，显式写出来避免读者去猜。 */
  readonly max: number;
  /** 实测分。`null` = 从未评分。 */
  readonly score: number | null;
  /** 实测 SHA（40 位）。`null` 当且仅当 `score` 为 `null`。 */
  readonly scored_sha: string | null;
  /** 评分人角色 id。 */
  readonly scored_by: string | null;
  /** 被评那一版的实现者角色 id。与 `scored_by` 相同即自评（G3）。 */
  readonly implemented_by: string | null;
  /** 证据（截图路径 / 命令输出路径 / issue 链接）。空数组 → G4 判 0。 */
  readonly evidence: readonly string[];
  /** 过期判定的观察范围：这些 glob 命中的文件改了，分数就过期（G2）。 */
  readonly watch: readonly string[];
  /** 挡在这条 track 与满分之间的 issue 号，渲染成统一队列。 */
  readonly blocking_issues: readonly number[];
}

export interface ReadinessState {
  readonly version: number;
  /** track id → 记录。id 与聚合公式里的符号一一对应（R / B / V-D / V-P）。 */
  readonly tracks: Readonly<Record<string, TrackRecord>>;
}

/** 一条 track 被判 0 的原因。`null` 表示分数如实计入。 */
export type DiscountReason =
  | "NEVER_SCORED"
  | "STALE"
  | "SHA_NOT_ON_MAIN"
  | "EVIDENCE_UNRESOLVABLE"
  | "SELF_SCORED"
  | "SCORER_NOT_ALLOWED"
  | "NO_EVIDENCE"
  | "SCORE_OUT_OF_RANGE";

export interface TrackVerdict {
  readonly id: string;
  readonly name: string;
  /** 记录里写的原始分。未评分为 `null`。 */
  readonly rawScore: number | null;
  /** 实际计入聚合的分。任一道门命中即 0。 */
  readonly effectiveScore: number;
  /** 全部命中的扣分原因（不是只报第一条——修好一条才发现还有三条最浪费周期， */
  /** 同 `pr-queue.ts` 的 `reasons` 设计）。 */
  /** 分数有效但已过期（方案 A）：计入 `clr`，但阻断 `passes`。 */
  readonly isStale: boolean;
  readonly discounts: readonly DiscountReason[];
  readonly blockingIssues: readonly number[];
}

export interface ReadinessVerdict {
  /**
   * 达标 ⟺ `clr >= PASS_THRESHOLD` **且没有任何一条 track 的分数是过期的**（方案 A）。
   *
   * 两个条件缺一不可：分数够高但其中一条已过期，只能说"上次量的时候够高"，不能说"现在达标"。
   * 这是把严格性从 `clr` 挪到这里——`clr` 负责**有信息量**，`passes` 负责**不说谎**。
   */
  readonly passes: boolean;
  /** 有几条 track 的分数已过期（`passes` 为 false 的常见原因，渲染时要显式说出来）。 */
  readonly staleCount: number;
  /** 天花板 track（R）的实际得分。 */
  readonly reachability: number;
  /** 其余三条 track 的均值。 */
  readonly experienceMean: number;
  /** CLR = min(reachability, experienceMean)，保留一位小数。 */
  readonly clr: number;
  readonly tracks: readonly TrackVerdict[];
  /** 统一队列：按「R 的阻塞项 → 最低分 track 的阻塞项 → 其余」排好序的 issue 号。 */
  readonly queue: readonly number[];
}

/** 天花板 track 的 id。写成常量而不是散在判断里，改的时候只有一处。 */
export const CEILING_TRACK = "R";

/**
 * 合格门槛（人类 2026-08-09 裁决，#831）：**CLR ≥ 9 即达标，不再要求 = 10**。
 *
 * ## 为什么不是 10
 *
 * 原本的 10 分门在结构上不可达：`chat-main-fidelity-rubric.md` 的 D3/D4 各有一条子要求
 * （线程「负责 agent」、面包屑「项目阶段/周次」）指向**产品域里根本不存在的概念**——
 * 要满足它们得先做一次产品设计并建模，而它们服务的只是一行副行和一行面包屑。
 *
 * 同一次裁决里那两条子要求已从判据中移除，所以"满分"重新变得可达；门槛降到 9 是**额外**
 * 留出的一分容错。两者叠加**不是双重放宽**：四条 track 每条都是 0/1 逐维判定 + 硬门
 * H1-H4，要求四条同时 ≥9 依然很硬。
 *
 * ⚠ 一个**不可能达到**的满分比一个略低但可达的门槛更危险——所有人会默认"反正到不了"，
 * 门就废了。这条推理写在这里，是为了让后来改动门槛的人知道它当初为什么不是 10。
 */
export const PASS_THRESHOLD = 9;

/**
 * 判一条 track 的实际得分。
 *
 * `changedSince` 是调用方用 git 查出来的「scored_sha 之后改动过的文件路径」；
 * 传 `null` 表示调用方没有能力判断（例如离线渲染），此时**不**触发 G2——
 * 查不到不等于没改，但也不该凭空判过期，所以由调用方显式表达"我没查"。
 */
export function judgeTrack(
  id: string,
  record: TrackRecord,
  changedSince: readonly string[] | null,
  shaIsAncestorOfMain: boolean | null = null,
  evidenceExists: ((ref: string) => boolean) | null = null,
): TrackVerdict {
  const discounts: DiscountReason[] = [];

  if (record.score === null) {
    discounts.push("NEVER_SCORED");
  } else {
    if (record.score < 0 || record.score > record.max) discounts.push("SCORE_OUT_OF_RANGE");
    if (record.evidence.length === 0) discounts.push("NO_EVIDENCE");
    if (record.scored_by === null || !record.allowed_scorers.includes(record.scored_by)) {
      discounts.push("SCORER_NOT_ALLOWED");
    }
    // G3：同一个人既实现又打分，这份分数在语义上自相矛盾——同
    // `review-decision-model.ts` 对 `reviewer === producer` 的判法。
    if (record.scored_by !== null && record.scored_by === record.implemented_by) {
      discounts.push("SELF_SCORED");
    }
    if (changedSince !== null && changedSince.length > 0 && matchesAny(changedSince, record.watch)) {
      discounts.push("STALE");
    }
    // G5（#814 后续，rev-uiux 2026-08-09 提出）：评的必须是 main 血统的树。
    // G2 只管"评分之后有没有改动"，管不了"评的根本不是这棵树"——#728 十轮评分的 SHA
    // 无一是 origin/main 的祖先，而当时没有任何门为此变红。`null` = 查不到，不判罚。
    if (shaIsAncestorOfMain === false) discounts.push("SHA_NOT_ON_MAIN");
    // G6：证据必须**结构上可解析**。原先 G4 只查数组非空，于是一条手写的假锚点
    // （`#issuecomment-round6`，真锚点是数字 id）照样过门——那是 coord-main 自己播下的。
    if (record.evidence.some((e) => !isStructurallyResolvable(e, evidenceExists))) {
      discounts.push("EVIDENCE_UNRESOLVABLE");
    }
  }

  // 人类 2026-08-09 裁决（方案 A）：**只有 `STALE` 是信息性的，其余全部清零。**
  //
  // 为什么单独放过 STALE：它是六种扣分里**唯一一种「测量本身有效、只是稍旧」**的情况——
  // 分数真的量过 main 上真实存在的一棵树，只是那之后 watch 路径又动了。其余五种都是
  // 「这个测量不成立」（没量过 / 自评 / 越权 / 无证据 / 越界 / 量的根本不是 main 那棵树）。
  //
  // 触发这次改动的实测：track R 在 `29f587b3` 上量出 6/10，方法扎实（跑了不吃种子的空库链），
  // 但同一天 main 前进后 R 的 watch 路径动了 24 个文件 ⇒ 旧规则下它计入 0，**看板恒为 0**。
  // 根因是**一轮评分要几小时，main 每几分钟就动一次**——这是节奏差，不是分数造假。
  //
  // ⚠ 严格性没有放松，只是挪了位置：`clr` 变得有信息量（3.3 而不是 0），
  // 而**「达标」判定（`passes`）要求所有 track 都新鲜**，一条过期就不算达标。见 `judgeReadiness`。
  //
  // 不这么改的代价很具体：看板恒 0 ⇒ 所有人开始忽略它。今天刚修完一个「恒红被绕过五天」
  // 的门（#849 `e2e-full`），不该立刻再造一个。
  const invalidating = discounts.filter((d) => d !== "STALE");
  return {
    id,
    name: record.name,
    rawScore: record.score,
    effectiveScore: invalidating.length === 0 ? (record.score ?? 0) : 0,
    /** 分数有效但已过期——计入 `clr`，但阻断 `passes`。 */
    isStale: discounts.includes("STALE"),
    discounts,
    blockingIssues: record.blocking_issues,
  };
}

/**
 * 证据是否**结构上**可解析。
 *
 * ⚠ 刻意**不做网络存活检查**：那会让门在离线/限流时抖动，而抖动的门迟早被 `--no-verify`
 * 绕过（本仓 #504 已有先例）。结构校验离线、确定、零误报，而且足以抓住真实事故——
 * 2026-08-09 混进记录的 `…/issues/728#issuecomment-round6` 就是**结构非法**的：
 * GitHub 的评论锚点恒为 `#issuecomment-<数字>`。
 *
 * 三类证据各自的判据：
 *   · 仓库内路径（无 scheme）→ 必须真的存在（由调用方注入 `exists`，纯函数不碰 fs）
 *   · GitHub 评论 URL       → 锚点必须是 `#issuecomment-<数字>`
 *   · 其它 URL              → 至少要能被 `new URL()` 解析
 */
export function isStructurallyResolvable(
  ref: string,
  exists: ((ref: string) => boolean) | null,
): boolean {
  const trimmed = ref.trim();
  if (trimmed === "") return false;

  // ── 结构化前缀（2026-08-10 补）────────────────────────────────────────────
  // rev-uiux 在 #867 用了 `sha:` / `cmd:` / `ci:` / `spec:` / `src:` / `authority:`
  // 前缀记证据——**这比裸路径更好**（类别自明、能按类验证），初版 G6 却把 `sha:…`
  // 误当仓库内路径判了不可解析（`sha:` 后没有 `//`，过不了 URL 正则）。
  // 门的职责是挡「看起来像引用但打不开的假锚点」，不是挡更好的格式。
  const prefixed = /^([a-z][a-z0-9-]*):(?!\/\/)(.*)$/i.exec(trimmed);
  if (prefixed) {
    const [, kind, rest] = prefixed as unknown as [string, string, string];
    switch (kind.toLowerCase()) {
      case "sha":
        // 结构校验：完整 40 位十六进制。是否真在 main 血统里由 G5 管，不在这重复。
        return /^[0-9a-f]{40}$/i.test(rest.trim());
      case "ci":
        // 后面必须是能解析的 URL
        try { new URL(rest.trim()); return true; } catch { return false; }
      case "spec":
      case "src":
      case "authority": {
        // 仓库内路径，允许三种后缀：`#锚`、`:行号`/`:行-行`、尾随 `(自由注记)`。
        // ⚠ 第二次误伤（2026-08-10）修的就是注记：`authority:a.md (含 …裁决)` ——
        //   带行号时旧正则顺带吃掉了 `(…)`，不带行号就清不掉。评分员在证据里带
        //   人类可读注记是合理需求，清洗要独立处理它，不能靠行号正则捎带。
        const path = rest.trim()
          .split("#")[0]!
          .replace(/\s*\([^)]*\)?\s*$/, "")
          .replace(/:[0-9]+(?:-[0-9]+)?\s*$/, "");
        return exists === null ? true : exists(path.trim());
      }
      case "cmd":
        // 自述性记录（命令 + 退出码），没有可解析的目标——非空即可。
        // ⚠ 已知边界：它验证不了命令真的跑过。挡编造靠 G3（独立评分人）与人的复核，
        //   不靠这里装一个假验证。
        return rest.trim() !== "";
      default:
        // 未知前缀：放行。拒绝会重演这次的误伤（对更好的新格式恒红），而恒红的门
        //   会被绕过（#849 的教训）。收紧前先把新前缀加进上面的 switch。
        return true;
    }
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // 仓库内路径。调用方没注入 exists（离线渲染）时不判罚——同 changedSince 的 null 语义。
    return exists === null ? true : exists(trimmed);
  }
  let url: URL;
  try { url = new URL(trimmed); } catch { return false; }
  if (url.hash !== "" && /issuecomment/i.test(url.hash)) {
    return /^#issuecomment-\d+$/.test(url.hash);
  }
  return true;
}

/** 极小的 glob：只支持 `**` 与 `*`，够本仓的 watch 表达且不引依赖。 */
export function matchesAny(paths: readonly string[], globs: readonly string[]): boolean {
  return paths.some((p) => globs.some((g) => globToRegExp(g).test(p)));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // 先换 `**`（跨目录），再换剩下的单 `*`（不跨目录）——顺序反了 `**` 会被
  // 拆成两个单星，`apps/**` 就匹配不到 `apps/web/lib/x.ts`。
  const pattern = escaped
    .replace(/\*\*\//g, " SLASHSTAR ")
    .replace(/\*\*/g, " STARSTAR ")
    .replace(/\*/g, "[^/]*")
    .replace(/ SLASHSTAR /g, "(?:.*/)?")
    .replace(/ STARSTAR /g, ".*");
  return new RegExp(`^${pattern}$`);
}

/**
 * 聚合成 CLR。
 *
 * `changedSinceByTrack` 按 track id 给出各自的「评分后改动文件」；缺 key 视为
 * `null`（调用方没查这条），不视为空数组（查了、确实没改）——这两者含义不同，
 * 混淆会让 G2 在离线渲染时静默失效。
 */
export function judgeReadiness(
  state: ReadinessState,
  changedSinceByTrack: Readonly<Record<string, readonly string[] | null>> = {},
  ancestryByTrack: Readonly<Record<string, boolean | null>> = {},
  evidenceExists: ((ref: string) => boolean) | null = null,
): ReadinessVerdict {
  const ids = Object.keys(state.tracks);
  const tracks = ids.map((id) =>
    judgeTrack(
      id, state.tracks[id]!, changedSinceByTrack[id] ?? null,
      ancestryByTrack[id] ?? null, evidenceExists,
    ),
  );

  const ceiling = tracks.find((t) => t.id === CEILING_TRACK);
  if (ceiling === undefined) {
    throw new Error(
      `core-loop-readiness: 缺天花板 track "${CEILING_TRACK}"——聚合公式 min(R, mean(...)) 没有 R 就不成立`,
    );
  }
  const others = tracks.filter((t) => t.id !== CEILING_TRACK);
  const experienceMean = others.length === 0
    ? 0
    : others.reduce((sum, t) => sum + t.effectiveScore, 0) / others.length;

  const clr = Math.min(ceiling.effectiveScore, experienceMean);
  const staleCount = tracks.filter((t) => t.isStale).length;

  return {
    // 方案 A：分数够高**且**没有一条过期，才算达标。前者由 clr 保证，后者在这里。
    passes: round1(clr) >= PASS_THRESHOLD && staleCount === 0,
    staleCount,
    reachability: ceiling.effectiveScore,
    experienceMean: round1(experienceMean),
    clr: round1(clr),
    tracks,
    queue: buildQueue(ceiling, others),
  };
}

/**
 * 统一队列：R 的阻塞项永远在最前（它是天花板，其余 track 修到满分也抬不动总分），
 * 其后按 track 实际得分升序（最低分先修），同分按 track id 稳定排序。
 * 去重时保留第一次出现的位置——同一个 issue 同时挡两条 track 时，按更靠前的那条排。
 */
function buildQueue(ceiling: TrackVerdict, others: readonly TrackVerdict[]): readonly number[] {
  const ordered = [
    ceiling,
    ...[...others].sort((a, b) => a.effectiveScore - b.effectiveScore || a.id.localeCompare(b.id)),
  ];
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const track of ordered) {
    for (const issue of track.blockingIssues) {
      if (seen.has(issue)) continue;
      seen.add(issue);
      queue.push(issue);
    }
  }
  return queue;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 结构校验。分数记录是手写的（评分人填），所以形状必须被机械检查——
 * 一个拼错的 track id 或漏掉的 `scored_sha` 会让 G2 静默失效。
 * 返回人类可读的问题清单，空数组表示通过。
 */
export function validateState(state: unknown): readonly string[] {
  const problems: string[] = [];
  if (typeof state !== "object" || state === null) return ["state 不是对象"];
  const s = state as Partial<ReadinessState>;
  if (typeof s.version !== "number") problems.push("缺 version");
  if (typeof s.tracks !== "object" || s.tracks === null) return [...problems, "缺 tracks"];

  const ids = Object.keys(s.tracks);
  if (!ids.includes(CEILING_TRACK)) problems.push(`缺天花板 track "${CEILING_TRACK}"`);

  for (const id of ids) {
    const t = (s.tracks as Record<string, Partial<TrackRecord>>)[id]!;
    const at = (msg: string) => problems.push(`track ${id}: ${msg}`);
    if (typeof t.name !== "string" || t.name === "") at("缺 name");
    if (typeof t.authority !== "string" || t.authority === "") at("缺 authority（判据出处）");
    if (!Array.isArray(t.allowed_scorers) || t.allowed_scorers.length === 0) at("缺 allowed_scorers");
    if (t.max !== 10) at("max 必须是 10（四条 track 同一量纲才能取均值）");
    if (!Array.isArray(t.watch) || t.watch.length === 0) at("缺 watch（没有它 G2 过期门恒不触发）");
    if (!Array.isArray(t.blocking_issues)) at("缺 blocking_issues（可以是空数组，但不能没有）");
    if (!Array.isArray(t.evidence)) at("缺 evidence（可以是空数组，但不能没有）");

    if (t.score === null) {
      // 未评分时其余字段必须一并为空，否则是"改了分数忘了改 SHA"的半截记录。
      if (t.scored_sha !== null) at("score 为 null 时 scored_sha 也必须为 null");
      if (t.scored_by !== null) at("score 为 null 时 scored_by 也必须为 null");
    } else if (typeof t.score !== "number") {
      at("score 必须是数字或 null");
    } else {
      if (typeof t.scored_sha !== "string" || !/^[0-9a-f]{40}$/.test(t.scored_sha)) {
        at("scored_sha 必须是 40 位小写 SHA（实测必须声明 SHA）");
      }
      if (typeof t.scored_by !== "string" || t.scored_by === "") at("已评分必须写 scored_by");
    }
  }
  return problems;
}
