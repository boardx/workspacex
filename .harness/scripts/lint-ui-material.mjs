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
 * 缺口条目怎么写：`⚠ 未产出：…` 的缺口是**文字**，不是链接。写成 `xxx.png` 会被
 * 当成死链报出来——正确写法是去掉 `.png` 后缀，用文字描述该缺哪张。
 *
 * 用法：node .harness/scripts/lint-ui-material.mjs [phase-dir-name …]
 *       不带参数 = 扫 phases/ 下全部带 ui.md 的契约束。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
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

export function lintUiMaterial({ root = ROOT, mapFile = MAP_FILE, phasesRoot, only = [] } = {}) {
  const errors = [];
  const rows = [];
  const map = JSON.parse(readFileSync(mapFile, "utf8"));

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

/* ── CLI ──────────────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith("lint-ui-material.mjs")) {
  const { errors, rows } = lintUiMaterial({ only: process.argv.slice(2) });
  for (const r of rows) {
    const ok = r.referenced === r.actual && r.orphans === 0;
    console.log(
      `  ${ok ? "✓" : "✗"} ${r.label.padEnd(40)} ${String(r.referenced).padStart(3)}/${String(r.actual).padEnd(3)} (${r.dir})`,
    );
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
