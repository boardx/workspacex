/**
 * 「`pnpm.overrides` 的 `parent>child` 选择器」机械门控（issue #2614）。
 *
 * ## 这条门控在防什么（不是风格问题，是会静默装错版本的一类假绿）
 *
 * pnpm 的 override 键支持 `parent>child` 这种「只改某个父包底下那条边」的写法。
 * 它对**常规 dependency** 有效；但当那条边是**由 peerDependency 自动解析**出来的时候
 * 不可靠——这是 pnpm 的已知限制类目，不是本仓的配置写错了。
 *
 * #2613 踩到的就是这个形态：`@langchain/langgraph-checkpoint-postgres@0.1.2` 把
 * `@langchain/langgraph-checkpoint` 声明成 peerDependency（range `^0.1.0`），
 * 仓库用
 *
 *     "@langchain/langgraph-checkpoint-postgres>@langchain/langgraph-checkpoint": "0.1.1"
 *
 * 去钉它。任何触发**全仓重新 resolve** 的操作（哪怕只是给完全无关的包 `pnpm add` 一次）
 * 都可能把这条边解析成不满足 `^0.1.0` 的版本（实测解析成 `1.1.5`），
 * 而 pnpm 对此**只告警**（`unmet peer`）**不报错**——lockfile 被悄悄改掉，
 * 一路提交进 PR，红在一个与依赖毫无关系的地方。
 *
 * 「装错了版本」被伪装成「某个运行时报错」，和普通配置错误不是一个量级的排查成本。
 *
 * ## 可靠的写法：把约束声明成消费方的直接依赖
 *
 * 在真正用到它的 workspace 包里写一条 direct dependency 并钉死版本
 * （#2613 的 `9182fa3` 就是这么修的：`apps/api` 直接依赖
 * `"@langchain/langgraph-checkpoint": "0.1.1"`）。
 * direct dependency 参与正常的 resolve，与 peer 解析的时机无关，
 * 版本冲突会**当场报错**而不是降级成一条告警。
 *
 * 所以本门控的判据不是「override 不许用」，而是「**不许用 `parent>child` 这个选择器语法**」：
 * 平铺的 `child` / `child@range` 覆盖全仓一条边，行为确定，不在拦截范围内。
 *
 * ## 判据边界：版本范围里的 `>` 不是嵌套分隔符
 *
 * `foo@>=1.0.0`、`foo@>1.2.3` 这类键里的 `>` 属于 semver 比较符，必须放行；
 * 裸 `includes(">")` 会把它们全部误报。分隔符的识别规则见下方 `isNestingSeparator`。
 */
export interface OverrideEntry {
  /** 仓库相对路径，例如 `package.json`。 */
  readonly file: string;
  /** 声明位置，例如 `pnpm.overrides`、`resolutions`、`overrides`。 */
  readonly field: string;
  readonly key: string;
  readonly value: string;
}

export interface NestedOverride extends OverrideEntry {
  readonly parent: string;
  readonly child: string;
}

export interface UnreadableFile {
  readonly file: string;
  readonly reason: string;
}

export interface OverrideReport {
  readonly filesScanned: number;
  readonly entriesScanned: number;
  readonly nested: readonly NestedOverride[];
  /** 解析不了的文件。扫不动 ≠ 通过，入口据此退非 0（fail-closed）。 */
  readonly unreadable: readonly UnreadableFile[];
}

export interface SourceFile {
  readonly file: string;
  readonly source: string;
}

/** 紧跟在 `>` 前面时，说明这个 `>` 属于版本范围而不是父子分隔符。 */
const RANGE_CONTEXT_BEFORE = /[@<>=~^|& ]/;
/** 父子分隔符后面跟的是包名：scope 的 `@`、字母、或 `_`。范围里的 `>` 后面跟的是 `=` 或数字。 */
const PACKAGE_NAME_START = /[A-Za-z@_]/;

/**
 * 返回 `key` 里第一个「父子分隔符」的下标，没有则返回 -1。
 *
 * 规则（两侧各看一个字符，足够把 semver 比较符和包名分开）：
 * - 前一个字符落在 `RANGE_CONTEXT_BEFORE` 里 ⇒ 这是 `foo@>=1.0.0` 这类范围，不是分隔符；
 * - 后一个字符不是包名的合法首字符 ⇒ 同上（`>1.2.3` 后面是数字）。
 */
export function findNestingSeparator(key: string): number {
  for (let i = 1; i < key.length - 1; i += 1) {
    if (key[i] !== ">") continue;
    if (RANGE_CONTEXT_BEFORE.test(key[i - 1]!)) continue;
    if (!PACKAGE_NAME_START.test(key[i + 1]!)) continue;
    return i;
  }
  return -1;
}

function toEntries(
  file: string,
  field: string,
  raw: unknown,
  out: OverrideEntry[],
): void {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out.push({ file, field, key, value: typeof value === "string" ? value : JSON.stringify(value) });
  }
}

/**
 * 从一个 `package.json` 的文本里取出所有 override 声明。
 *
 * 两处都取：`pnpm.overrides`（pnpm 的正式位置）与 `resolutions`
 * （yarn 语法，pnpm 也认；同一个选择器坑，别只堵一半门）。
 */
export function overrideEntriesFromPackageJson(file: string, source: string): OverrideEntry[] {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const entries: OverrideEntry[] = [];
  const pnpmField = parsed.pnpm;
  if (pnpmField !== null && typeof pnpmField === "object" && !Array.isArray(pnpmField)) {
    toEntries(file, "pnpm.overrides", (pnpmField as Record<string, unknown>).overrides, entries);
  }
  toEntries(file, "resolutions", parsed.resolutions, entries);
  return entries;
}

/**
 * 从 `pnpm-workspace.yaml` 的**已解析对象**里取出 override 声明。
 *
 * pnpm 10 起 `overrides` 可以写在 workspace 清单里而不是根 `package.json`，
 * 同一个选择器语法、同一个坑——今天本仓还在 pnpm 9，但门要挡的是「以后有人这么写」，
 * 只堵今天用得到的那一处等于没堵。
 *
 * yaml 解析留在调用方（入口脚本 / 测试），这里只吃对象，保持本模块零依赖。
 */
export function overrideEntriesFromWorkspaceManifest(file: string, parsed: unknown): OverrideEntry[] {
  const entries: OverrideEntry[] = [];
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return entries;
  toEntries(file, "overrides", (parsed as Record<string, unknown>).overrides, entries);
  return entries;
}

export function analyzeOverrideEntries(
  entries: readonly OverrideEntry[],
  context: { readonly filesScanned: number; readonly unreadable?: readonly UnreadableFile[] },
): OverrideReport {
  const nested: NestedOverride[] = [];
  for (const entry of entries) {
    const at = findNestingSeparator(entry.key);
    if (at < 0) continue;
    nested.push({ ...entry, parent: entry.key.slice(0, at), child: entry.key.slice(at + 1) });
  }
  return {
    filesScanned: context.filesScanned,
    entriesScanned: entries.length,
    nested,
    unreadable: context.unreadable ?? [],
  };
}

/**
 * 便捷入口：吃一组 `package.json` 文本，直接出报告。
 * 解析不了的文件进 `unreadable`（不是静默跳过）。
 */
export function analyzePackageJsonFiles(files: readonly SourceFile[]): OverrideReport {
  const entries: OverrideEntry[] = [];
  const unreadable: UnreadableFile[] = [];
  for (const { file, source } of files) {
    try {
      entries.push(...overrideEntriesFromPackageJson(file, source));
    } catch (error) {
      unreadable.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return analyzeOverrideEntries(entries, { filesScanned: files.length, unreadable });
}
