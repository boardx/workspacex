#!/usr/bin/env node
/**
 * lint-design-facet-single-source.mjs -- F17 / 不变量 I-5 的机械门控。
 *
 * ## 它守的那一句话
 *
 * `uc-2-1` R3 的裁决 O-07 逐字：「实现必须由**配置项定义表**驱动，
 * 分母 ＝ 表中已定义项数，**禁止硬编码 16 或 15**」。I-5 的验收线索也逐字写着
 * 「`grep` 断言实现与测试无硬编码分母；改表加一项后接口返回的分母自动 +1」。
 *
 * 「改表加一项分母自动 +1」由单元测试证明。**这个脚本证明的是另一半**：
 * 没有第二处把同一件事又写了一遍。两半缺一不可——一个从定义表派生的实现，
 * 旁边再放一个手写的 `TOTAL = 16`，单元测试照样全绿。
 * 本仓已**九次**因「同一事实声明在两处」漂移。
 *
 * ## 三条规则
 *
 *  1. **硬编码分母**：谈论分母/完成度的行里出现字面量 15 或 16。
 *     刻意只在「谈论分母」的行上开火：全仓禁用数字 16 会在两天后被人静音，
 *     而一个被静音的门控比没有门控更糟——它还会让人以为查过了。
 *  2. **第二份槽位清单**：一个数组/对象字面量里出现 ≥2 个定义表里的 `designFacetKey`。
 *     这是第二份表实际长的样子，无论它叫什么名字。
 *  3. **第二份分组清单**：一个字面量里出现 ≥2 个五组封闭枚举的成员。
 *
 * 规则 1 与 2/3 的开火条件不同，是**刻意的**：三个各自会漏、但漏得不一样的检查，
 * 好过一个大而全、然后被全员关掉的检查（同 `lint-no-builtin-capabilities` 的取舍）。
 *
 * ## 唯一事实源来自哪里
 *
 * 本脚本**不内嵌 key 清单**——那本身就是第四份副本。它从
 * `apps/api/src/domain/templates/design-facet-table.ts` 里解析出 key 与分组，
 * 解析不到 ⇒ 直接失败（而不是「零违规」地绿掉）。
 *
 * ⚠ 2026-08-17（F197 复核发现）：`SOURCE_RELS` 有**两个**豁免文件，不是笔误——
 *   它们回答的是两件不同的事，都各自只有一份：
 *   · `design-facet-table.ts`（上面那份）：这些 key 分别叫什么/属于哪组/是否必填。
 *   · `facet-editor-registry.ts`：某个 key 该渲染哪个 React 组件——前端专属的事实，
 *     领域表不可能知道（它不认识 React），也不该知道（洋葱架构单向依赖）。
 *   两张表**不冲突**：豁免第二张不是给「第二份定义表」开口子，是承认它压根不是
 *   同一件事的第二份拷贝。会真正冲突的是「第三张也想叫路由表」——那种情况仍然
 *   会被规则 2b 抓到，因为它不在 SOURCE_RELS 里。
 *
 * ## 已知的第二份副本：原型 mock（DEBT，计数被钉住）
 *
 * `apps/web/lib/mock/tpl.ts` 里已经有一张 **16 行**的 `CONFIG_ITEMS`，
 * 它与领域表 **不是同一张表**：
 *   · 行数 16 vs 15（mock 声称 2026-07-30 的保真度重做找到了第 16 项
 *     `basic-overview`「基本配置」是面板不是分组标题；而 `domain.md` 与 `uc-2-1` R3
 *     仍记 15 项 + 「第 16 项待补抽取 O-07」）
 *   · key 不同（`flow-agenda` / `survey` / `grouping-rule` / `roles-and-perms` /
 *     `interview-and-subjects` / `print-materials` / `group-capabilities` / `outputs`
 *     对 `agenda` / `questionnaire` / …）
 *   · `required` 列不同（mock 有 5 项 true，领域表 0 项 true）
 *
 * ⚠ **哪张对不是代码问题，是签核问题**（缺 D-2 / O-07 / `KNOWN_CONTRACT_GAPS.T3`）。
 * 本脚本**不选边**：把 mock 一侧报成 DEBT 并输出计数，由测试钉住它**不许增长**；
 * 其余位置零容忍。静默排除 mock 会让门控在问题所在的那一侧永远是绿的。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCE_REL = "apps/api/src/domain/templates/design-facet-table.ts";
/**
 * 第二个豁免文件：key → React 组件 的路由表，前端专属，不是 key 定义的第二份拷贝
 * （见上方文件头「唯一事实源来自哪里」一节）。规则 1/3 仍然全文件适用——豁免只
 * 覆盖规则 2b（跨行 key 字面量计数），因为路由表天然要逐行提到多个 key。
 */
const REGISTRY_REL = "apps/web/components/tpl-designer/facet-editor-registry.ts";
// 2026-08-18（复核裁决）：曾短暂存在过第三个豁免 `facet-intro-table.ts`（F206 合并时
// 引入），已撤掉——面板 intro 解释段折进了 REGISTRY_REL 本身（key → 渲染什么组件、
// key → 解释段是同一张前端投影表的两列，不该拆成两个文件各列一遍 15 个 key）。
// 别再加第三个豁免：会真正冲突的是「第三张也想叫路由表」，那种情况就该被规则 2b 抓到。
const SOURCE_RELS = [SOURCE_REL, REGISTRY_REL];

/* -- 唯一事实源：从领域表里解析，不内嵌 ------------------------------------- */

const sourceAbs = join(ROOT, SOURCE_REL);
if (!existsSync(sourceAbs)) {
  console.error(`✗ single source not found: ${SOURCE_REL}`);
  console.error("    Without it this gate would scan for nothing and exit 0 -- the vacuous-green failure mode.");
  process.exit(1);
}
const sourceBody = readFileSync(sourceAbs, "utf8");

const FACET_KEYS = [...sourceBody.matchAll(/designFacetKey:\s*"([^"]+)"/g)].map((m) => m[1]);
const GROUP_NAMES = (/DESIGN_FACET_GROUPS\s*=\s*\[([^\]]*)\]/.exec(sourceBody)?.[1] ?? "")
  .match(/"([^"]+)"/g)
  ?.map((s) => s.slice(1, -1)) ?? [];

if (FACET_KEYS.length < 2 || GROUP_NAMES.length < 2) {
  console.error(
    `✗ parsed ${FACET_KEYS.length} facet key(s) and ${GROUP_NAMES.length} group(s) out of ${SOURCE_REL}`,
  );
  console.error("    A gate that parsed nothing reports zero violations forever. Failing instead.");
  process.exit(1);
}

/* -- 扫描 ------------------------------------------------------------------- */

const DEFAULT_ROOTS = [
  "apps/api/src",
  "apps/api/tests",
  "apps/web/lib",
  "apps/web/app",
  "apps/web/components",
  "packages/contracts/src",
];

/**
 * 已知第二份副本。前缀 + 理由；其规模由 `blueprint-config-table-driven.test.ts` 钉住。
 * ⚠ 加一条 = 承认又多了一处副本，必须同时更新那条断言，改不动就是改不动。
 */
const DEBT_PREFIXES = [
  [
    "apps/web/lib/mock/tpl.ts",
    "the standalone prototype's hand-written CONFIG_ITEMS -- a SECOND definition table with 16 rows, different keys and a different `required` column. Which table is right is a human ruling (O-07 / D-2 / KNOWN_CONTRACT_GAPS.T3), not a code fix, so it is counted rather than excused.",
  ],
  [
    "apps/web/components/tpl/",
    "prototype screens that read the mock table above. They stop being a second copy the moment the mock does.",
  ],
];

const SKIP_DIRS = new Set(["node_modules", "generated", ".next", "dist", "__fixtures__"]);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n) || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

/** 谈论分母/完成度的行。规则 1 只在这些行上开火。 */
const DENOMINATOR_CONTEXT_RE =
  /denominator|分母|完成度|completeness|configTotal|doneCount|facetTotal|toHaveLength|设计配置项|设计环节/i;
/** 一个裸的 15 或 16（不是 16px、不是 v16、不是 0x16、不是 2016） */
const BARE_15_16_RE = /(?<![\w.$])1[56](?![\w.$%])/;

/** 非嵌套的数组/对象字面量片段——第二份清单实际长的样子 */
const LITERAL_RE = /\[([^[\]]*)\]|\{([^{}]*)\}/g;

const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;

let scanned = 0;
let violations = 0;
let debt = 0;

const isDebt = (rel) => DEBT_PREFIXES.some(([p]) => rel.startsWith(p));

function report(rel, line, message, why) {
  if (isDebt(rel)) {
    debt++;
    console.log(`· [debt] ${rel}:${line}  ${message}`);
    return;
  }
  violations++;
  console.error(`✗ ${rel}:${line}  ${message}`);
  console.error(`    ${why}`);
}

for (const root of roots) {
  const abs = root.startsWith("/") ? root : join(ROOT, root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  const files = statSync(abs).isDirectory() ? walk(abs) : [abs];
  for (const file of files) {
    const rel = relative(ROOT, file);
    /**
     * 唯一事实源对**规则 2 / 2b / 3** 豁免（它当然含全部 key 与全部分组），
     * 但**规则 1 照常适用**。
     *
     * ⚠ 第一版把整个文件跳过，于是把 `return table.length` 改成 `return 15`
     * 这件事——单源文件里最容易发生、后果最直接的那一种硬编码——门控完全看不见。
     * 反证时发现的：单元测试红了 2 条，门控 `violations=0`。
     */
    const isSingleSource = SOURCE_RELS.includes(rel);
    scanned++;
    const lines = readFileSync(file, "utf8").split("\n");

    /* 规则 2b -- 跨行的第二份表 --------------------------------------------
     * 真实的第二份表**不长成一行**：它是每行一个 `{ key: "…" }` 的数组。
     * 只看单行字面量的规则 2 对它完全沉默——`apps/web/lib/mock/tpl.ts` 的
     * `CONFIG_ITEMS` 就是这样躲过第一版的（16 行，每行一个 key，规则 2 零命中）。
     * ⇒ 再按**文件**统计一次去重后的 key 数。阈值取 3 而不是 2：
     *   偶然同时提到两个 key 的消费方不该被罚，而任何一张真表都不止 3 行。*/
    const fileKeys = new Set();
    for (const [n, raw] of lines.entries()) {
      if (/^\s*(\*|\/\/|\/\*|\{\s*\/\*)/.test(raw)) continue;
      for (const s of raw.match(/(["'`])(?:(?!\1).)*\1/g) ?? []) {
        const v = s.slice(1, -1);
        if (FACET_KEYS.includes(v)) fileKeys.add(`${v}@${n + 1}`);
      }
    }
    const distinct = new Set([...fileKeys].map((x) => x.split("@")[0]));
    if (!isSingleSource && distinct.size >= 3) {
      report(
        rel, Number([...fileKeys][0].split("@")[1]),
        `second design-facet definition table spread over multiple lines (${distinct.size} distinct keys)`,
        "I-5: one table, one file -- apps/api/src/domain/templates/design-facet-table.ts. A per-line table " +
          "is still a table; it just does not fit on one line. Import designFacetKeys() / listDesignFacetDefinitions().",
      );
    }

    lines.forEach((raw, i) => {
      // 注释里写规则本身不是违反规则——lint-error-leak / lint-permission-paths 同款豁免。
      // `{/* … */}` 也算：JSX 里的注释就是这个样子，漏掉它会把「注释里写着禁止硬编码 16」
      // 报成「硬编码了 16」——一个门控最快被静音的方式就是它先冤枉了写对的人。
      if (/^\s*(\*|\/\/|\/\*|\{\s*\/\*)/.test(raw)) return;
      const line = raw;

      /* 规则 1 -- 硬编码分母 */
      if (DENOMINATOR_CONTEXT_RE.test(line) && BARE_15_16_RE.test(line)) {
        report(
          rel, i + 1,
          `hardcoded completeness denominator in \`${line.trim().slice(0, 60)}\``,
          "uc-2-1 R3 / O-07: the denominator IS the row count of the definition table. A literal 15 or 16 " +
            "next to the word 'denominator' means the 16th-item ruling will need a code change -- which is " +
            "precisely what O-07 decided must not happen. Call designFacetDenominator().",
        );
      }

      /* 规则 2 / 3 -- 第二份清单 */
      if (isSingleSource) return;
      for (const m of line.matchAll(LITERAL_RE)) {
        const body = m[1] ?? m[2] ?? "";
        const strings = (body.match(/(["'`])(?:(?!\1).)*\1/g) ?? []).map((s) => s.slice(1, -1));
        const keyHits = strings.filter((s) => FACET_KEYS.includes(s));
        const groupHits = strings.filter((s) => GROUP_NAMES.includes(s));
        if (keyHits.length >= 2) {
          report(
            rel, i + 1,
            `second design-facet slot list (${keyHits.length} keys: ${keyHits.slice(0, 4).join(", ")}…)`,
            "I-5: the slot list has exactly one source, apps/api/src/domain/templates/design-facet-table.ts. " +
              "Derive it with designFacetKeys(); a literal copy drifts the day the 16th item lands.",
          );
        }
        if (groupHits.length >= 2) {
          report(
            rel, i + 1,
            `second design-facet group list (${groupHits.length}: ${groupHits.join(", ")})`,
            "I-20: the five groups are a closed enum declared once, as DESIGN_FACET_GROUPS. " +
              "A second listing makes 'is this enum still closed' a question with two answers.",
          );
        }
      }
    });
  }
}

console.log(
  violations === 0
    ? "✅ lint-design-facet-single-source: the definition table has one source"
    : `\n❌ ${violations} second copy/copies of the design-facet definition table. uc-2-1 R3 / I-5 / I-20.`,
);
// 机械可读，由 blueprint-config-table-driven.test.ts 断言。空目录下本脚本会「零违规」
// 地退出 0 —— 所以测试断言的是这几个数字，不是退出码。这个失败模式本仓发生过九次。
console.log(
  `scanned=${scanned} violations=${violations} debt=${debt} keys=${FACET_KEYS.length} groups=${GROUP_NAMES.length}`,
);
process.exit(violations === 0 ? 0 : 1);
