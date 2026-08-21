#!/usr/bin/env node
/**
 * lint-ui-material.mjs —— 签核第 ① 件（UI）的材料完整性门控
 *
 * 管的是什么：`phases/<phase>/contracts/<束>/ui.md` 里引用的截图集合，
 * 必须与它对应的 `ui-preview/<目录>/` 里实存的 png 集合**逐张相等**。
 *
 * 为什么这道门控必须存在：
 *   签核 ① 的材料就是那批截图。十个束的 ui.md 顶部各写了一行
 *   「本文件引用 N 张，目录实存 M 张」的自检——**没有任何脚本在跑它**。
 *   按本仓硬约束「没有脚本的规范条目视为未落地」，那行字今天为真，
 *   明天有人加一张图或改一个文件名，它就悄悄变假，而没有任何东西会报。
 *   ⚠ 这不是假设：main coordinator 手写过一个统计脚本，正则写错、对每个束都返回
 *   「0 处命中」，还拿那个错数字向人类汇报了两次。会红的门控本能第一次就拦住它。
 *
 * 判定四条：
 *   ① 正向：ui.md 引用的每一条截图路径都必须是真实存在的文件（死链 ⇒ 失败，点名路径）。
 *   ② 反向：截图目录里每一张 png 都必须被 ui.md 引用到
 *      —— 有图没被引用 = 人类签核时根本看不到它，同样是材料不完整。
 *   ③ 束↔目录映射必须显式声明在 ui-material-map.json（四个束不同名，猜同名必错）；
 *      缺映射 ⇒ 报「未声明」，**不是**静默跳过。
 *   ④ 目录不存在 / 目录里 0 张 png ⇒ 失败，不是「0/0 全绿」。
 *      「空集使断言平凡为真」是本仓栽过的形状，这里显式堵掉。
 *
 * 同 phase 复用：不引入新界面的束可在 map 中显式声明
 * `{ "reuse_bundle": "<bundle>" }`。目标必须是拥有 concrete 目录且自身完整通过
 * 双向门禁的同 phase 束；复用束仍须完整引用该目录的精确截图集。
 * self/missing/cycle/chained/跨 phase/越出目标目录一律 fail closed。
 *
 * 缺口条目怎么写：`⚠ 未产出：…` 的缺口是**文字**，不是链接。写成 `xxx.png` 会被
 * 当成死链报出来——正确写法是去掉 `.png` 后缀，用文字描述该缺哪张。
 *
 * 用法：node .harness/scripts/lint-ui-material.mjs [phase-dir-name …]
 *       不带参数 = 扫 phases/ 下全部带 ui.md 的契约束。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHASES = join(ROOT, "phases");
const MAP_FILE = join(dirname(fileURLToPath(import.meta.url)), "ui-material-map.json");
const MAP_REL = relative(ROOT, MAP_FILE);

/**
 * 从 ui.md 正文抽出所有截图引用。
 *
 * ⚠ 文件名含中文（`uc-6-0-访谈列表-default.png`），所以**不能**用 `[\w./-]+\.png`。
 *   第一版正是这个错——对每个束返回 0 处命中，看起来「全绿」。
 *   这里改成「非空白、非分隔符的一串字符 + .png」，并显式排除占位符。
 *
 * 返回 [{ raw, line }]。
 */
export function extractRefs(body) {
  const out = [];
  const lines = body.split("\n");
  // 分隔符：空白、反引号、markdown 表格竖线、括号、方括号、引号、中文顿号/逗号/句号
  const RE = /[^\s`|()\[\]"'，、。；：]+\.png\b/g;
  lines.forEach((text, i) => {
    for (const m of text.matchAll(RE)) {
      const raw = m[0];
      // 占位符 / 命名规则说明 / 复核命令里的正则，不是真实引用：
      //   `<uc-id>-<屏名>-<状态>.png`、`ui-preview/x/*.png`、`[a-z0-9-]+\.png`、光秃秃的 `.png`
      // 真实截图文件名里不会出现 < > * \，所以拿它们当占位符标记是安全的。
      if (/[<>*\\]/.test(raw)) continue;
      if (raw === ".png") continue;
      out.push({ raw, line: i + 1 });
    }
  });
  return out;
}

/**
 * 把一条引用归一成「相对 phase 目录的路径」。
 *   `ui-preview/tpl/a.png`                            → ui-preview/tpl/a.png
 *   `phases/phase-01-.../ui-preview/tpl/a.png`        → ui-preview/tpl/a.png
 *   `a.png`（裸文件名）                                 → <declaredDir>/a.png
 * 带目录但不在声明目录下的，原样返回 —— 由调用方判定为「不属于本束目录」。
 */
export function normalizeRef(raw, declaredDir) {
  let p = raw.replace(/^\.\//, "");
  const idx = p.indexOf("ui-preview/");
  if (idx >= 0) return p.slice(idx);
  if (!p.includes("/")) return `${declaredDir}/${p}`;
  return p;
}

/**
 * 抽出 ui.md 顶部那行人写的自检：「本文件引用 N 张截图，目录下实际 M 张」。
 *
 * 为什么要抽它出来对：这行字是**同一事实的第二份副本**（第一份是文件系统本身）。
 * 本仓已五次因「同一事实声明在两处」漂移。既然十份 ui.md 都写了它，正确的收敛
 * 不是把它删掉（人类签核时要一眼看到量级），而是把它**变成会被机械核对的断言**。
 * 十份文件的写法各不相同，所以只认最松的两个模式，且限定在文件头 20 行内。
 */
export function extractSelfCheck(body) {
  const head = body.split("\n").slice(0, 20).join("\n");
  const n = /引用\s*\*{0,2}\s*(\d+)\s*\*{0,2}\s*张/.exec(head);
  const m = /实际\s*\*{0,2}\s*(\d+)\s*\*{0,2}\s*张/.exec(head);
  return { declaredN: n ? Number(n[1]) : null, declaredM: m ? Number(m[1]) : null };
}

function listPngs(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) continue;
    if (n.toLowerCase().endsWith(".png")) out.push(n);
  }
  return out.sort();
}

function findUiMds(phasesRoot = PHASES) {
  const found = [];
  if (!existsSync(phasesRoot)) return found;
  for (const phase of readdirSync(phasesRoot).sort()) {
    const contracts = join(phasesRoot, phase, "contracts");
    if (!existsSync(contracts) || !statSync(contracts).isDirectory()) continue;
    for (const bundle of readdirSync(contracts).sort()) {
      const ui = join(contracts, bundle, "ui.md");
      if (existsSync(ui)) found.push({ phase, bundle, ui });
    }
  }
  return found;
}

function isReuseMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isConcreteScreenshotDir(value) {
  if (typeof value !== "string" || !value.startsWith("ui-preview/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.length > 1 && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * 共用目录允许是阶段级 `ui-preview` 本身（phase-10 的真实结构就是扁平的），
 * 也允许是它下面的子目录。安全约束与 concrete 目录一致：不许 ..、绝对路径、
 * 反斜杠、跨 phase——只是放开「必须是子目录」这一条。
 */
function isPhaseContainedSharedDir(root, phase, value) {
  if (typeof value !== "string" || value.includes("\\")) return false;
  if (value !== "ui-preview" && !value.startsWith("ui-preview/")) return false;
  const segments = value.split("/");
  if (!segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")) return false;
  const phaseRoot = resolve(root, "phases", phase);
  return resolve(phaseRoot, value).startsWith(`${phaseRoot}${sep}`);
}

function isPhaseContainedScreenshotDir(root, phase, value) {
  if (!isConcreteScreenshotDir(value)) return false;
  const phaseRoot = resolve(root, "phases", phase);
  return resolve(phaseRoot, value).startsWith(`${phaseRoot}${sep}`);
}

/** 解析复用束 ui.md 中人可见、可机检的固定声明。 */
export function extractReuseStatement(body) {
  const match = /^\s*>\s*\*{0,2}UI material reuse:\s*no new screen\s*;\s*reuse_bundle:\s*`([A-Za-z0-9][A-Za-z0-9_-]*)`\.\*{0,2}\s*$/im.exec(body);
  return match?.[1] ?? null;
}

/**
 * 读 map 文件，并在解析前先查一遍**重复键**。
 *
 * 为什么要单独查：`JSON.parse` 对重复键是「后者胜出、前者静默丢弃」。
 * 2026-08 就栽过一次——#1692 给 phase-10 写了 `shared_dir` 映射，#1691 又给同一个
 * phase 写了第二份按束子目录映射，两块都留在文件里。门控只认后一块，前一块连同它
 * 那段解释「为什么必须共用目录」的注释成了死代码，读文件的人会看到两段互相矛盾的说明。
 * 本仓硬约束是「同一事实不得声明在两处」——这次连两处都不在两个文件里，是同一个对象里
 * 的同一个键。丢弃发生在 JSON 层，静悄悄的，没有任何东西会报。现在会报。
 */
export function findDuplicateKeys(text) {
  const dups = [];
  const stack = [];        // 每层对象一个 Set<key>
  const path = [];         // 当前 key 路径，仅用于报错可读
  let i = 0;
  let pendingKey = null;   // 刚读到的字符串，若下一个非空白字符是 ':' 则它是 key

  const readString = () => {
    let out = "";
    i += 1;                // 跳过开引号
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { out += text[i + 1] ?? ""; i += 2; continue; }
      if (c === '"') { i += 1; return out; }
      out += c;
      i += 1;
    }
    return out;            // 未闭合的字符串交给下面的 JSON.parse 去报语法错
  };

  while (i < text.length) {
    const c = text[i];
    if (c === '"') { pendingKey = readString(); continue; }
    if (c === ":" && pendingKey !== null && stack.length > 0) {
      const seen = stack[stack.length - 1];
      const key = pendingKey;
      // `//`、`//1` 这类注释键在本文件里成组出现且各不相同；真重复了照样该报。
      if (seen.has(key)) dups.push([...path.slice(0, stack.length - 1), key].join(" › "));
      else seen.add(key);
      path[stack.length - 1] = key;
      pendingKey = null;
      i += 1;
      continue;
    }
    if (c === "{") { stack.push(new Set()); pendingKey = null; i += 1; continue; }
    if (c === "}") { stack.pop(); path.length = Math.max(0, stack.length); pendingKey = null; i += 1; continue; }
    if (c === "," || c === "[" || c === "]") pendingKey = null;
    i += 1;
  }
  return dups;
}

function readMap(mapFile) {
  const text = readFileSync(mapFile, "utf8");
  const dups = findDuplicateKeys(text);
  if (dups.length) {
    const rel = relative(ROOT, mapFile);
    throw new Error(
      `[映射重复键] ${rel} 里有 ${dups.length} 个键出现了不止一次：\n` +
      dups.map((d) => `      ${d}`).join("\n") +
      `\n    JSON.parse 会让后者胜出、前者连同它的 "//" 注释一起被静默丢弃，\n` +
      `    于是文件里躺着一份没人执行的映射，读的人却以为它生效。\n` +
      `    修法：把两份收敛成一份（本仓硬约束：同一事实不得声明在两处），别靠"后者胜出"。`,
    );
  }
  return JSON.parse(text);
}

function lintUiMaterialLegacy({ root = ROOT, mapFile = MAP_FILE, phasesRoot, only = [] } = {}) {
  const errors = [];
  const rows = [];
  const map = readMap(mapFile);

  let targets = findUiMds(phasesRoot ?? join(root, "phases"));
  if (only.length) targets = targets.filter((t) => only.includes(t.phase));
  if (targets.length === 0) {
    errors.push(`没有找到任何 phases/<phase>/contracts/<束>/ui.md —— 门控无对象可查，视为失败（空集不许平凡为真）`);
    return { errors, rows };
  }

  for (const { phase, bundle, ui } of targets) {
    const label = `${phase}/${bundle}`;
    const declaredDir = map[phase]?.[bundle];

    /* ── ③ 映射必须显式声明 ───────────────────────────────────────── */
    if (!declaredDir) {
      errors.push(
        `[未声明] ${label}/ui.md 存在，但 ${MAP_REL} 里没有声明它的截图目录。\n` +
        `    束名与截图目录名并非一一对应（interview→itv-v2、recording→rec、skills→skill、templates→tpl），\n` +
        `    所以这里不猜同名。修法：往 ${MAP_REL} 的 "${phase}" 下补一行 "${bundle}": "ui-preview/<目录名>"。`,
      );
      continue;
    }

    const absDir = join(root, "phases", phase, declaredDir);

    /* ── ④ 目录必须存在且非空 ─────────────────────────────────────── */
    if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
      errors.push(
        `[目录缺失] ${label} 声明的截图目录不存在：phases/${phase}/${declaredDir}\n` +
        `    要么目录改名了（改 ${MAP_REL}），要么截图还没产出（那就是签核 ① 无材料）。\n` +
        `    这里**不**当成 0/0 通过——「空集使断言平凡为真」是本仓栽过的形状。`,
      );
      continue;
    }
    const actual = listPngs(absDir);
    if (actual.length === 0) {
      errors.push(
        `[目录为空] ${label} 的截图目录 phases/${phase}/${declaredDir} 里一张 png 都没有。\n` +
        `    签核 ① 的材料就是截图，没有截图 = 不具备签核条件，不是「全绿」。`,
      );
      continue;
    }

    const body = readFileSync(ui, "utf8");
    const refs = extractRefs(body);
    const referenced = new Map(); // basename -> 首次出现行号

    for (const { raw, line } of refs) {
      const rel = normalizeRef(raw, declaredDir);
      const abs = join(root, "phases", phase, rel);
      if (!existsSync(abs)) {
        /* ── ① 死链 ───────────────────────────────────────────────── */
        errors.push(
          `[死链] ${label}/ui.md:${line} 引用了不存在的截图：${rel}\n` +
          `    原文：${raw}\n` +
          `    修法二选一：(a) 改成 phases/${phase}/${declaredDir}/ 下真实存在的文件名；\n` +
          `                (b) 如果这本来就是「⚠ 未产出」的缺口条目——**缺口是文字，不是链接**，\n` +
          `                    去掉 .png 后缀改成文字描述（例如「⚠ 未产出：模板库空态特写」），否则它会被当成死链。`,
        );
        continue;
      }
      if (!rel.startsWith(`${declaredDir}/`)) {
        errors.push(
          `[跨目录] ${label}/ui.md:${line} 引用了本束声明目录之外的截图：${rel}\n` +
          `    本束声明的目录是 ${declaredDir}（见 ${MAP_REL}）。签核材料只能来自本束目录。`,
        );
        continue;
      }
      const base = rel.slice(declaredDir.length + 1);
      if (!referenced.has(base)) referenced.set(base, line);
    }

    /* ── ② 反方向：有图没被引用 ───────────────────────────────────── */
    const orphans = actual.filter((f) => !referenced.has(f));
    for (const f of orphans) {
      errors.push(
        `[未被引用] ${label}: phases/${phase}/${declaredDir}/${f} 实存，但 ui.md 一次都没引用它。\n` +
        `    人类签核只看 ui.md，没被索引到的图等于不存在——要么补进索引表，要么删掉这张图。`,
      );
    }

    /* ── ⑤ 顶部自检行必须存在，且数字必须与机械统计一致 ─────────────── */
    const { declaredN, declaredM } = extractSelfCheck(body);
    if (declaredN === null || declaredM === null) {
      errors.push(
        `[缺自检行] ${label}/ui.md 头 20 行里找不到「本文件引用 N 张截图，目录下实际 M 张」这行自检。\n` +
        `    人类签核靠它一眼看量级。写上它，本门控会替你核对（当前实测 N=${referenced.size}、M=${actual.length}）。`,
      );
    } else if (declaredN !== referenced.size || declaredM !== actual.length) {
      errors.push(
        `[自检行过时] ${label}/ui.md 顶部写着「引用 ${declaredN} 张 / 实际 ${declaredM} 张」，` +
        `实测是「引用 ${referenced.size} 张 / 实际 ${actual.length} 张」。\n` +
        `    这行字是同一事实的第二份副本——改了截图就得同步改它，否则它今天为真、明天悄悄变假。`,
      );
    }

    rows.push({
      label,
      dir: declaredDir,
      referenced: referenced.size,
      actual: actual.length,
      orphans: orphans.length,
    });
  }

  return { errors, rows };
}

/**
 * 共用目录模式：`{ "shared_dir": "ui-preview" }`。
 *
 * 为什么需要它（2026-08-20，phase-10-live-collaboration-orchestration 实测）：
 * 原模型是「一束 ↔ 一个独占目录 ∧ 引用集逐张相等」。phase-10 的 5 个束共用一个
 * 阶段级 ui-preview/，而且**引用互相重叠**——`group-graph-default.png` 同时被
 * module-routing 与 stage-aggregation 引用，`role-member-group-chat.png` 等 3 张
 * 同时被 segment-engine 与 viewer-role 引用。这种结构无法拆成互不相交的子目录
 * （除非复制图片，那就制造了同一张图的第二份副本）。
 *
 * 不是作者漏声明，是模型表达不了。所以扩模型，不是放宽判定：
 *   · 死链检查      逐束不变（引用的图必须存在）
 *   · 跨目录检查    逐束不变（只能引用本组声明的目录）
 *   · 孤图检查      **升到组级**：目录里每张图必须被组内至少一个束引用
 *   · 无材料检查    逐束新增：一个束一张图都不引用 = 没有签核材料
 * 判据强度不变——「没有死链、没有孤图」这两条一条没松，只是孤图的检查单位从
 * 「单束」变成「共用组」。空集仍然不许平凡为真（目录缺失/为空/束零引用都判红）。
 */
function lintSharedGroup({ root, phase, declaredDir, members }) {
  const errors = [];
  const rows = [];
  const groupLabel = `${phase}/[共用 ${declaredDir}]`;
  const absDir = join(root, "phases", phase, declaredDir);
  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
    errors.push(
      `[目录缺失] ${groupLabel} 声明的共用截图目录不存在：phases/${phase}/${declaredDir}\n` +
      `    要么目录改名了，要么截图还没产出。这里不当成 0/0 通过。`,
    );
    return { errors, rows };
  }
  const actual = listPngs(absDir);
  if (actual.length === 0) {
    errors.push(`[目录为空] ${groupLabel} 的共用截图目录里一张 png 都没有——不具备签核条件。`);
    return { errors, rows };
  }

  const unionRef = new Set();
  for (const { label, ui } of members) {
    const body = readFileSync(ui, "utf8");
    const referenced = new Map();
    for (const { raw, line } of extractRefs(body)) {
      const rel = normalizeRef(raw, declaredDir);
      const abs = resolve(root, "phases", phase, rel);
      if (!existsSync(abs)) {
        errors.push(
          `[死链] ${label}/ui.md:${line} 引用了不存在的截图：${rel}\n` +
          `    原文：${raw}\n` +
          `    改成 phases/${phase}/${declaredDir}/ 下真实文件；若是未产出缺口，去掉 .png 后缀改成文字。`,
        );
        continue;
      }
      if (!rel.startsWith(`${declaredDir}/`)) {
        errors.push(
          `[跨目录] ${label}/ui.md:${line} 引用了共用目录之外的截图：${rel}\n` +
          `    本组声明的唯一目录是 ${declaredDir}（见 ${MAP_REL}）。`,
        );
        continue;
      }
      const base = rel.slice(declaredDir.length + 1);
      if (!referenced.has(base)) referenced.set(base, line);
    }

    if (referenced.size === 0) {
      errors.push(
        `[无材料] ${label}/ui.md 一张共用目录里的截图都没引用——共用目录不代表本束可以不引用材料。\n` +
        `    签核 ① 的材料是这个束自己指名的那批图，不是"组里有图就算"。`,
      );
    }
    for (const key of referenced.keys()) unionRef.add(key);

    const { declaredN } = extractSelfCheck(body);
    if (declaredN === null) {
      errors.push(
        `[缺自检行] ${label}/ui.md 头 20 行里找不到自检行。共用目录模式下固定写：\n` +
        `    > **自检**：本文件引用 ${referenced.size} 张截图，目录下实际 ${actual.length} 张。\n` +
        `    （共用 \`${declaredDir}/\`，孤图由组级并集检查兜底，见 ${MAP_REL}）`,
      );
    } else if (declaredN !== referenced.size) {
      errors.push(
        `[自检行过时] ${label}/ui.md 顶部写着引用 ${declaredN} 张，实测 ${referenced.size} 张。\n` +
        `    这行字是同一事实的第二份副本——本门控替你核对，改了截图就得同步改它。`,
      );
    }

    rows.push({ label, dir: declaredDir, referenced: referenced.size, actual: actual.length, orphans: 0, shared: true });
  }

  const orphans = actual.filter((file) => !unionRef.has(file));
  for (const file of orphans) {
    errors.push(
      `[未被引用] ${groupLabel}: phases/${phase}/${declaredDir}/${file} 实存，但共用组里**没有任何一个束**引用它。\n` +
      `    人类签核只看 ui.md，没被索引到的图等于不存在——要么补进某个束的索引表，要么删掉这张图。`,
    );
  }
  return { errors, rows };
}

function isSharedMapping(mapping) {
  return (
    mapping !== null &&
    typeof mapping === "object" &&
    !Array.isArray(mapping) &&
    Object.keys(mapping).length === 1 &&
    typeof mapping.shared_dir === "string" &&
    mapping.shared_dir.length > 0
  );
}

function lintResolvedBundle({ root, phase, label, ui, declaredDir, reuseBundle = null }) {
  const errors = [];
  const absDir = join(root, "phases", phase, declaredDir);
  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
    errors.push(
      `[目录缺失] ${label} 声明的截图目录不存在：phases/${phase}/${declaredDir}\n` +
      `    要么目录改名了，要么截图还没产出。这里不当成 0/0 通过。`,
    );
    return { errors, row: null };
  }
  const actual = listPngs(absDir);
  if (actual.length === 0) {
    errors.push(`[目录为空] ${label} 的截图目录 phases/${phase}/${declaredDir} 里一张 png 都没有。`);
    return { errors, row: null };
  }

  const body = readFileSync(ui, "utf8");
  if (reuseBundle !== null && extractReuseStatement(body) !== reuseBundle) {
    errors.push(
      `[缺复用声明] ${label}/ui.md 必须显式写明不引入新界面，并点名与 map 一致的目标束。\n` +
      `    固定格式：> **UI material reuse: no new screen; reuse_bundle: \`${reuseBundle}\`.**`,
    );
  }

  const referenced = new Map();
  for (const { raw, line } of extractRefs(body)) {
    if (reuseBundle !== null) {
      const explicitPhase = /(?:^|\/)phases\/([^/]+)\/ui-preview\//.exec(raw.replace(/^\.\//, ""));
      if (explicitPhase && explicitPhase[1] !== phase) {
        errors.push(`[跨阶段路径] ${label}/ui.md:${line} 引用了其他 phase 的截图路径：${raw}`);
        continue;
      }
    }
    const rel = normalizeRef(raw, declaredDir);
    const abs = resolve(root, "phases", phase, rel);
    if (reuseBundle !== null && !abs.startsWith(`${resolve(absDir)}${sep}`)) {
      errors.push(
        `[跨目录] ${label}/ui.md:${line} 引用了解析目标目录之外的截图：${rel}\n` +
        `    包含 ../ 的伪前缀也不例外；允许的唯一目录是 ${declaredDir}。`,
      );
      continue;
    }
    if (!existsSync(abs)) {
      errors.push(
        `[死链] ${label}/ui.md:${line} 引用了不存在的截图：${rel}\n` +
        `    原文：${raw}\n` +
        `    改成 phases/${phase}/${declaredDir}/ 下真实文件；若是未产出缺口，去掉 .png 后缀改成文字。`,
      );
      continue;
    }
    if (!rel.startsWith(`${declaredDir}/`)) {
      errors.push(
        `[跨目录] ${label}/ui.md:${line} 引用了解析目标目录之外的截图：${rel}\n` +
        `    允许的唯一目录是 ${declaredDir}（见 ${MAP_REL}）。`,
      );
      continue;
    }
    const base = rel.slice(declaredDir.length + 1);
    if (!referenced.has(base)) referenced.set(base, line);
  }

  const orphans = actual.filter((file) => !referenced.has(file));
  for (const file of orphans) {
    errors.push(`[未被引用] ${label}: phases/${phase}/${declaredDir}/${file} 实存，但 ui.md 一次都没引用它。`);
  }
  const { declaredN, declaredM } = extractSelfCheck(body);
  if (declaredN === null || declaredM === null) {
    errors.push(`[缺自检行] ${label}/ui.md 头 20 行里找不到「本文件引用 N 张截图，目录下实际 M 张」自检。`);
  } else if (declaredN !== referenced.size || declaredM !== actual.length) {
    errors.push(
      `[自检行过时] ${label}/ui.md 顶部写着「引用 ${declaredN} 张 / 实际 ${declaredM} 张」，` +
      `实测是「引用 ${referenced.size} 张 / 实际 ${actual.length} 张」。`,
    );
  }
  return {
    errors,
    row: {
      label,
      dir: declaredDir,
      referenced: referenced.size,
      actual: actual.length,
      orphans: orphans.length,
      ...(reuseBundle === null ? {} : { reusedFrom: reuseBundle }),
    },
  };
}

export function lintUiMaterial({ root = ROOT, mapFile = MAP_FILE, phasesRoot, only = [] } = {}) {
  const map = readMap(mapFile);
  let targets = findUiMds(phasesRoot ?? join(root, "phases"));
  if (only.length) targets = targets.filter((target) => only.includes(target.phase));

  // 没有复用声明时完全走旧路径，保证既有 string mapping 行为不变。
  const hasStructuredMapping = targets.some(({ phase, bundle }) => {
    const mapping = map[phase]?.[bundle];
    return mapping !== undefined && typeof mapping !== "string";
  });
  if (!hasStructuredMapping) return lintUiMaterialLegacy({ root, mapFile, phasesRoot, only });

  const errors = [];
  const rows = [];
  if (targets.length === 0) {
    errors.push(`没有找到任何 phases/<phase>/contracts/<束>/ui.md —— 门禁无对象可查，视为失败（空集不许平凡为真）`);
    return { errors, rows };
  }
  const targetByLabel = new Map(targets.map((target) => [`${target.phase}/${target.bundle}`, target]));
  const concrete = [];
  const reused = [];
  const sharedGroups = new Map(); // `${phase}\u0000${dir}` -> { phase, declaredDir, members }

  for (const target of targets) {
    const { phase, bundle } = target;
    const label = `${phase}/${bundle}`;
    const mapping = map[phase]?.[bundle];
    if (!mapping) {
      errors.push(`[未声明] ${label}/ui.md 存在，但 ${MAP_REL} 里没有声明它的截图目录或复用目标。`);
      continue;
    }
    if (typeof mapping === "string") {
      if (!isPhaseContainedScreenshotDir(root, phase, mapping)) {
        errors.push(
          `[目录映射越界] ${label} 的 concrete 映射必须是当前 phase 内的 ui-preview/<目录>：${JSON.stringify(mapping)}。\n` +
          `    禁止 ../、绝对路径、反斜杠与跨 phase 目录；检测到 structured reuse 时，所有 plain mapping 也会 fail closed。`,
        );
        continue;
      }
      concrete.push({ ...target, label, declaredDir: mapping });
      continue;
    }
    if (isSharedMapping(mapping)) {
      const dir = mapping.shared_dir;
      if (!isPhaseContainedSharedDir(root, phase, dir)) {
        errors.push(
          `[目录映射越界] ${label} 的 shared_dir 必须是当前 phase 内的 \`ui-preview\` 或其子目录：${JSON.stringify(dir)}。\n` +
          `    禁止 ../、绝对路径、反斜杠与跨 phase。`,
        );
        continue;
      }
      const key = `${phase}\u0000${dir}`;
      if (!sharedGroups.has(key)) sharedGroups.set(key, { phase, declaredDir: dir, members: [] });
      sharedGroups.get(key).members.push({ ...target, label });
      continue;
    }
    if (!isReuseMapping(mapping)) {
      errors.push(`[复用声明非法] ${label} 的映射必须是目录字符串、{ "reuse_bundle": "<bundle>" } 或 { "shared_dir": "<目录>" }。`);
      continue;
    }
    const keys = Object.keys(mapping);
    const reuseBundle = mapping.reuse_bundle;
    if (keys.length !== 1 || keys[0] !== "reuse_bundle" || typeof reuseBundle !== "string" || reuseBundle.length === 0) {
      errors.push(`[复用声明非法] ${label} 只能声明 { "reuse_bundle": "<同 phase 束名>" }，不允许额外字段或空目标。`);
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(reuseBundle)) {
      errors.push(`[跨阶段复用] ${label} 的 reuse_bundle=${JSON.stringify(reuseBundle)} 不是同 phase 的单一束名；禁止 phase/目录/绝对路径与 ..。`);
      continue;
    }
    if (reuseBundle === bundle) {
      errors.push(`[复用自身] ${label} 不能 reuse_bundle 自己。`);
      continue;
    }

    const targetLabel = `${phase}/${reuseBundle}`;
    const targetMapping = map[phase]?.[reuseBundle];
    if (!targetMapping || !targetByLabel.has(targetLabel)) {
      errors.push(`[复用目标缺失] ${label} 的目标 ${targetLabel}/ui.md 或映射不存在。`);
      continue;
    }
    if (isReuseMapping(targetMapping)) {
      const seen = new Set([bundle]);
      let cursor = reuseBundle;
      let cycle = false;
      while (typeof cursor === "string") {
        if (seen.has(cursor)) {
          cycle = true;
          break;
        }
        seen.add(cursor);
        const cursorMapping = map[phase]?.[cursor];
        if (!isReuseMapping(cursorMapping)) break;
        cursor = cursorMapping.reuse_bundle;
      }
      if (cycle) {
        errors.push(`[复用循环] ${label} 的复用链形成循环：${[...seen, cursor].join(" -> ")}。`);
      } else {
        errors.push(`[复用链] ${label} 指向了复用束 ${reuseBundle}；请扁平化到最终 concrete 目标。`);
      }
      continue;
    }
    if (!isPhaseContainedScreenshotDir(root, phase, targetMapping)) {
      errors.push(`[复用目标非 concrete] ${label} 的目标 ${targetLabel} 没有安全的 concrete ui-preview/<目录> 映射。`);
      continue;
    }
    reused.push({ ...target, label, declaredDir: targetMapping, reuseBundle, targetLabel });
  }

  for (const group of sharedGroups.values()) {
    // 共用组必须至少两个束——只有一个束时用普通 concrete 映射即可，
    // 声明成共用只会把「逐张相等」悄悄降级成「并集相等」，等于白送一个豁免。
    if (group.members.length < 2) {
      errors.push(
        `[共用组过小] ${group.phase}/${group.declaredDir} 只有 1 个束声明了 shared_dir（${group.members[0].label}）。\n` +
        `    单束请直接用普通目录映射——共用模式把孤图检查放宽到组级，独占时用它等于白送一个豁免。`,
      );
      continue;
    }
    const result = lintSharedGroup({ root, ...group });
    errors.push(...result.errors);
    rows.push(...result.rows);
  }

  const concreteResults = new Map();
  for (const descriptor of concrete) {
    const result = lintResolvedBundle({ root, ...descriptor });
    errors.push(...result.errors);
    if (result.row) rows.push(result.row);
    concreteResults.set(descriptor.label, result.errors.length === 0);
  }
  for (const descriptor of reused) {
    if (concreteResults.get(descriptor.targetLabel) !== true) {
      errors.push(`[复用目标未通过] ${descriptor.label} 不能复用 ${descriptor.targetLabel}；目标束必须先独立通过完整双向材料门禁。`);
    }
    const result = lintResolvedBundle({ root, ...descriptor });
    errors.push(...result.errors);
    if (result.row) rows.push(result.row);
  }
  return { errors, rows };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith("lint-ui-material.mjs")) {
  const { errors, rows } = lintUiMaterial({ only: process.argv.slice(2) });
  for (const r of rows) {
    // 共用组的行不该拿「逐张相等」去判——它的不变量是组级并集相等，
    // 单束 3/18 是正确状态。用 ✗ 渲染会让人以为红了（本仓最恨的谎报形状）。
    const ok = r.shared ? r.referenced > 0 && r.orphans === 0 : r.referenced === r.actual && r.orphans === 0;
    const count = r.shared
      ? `${String(r.referenced).padStart(3)}/${String(r.actual).padEnd(3)}*`
      : `${String(r.referenced).padStart(3)}/${String(r.actual).padEnd(3)} `;
    console.log(`  ${ok ? "✓" : "✗"} ${r.label.padEnd(40)} ${count}(${r.dir})`);
  }
  if (rows.some((r) => r.shared)) {
    console.log("  * = 共用目录组：本束引用数 / 组目录总数。不变量是「组内并集 == 实存集」，不是逐束相等。");
  }
  if (errors.length) {
    console.error("");
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(
      `\n❌ lint-ui-material: ${errors.length} 处材料不一致。` +
      `\n   签核第 ① 件的材料就是这批截图：ui.md 引用的集合 与 ui-preview/ 实存的集合必须逐张相等。`,
    );
    process.exit(1);
  }
  console.log(
    `✅ lint-ui-material: ${rows.length} 个契约束的 ui.md 引用集合 == ui-preview 实存集合` +
    `（共 ${rows.reduce((a, r) => a + r.actual, 0)} 张截图，无死链、无孤图）`,
  );
}
