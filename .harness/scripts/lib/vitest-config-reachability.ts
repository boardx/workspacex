/**
 * 「vitest config 必须能从自动化入口到达」的机械门控（issue #3164）。
 *
 * ## 这条门控在防什么
 *
 * #3164 实测：13 个 `apps/api/vitest.*real-model*.config.ts` 里只有 3 个能从
 * npm script 或 workflow 到达，其余 10 个只能靠人手敲 `vitest --config …`，
 * 其中 3 个在整个仓库里**零引用**（非 real-model 的 `vitest.native-output-unit.config.ts`
 * 同样零引用，问题不限于那一批）。
 *
 * 后果不是"不好看"，是**能力面没有回归防护**：某个 skill 悄悄失效，
 * 没有任何一条可重复的车道会变红——"这个 skill 今天还能被调起来吗"
 * 这个问题只能靠人手复跑回答。
 *
 * ## 为什么 evidence 文本不算入口
 *
 * 那 10 个里有 7 个被 `docs/design/standard-capabilities/evidence/**` 的 txt 引用。
 * 那是**某次手工执行留下的静态痕迹**，只证明"曾经有人敲过一次"，不证明今天还跑得起来——
 * 正是 AGENTS.md「静态痕迹 ≠ 动态事实」点名的形态。所以本门控只认两类入口：
 *
 * 1. 任意 `package.json` 的 `scripts`（哪怕只能手动触发，"怎么跑它"这件事本身可发现）；
 * 2. `.github/workflows/*.yml`。
 *
 * ## 与 #512 的 spec-gate-coverage 是什么关系（不是同一事实的第二份副本）
 *
 * `lint-spec-gate-coverage.mjs`（#512）管的是 **Playwright 的 `.spec.ts`**——它自己写明
 * 「`.spec.ts` 在本仓是 Playwright 专属地盘」，最后一跳靠 `playwright test --list` 取事实，
 * 对 vitest 的 config/spec 一概不判。本门控是它在 **vitest 这一侧**的对位物，两者的
 * 输入集合不相交。
 *
 * 一处**故意**的口径差异：#512 只认 CI workflow（npm script 不算数），本门控认
 * npm script 或 workflow。理由是 #3164 自己的修法建议——真实模型很贵，不必每条 PR 都跑，
 * 所以这批车道的**最低门槛**定在「具名、可发现」，而不是「每次 PR 都执行」。
 * 把它提到「必须进 CI」是更强的要求，需要先有一条跑得起真实模型的 workflow（见 #3164 建议 3）。
 *
 * ## 可达性是传递的
 *
 * `vitest.native-document.config.ts` 没有自己的 npm script，但被
 * `vitest.native-runtime-lane.config.ts` 引用，而后者在 backend-gates.yml 里——
 * 它确实跑得到。所以：入口引用的 config 可达；**可达 config** 引用的 config 也可达。
 * 反过来，被一个孤儿 config 引用不能让谁变可达（那只是两个都跑不到）。
 */
export interface SourceFile {
  /** 展示用的路径或标签，例如 `apps/api/package.json#scripts.test:storage`。 */
  readonly name: string;
  readonly content: string;
}

/** 参与判定的 config：`name` 是文件名（`vitest.storage.config.ts`），不含目录。 */
export interface ConfigFile extends SourceFile {}

export interface ReachabilityInput {
  /** 受本门控约束的 config 集合。 */
  readonly configs: readonly ConfigFile[];
  /** 自动化入口：npm script 与 workflow。 */
  readonly entries: readonly SourceFile[];
  /**
   * 天然可达的 config（例如 `vitest.config.ts`——`vitest run` 不带 `--config` 时的默认值）。
   * 它们自身不受约束，但从它们出发的引用算可达。
   */
  readonly roots?: readonly SourceFile[];
  /** 需要被某个**可达** config `include` 覆盖的 spec 路径（相对包根）。 */
  readonly specs?: readonly string[];
}

export interface ReachableConfig {
  readonly config: string;
  /** 直接引用它的那个入口/config 的 name。 */
  readonly via: string;
}

export interface ReachabilityReport {
  readonly scanned: number;
  readonly reachable: readonly ReachableConfig[];
  /** 没有任何自动化入口能到达的 config，按输入顺序。 */
  readonly orphans: readonly string[];
  /** 没有被任何可达 config 的 include 覆盖的 spec，按输入顺序。 */
  readonly uncoveredSpecs: readonly string[];
}

const escape = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 文件名引用要求两侧都不是标识符字符，避免 `vitest.document-skill-real-model.config.ts`
 * 与 `vitest.document-skills-real-model.config.ts` 这种互为近邻的名字彼此误判。
 *
 * 路径前缀（`apps/api/vitest.x.config.ts`、`./vitest.x.config.ts`）必须照样算引用——
 * workflow 写全路径、config 之间用相对路径互相 import，都是本仓真实存在的写法。
 */
function references(content: string, configName: string): boolean {
  return new RegExp(`(?<![\\w\\-])${escape(configName)}(?![\\w\\-])`).test(content);
}

/** config 里 `include` 到的 spec 路径：取所有形如 `tests/…` 的引号字面量。 */
export function includedSpecs(configContent: string): string[] {
  const quoted = configContent.matchAll(/['"`]((?:\.\/)?(?:apps\/api\/)?tests\/[^'"`]+)['"`]/g);
  return [...quoted]
    .map((match) => match[1] ?? "")
    .map((spec) => spec.replace(/^\.\//, "").replace(/^apps\/api\//, ""));
}

/**
 * spec 是否落在 config 的某条 include 里。include 可能是 glob（`tests/inbox/*.test.ts`），
 * 所以逐条把 `**` / `*` 翻成正则——只支持 vitest include 里实际用到的这两种通配。
 */
function covers(pattern: string, spec: string): boolean {
  const source = escape(pattern)
    .replace(/\\\*\\\*\//g, "(?:.*/)?")
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp(`^${source}$`).test(spec);
}

export function analyzeVitestConfigReachability(input: ReachabilityInput): ReachabilityReport {
  const pending = new Map(input.configs.map((config) => [config.name, config]));
  const reachable: ReachableConfig[] = [];
  // 入口与已判定可达的 config 都能继续往外传递可达性；孤儿 config 不能。
  let frontier: readonly SourceFile[] = [...input.entries, ...(input.roots ?? [])];

  while (frontier.length > 0 && pending.size > 0) {
    const next: SourceFile[] = [];
    for (const source of frontier) {
      for (const config of [...pending.values()]) {
        if (config.name === source.name) continue;
        if (!references(source.content, config.name)) continue;
        pending.delete(config.name);
        reachable.push({ config: config.name, via: source.name });
        next.push(config);
      }
    }
    frontier = next;
  }

  const reachableNames = new Set(reachable.map((entry) => entry.config));
  const covered = input.configs
    .filter((config) => reachableNames.has(config.name))
    .flatMap((config) => includedSpecs(config.content))
    .concat((input.roots ?? []).flatMap((root) => includedSpecs(root.content)));

  return {
    scanned: input.configs.length,
    reachable,
    orphans: input.configs.filter((config) => pending.has(config.name)).map((config) => config.name),
    uncoveredSpecs: (input.specs ?? []).filter(
      (spec) => !covered.some((pattern) => covers(pattern, spec)),
    ),
  };
}
