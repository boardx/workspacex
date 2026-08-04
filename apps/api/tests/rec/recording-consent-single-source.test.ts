/**
 * issue #465 — 录音同意矩阵的两条单一事实源门控（coord-main 2026-08-04 裁决的放行条件 1 与 3）。
 *
 * 裁决的关键区分：`domain.md` X-7 管的是「**授权项定义**」——「必须读同一份授权项定义，
 * 不得自己拆」——不是「提交记录存哪张表」。所以 `recording_consent_cells` 可以存在，
 * 条件是它**不定义也不复制**那份枚举，且它算出来的东西**不会变成第二个「同意状态」**。
 * 这两句话各自对应本文件的一组断言。
 *
 * ## ① 定义只有一处（放行条件 1）
 *
 * 迁移里那条 `CHECK (item IN (...))` 字面上确实是枚举的一份拷贝——SQL 没法 import
 * TypeScript。本仓对这种「必须存在的拷贝」有既定处置，不是删掉约束（那样数据库就什么都收），
 * 而是**机械对账**：`tests/kernel/admin-audit-access-visible-to-lead.test.ts` 的
 * 「the database CHECK enumerates exactly the contract's event types」就是同一手法，
 * 它自己的注释写着「this project has drifted six times from copies」。照抄那条路。
 *
 * ⚠ 代码侧原本还藏着第二份拷贝，且伪装得更好：`blocksStart` 里写的是 `< 3`——
 *   一个**穿着数字外衣的枚举基数**。X-7 的三项/四项之争一旦裁成四项，字面 3 会让门在
 *   矩阵只答了四分之三时照常放行，而且没有任何东西会报。已改成读
 *   `RecordingConsentItem.options.length`，下面第三条断言把它钉住。
 *
 * ## ② 不产生第二个「同意状态」（放行条件 3）
 *
 * 这才是「第二份事实」真正的风险面：两张表各自算出一个 `consentStatus`。
 * `deriveConsentStatus`（`domain/interview/subject.ts`）是那个状态**唯一**的派生实现，
 * 所以断言写成图可达性而不是同文件字符串匹配——「A 文件读表、B 文件调 derive」这种
 * 一跳就能绕开的写法挡不住两跳。下面从每个调用 `deriveConsentStatus` 的模块出发，
 * 沿相对 import 求传递闭包，断言闭包里没有任何模块碰 `recording_consent_cells`。
 *
 * ⚠ 反证（本仓已九次「全绿但空转」，所以门控写完当场造）：把 recording 的仓储接进
 *   interview 的同意路径，这条断言必须当场变红。实测记录在 PR #500 正文里。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recording as C } from "@repo/contracts";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(API_DIR, "src");
const TABLE = "recording_consent_cells";
const DERIVE = "deriveConsentStatus";

const ORG = "org-rec465-consent";
const PROJECT = "proj-rec465-consent";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Code lines only — a gate that fires on its own documentation gets muted. */
function codeLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

/** Relative imports this file pulls in, resolved to real paths under `src/`. */
function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const line of codeLines(file)) {
    for (const m of line.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const base = resolve(dirname(file), m[1]!);
      for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
        try {
          if (statSync(candidate).isFile()) out.push(candidate);
        } catch {
          // A specifier that resolves to nothing on disk is a type-only path or a `.js`
          // suffix convention; tsc already guarantees it resolves, so nothing to report.
        }
      }
    }
  }
  return out;
}

/** Everything reachable from `roots` by following relative imports. */
function closure(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    queue.push(...importsOf(f));
  }
  return seen;
}

describe("录音同意矩阵不成为第二份事实", () => {
  const files = walk(SRC);

  it("① 授权项定义只有契约一处：迁移的 CHECK 与 RecordingConsentItem 逐字相等", async () => {
    ensureDatabase();
    await migrateOnce();
    const def = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = $1 AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) LIKE '%ai_analysis%'`,
        [TABLE],
      );
      return r.rows[0]?.def ?? "";
    });
    // Positive control: an empty definition would make the comparison below vacuous, and
    // "the constraint was renamed away" must not read as "the copy is in sync".
    expect(def).not.toBe("");
    const inSql = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(inSql).toEqual([...C.RecordingConsentItem.options].sort());
  });

  it("① 该 CHECK 是活的，不只是存在：枚举外的项被数据库拒绝", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO ${TABLE} (org_id, source_ref_id, participant_id, item, state)
           VALUES ($1, 'src-x', 'p-x', 'attribution', 'granted')`,
          [ORG],
        ),
      ),
      // `attribution` 不是随手挑的：它正是 interview 侧四位里多出来的那一位，
      // 也就是 X-7 三项/四项之争的争点本身。本束若哪天悄悄跟着拆成四项，这条先红。
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("① 代码侧不写死项数：门禁读的是契约枚举的基数，不是字面量", () => {
    const repo = join(SRC, "infrastructure/recording/pg-recording-repository.ts");
    const code = codeLines(repo).join("\n");
    expect(code).toContain("C.RecordingConsentItem.options.length");
    // 反面：任何与 `granted` 计数并列的裸数字比较都是那个「穿着数字外衣的枚举基数」。
    expect(code).not.toMatch(/granted[^\n]*[<>]=?\s*\d/);
  });

  it("③ recording_consent_cells 进不了 deriveConsentStatus 的数据来源", () => {
    const callers = files.filter(
      (f) => codeLines(f).some((l) => l.includes(DERIVE)) && !f.endsWith(join("domain", "interview", "subject.ts")),
    );
    // Positive control FIRST: with zero callers the subset check below passes vacuously,
    // which is exactly how this rots into a green no-op if the function is ever renamed.
    expect(callers.length).toBeGreaterThan(0);

    const reachable = closure(callers);
    const offenders = [...reachable].filter((f) => codeLines(f).some((l) => l.includes(TABLE)));
    expect(
      offenders.map((f) => f.slice(API_DIR.length)),
      `一个能算出 Subject.consentStatus 的模块（传递）碰到了 ${TABLE}：` +
        "两张表各自算一个「同意状态」正是 X-7 裁决明确不放行的那件事",
    ).toEqual([]);

    // Second positive control: the scan really does see the table somewhere in `src/`,
    // so "no offenders" means "not in that closure" rather than "never found the string".
    expect(files.filter((f) => codeLines(f).some((l) => l.includes(TABLE))).length).toBeGreaterThan(0);
  });
});

beforeAll(() => {
  ensureDatabase();
});

afterAll(async () => {
  await resetOrgs(ORG);
});
