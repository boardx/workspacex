/**
 * F78 AC3 —— **保留期是参数，不是常量**（D-14 / O-01 / I-32 / I-33）。
 *
 * 文件名逐字说明了要断言的两件事，它们缺一不可：
 *
 *   · **param-resolution** —— 解析走「项目级覆盖值 → 组织默认值」，且**取值真的流过去了**。
 *   · **no-hardcode**      —— 本束源码里**没有**任何天数常量（静态检查）。
 *
 * ## 为什么只断言「返回 180」是无效的
 *
 * feature notes 写着「读参数返回默认值」。若照字面只写一条
 * `expect(resolveRetention(...).resolvedDays).toBe(180)`，那么
 * **`function resolveRetention() { return 180 }` 也能通过** —— 断言的正好是它要禁止的东西。
 *
 * ⇒ 本文件对**一整张取值表**跑同一条链（7 / 45 / 180 / 365 / 4000…）。写死任何一个数，
 *   其余每一行都会红。这才是「读参数」的结构性断言，而 180 只是表里的一行。
 *
 * ## 静态检查的形状
 *
 * `domain.md` I-32 的「怎么断言」逐字要求：本束源文件中不出现 `180` / `30` / `1095` 等
 * 天数字面量参与保留期计算。本文件把它实现为两层：
 *   ① **天数黑名单无豁免通道** —— 本仓已有 `[threshold-ok:…]` 这种标记式豁免，
 *      而保留期恰恰是最不该开豁免口的那一项（它的第二份副本会落在受访者签过字的同意书上）。
 *   ② **保留期语境里的任何数字都要显式标记** —— 抓的是黑名单外的数（比如有人写 `183`）。
 *      唯一合法理由是 `unit-conversion`，且被标记的行**依然**受 ① 约束。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { recording as C } from "@repo/contracts";

import {
  classifyExpiry,
  freezeExpiry,
  resolveDeletionGraceDays,
  resolveMaterialRetention,
} from "../../src/domain/recording/retention";
import { resolveRetention } from "../../src/application/recording/retention-lifecycle";
import { retentionHarness } from "../support/retention-fakes";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const AT = "2026-07-31T00:00:00.000Z";

/* ────────────────────── ① 解析：取值真的流过去了 ────────────────────── */

/**
 * 取值表。**没有一个数是「产品常量」**，全是任意取值。
 * 180 在里面，但它没有任何特殊地位 —— 这正是本 feature 要的性质。
 */
const DAY_VALUES = [1, 7, 45, 180, 365, 1095, 4000] as const;

describe("F78 · 材料保留期是参数，不是常量", () => {
  it.each(DAY_VALUES)("组织默认值 = %i 天时，解析结果就是这个数（resolvedFrom = org）", async (days) => {
    const deps = retentionHarness({
      projectOverrideDays: null,
      orgDefaultDays: days,
      deletionGraceDays: null,
    });
    const out = await resolveRetention(deps, { orgId: "org-1", projectId: "prj-1", resolvedAt: AT });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.retention.resolvedDays).toBe(days);
    expect(out.retention.resolvedFrom).toBe("org");
    expect(out.retention.resolvedAt).toBe(AT);
  });

  it.each(DAY_VALUES)("项目级覆盖值 = %i 天时压过组织默认值（resolvedFrom = project）", async (days) => {
    const deps = retentionHarness({
      projectOverrideDays: days,
      // 组织默认值故意取一个**不同的**数：若实现读错了一级，断言立刻分辨得出来。
      orgDefaultDays: days + 1,
      deletionGraceDays: null,
    });
    const out = await resolveRetention(deps, { orgId: "org-1", projectId: "prj-1", resolvedAt: AT });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.retention.resolvedDays).toBe(days);
    expect(out.retention.resolvedFrom).toBe("project");
  });

  it("清空项目覆盖值 ⇒ 回落组织默认值（V3 第二段）", async () => {
    const deps = retentionHarness({
      projectOverrideDays: 45,
      orgDefaultDays: 180,
      deletionGraceDays: null,
    });
    const withOverride = await resolveRetention(deps, {
      orgId: "org-1", projectId: "prj-1", resolvedAt: AT,
    });
    expect(withOverride.ok && withOverride.retention.resolvedFrom).toBe("project");

    deps.params.set({ projectOverrideDays: null });
    const fallenBack = await resolveRetention(deps, {
      orgId: "org-1", projectId: "prj-1", resolvedAt: AT,
    });
    expect(fallenBack.ok).toBe(true);
    if (!fallenBack.ok) return;
    expect(fallenBack.retention.resolvedFrom).toBe("org");
    expect(fallenBack.retention.resolvedDays).toBe(180);
  });

  it("清空组织默认值 ⇒ RETENTION_POLICY_MISSING，**不用隐含常量兜底**（I-33 / E5）", async () => {
    const deps = retentionHarness({
      projectOverrideDays: null,
      orgDefaultDays: null,
      deletionGraceDays: 30,
    });
    const out = await resolveRetention(deps, { orgId: "org-1", projectId: "prj-1", resolvedAt: AT });

    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe("RETENTION_POLICY_MISSING");
  });

  it("覆盖值为 0 / 负数 / 非整数 ⇒ RETENTION_VALUE_OUT_OF_RANGE，判据来自契约 schema", () => {
    for (const bad of [0, -1, 1.5]) {
      const r = resolveMaterialRetention(
        { projectOverrideDays: bad, orgDefaultDays: 180, deletionGraceDays: null },
        AT,
      );
      expect(r.ok, `days=${bad} 不应通过`).toBe(false);
      expect(r.ok === false && r.reason).toBe("RETENTION_VALUE_OUT_OF_RANGE");
    }
    // 判据同源：契约的 `RetentionResolution` 自己也拒绝同一批值。
    for (const bad of [0, -1, 1.5]) {
      expect(
        C.RetentionResolution.safeParse({ resolvedDays: bad, resolvedFrom: "org", resolvedAt: AT })
          .success,
      ).toBe(false);
    }
  });

  it("⚠ D-5 未裁：区间上界**没有**被实现者顺手发明出来", () => {
    // 「保留期允许区间」是 domain.md D-5，缺合规输入。一个大得离谱但合法的正整数
    // 必须被接受 —— 若哪天它开始被拒，说明有人替合规定了一个上界。
    const r = resolveMaterialRetention(
      { projectOverrideDays: 99_999, orgDefaultDays: null, deletionGraceDays: null },
      AT,
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.resolvedDays).toBe(99_999);
  });

  it.each([0, 15, 30, 90])("删除宽限期同样是参数（= %i 天）", (days) => {
    const r = resolveDeletionGraceDays({
      projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: days,
    });
    expect(r.ok && r.value).toBe(days);
  });

  it("删除宽限期缺失 ⇒ 同样拒绝，不落到 30 天", () => {
    const r = resolveDeletionGraceDays({
      projectOverrideDays: null, orgDefaultDays: 180, deletionGraceDays: null,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("RETENTION_POLICY_MISSING");
  });

  it("到期时间随参数取值线性变化 —— 常量实现过不了这一条", () => {
    // 同一个落库时刻、不同保留期 ⇒ 到期时间必须各不相同且严格递增。
    const storedAt = "2026-01-01T00:00:00.000Z";
    const expiries = DAY_VALUES.map((days) => {
      const frozen = freezeExpiry({
        materialId: `m-${days}`,
        storedAt,
        resolution: { resolvedDays: days, resolvedFrom: "org", resolvedAt: AT },
        snapshotReferenced: false,
      });
      expect(frozen.ok).toBe(true);
      return frozen.ok ? Date.parse(frozen.value.expiresAt) : NaN;
    });
    expect(new Set(expiries).size).toBe(DAY_VALUES.length);
    for (let i = 1; i < expiries.length; i += 1) {
      expect(expiries[i]!).toBeGreaterThan(expiries[i - 1]!);
    }
  });

  it("相位判定也吃参数：宽限期越长，物理删除越晚", () => {
    const record = {
      materialId: "m-1",
      storedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      resolvedDays: 31,
      resolvedFrom: "org" as const,
      trainingProhibited: true as const,
      logicallyDisabledAt: "2026-02-01T00:00:00.000Z",
      physicallyDeletedAt: null,
      deletionCertificateId: null,
      snapshotReferenced: false,
    };
    // 同一个 asOf，宽限期 5 天 ⇒ 该删了；宽限期 60 天 ⇒ 还在等。
    const asOf = "2026-02-10T00:00:00.000Z";
    expect(classifyExpiry(record, asOf, 5).phase).toBe("delete");
    expect(classifyExpiry(record, asOf, 60).phase).toBe("awaiting-grace");
  });
});

/* ────────────────────── ② 静态检查：本束无硬编码天数 ────────────────────── */

/**
 * 本束的源文件范围 —— `domain.md` I-32 说的「本束代码」。
 * 目录是**读出来的**而不是逐个文件列举：新加一个 `recording/xxx.ts` 自动进扫描面，
 * 不需要有人记得回来改这张表。
 */
const BUNDLE_DIRS = [
  join(API_DIR, "src/domain/recording"),
  join(API_DIR, "src/application/recording"),
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** 注释行不算违规：文档里写「不得写死 180 天」本身正是门控想要的东西。 */
const COMMENT = /^\s*(\*|\/\/|\/\*)/;

/** 唯一合法的行内豁免理由。**不是**通配的 `[days-literal-ok]`。 */
const DAYS_LITERAL_OK = /\[days-literal-ok:unit-conversion\]/;

/**
 * 天数黑名单 —— O-01 五参数的取值与几个常见近亲。
 * ⚠ **这一层没有豁免通道**：标记也放行不了。
 */
const FORBIDDEN_DAY_NUMBERS = [7, 30, 90, 180, 365, 1095];

/** 保留期语境的关键词。命中它 + 行里有数字 ⇒ 要么是策略取值，要么该说清楚为什么不是。 */
const RETENTION_CONTEXT = /retention|expir|grace|Days\b|days\b|保留期|宽限|留存/i;

function numericLiterals(line: string): number[] {
  // 先掐掉字符串字面量：注释与文案里的数字不参与判定（`"del-cert-1"` 之类）。
  const code = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return [...code.matchAll(/(?<![\w.])(\d[\d_]*)(?![\w.])/g)].map((m) =>
    Number(m[1]!.replace(/_/g, "")),
  );
}

describe("F78 · 静态检查：recording 束里没有写死的保留天数（I-32）", () => {
  const files = BUNDLE_DIRS.flatMap((d) => sourceFiles(d));

  it("扫描面非空 —— 空目录会让下面两条永远真", () => {
    // 本仓记过这个形状：lint-arch-deps 曾经「skipped 且退出 0」，被当成通过用了很久。
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("黑名单天数（7/30/90/180/365/1095）在本束源码里一次都不出现，且无豁免通道", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT.test(line)) return;
        for (const n of numericLiterals(line)) {
          if (FORBIDDEN_DAY_NUMBERS.includes(n)) {
            hits.push(`${relative(API_DIR, f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
        }
      });
    }
    expect(
      hits,
      hits.length
        ? "保留期是参数不是常量（D-14 / O-01 / I-32）。默认值属于留存策略内核的配置初值，" +
          "不是本束的常量。请走 RetentionParameterStore：\n  " + hits.join("\n  ")
        : "",
    ).toEqual([]);
  });

  it("保留期语境里的其他数字必须显式标记 unit-conversion", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT.test(line)) return;
        if (!RETENTION_CONTEXT.test(line)) return;
        if (DAYS_LITERAL_OK.test(line)) return;
        const nums = numericLiterals(line).filter((n) => n !== 0 && n !== 1);
        if (nums.length > 0) {
          hits.push(`${relative(API_DIR, f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(
      hits,
      hits.length
        ? "保留期相关代码里出现了未说明的数字。若确属单位换算，加 " +
          "`[days-literal-ok:unit-conversion] <理由>`；若是策略取值，它应该来自参数端口：\n  " +
          hits.join("\n  ")
        : "",
    ).toEqual([]);
  });

  it("反证 · 门控本身不是空转：把三个已知违规形态喂给同一套判据，必须全部被抓", () => {
    // 没有这一条，上面两条「hits 为空」在正则写错时同样绿。
    const bad = [
      "const DEFAULT_RETENTION_DAYS = 180;",
      "  const grace = params.deletionGraceDays ?? 30;",
      "return { resolvedDays: 1095, resolvedFrom: 'org' };",
    ];
    for (const line of bad) {
      expect(
        numericLiterals(line).some((n) => FORBIDDEN_DAY_NUMBERS.includes(n)),
        `应被黑名单抓住：${line}`,
      ).toBe(true);
    }

    // 黑名单外的天数（183）靠第二层抓。
    const sneaky = "const retentionDays = 183;";
    expect(numericLiterals(sneaky).some((n) => FORBIDDEN_DAY_NUMBERS.includes(n))).toBe(false);
    expect(RETENTION_CONTEXT.test(sneaky)).toBe(true);
    expect(DAYS_LITERAL_OK.test(sneaky)).toBe(false);
    expect(numericLiterals(sneaky).filter((n) => n !== 0 && n !== 1)).toEqual([183]);

    // 而豁免标记**救不了**黑名单里的数 —— 这是「标记式豁免会被滥用」的封口。
    const marked = "const d = 180; // [days-literal-ok:unit-conversion] 我瞎写的理由";
    expect(numericLiterals(marked).some((n) => FORBIDDEN_DAY_NUMBERS.includes(n))).toBe(true);

    // 字符串里的数字不算（否则 `del-cert-1`、ISO 时间戳会把门控淹掉）。
    expect(numericLiterals('const id = "del-cert-180";')).toEqual([]);
  });
});
