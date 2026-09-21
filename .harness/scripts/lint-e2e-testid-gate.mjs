#!/usr/bin/env node
/**
 * lint-e2e-testid-gate.mjs —— e2e spec 引用的 testid 必须在源码里存在（issue #2128）
 *
 * ## 管的是什么
 *
 * 2026-08-26 一天内同一形状咬了两次，两次都是**删东西**引起的：
 *   ① 编辑器改版删掉 `tpladmin-editor-add-section`，两个老 spec 还锚着它；
 *   ② 撤掉表格视图（PR #2123）时 `tpladmin-row-*` / `canvas-template-usage-*` 跟着
 *      容器一起没了，`core-loop.spec.ts` 第 4、8c 步锚的正是它们。
 * 共同形状：**改动侧全绿**——lint / tsc / 单测都不看 testid 字符串，只有跑完整栈
 * 浏览器 e2e 才会红；那是最慢、最贵、最容易被当成环境抖动的一层。等 CI 告诉你，
 * 已经浪费一整轮。
 *
 * 本门控是**纯文本比对**：不起浏览器、不连库、秒级出结果。它的全部价值是
 * **删掉一个 testid 而没人跟进时立刻红**。
 *
 * ## 它挡不住什么（不要误以为管得更宽）
 *
 *  · 只查「这个 testid 在源码里出现过」——**不**查它出现在正确的组件里，更**不**查
 *    它当前是否真的渲染得出来（条件渲染、权限分支都可能让它不出现）。那些只有真
 *    e2e 能证。
 *  · 声明侧带插值的写法（``data-testid={`${prefix}-form`}``）退化成通配符 `*-form`，
 *    于是任何以 `-form` 结尾的引用都判绿。这是**刻意的宽松**：门控误报一次就会被
 *    整条跳过，宁可漏报。
 *  · 引用侧解析不了的写法（正则字面量、跨文件常量、下标表达式）直接跳过并计数，
 *    不假装检查过——跳过数会打印出来。
 *  · spec 里的注释**不算引用**（`core-loop.spec.ts` 的复盘注释逐字引用过已删掉的
 *    `chat-agent-run-status`；那是史料，不是锚点）。
 *
 * ## 豁免：「断言它不存在」的故意引用
 *
 * `await expect(page.getByTestId("tpladmin-table")).toHaveCount(0)` 断言的是表格视图
 * **已被刻意撤掉**，这条引用完全正确。门控无法从字符串区分「引用」与「断言其不
 * 存在」，所以给**行内标注**（不是一张会腐烂的允许清单）：
 *
 *     await expect(page.getByTestId("tpladmin-table")).toHaveCount(0); // testid-gate: absent 表格视图已撤（#2123）
 *
 * 标注作用于**该行与紧邻的下一行**（便于写在长断言上方）。两条防腐判定：
 *   · 标注覆盖范围内压根没有 testid 引用 ⇒ 红（陈旧标注）。
 *   · 覆盖范围内的引用**全都**能在源码里找到 ⇒ 红（那个 testid 又回来了，
 *     豁免已无意义；留着它等于给未来的删除开一张永久通行证）。
 *
 * 用法：node .harness/scripts/lint-e2e-testid-gate.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** e2e spec 与其 helper（helper 里也有 getByTestId）。 */
export const SPEC_ROOTS = ["apps/web/e2e"];
export const SPEC_EXTS = [".ts"];

/** 声明侧扫描范围：源码平面，不含测试自身。 */
export const SOURCE_ROOTS = ["apps/web/components", "apps/web/app", "apps/web/lib", "packages"];
export const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"];

/** 行内豁免标注。 */
export const ABSENT_MARKER = /testid-gate:\s*absent/;

/** 插值占位符——声明/引用里的 `${...}` 统一折成它，再按通配符处理。 */
export const HOLE = "\u0000";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo", "coverage", "__evidence__", ".git"]);

/** 递归列目录下指定后缀的文件（相对 base 的路径）。 */
export function listFiles(root, exts, base = ROOT) {
  const abs = join(base, root);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (exts.some((e) => entry.endsWith(e))) out.push(relative(base, full));
    }
  };
  if (statSync(abs).isDirectory()) walk(abs);
  return out.sort();
}

/**
 * 把注释涂成空格（长度与换行全部保留，行号/下标不变）。
 * 字符串与正则字面量里的 `//` 不是注释（`https://…`、`/\/\//`）。
 */
export function stripComments(text) {
  const out = text.split("");
  let i = 0;
  let prev = ""; // 上一个非空白、非注释的有效字符，用来区分除号与正则字面量
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
      i += 1;
      prev = c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*~^%<>".includes(prev))) {
      // 正则字面量：整段跳过，里面的 `//` 不是注释。
      i += 1;
      let inClass = false;
      while (i < text.length && text[i] !== "\n") {
        if (text[i] === "\\") i += 2;
        else if (text[i] === "[") { inClass = true; i += 1; }
        else if (text[i] === "]") { inClass = false; i += 1; }
        else if (text[i] === "/" && !inClass) { i += 1; break; }
        else i += 1;
      }
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out.join("");
}

/**
 * 把带插值的 testid 字面量折成「模式」：`${...}` → HOLE。
 * 返回 null 表示这个字面量不可用作判据：全是洞，或最长静态片段 < 3
 * （`${a}-${b}` 这种会匹配一切，收进判据池等于把门控变成恒绿）。
 */
export function toPattern(literal) {
  const folded = literal.replace(/\$\{[^}]*\}/g, HOLE);
  const statics = folded.split(HOLE).filter(Boolean);
  if (statics.length === 0) return null;
  if (!folded.includes(HOLE)) return folded;
  return Math.max(...statics.map((s) => s.length)) >= 3 ? folded : null;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 模式 → 正则（洞匹配任意 testid 片段）。 */
export function patternToRegExp(pattern) {
  return new RegExp(`^${pattern.split(HOLE).map(esc).join("[^\\s\"'`]*")}$`);
}

/** 模式 → 「骨架」：把洞当成空串的那个具体实例。 */
export const skeleton = (pattern) => pattern.split(HOLE).join("");

/**
 * 引用模式 R 与声明模式 D 是否**可能指向同一个 testid**。
 * 二者都静态时退化为相等；任一侧带洞时，用「一侧的正则吃得下另一侧的骨架」做判据。
 */
export function compatible(refPattern, declPattern) {
  return (
    patternToRegExp(declPattern).test(skeleton(refPattern)) ||
    patternToRegExp(refPattern).test(skeleton(declPattern))
  );
}

/**
 * 判据池分两层——单独任何一层都漏过 #2128 草稿栽的那批：
 *
 *  · **属性锚定层**：紧跟在 testid 类属性名后面的字面量（`data-testid="loading"`、
 *    `testid="skill-create-modal"`、`testId: "x"`、`` data-testid={`${p}-form`} ``）。
 *    这一层无歧义，所以连 `loading` / `empty` / `denied` 这种单词名也照收。
 *  · **泛字面量层**：源码里任何「长得像 testid」的**静态**字符串（含 `-`、只有词字符）。
 *    #2128 里 `copilot-assistant-message` 写在 CSS 选择器里、`admin-nav-org-members`
 *    躺在 `ADMIN_NAV_TESTID` 映射表里、`chat-task-workbench-template-research` 是模板
 *    数组里的 `id` ——按属性名抓一律漏。本门控问的本来就只是「这个字符串在源码里
 *    出现过吗」，那就别去穷举有限多种写法。
 *
 * ⚠ 泛字面量层**只收静态串**：`skill-${crypto.randomUUID()}`（一个业务 id 生成式，
 * 跟 testid 毫无关系）折成通配符就是 `skill-*`，它会把每一个 `skill-…` 开头的引用
 * 判绿——一条这样的串就能让整道门对半个仓库失效。带插值的写法只有**明确写在
 * testid 属性位上**时才进池子（属性锚定层）。
 *
 * 泛字面量层剩下的代价：`text-12` 这类 class 名也会进池子，于是同名 testid 被删掉时
 * 会误判成"还在"。这是**漏报**方向的代价，符合「宁可漏报也不误报」的取向
 * （误报一次，这道门就会被整条跳过）。
 *
 * 两层都先 `stripComments`：源码注释里逐字写着「`chat-task-workbench-failure-restore-checkpoint`
 * 这个锚点不存在于 DOM」——照收就是拿一句"它不存在"证明"它存在"。
 */
export function looksLikeTestid(folded) {
  return folded.includes("-") && /^[\w\u0000-]+$/.test(folded) && folded.replace(/\u0000/g, "").length >= 3;
}

const ANY_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g;

/** 任何以 testid 结尾（或 testIdPrefix / testidBase 这类）的属性名/常量名。 */
const DECL_KEY = /(?:^|[\s{(,;"'`[])(?:data-)?[A-Za-z_$-]*[Tt][Ee][Ss][Tt]-?[Ii][Dd][A-Za-z_$]*\s*[:=]\s*/g;

/** 从 `{...}` 表达式里抓全部字符串字面量（覆盖三元、辅助函数调用等写法）。 */
function literalsInBraces(text, openIndex) {
  let depth = 0;
  let i = openIndex;
  for (; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return [...text.slice(openIndex + 1, i).matchAll(ANY_LITERAL)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** 属性锚定层：紧跟 testid 类属性名的字面量。 */
export function extractAnchoredDeclarations(text) {
  const out = [];
  for (const m of text.matchAll(DECL_KEY)) {
    const at = m.index + m[0].length;
    const ch = text[at];
    if (ch === "{") out.push(...literalsInBraces(text, at));
    else if (ch === '"' || ch === "'" || ch === "`") {
      const end = text.indexOf(ch, at + 1);
      if (end > at) out.push(text.slice(at + 1, end));
    }
  }
  return out.filter((l) => l.length >= 2 && !/\s/.test(l));
}

/** 泛字面量层：任何长得像 testid 的**静态**字符串字面量（带插值的一律不收，见头注）。 */
export function extractLooseDeclarations(text) {
  const out = [];
  for (const m of text.matchAll(ANY_LITERAL)) {
    const literal = m[1] ?? m[2] ?? m[3];
    if (literal && !literal.includes("${") && looksLikeTestid(literal)) out.push(literal);
  }
  return out;
}

/** 两层合一。 */
export function extractDeclarations(text) {
  return [...extractAnchoredDeclarations(text), ...extractLooseDeclarations(text)];
}

const REF_CALL = /getByTestId\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|([A-Za-z_$][\w$]*)\s*\))/g;
const REF_SELECTOR = /\[data-testid=\s*(?:"([^"\n\]]*)"|'([^'\n\]]*)')\s*\]/g;
const REF_REGEX_ARG = /getByTestId\(\s*\//g;
const LOCAL_CONST = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`)/g;

/**
 * 抽取一个 spec 文件里引用到的 testid（调用方需先 `stripComments`）。
 * 返回 { refs: [{ literal, line }], skipped: [{ text, line }] }——
 * 解析不了的引用（正则字面量、下标表达式、跨文件常量）进 skipped，**不假装检查过**。
 */
export function extractReferences(text) {
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const consts = new Map();
  for (const m of text.matchAll(LOCAL_CONST)) {
    const value = m[2] ?? m[3] ?? m[4];
    if (value) consts.set(m[1], value);
  }
  const refs = [];
  const skipped = [];
  for (const m of text.matchAll(REF_CALL)) {
    const literal = m[1] ?? m[2] ?? m[3];
    if (literal !== undefined) {
      refs.push({ literal, line: lineOf(m.index) });
      continue;
    }
    const resolved = consts.get(m[4]);
    if (resolved !== undefined) refs.push({ literal: resolved, line: lineOf(m.index) });
    else skipped.push({ text: m[0], line: lineOf(m.index) });
  }
  for (const m of text.matchAll(REF_SELECTOR)) refs.push({ literal: m[1] ?? m[2], line: lineOf(m.index) });
  for (const m of text.matchAll(REF_REGEX_ARG)) skipped.push({ text: "getByTestId(/…/)", line: lineOf(m.index) });
  return { refs, skipped };
}

/**
 * 行内豁免的覆盖范围：标注写成**行尾注释**时只豁免该行；标注**独占一行**时豁免
 * 紧邻的下一行（便于写在长断言上方）。
 *
 * ⚠ 不做成「本行 + 下一行」都豁免：行尾标注会顺手把下一行的引用也放出去
 * （`registration-code` 的下一行正是 `registration-org-name`），那是**一条真引用
 * 被静默豁免**，恰恰是这道门最怕的失效形态。
 */
export function absentLines(rawText, refs) {
  const hasRef = new Set(refs.map((r) => r.line));
  const marked = new Map();
  rawText.split("\n").forEach((line, i) => {
    if (!ABSENT_MARKER.test(line)) return;
    marked.set(i + 1, hasRef.has(i + 1) ? [i + 1] : [i + 2]);
  });
  return marked;
}

/** 声明池：静态字符串 Set + 带洞模式数组（后者量小，逐条正则）。 */
export function buildDeclarationIndex(sources) {
  const statics = new Set();
  const wildcards = new Map();
  for (const [path, raw] of sources) {
    for (const literal of extractDeclarations(stripComments(raw))) {
      const pattern = toPattern(literal);
      if (pattern === null) continue;
      if (pattern.includes(HOLE)) { if (!wildcards.has(pattern)) wildcards.set(pattern, path); }
      else statics.add(pattern);
    }
  }
  return { statics, wildcards: [...wildcards.keys()] };
}

/** 一条引用模式能否在声明池里找到落点。 */
export function resolves(refPattern, index) {
  if (!refPattern.includes(HOLE) && index.statics.has(refPattern)) return true;
  if (index.wildcards.some((d) => compatible(refPattern, d))) return true;
  if (refPattern.includes(HOLE)) {
    const re = patternToRegExp(refPattern);
    for (const s of index.statics) if (re.test(s)) return true;
  }
  return false;
}

/** 纯函数判定。specs / sources: [路径, 内容][]。 */
export function checkTestidGate(specs, sources) {
  const failures = [];
  const index = buildDeclarationIndex(sources);
  const declCount = index.statics.size + index.wildcards.length;

  let seen = 0; // 抽到的引用总数（checked + exempted + 折不出模式的那几条）
  let checked = 0;
  let exempted = 0;
  let skipped = 0;
  const dangling = [];

  for (const [path, raw] of specs) {
    const text = stripComments(raw);
    const { refs, skipped: unparsed } = extractReferences(text);
    skipped += unparsed.length;
    const marks = absentLines(raw, refs);
    const coveredBy = new Map(); // 标注行 → 它覆盖到的引用
    for (const [markLine, range] of marks) coveredBy.set(markLine, refs.filter((r) => range.includes(r.line)));

    const exemptLines = new Set([...marks.values()].flat());
    seen += refs.length;
    for (const ref of refs) {
      const pattern = toPattern(ref.literal);
      if (pattern === null) { skipped += 1; continue; }
      if (exemptLines.has(ref.line)) { exempted += 1; continue; }
      checked += 1;
      if (!resolves(pattern, index)) dangling.push({ path, line: ref.line, testid: ref.literal });
    }

    // 防腐①：标注没覆盖到任何引用 ⇒ 陈旧标注。
    // 防腐②：覆盖到的引用全都能在源码里找到 ⇒ 那个 testid 回来了，豁免已无意义。
    for (const [markLine, covered] of coveredBy) {
      if (covered.length === 0) {
        failures.push(`${path}:${markLine} 有 \`testid-gate: absent\` 标注，但它覆盖的行没有任何 testid 引用——陈旧标注，删掉它`);
        continue;
      }
      const patterns = covered.map((r) => toPattern(r.literal)).filter((p) => p !== null);
      if (patterns.length > 0 && patterns.every((p) => resolves(p, index))) {
        failures.push(`${path}:${markLine} 的 \`testid-gate: absent\` 标注已无意义——它覆盖的 ${covered.map((r) => `\`${r.literal}\``).join(" / ")} 在源码里都还在；删掉标注，让门控重新管住它们`);
      }
    }
  }

  // ── 空集防线（本仓多次「全绿但空转」的教训）──────────────────────
  if (specs.length === 0) failures.push("空集防线：一个 spec 文件都没扫到——门控在空转");
  if (sources.length === 0) failures.push("空集防线：一个源码文件都没扫到——门控在空转");
  if (declCount === 0) failures.push("空集防线：源码里一个 testid 声明都没抽到——判据池是空的，此时任何引用都会判红，结论无意义");
  // ⚠ 判据是「抽到的引用总数」而不是 checked：全部引用恰好都被豁免时 checked 为 0，
  // 那是正常状态，不是正则失配。
  if (seen === 0 && specs.length > 0) failures.push("空集防线：一条 testid 引用都没抽到——引用侧正则大概率失配");

  for (const d of dangling) {
    failures.push(
      `${d.path}:${d.line} 引用的 \`${d.testid}\` 在源码里找不到任何声明——要么 spec 写错了名字，` +
      `要么这个 testid 被删了而 spec 没跟进；确属「断言它不存在」请加行内标注 \`// testid-gate: absent <原因>\``,
    );
  }

  return { ok: failures.length === 0, failures, seen, checked, exempted, skipped, dangling, declarations: declCount };
}

export function run(base = ROOT) {
  const read = (rel) => [rel, readFileSync(join(base, rel), "utf8")];
  const specs = SPEC_ROOTS.flatMap((r) => listFiles(r, SPEC_EXTS, base)).map(read);
  const sources = SOURCE_ROOTS.flatMap((r) => listFiles(r, SOURCE_EXTS, base)).map(read);
  return checkTestidGate(specs, sources);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  if (result.ok) {
    console.log(
      `✅ [e2e-testid-gate] ${result.checked} 条 e2e testid 引用全部在源码里有声明` +
      `（判据池 ${result.declarations} 条；豁免 ${result.exempted} 条；解析不了跳过 ${result.skipped} 条）`,
    );
    process.exit(0);
  }
  console.error("❌ [e2e-testid-gate]");
  for (const f of result.failures) console.error(`   · ${f}`);
  console.error(`   （已检查 ${result.checked} 条引用，豁免 ${result.exempted} 条，跳过 ${result.skipped} 条）`);
  process.exit(1);
}
