#!/usr/bin/env node
/**
 * 门控：**spec 与验收文档里出现的态名，必须是契约枚举里真有的那个名**（#3140）。
 *
 * ## 它要挡的失效
 *
 * 2026-09-08 一天里同一个模式栽了两次（#3140 正文）：
 *   · TW-P0-3①：spec 断言态名 `awaiting-approval` / `completed`，而契约
 *     `packages/contracts/src/plan-control.ts` 的 `PlanPhase` 枚举里压根没有这两个名字
 *     （真名是 `approving` / `done`）。
 *   · 验收文档 `.harness/instructions/chat-task-workbench-acceptance.md` 同样滞后。
 *
 * 两次都不是「实现有 bug」，而是**契约/裁决更新了，下游的 spec 与验收文档没跟上**：
 * spec 于是对着不存在的东西做断言、永远红，而红的原因与被测能力无关——比不红更坏，
 * 因为它消耗的是「红了就去查」的信任。
 *
 * 签核是人的动作（ADR-023），但**签核之后的下游同步此前没有任何检查**，只能靠人记得。
 * 本仓的教训是「没有脚本的规范条目视为未落地」（AGENTS.md），所以这里补上脚本。
 *
 * ## 判定口径（读到这里的人请按这个理解，别按直觉）
 *
 * 契约枚举是**唯一事实源，本文件一个字都不抄**：态名与中文文案都在运行时从
 * `plan-control.ts` 里 import 出来（所以本门控用 `tsx` 跑，不是 `node`）。
 * 契约改一个值，判据当场跟着改；契约里那个 export 没了，本门控**红**，不是静默放行。
 *
 * 一条「声明」（claim）= spec / 验收文档里一处**自称是该契约态名**的字面量。
 * 怎么认出「自称」是本门控唯一需要小心的地方——`data-phase` 这个属性名并不为
 * `PlanPhase` 独有（`core-loop.spec.ts` 里的录音器也叫 `data-phase`，值是
 * `idle`/`recording`），按属性名全仓扫必然假红。所以**先划范围，再取字面量**：
 *
 *   ① 范围：文件里提到了该契约面的锚点 testid（`scopeAnchors`）才算在范围内。
 *      本仓的验收文档一律写「**锚点**：`<testid>`」，spec 也必然要 `getByTestId` 到它，
 *      所以这条既够窄（无关文件天然出局），又能自动接住**新写的**同面 spec。
 *   ② 取字面量，三种形态：
 *      · 属性断言：`data-phase="planning"` / `toHaveAttribute("data-phase", "done")`
 *      · 名字里带 PHASE 的**数组**常量：`const SIX_PHASES = ["preparing", ...]`
 *        （只认数组字面量——`const PHASE_INDICATOR = "chat-task-workbench-..."`
 *        这种字符串常量装的是 testid 不是态名，认了必假红）
 *      · 验收文档里的**中文态机链**：`准备 → 计划 → 执行 → 审批 → 完成 → 失败`
 *        （比对 `PLAN_PHASE_LABEL_ZH`，它是态名→中文的单一事实源）
 *
 * 注释里的字面量不算声明：本仓注释大量逐字引用**旧的错名**来记录裁决（那条 spec
 * 头注就写着「原先写的 `awaiting-approval` / `completed` 在实现里并不存在」），
 * 按原文 grep 会把历史记录判成违规。断言在代码里，不在注释里。
 *
 * ## 中文态机链为什么要「至少命中 3 个」才激活
 *
 * 「完成」「失败」「执行」是极常见的词，见一个就激活必然假红。取 3 是这样权衡的：
 * 真链有 6 段，就算一次漂走 2 个名字仍有 4 段命中 ⇒ 照样抓得到；而无关句子里
 * 恰好出现 3 个**精确等于**契约文案的 CJK 段、且被 `→` 串起来，概率低到可以接受。
 * 链只判**成员资格**，不判完整性：`ui.md` 2.3 明写 `failed` 不出现在指示器那条线上，
 * 「六态里少列一个」是签核过的设计，不是漂移。
 *
 * ## 不做恒真门（#3122 刚栽过）
 *
 * 一道抓不到东西的门比没有门更坏。所以本门控对**自己**也有三条自检，任一不满足判红：
 *   · 契约模块 import 不到 / 该 export 不在 / 枚举为空 → 红（守着空气）
 *   · 某条绑定的锚点一个文件都没匹配上 → 红（范围划空了）
 *   · 某个面（spec / 验收文档）一条声明都没抽到 → 红（抽取规则漂移了，此时
 *     门会"全绿"而实际什么都没在看——正是 #3122 那种失效）
 * 变异反证登记在 `.harness/scripts/lib/gate-mutation-spec.ts`（`contract-state-names`）：
 * 把 spec 里的态名改成枚举外的值 → 必须红；改回 → 必须绿。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 绑定表：一条 = 一个契约枚举 + 它在下游的认领方式。
 *
 * #3140 明确「先从 `PlanPhase` 这一个枚举做起，跑通再扩」——扩的成本就是往这里加一条，
 * 判定逻辑本体不用动。加一条之前先确认它的 `scopeAnchors` 真的够窄：范围划错，
 * 门不是漏就是吵。
 */
export const BINDINGS = [
  {
    name: "PlanPhase",
    /** 态名与中文文案的唯一事实源；本文件不存副本，运行时 import。 */
    module: "packages/contracts/src/plan-control.ts",
    valuesExport: "PlanPhase",
    labelsExport: "PLAN_PHASE_LABEL_ZH",
    /** 提到这些 testid 的文件才在范围内（见判定口径 ①）。 */
    scopeAnchors: ["chat-task-workbench-phase-indicator"],
    /** 在范围内的文件里，这些属性的字面量值被当作态名声明。 */
    attributes: ["data-phase", "data-phase-step"],
    /** 名字匹配这个正则的**数组**常量，其元素被当作态名声明。 */
    identifierPattern: /PHASE/,
    /** 契约锚点：`ui.md` 2.3 的裁决在这里留个指路牌，报错时一并打出来。 */
    contractDoc: "phases/phase-01-run-a-project/contracts/plan-control/ui.md",
  },
];

/** 中文态机链的激活阈值：链里至少这么多段**精确等于**契约文案才开始判。 */
export const LABEL_CHAIN_ACTIVATION = 3;

/** 扫描面：spec 与验收文档各一条 glob（#3140 正文点名的就是这两处）。 */
export const SURFACES = [
  { id: "spec", globs: ["apps/web/e2e/*.spec.ts", "apps/web/e2e/**/*.spec.ts"] },
  { id: "doc", globs: [".harness/instructions/*-acceptance.md"] },
];

function trackedFiles(globs) {
  const out = execFileSync("git", ["ls-files", "--", ...globs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return [...new Set(out.split("\n").filter(Boolean))].sort();
}

/**
 * 把注释**涂白**（保留换行，行号不偏）。行注释只涂整行的那种：
 * 行尾 `//` 在本仓多半是 URL 的一半，涂了反而制造语法错觉。
 */
export function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}

/** 文件是否落在某条绑定的范围内（判定口径 ①）。 */
export function inScope(source, binding) {
  return binding.scopeAnchors.some((anchor) => source.includes(anchor));
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * 从**代码**（spec）里抽态名声明。纯函数：给什么文本判什么，不碰 IO。
 * 返回 `{ name, line, via }[]`，`via` 是报错时给人看的「我是这么认出它的」。
 */
export function extractCodeClaims(source, binding) {
  const src = blankComments(source);
  const claims = [];

  for (const attr of binding.attributes) {
    // `attr="v"`（JSX/文档式）与 `"attr", "v"`（toHaveAttribute 式）两种写法一网打尽。
    // 刻意不认 `getAttribute("data-phase")` 这种**只问不比**的用法：那里没有声明任何态名。
    const re = new RegExp(`${attr}["']?\\s*(?:=|,)\\s*["']([^"'\\n]+)["']`, "g");
    for (const m of src.matchAll(re)) {
      claims.push({ name: m[1], line: lineOf(src, m.index), via: `${attr} 的字面量值` });
    }
  }

  // 只认数组字面量（见判定口径 ②）。`[^\]]*` 够用：态名数组里不会嵌套方括号。
  const arrayRe = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z0-9_$]*${binding.identifierPattern.source}[A-Za-z0-9_$]*)\\s*(?::[^=\\n]+)?=\\s*\\[([^\\]]*)\\]`,
    "g",
  );
  for (const m of src.matchAll(arrayRe)) {
    const line = lineOf(src, m.index);
    for (const lit of m[2].matchAll(/["']([^"'\n]+)["']/g)) {
      claims.push({ name: lit[1], line, via: `常量 ${m[1]} 的数组元素` });
    }
  }

  return claims;
}

/**
 * 从**验收文档**里抽态名声明：属性字面量（同代码）+ 中文态机链。
 * 链的切分靠 CJK 连续段天然断开标点与 `**`，所以
 * 「存在显式状态机：**准备 → 计划…」里只会抽出 `准备` 起的那条链。
 */
export function extractDocClaims(markdown, binding, labels) {
  const claims = extractCodeClaims(markdown, binding);
  const labelValues = new Set(Object.values(labels));

  const lines = markdown.split("\n");
  lines.forEach((text, i) => {
    for (const chain of text.matchAll(/[一-龥]+(?:\s*→\s*[一-龥]+)+/g)) {
      const segments = chain[0].split("→").map((s) => s.trim());
      const hits = segments.filter((s) => labelValues.has(s)).length;
      if (hits < LABEL_CHAIN_ACTIVATION) continue; // 不是态机链，别乱判
      for (const segment of segments) {
        claims.push({ name: segment, line: i + 1, via: "中文态机链的一段", chinese: true });
      }
    }
  });

  return claims;
}

/**
 * 判定本体，**纯函数**：给定词表与声明，出违规清单。
 * 从 IO 里剥出来是为了让反证套件能对构造出来的输入断言每一种判决都成立。
 */
export function judgeClaims({ claims, values, labels }) {
  const allowedNames = new Set(values);
  const allowedLabels = new Set(Object.values(labels));
  return claims.filter((c) => !(c.chinese ? allowedLabels : allowedNames).has(c.name));
}

/** 读绑定的词表。契约那边缺了东西就抛——不给「守着空气」留余地。 */
export async function loadVocabulary(binding) {
  const abs = path.join(REPO_ROOT, binding.module);
  if (!existsSync(abs)) {
    throw new Error(`绑定 ${binding.name} 的契约模块不存在：${binding.module}`);
  }
  const mod = await import(abs);
  const values = mod[binding.valuesExport]?.options;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      `绑定 ${binding.name}：${binding.module} 里读不到非空枚举 ${binding.valuesExport}.options——` +
        `契约改名或改形状了，先把本绑定对齐，不要让门静默放行。`,
    );
  }
  const labels = mod[binding.labelsExport];
  if (!labels || typeof labels !== "object") {
    throw new Error(
      `绑定 ${binding.name}：${binding.module} 里读不到文案映射 ${binding.labelsExport}——同上。`,
    );
  }
  return { values, labels };
}

export async function auditContractStateNames() {
  const reports = [];
  for (const binding of BINDINGS) {
    const { values, labels } = await loadVocabulary(binding);
    const surfaces = [];
    for (const surface of SURFACES) {
      const files = [];
      for (const rel of trackedFiles(surface.globs)) {
        const source = readFileSync(path.join(REPO_ROOT, rel), "utf8");
        if (!inScope(source, binding)) continue;
        const claims =
          surface.id === "doc"
            ? extractDocClaims(source, binding, labels)
            : extractCodeClaims(source, binding);
        files.push({ rel, claims, violations: judgeClaims({ claims, values, labels }) });
      }
      surfaces.push({ id: surface.id, files });
    }
    reports.push({ binding, values, labels, surfaces });
  }
  return reports;
}

/**
 * 自检（反恒真）：门自己有没有在看东西。返回失败说明清单。
 * 这一段不是锦上添花——#3122 那道门就是「全绿但什么都没在看」。
 */
export function selfCheck(report) {
  const failures = [];
  for (const surface of report.surfaces) {
    if (surface.files.length === 0) {
      failures.push(
        `绑定 ${report.binding.name} 在「${surface.id}」面一个文件都没匹配上：` +
          `锚点 ${report.binding.scopeAnchors.join("/")} 改名了，或那面确实没有文件——` +
          `前者改 BINDINGS 的 scopeAnchors，后者把该面从绑定里去掉并写明理由。`,
      );
      continue;
    }
    const claims = surface.files.reduce((n, f) => n + f.claims.length, 0);
    if (claims === 0) {
      failures.push(
        `绑定 ${report.binding.name} 在「${surface.id}」面抽到 0 条态名声明（文件有 ` +
          `${surface.files.length} 个）：抽取规则与下游写法漂移了。此刻门是"全绿"的，` +
          `但它什么都没在看——先把抽取规则对齐，不要留着。`,
      );
    }
  }
  return failures;
}

function main() {
  return auditContractStateNames().then((reports) => {
    const failures = [];

    for (const report of reports) {
      const { binding, values } = report;
      console.log(`绑定 ${binding.name} ← ${binding.module}`);
      console.log(`  枚举（唯一事实源，本门控不存副本）：${values.join(" / ")}`);
      for (const surface of report.surfaces) {
        for (const file of surface.files) {
          const mark = file.violations.length > 0 ? "❌" : "🧾";
          console.log(`  ${mark} [${surface.id}] ${file.rel}  声明 ${file.claims.length} 条`);
        }
      }

      failures.push(...selfCheck(report));

      for (const surface of report.surfaces) {
        for (const file of surface.files) {
          for (const v of file.violations) {
            failures.push(
              `${file.rel}:${v.line} 里的「${v.name}」（${v.via}）不在契约 ` +
                `${binding.name} 里。允许值：${(v.chinese ? Object.values(report.labels) : values).join(" / ")}。` +
                `契约在 ${binding.module}${binding.contractDoc ? `，签核过的界面口径见 ${binding.contractDoc}` : ""}——` +
                `以契约为准改这处断言，不要反过来改契约迁就断言。`,
            );
          }
        }
      }
    }

    if (failures.length > 0) {
      console.error("\n✗ spec / 验收文档里的态名与契约对不上：");
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log("\n✅ 在范围内的 spec 与验收文档，态名全部落在契约枚举里");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
}
