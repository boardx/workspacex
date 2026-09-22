/**
 * coord-service 退役标识的机械门（issue #381）。
 *
 * 为什么必须机械化：`COORD_SERVICE_URL` / `COORD_SERVICE_TOKEN` 随 coord-service
 * 一起退役（ADR-017 决策 4），但退役是**一次性动作**，而引用它们的文档和脚本散在
 * 十几处。AGENTS.md「静态痕迹 ≠ 动态事实」记的正是这个形状：
 *
 *   > 痕迹写得越诚实越具体，读起来越像权威——这正是它骗人的方式。
 *
 * `human-developer-onboarding.md` 里那两行 `export COORD_SERVICE_URL=…` 是可复制
 * 可粘贴的具体指令，读起来比任何 ADR 都更像「现在该这么做」；照着做的人领到的是
 * 一套不存在的服务的凭据。所以规则不是「别写旧名字」（历史必须能被记下来），而是：
 *
 *   A. 活的代码路径**一次都不许读**这两个环境变量；
 *   B. 历史档案之外，它们不许出现在**祈使句**里（export / 必须配置 / 需要…凭据 /
 *      环境变量 X / 才能使用）——那是把旧权威写成照做的指令；
 *   C. 历史档案之外，每一处提及后面必须紧跟退役标记，读者一眼就知道这是旧权威。
 *
 * B 和 C 是互补的：C 管「没说这是旧的」，B 管「说了是旧的、但同一段仍教人怎么配」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sh } from "./lib/sh";

const ROOT = resolve(import.meta.dirname, "../..");
const RETIRED = /COORD_SERVICE_(?:URL|TOKEN)/g;
/** **读**环境变量的写法：process.env.X / process.env["X"] / env("X")。
 *  尾随 `=` 的赋值不算读——测试要先把旧变量设上，才能证明它确实不再被读。 */
const ENV_READ =
  /(?:process\.env(?:\.COORD_SERVICE_(?:URL|TOKEN)|\[\s*["'`]COORD_SERVICE_(?:URL|TOKEN)["'`]\s*\])|\benv\(\s*["'`]COORD_SERVICE_(?:URL|TOKEN)["'`]\s*\))(?!\s*=[^=])/;

/** 历史决策档案与状态快照：按定义记的就是「当时是什么样」，ADR 不许被改写。 */
const HISTORICAL_PREFIXES = ["docs/adr/", "docs/proposals/", ".harness/state/"];
/** 本门自己的 fixture：这两个文件**存在的意义**就是证明退役，必然要逐字写出旧名字。
 *  它们只豁免 B/C（措辞规则），A（不许读）仍然对它们生效。 */
const SELF = ".harness/scripts/coord-service-retirement.test.ts";
const FIXTURES = new Set([SELF, ".harness/scripts/cycle-report.test.ts"]);

/** 退役标记：出现任意一个，读者就知道这是旧权威而非现行指令。 */
const RETIREMENT_MARKERS = ["退役", "已删", "停用", "割接删除", "ADR-017", "superseded", "不会被读取"];
/** 标记必须紧跟在标识符**后面**——「X 已退役」才是退役说明；
 *  「（GitHub 协调面已整体退役）」离得再近也不是在说 X。 */
const MARKER_LOOKAHEAD = 80;
/** 祈使句特征：出现在标识符邻域 = 这段仍在教人怎么配旧权威。 */
const PRESCRIPTIVE = ["export COORD_SERVICE", "必须配置", "需要 `COORD_SERVICE", "需要 COORD_SERVICE", "环境变量 `COORD_SERVICE", "环境变量 COORD_SERVICE", "才能使用"];
const WINDOW_LINES = 3;

interface Hit {
  file: string;
  line: number;
  text: string;
  /** 以标识符为起点、展平换行后的后续文本（用于 C）。 */
  lookahead: string;
  /** 标识符上下各 WINDOW_LINES 行展平（用于 B）。 */
  window: string;
}

const flat = (text: string) => text.replace(/\s*\n\s*/g, "");

function trackedFilesMentioningRetired(): string[] {
  const result = sh(`git -C ${JSON.stringify(ROOT)} grep -l -E "COORD_SERVICE_(URL|TOKEN)" -- . || true`);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function collectHits(): Hit[] {
  const out: Hit[] = [];
  for (const file of trackedFilesMentioningRetired()) {
    const lines = readFileSync(resolve(ROOT, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      RETIRED.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RETIRED.exec(text)) !== null) {
        const rest = flat([text.slice(match.index), ...lines.slice(i + 1, i + 1 + WINDOW_LINES)].join("\n"));
        out.push({
          file,
          line: i + 1,
          text,
          lookahead: rest.slice(0, MARKER_LOOKAHEAD),
          window: flat(lines.slice(Math.max(0, i - WINDOW_LINES), i + 1 + WINDOW_LINES).join("\n")),
        });
      }
    });
  }
  return out;
}

const where = (hit: Hit) => `${hit.file}:${hit.line} ${hit.text.trim()}`;
const isHistorical = (file: string) => HISTORICAL_PREFIXES.some((prefix) => file.startsWith(prefix));

describe("coord-service 退役标识（#381）", () => {
  const all = collectHits();
  const live = all.filter((hit) => !isHistorical(hit.file) && !FIXTURES.has(hit.file));

  it("门本身够得着东西——退役标识仍在仓库里被提到（否则这个门是空转的）", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(live.length).toBeGreaterThan(0);
  });

  it("A：活的代码路径一次都不读 COORD_SERVICE_URL / COORD_SERVICE_TOKEN", () => {
    const reads = all.filter((hit) => ENV_READ.test(hit.text)).map(where);
    expect(
      reads,
      "这些地方还在读已退役的旧权威（ADR-017）——改读 COORD_GATEWAY_URL / COORD_API_TOKEN / COORD_REPO"
    ).toEqual([]);
  });

  it("B：历史档案之外不出现在祈使句里——不教人去配一套已经不存在的服务", () => {
    const prescriptive = live
      .filter((hit) => PRESCRIPTIVE.some((phrase) => hit.window.includes(phrase)))
      .map(where);
    expect(prescriptive, "这些段落仍把已退役的 COORD_SERVICE_* 写成照做的配置指令（ADR-017）").toEqual([]);
  });

  it("C：历史档案之外的每一处提及，后面都紧跟退役标记", () => {
    const unmarked = live
      .filter((hit) => !RETIREMENT_MARKERS.some((marker) => hit.lookahead.includes(marker)))
      .map(where);
    expect(unmarked, "这些地方提到 COORD_SERVICE_* 却没说它已退役，读起来像现行权威（ADR-017）").toEqual([]);
  });
});
