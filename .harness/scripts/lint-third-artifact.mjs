#!/usr/bin/env node
/**
 * lint-third-artifact.mjs —— 签核第 ③ 件（API 契约）的存在性门控
 *
 * 管的是什么：ADR-023 决策一规定人类签核要确认三件（① UI ② 用例 ③ API 契约）。
 * 第 ① 件由 `lint-ui-material.mjs` 管材料完整性，第 ③ 件此前**没有任何脚本在管**。
 *
 * 为什么这道门控必须存在（不是假设，是实测）：
 *   `grep "第 ③\|无对外 HTTP" .harness/scripts/` **零命中** —— 该判定从未被执行过。
 *   实测：十一个契约束里**十个**的 `packages/contracts/src/<bundle>.ts` 不存在，
 *   而其中十束已经以「三件已确认」的名义签核完毕。
 *   架构师的反证 CP-1 更直接：造一个合规 fixture 阶段、故意不建 `<bundle>.ts`，
 *   `auditSignoff` 的 fails=0、`verify-uc-coverage` 退出码 0 且打印「✅ 覆盖矩阵完整」。
 *   按本仓硬约束「没有脚本的规范条目视为未落地」，ADR-023 决策一在今天之前是**只写没做**。
 *
 * ── 判定三条 ───────────────────────────────────────────────────────────
 *
 * ① **第 ③ 件必须以两种形态之一存在**（ADR-023 决策一逐字规定的二选一）：
 *      形态 A：`packages/contracts/src/<bundle>.ts`（或 `<bundle>/index.ts`）存在，
 *              且**至少有一个 export**——一份 0 export 的文件是「为了让门控绿而
 *              发明的空契约」，ADR-023 正文点名反对的就是它。
 *      形态 B：`domain.md` 里**以小节标题的形式**显式声明本束无对外 HTTP 面，
 *              **且** `coverage.md` 的「API 操作」列填**可执行的门控命令**。
 *    两者都没有 ⇒ 红，点名该束并给出两条修法。
 *
 * ② **「无 HTTP 面」必须是显式声明，不能从「文件不存在」反推。**
 *    ADR-023 逐字：「不接受沉默的第三种情况——『忘了写契约』和『本来就没有 HTTP 面』
 *    在磁盘上必须长得不一样。」所以这里要求声明落在 `domain.md` 的**标题行**上
 *    （现存两束正是这么写的：`## 三、③ 件为什么**不是** zod 契约文件`）。
 *    只在正文里捎带一句「HTTP 管道」不算声明——`api-kernel` 的 domain.md 里就有这么一句，
 *    如果按正文松匹配，它会因为一句不相干的话被判成「已声明无 HTTP 面」。
 *    并且形态 B 的第二半（门控命令列）**是硬要求**：光声明不填命令 ⇒ 仍然红。
 *    否则「无 HTTP 面」会变成一句免死金牌，一行字就能豁免掉整个第 ③ 件。
 *
 * ③ **`coverage.md` 的最低实质性判据**（顺带堵掉 CP-1 的第二条：只有一行
 *    `# coverage` 的文件被判「覆盖矩阵完整」）。判据是**性质**，不是数量
 *    （纪律第 9 条：`toHaveLength(N)` 会把正当新增变成红，债务上限成移动靶）：
 *      ③-a 至少存在一张**以 R12 编号为行键**的映射表（表头含「API 操作 / 门控命令」
 *          一类的列，且至少有一行行键形如 `V1` / `**V4b**`）。
 *          ——「至少一张」不是数量断言，是**存在性**：零张表 = 这份文件没有在做映射这件事。
 *      ③-b 该表里**每一条** R12 行都不许沉默：要么「API 操作」格有真实落点
 *          （诚实的「无 API 面（直连 SQL 断言 RLS）」算），要么该行**具名了缺口**
 *          （`⚠ 缺口 5` / `未建` / `待裁`）。既没落点又没缺口名 ⇒ 点名那一行。
 *          ——这才是真正的判据：**逐行全称**，行数增加不会让它变红，
 *            而任何一条 R12 沉默立刻点名。判据落在**行**上而不是格上，
 *            因为纪律第 10 条是「缺口要可见、有名字」，不是「缺口不许存在」。
 *
 * ── 空集防线（纪律第 10 条，本仓栽过：空集使断言平凡为真）───────────────
 *   · 全仓一个契约束都找不到 ⇒ 红，不是「没对象所以全绿」。
 *   · 某阶段有 `contracts/` 目录却零个束目录 ⇒ 红。
 *
 * 用法：node .harness/scripts/lint-third-artifact.mjs [phase-dir-name …]
 *       不带参数 = 扫 phases/ 下全部契约束。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_MAP_FILE = join(dirname(fileURLToPath(import.meta.url)), "third-artifact-map.json");

/* ── 形态 B 的声明识别 ──────────────────────────────────────────────────
 * 只认 `domain.md` 里的**标题行**（`#` 开头）。两条模式，都以现存两束的真实写法为准：
 *   `## 三、③ 件为什么**不是** zod 契约文件`            → PAT_NOT_ZOD
 *   `…零后端、零 HTTP…` / `…没有业务 HTTP API…`        → PAT_NO_HTTP
 * 放在标题上是刻意的：声明是一个**结构性动作**（专门开一节讲清楚为什么没有），
 * 不是正文里飘过的一句话。
 * ──────────────────────────────────────────────────────────────────── */
const PAT_NOT_ZOD = /③\s*件[^\n]{0,40}不是[^\n]{0,20}zod/i;
const PAT_NO_HTTP = /(没有|无|零)\s*(业务)?\s*(对外)?\s*HTTP/;

/** domain.md 是否**以标题形式**显式声明「本束无对外 HTTP 面」。返回命中的标题行或 null。 */
export function findNoHttpDeclaration(domainBody) {
  for (const line of domainBody.split("\n")) {
    if (!/^\s{0,3}#{1,6}\s/.test(line)) continue;
    if (PAT_NOT_ZOD.test(line) || PAT_NO_HTTP.test(line)) return line.trim();
  }
  return null;
}

/* ── coverage.md 的 R12 映射表解析 ────────────────────────────────────── */

const API_COL = /API\s*操作|门控命令|API\s*面/i;
/** 行键：`V1` `**V4b**` `V10`。UC 里确有 `V4b/V7c` 这种带后缀的编号。 */
const ROW_KEY = /^\*{0,2}(V\d+[a-z]?)\*{0,2}$/;
/** 占位符：填了等于没填。`—（数据层验收）` 这种**带解释的**不算占位符，是诚实的落点。 */
const PLACEHOLDER = /^(—|-|–|——|\?|？|TBD|tbd|待填|待定|N\/A|n\/a|待补)$/;
/**
 * 具名缺口标记。判据落在**行**上而不是单个格上，理由见文件头 ③-b：
 * 本仓纪律第 10 条是「缺口要可见、有名字」，不是「缺口不许存在」。
 * `| V9 | 尝试删除本地组织被拒 | —— | —— | ⚠ **缺口 5** |` 是**合规的诚实**；
 * `| V9 | … |  |  |  |` 是**沉默**——后者才是这条判据要红的东西。
 * ⚠ 刻意不收「待生成」：它在多份 coverage 的 feature 列里逐行出现，
 *   把它当缺口标记会让整张表一律豁免，判据当场失效。
 */
const NAMED_GAP = /缺口|未建|未定|待裁|待确认|待补/;

function cells(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => c.trim());
}

/**
 * 抽出所有「以 R12 编号为行键」的映射表。
 * 返回 [{ headerLine, apiCol, rows: [{ key, api, line }] }]。
 * 表头必须含 API 操作类的列——否则「反向检查」「缺口清单」那些表会被误当成映射表。
 */
export function parseCoverageTables(body) {
  const lines = body.split("\n");
  const tables = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) { cur = null; continue; }
    const c = cells(line);
    if (/^:?-{2,}:?$/.test(c[0] ?? "")) continue;      // 分隔行

    if (cur) {
      const key = ROW_KEY.exec(c[0] ?? "");
      if (key) cur.rows.push({ key: key[1], api: c[cur.apiCol] ?? "", row: c, line: i + 1 });
      continue;
    }
    const apiCol = c.findIndex((h) => API_COL.test(h));
    if (apiCol >= 0) {
      cur = { headerLine: i + 1, apiCol, rows: [] };
      tables.push(cur);
    }
  }
  return tables.filter((t) => t.rows.length > 0);
}

/** 这一格看起来像**可执行的**门控命令吗（形态 B 第二半的判据）。 */
export function hasExecutableCommand(cell) {
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    const tok = m[1].trim();
    if (/(^|[\s/])[\w.@/-]+\.(sh|mjs|cjs|js|ts|tsx|py)\b/.test(tok)) return true;
    if (/^(pnpm|npm|yarn|node|bash|sh|make|turbo|docker|psql|curl|pytest|vitest|playwright|tsx)\b/.test(tok)) return true;
  }
  return false;
}

/* ── 束的枚举 ─────────────────────────────────────────────────────────── */

function findBundles(phasesRoot) {
  const out = [];
  const emptyPhases = [];
  if (!existsSync(phasesRoot)) return { out, emptyPhases };
  for (const phase of readdirSync(phasesRoot).sort()) {
    const contracts = join(phasesRoot, phase, "contracts");
    if (!existsSync(contracts) || !statSync(contracts).isDirectory()) continue;
    const bundles = readdirSync(contracts)
      .filter((n) => statSync(join(contracts, n)).isDirectory())
      .sort();
    if (bundles.length === 0) { emptyPhases.push(phase); continue; }
    for (const bundle of bundles) out.push({ phase, bundle, dir: join(contracts, bundle) });
  }
  return { out, emptyPhases };
}

/* ── 主体 ─────────────────────────────────────────────────────────────── */

export function lintThirdArtifact({ root = ROOT, phasesRoot, contractsSrc, schemaMapFile = CONTRACT_MAP_FILE, only = [] } = {}) {
  const errors = [];
  const rows = [];
  const SRC = contractsSrc ?? join(root, "packages", "contracts", "src");
  const PH = phasesRoot ?? join(root, "phases");
  const schemaMap = existsSync(schemaMapFile)
    ? JSON.parse(readFileSync(schemaMapFile, "utf8"))
    : {};

  const { out: found, emptyPhases } = findBundles(PH);
  for (const p of emptyPhases) {
    errors.push(
      `[零契约束] ${p} 有 contracts/ 目录，但里面一个束目录都没有。\n` +
      `    建了 contracts/ 就说明这个阶段选了 ADR-023 这套流程，零个束不许当「0/0 通过」\n` +
      `    ——「空集使断言平凡为真」是本仓栽过的形状。`,
    );
  }

  let targets = found;
  if (only.length) targets = targets.filter((t) => only.includes(t.phase));
  if (targets.length === 0) {
    errors.push(
      `没有找到任何 phases/<phase>/contracts/<束>/ —— 门控无对象可查，视为失败（空集不许平凡为真）。` +
      (only.length ? `\n    （本次只扫：${only.join(" ")}）` : ""),
    );
    return { errors, rows };
  }

  for (const { phase, bundle, dir } of targets) {
    const label = `${phase}/${bundle}`;
    const row = { label, form: null, schema: null, r12: 0 };

    /* ── 形态 A：zod 契约文件 ────────────────────────────────────────── */
    const mappedSchema = schemaMap[phase]?.[bundle] ?? null;
    const mappedSchemaValid = mappedSchema === null || (
      typeof mappedSchema === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(mappedSchema) &&
      mappedSchema !== bundle
    );
    if (!mappedSchemaValid) {
      errors.push(
        `[契约复用映射非法] ${label} 在 ${schemaMapFile.slice(root.length + 1)} 中的值必须是` +
        `不同于束名的安全契约名，实际为 ${JSON.stringify(mappedSchema)}。`,
      );
    }
    const schemaBundle = mappedSchemaValid && mappedSchema ? mappedSchema : bundle;
    const candidates = [join(SRC, `${schemaBundle}.ts`), join(SRC, schemaBundle, "index.ts")];
    const schemaPath = candidates.find((p) => existsSync(p)) ?? null;
    if (mappedSchemaValid && mappedSchema && !schemaPath) {
      errors.push(
        `[契约复用目标缺失] ${label} 显式复用 ${mappedSchema}，但 packages/contracts/src/${mappedSchema}.ts` +
        ` 与 packages/contracts/src/${mappedSchema}/index.ts 均不存在。`,
      );
    }
    let formA = false;
    if (schemaPath) {
      const src = readFileSync(schemaPath, "utf8");
      if (/^\s*export\s/m.test(src)) {
        formA = true;
        row.form = "A";
        row.schema = schemaPath.slice(root.length + 1);
      } else {
        errors.push(
          `[空契约] ${label} 的第 ③ 件 ${schemaPath.slice(root.length + 1)} 存在，但一个 export 都没有。\n` +
          `    ADR-023 正文点名反对的正是这个：「硬要给它们造一个空契约就是为了让门控绿而发明一份空契约」。\n` +
          `    修法二选一：把真实的 zod schema 写进去；或者如果本束确实无对外 HTTP 面，删掉这个文件走形态 B。`,
        );
      }
    }

    /* ── coverage.md：形态 B 判定与 ③ 实质性判据都要用它 ───────────── */
    const coveragePath = join(dir, "coverage.md");
    const coverage = existsSync(coveragePath) ? readFileSync(coveragePath, "utf8") : null;
    const tables = coverage === null ? [] : parseCoverageTables(coverage);
    const r12Rows = tables.flatMap((t) => t.rows);
    row.r12 = r12Rows.length;

    /* ── 形态 B：显式「无对外 HTTP 面」+ 门控命令列 ─────────────────── */
    const domainPath = join(dir, "domain.md");
    const declaration = existsSync(domainPath)
      ? findNoHttpDeclaration(readFileSync(domainPath, "utf8"))
      : null;

    let formB = false;
    if (!formA && declaration) {
      // 声明只是形态 B 的前一半。后一半：coverage 的 API 列必须填可执行门控命令。
      const noCmd = r12Rows.filter((r) => !hasExecutableCommand(r.api));
      if (r12Rows.length === 0) {
        errors.push(
          `[声明无 HTTP 但无门控命令] ${label} 的 domain.md 声明了本束无对外 HTTP 面\n` +
          `    （标题：${declaration}），但 coverage.md 里找不到一张以 R12 编号为行键的映射表，\n` +
          `    也就无从谈起「API 操作列填可执行门控命令」。ADR-023 决策一要求这两半同时成立。\n` +
          `    ⚠ 只声明不填命令 = 一行字豁免掉整个第 ③ 件，那正是本门控要堵的口。`,
        );
      } else if (noCmd.length > 0) {
        errors.push(
          `[声明无 HTTP 但无门控命令] ${label} 的 domain.md 声明了本束无对外 HTTP 面\n` +
          `    （标题：${declaration}），按 ADR-023 决策一，coverage.md 的「API 操作」列必须改填\n` +
          `    **可执行的门控命令**（api-kernel / web-kernel 两束就是这么写的）。\n` +
          `    这些行的 API 格里找不到任何可执行命令：` +
          noCmd.map((r) => `\n      · coverage.md:${r.line} ${r.key} → ${r.api || "（空）"}`).join("") +
          `\n    没有 HTTP 面不等于没有契约——它的契约就是那几道门控命令本身。`,
        );
      } else {
        formB = true;
        row.form = "B";
        row.schema = "无对外 HTTP 面（已显式声明 + 门控命令列已填）";
      }
    }

    /* ── ① + ②：两种形态都不成立 ⇒ 第 ③ 件缺失 ──────────────────────
     * 只在**沉默**的情况下报这一条：既没有契约文件（连空的都没有），
     * 也没有任何「无 HTTP 面」的声明。另外两种不成立各有自己的、更具体的报错
     * （[空契约] / [声明无 HTTP 但无门控命令]），不重复点名。 */
    if (!schemaPath && !declaration && !mappedSchema) {
      {
        errors.push(
          `[第 ③ 件缺失] ${label}：packages/contracts/src/${bundle}.ts 不存在` +
          `（domain.md 里也没有任何「本束无对外 HTTP 面」的小节声明）。\n` +
          `    ADR-023 决策一：第 ③ 件（API 契约）的可接受形态只有两种，**必须显式二选一**：\n` +
          `      (a) 建 packages/contracts/src/${bundle}.ts（zod 单一事实源）；\n` +
          `      (b) 本束确实无对外 HTTP 面 ⇒ 在 ${phase}/contracts/${bundle}/domain.md 里\n` +
          `          **开一节标题**说清楚（参照 phase-00 的 api-kernel / web-kernel），\n` +
          `          并把 coverage.md 的「API 操作」列改填可执行的门控命令。\n` +
          `    ⚠ ADR-023 逐字：「不接受沉默的第三种情况——『忘了写契约』和『本来就没有 HTTP 面』\n` +
          `      在磁盘上必须长得不一样。」文件不存在**不能**反推成「本来就没有」。`,
        );
      }
    }

    /* ── ③：coverage.md 的最低实质性判据 ───────────────────────────── */
    if (coverage === null) {
      errors.push(
        `[缺 coverage.md] ${label} 没有 coverage.md —— 第 ③ 件的落点判定与 UC↔API 的双向映射都靠它。`,
      );
    } else if (tables.length === 0) {
      errors.push(
        `[coverage 无映射表] ${label}/coverage.md 里找不到任何**以 R12 编号为行键**的映射表\n` +
        `    （需要一张 markdown 表，表头含「API 操作」/「门控命令」一类的列，且至少有一行行键形如 V1）。\n` +
        `    ⚠ 这条专治「只有一行 \`# coverage\` 的文件也被判『✅ 覆盖矩阵完整』」——实测发生过。\n` +
        `    覆盖矩阵的价值在于逐条 R12 指到落点；没有表 = 这份文件根本没在做这件事，不是「通过」。`,
      );
    } else {
      const blank = r12Rows.filter(
        (r) => (r.api === "" || PLACEHOLDER.test(r.api)) && !r.row.some((c) => NAMED_GAP.test(c)),
      );
      if (blank.length > 0) {
        errors.push(
          `[R12 落点悬空] ${label}/coverage.md 有 ${blank.length} 条 R12 既没有 API 落点、也没有具名缺口：` +
          blank.map((r) => `\n      · coverage.md:${r.line} ${r.key} → ${r.api === "" ? "（空）" : r.api}`).join("") +
          `\n    判据是**逐行全称**不是行数下限（纪律第 9 条：断言性质不是数量）——加行不会变红，沉默一条立刻红。\n` +
          `    诚实的「无 API 面（直连 SQL 断言 RLS）」算填了；「—— … ⚠ 缺口 5」这种具名缺口也算；\n` +
          `    一个光秃秃的破折号、或干脆空着，不算。`,
        );
      }
    }

    rows.push(row);
  }

  return { errors, rows };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith("lint-third-artifact.mjs")) {
  const { errors, rows } = lintThirdArtifact({ only: process.argv.slice(2) });
  for (const r of rows) {
    console.log(
      `  ${r.form ? "✓" : "✗"} ${r.label.padEnd(44)} ${r.form ? `形态 ${r.form}` : "第 ③ 件缺失"}` +
      `  R12 ${String(r.r12).padStart(3)} 行  ${r.schema ?? ""}`,
    );
  }
  if (errors.length) {
    console.error("");
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(
      `\n❌ lint-third-artifact: ${errors.length} 处第 ③ 件不成立。` +
      `\n   签核第 ③ 件是「API 契约」：要么有 packages/contracts/src/<束>.ts，` +
      `要么显式声明无对外 HTTP 面并把 coverage 的 API 列改填门控命令。二选一，不接受沉默的第三种。`,
    );
    process.exit(1);
  }
  console.log(
    `✅ lint-third-artifact: ${rows.length} 个契约束的第 ③ 件均成立` +
    `（形态 A ${rows.filter((r) => r.form === "A").length} 束 / 形态 B ${rows.filter((r) => r.form === "B").length} 束）`,
  );
}
