/**
 * F72 · domain.md I-20 / I-21 -- 「手机号加密存储」与「界面掩码」是TWO separate guarantees,
 * not one. A feature that only masks the interface and never encrypts the original at rest
 * satisfies I-19 but not I-20; a feature that only encrypts but forgets to mask the default
 * read path satisfies I-20 but not I-19. This file asserts both, each on its own describe
 * block, so neither can quietly cover for the other going missing.
 *
 * ## Why this file never opens a database connection
 *
 * `apps/api/vitest.config.ts` documents issue #74 (full-suite nondeterminism from Postgres
 * connection exhaustion) and this worker's own instructions say no test that needs Postgres
 * runs locally -- only typecheck does. `F48`'s `credential-never-echoed.test.ts` already
 * solved exactly this problem for the identical requirement ("the app role cannot read the
 * ciphertext column") by reading the MIGRATION FILE'S TEXT and regex-matching the `GRANT`
 * statements, rather than connecting to a real database and querying
 * `information_schema.column_privileges`. That is the same technique this file uses for
 * `pii_originals` -- static, deterministic, and it runs in the same process as every other
 * unit test in this file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maskPii, PII_MASK_TOKEN, sealPiiOriginal, type PiiCipher } from "../../src/domain/recording/pii-mask";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
const MIGRATION = join(MIGRATIONS_DIR, "20260731165010_f72_pii_masking_phone_encryption.sql");
const API_SRC = fileURLToPath(new URL("../../src", import.meta.url));

const PLAINTEXT_PHONE = "13812345678";

const cipher: PiiCipher = {
  algorithm: "aes-256-gcm",
  keyId: "k-test-pii-1",
  // Deliberately NOT reversible in this file -- base64 only proves the stored bytes are not
  // the plaintext bytes, the same discipline F48's credential-never-echoed test uses.
  encrypt: (p) => Buffer.from(p, "utf8").toString("base64"),
};

describe("界面掩码 (I-19 的手机号一支)：手机号在默认读接口的文本里只剩占位符", () => {
  it("masked text 不含手机号明文", () => {
    const raw = `请拨打 ${PLAINTEXT_PHONE} 联系。`;
    const result = maskPii(raw, { cipher, sealedAt: "2026-07-31T00:00:00.000Z" });
    expect(result.text).not.toContain(PLAINTEXT_PHONE);
    expect(result.text).toBe(`请拨打 ${PII_MASK_TOKEN} 联系。`);
  });

  it("不传 cipher 时，界面掩码依旧生效 —— 两件事互不依赖", () => {
    const raw = `请拨打 ${PLAINTEXT_PHONE} 联系。`;
    const result = maskPii(raw); // no cipher supplied
    expect(result.text).not.toContain(PLAINTEXT_PHONE);
    expect(result.sealedOriginals).toEqual([]); // encryption guarantee simply not produced
  });
});

describe("存储层加密 (I-20)：手机号原文只以密文形式存在，且本进程内无解密路径", () => {
  it("sealPiiOriginal 产出的密文不等于明文", () => {
    const sealed = sealPiiOriginal(PLAINTEXT_PHONE, cipher, "2026-07-31T00:00:00.000Z");
    expect(sealed.ciphertext).not.toBe(PLAINTEXT_PHONE);
    expect(JSON.stringify(sealed)).not.toContain(PLAINTEXT_PHONE);
    expect(Object.keys(sealed).sort()).toEqual(
      ["__sealedPii", "algorithm", "ciphertext", "keyId", "sealedAt"].sort(),
    );
  });

  it("maskPii 在命中手机号且传入 cipher 时，同一次扫描顺带产出该 finding 的密文原文", () => {
    const raw = `请拨打 ${PLAINTEXT_PHONE} 联系。`;
    const result = maskPii(raw, { cipher, sealedAt: "2026-07-31T00:00:00.000Z" });
    expect(result.sealedOriginals).toHaveLength(1);
    const sealedOriginal = result.sealedOriginals[0]!;
    expect(sealedOriginal.type).toBe("phone");
    expect(sealedOriginal.findingId).toBe(result.findings[0]!.findingId);
    expect(sealedOriginal.sealed.ciphertext).not.toBe(PLAINTEXT_PHONE);
  });

  it("拒绝密封空字符串 —— 空原文不是一个合法的『已加密原文』", () => {
    expect(() => sealPiiOriginal("", cipher, "2026-07-31T00:00:00.000Z")).toThrow();
  });

  it("`pii-mask.ts` 声明了 encrypt、没有声明任何 decrypt/unseal —— 唯一入口无出口", () => {
    const body = readFileSync(join(API_SRC, "domain/recording/pii-mask.ts"), "utf8");
    const declarations = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .filter((l) => /^export\s+(?:function|const|interface|type)\s+\w+/.test(l))
      .map((l) => /\s(\w+)\s*[(:=<]/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    expect(declarations).not.toContain("unsealPiiOriginal");
    expect(declarations).not.toContain("decrypt");
    expect(/\bdecrypt\w*\s*\(/i.test(body.replace(/^.*(\*|\/\/).*$/gm, ""))).toBe(false);
  });
});

describe("at rest: the migration grants the app role every column of `pii_originals` EXCEPT `ciphertext`", () => {
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

  function grantsFor(table: string): string {
    return (
      new RegExp(`GRANT\\s+([A-Z,\\s]+?)\\s+ON\\s+${table}\\s+TO\\s+app_rw`, "i").exec(sql)?.[1] ?? ""
    );
  }

  function selectColumnsFor(table: string): string[] | null {
    const m = new RegExp(`GRANT\\s+SELECT\\s*\\(([^)]*)\\)\\s*\\n?\\s*ON\\s+${table}\\s+TO\\s+app_rw`, "i").exec(sql);
    return m ? m[1]!.split(",").map((c) => c.trim()).filter(Boolean) : null;
  }

  it("pii_originals: 列级 GRANT 存在，且不含 ciphertext（否则这条断言就是空转）", () => {
    const cols = selectColumnsFor("pii_originals");
    expect(cols, "no column-level SELECT grant found -- this assertion would be vacuous").not.toBeNull();
    expect(cols).not.toContain("ciphertext");
    // The org export / cross-tenant sweeps need this one specifically.
    expect(cols).toContain("org_id");
    // Two-way: the granted set is pinned so a later column is a deliberate decision.
    expect([...cols!].sort()).toEqual(
      ["algorithm", "finding_id", "key_id", "org_id", "pii_type", "sealed_at", "segment_id"].sort(),
    );
  });

  it("pii_originals: 写入权限存在，表可用", () => {
    const g = grantsFor("pii_originals");
    expect(g).toContain("INSERT");
    expect(g).toContain("UPDATE");
  });

  it("反证：`ciphertext` 在本仓任何一份迁移的任何 GRANT 里都不出现", () => {
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({ f, body: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
    expect(all.length, "read no migrations -- this scan would be vacuous").toBeGreaterThan(10);
    const offenders = all.flatMap(({ f, body }) =>
      body
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => !/^\s*--/.test(line))
        .filter(({ line }) => /GRANT[\s\S]*\bciphertext\b/i.test(line))
        .map(({ n }) => `${f}:${n}`),
    );
    expect(offenders, "a migration grants access to the ciphertext column").toEqual([]);
  });

  it("没有明文列可写：table body 里只有 ciphertext，没有 plaintext/phone_value 一类的列", () => {
    const table = /CREATE TABLE IF NOT EXISTS pii_originals \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
    expect(table, "pii_originals table body not found").not.toBe("");
    expect(table).toContain("ciphertext");
    expect(/\bplaintext\b|\bphone_value\b|\bsecret_value\b/i.test(table)).toBe(false);
  });

  it("pii_type 只受理 'phone'（本迁移的范围声明，见文件头）", () => {
    expect(sql).toMatch(/pii_type\s+text\s+NOT NULL\s+CHECK\s*\(pii_type\s+IN\s*\('phone'\)\)/);
  });

  it("正对照：`pii_originals` 是本迁移里唯一带列级 GRANT 的表，不是这份文件写 GRANT 的通常写法", () => {
    // Without this, "pii_originals has a column grant" could just be how this file writes
    // every grant, and the restriction above would be saying nothing.
    expect(selectColumnsFor("pii_originals")).not.toBeNull();
  });

  it("secrets 表启用了 RLS，和其它租户表一致", () => {
    expect(sql).toContain("ALTER TABLE pii_originals ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE pii_originals FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY pii_originals_tenant");
  });
});
