/**
 * issue #533 —— X-7 / XC-18 落地：同意项收敛为**一套四项**，且**只有一处定义**。
 *
 * ## 这条门控守的是什么
 *
 * 2026-08-05 coord-main（经人类授权）裁决：`recording` 的三项与 `interview` 的四位不是
 * 两套设计，是**漏了一位**——三项是四位的严格子集、逐字相同。两者收敛为
 * `packages/contracts/src/consent-item.ts` 的 `CONSENT_ITEMS`，recording 补 `attribution`。
 *
 * 裁决同时立了验收标准：**光把数字改对不算做完**。`AGENTS.md` 逐字写着
 * 「同一事实不得声明在两处——本项目已五次因此漂移」，而这条裁决前的现场正是那个形状：
 * 同一份「同意项」在仓里有**五处**独立声明（两处契约枚举 + `consent-token-ports.ts`
 * 的手写联合类型 + `portal-request.ts` 的 `ALL_CONSENT_KEYS` 数组 + `consent-token.ts`
 * 的 `CONSENT_ITEM_COPY` 键）。所以本文件的主体不是「四项对不对」，是
 * **「除单一事实源外，没有第二处枚举它」**。
 *
 * ## 为什么第 ② 条扫的是「带引号的项名」而不是所有出现
 *
 * `ai_analysis` 这个词在 `src/` 下 40 多处出现，绝大多数是 SQL 投影列
 * （`SELECT record, transcript, ai_analysis, attribution FROM ...`）和对象字段名——
 * 那些是**用**这份事实，不是**声明**它，把它们一并判红只会让这条门控在两周内被静音。
 * 声明的形状是**带引号的项名连续列出**：`z.enum([...])`、字符串联合、数组字面量。
 * 扫这一种，误报少到可以真正保持红。
 *
 * ⚠ 对象字面量键（`record: z.boolean()`）逃得过本扫描，所以那一类**不靠本扫描**：
 *   `ConsentBits` 的 shape 改成由 `CONSENT_ITEMS` 机械生成，`CONSENT_ITEM_COPY` 改成
 *   `Record<ConsentItemValue, ...>` —— 少一个键或多一个键由 **tsc** 判红。
 *   两条路各有覆盖，本文件只对自己扫得到的那类负责。
 *
 * ## 反证（本仓已九次「全绿但空转」，门控写完当场造）
 *
 * · 把 `RecordingConsentItem` 改回自己声明三项 ⇒ 第 ① 条（同一性）红 +
 *   `recording-consent-single-source.test.ts` 的迁移 CHECK 对账红；
 * · 把任意一处手写副本加回 `src/` ⇒ 第 ② 条红。
 * 实测记录写在 PR 正文里。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { consentItem, interview, recording } from "@repo/contracts";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));
const SINGLE_SOURCE = join(REPO, "packages/contracts/src/consent-item.ts");
const SCAN_ROOTS = [join(REPO, "apps/api/src"), join(REPO, "packages/contracts/src")];

/** 裁决钉死的那四项，逐字。**改这里等于改裁决**，需要新的人类裁决。 */
const RULED_FOUR = ["record", "transcript", "ai_analysis", "attribution"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** 注释里讨论这份枚举是**要鼓励的**（裁决明写注释不许删），所以先剥注释再扫。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 该文件里是否存在「把项名连续列出来」的声明。
 * 判据：某个带引号的项名之后 200 字符内，`record`/`transcript`/`ai_analysis` 三个
 * 带引号的项名全部出现——这是列表/联合/枚举的形状，不是单点引用的形状。
 */
function declaresItemList(text: string): boolean {
  const hits: { at: number; name: string }[] = [];
  const re = /["'](record|transcript|ai_analysis|attribution)["']/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) hits.push({ at: m.index, name: m[1]! });
  return hits.some((h) => {
    const window = hits.filter((o) => o.at >= h.at && o.at - h.at < 200).map((o) => o.name);
    return ["record", "transcript", "ai_analysis"].every((n) => window.includes(n));
  });
}

describe("同意项：一套四项，一处定义（#533 裁决）", () => {
  it("① 契约两束指向同一个对象，不是两份内容相同的声明", () => {
    // `toEqual` 在这里是不够的：两处各写一遍 `z.enum([...四项...])` 也能 toEqual 通过，
    // 而那正是裁决要消灭的形状。同一性（`toBe`）才能证明「只有一处定义」。
    expect(recording.RecordingConsentItem).toBe(consentItem.ConsentItemKey);
    expect(interview.ConsentKey).toBe(consentItem.ConsentItemKey);
  });

  it("① 四项逐字就是裁决钉的那四项，顺序也一致", () => {
    expect([...consentItem.CONSENT_ITEMS]).toEqual([...RULED_FOUR]);
    expect(consentItem.ConsentItemKey.options).toEqual([...RULED_FOUR]);
    // `attribution` 是本次裁决补进来的那一位，单独钉一次：它是整条裁决的行为差异所在。
    expect(consentItem.ConsentItemKey.options).toContain("attribution");
  });

  it("② src/ 下除单一事实源外，没有第二处把同意项列成一张表", () => {
    const files = SCAN_ROOTS.flatMap((r) => walk(r));
    // 正样本先行：扫描器必须真的能在单一事实源里认出这张表。认不出的话，
    // 下面那条 `toEqual([])` 会因为「谁也没扫到」而空转通过——本仓九次绿色空转的老形状。
    expect(files).toContain(SINGLE_SOURCE);
    expect(declaresItemList(stripComments(readFileSync(SINGLE_SOURCE, "utf8")))).toBe(true);

    const offenders = files
      .filter((f) => f !== SINGLE_SOURCE)
      .filter((f) => declaresItemList(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.slice(REPO.length));

    expect(
      offenders,
      "这些文件各自把同意项列了一遍。#533 裁决：同意项只能在 " +
        "packages/contracts/src/consent-item.ts 声明一次，其余一律引用它。",
    ).toEqual([]);
  });

  it("② 扫描器不是只认单一事实源那一种写法（对四种声明形状都判红）", () => {
    // 扫描器本身的反证：如果它只在某一种语法上有效，第 ② 条就只是运气好。
    // 这四段覆盖 z.enum / 字符串联合 / 数组字面量 / 带 as const 的元组。
    for (const shape of [
      `z.enum(["record", "transcript", "ai_analysis", "attribution"])`,
      `type T = "record" | "transcript" | "ai_analysis" | "attribution";`,
      `const a = ["record", "transcript", "ai_analysis"];`,
      `const t = ['record', 'transcript', 'ai_analysis', 'attribution'] as const;`,
    ]) {
      expect(declaresItemList(shape), shape).toBe(true);
    }
    // 反面：单点引用与 SQL 投影**不**判红，否则这条门控会因噪音被静音。
    expect(declaresItemList(`if (item === "ai_analysis") return false;`)).toBe(false);
    expect(declaresItemList(`SELECT record, transcript, ai_analysis FROM t`)).toBe(false);
  });
});
