/**
 * #3066 —— URL 导入落库的 `SKILL.md`，前言 `name:` 必须等于 `stable_name`。
 *
 * ## 为什么这条断言值得一份独立测试
 *
 * Agent Skills 规范要求前言 `name` 等于**包含 `SKILL.md` 的目录名**，而运行时把包铺成
 * `/skills/<stable_name>/SKILL.md`——所以目录名就是 `stable_name`。URL 导入的
 * `SKILL.md` 是上游作者写的，`name:` 是任意展示名，与 `stable_name` 天然不等。
 * #3033 第三层已经把 Deep Agent 侧的「不等」从致命错降成 warning
 * （`native_skill_activity.py`：`skill frontmatter name differs from trusted stable name`），
 * ⚠ 那只是让 run 不炸——**包本身仍然不合规**，模型在系统提示里看到的 skill 名
 *   与它的工具身份名不是同一个，而这是一个**没有任何东西会红**的状态。
 *
 * ⇒ 这里把它变成会红的东西：不合规 ⇒ 当场失败。
 *
 * ## 为什么不连真实 Postgres
 *
 * 被测的是**仓储自己的改写与重算逻辑**（改哪一行、摘要按哪一种构造重算），不是
 * RLS/触发器那一层的集成边界——同目录 `url-import-persists-real-db.test.ts`
 * 覆盖后者。这里用一个记录 SQL 的假 `DatabasePort`（同
 * `logging/pg-error-log-writer.test.ts` 的套路），因此这份反证在没有 docker
 * 的环境里也一定能跑。
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import {
  PgSkillUrlImportRepository,
  alignSkillMdFrontmatterName,
} from "../../src/infrastructure/skill/pg-skill-url-import-repository";

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

interface Recorded {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * 假 `DatabasePort`：记录每一条 SQL，幂等回放查询与平台重名查询都返回「没有」，
 * 让 `persist()` 走完整的新建分支。
 */
function fakeDb(): { db: DatabasePort; queries: Recorded[] } {
  const queries: Recorded[] = [];
  const session: TenantSession = {
    async query<R = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      queries.push({ sql, params });
      // 平台组织重名判定：`present` 必须是 false，否则 `persist` 抛 SkillNameConflictError。
      if (sql.includes("AS present")) return { rows: [{ present: false }] as unknown as R[] };
      return { rows: [] as R[] };
    },
  };
  return {
    db: {
      withTenant: async (_orgId, fn) => fn(session),
      withoutTenant: async () => {
        throw new Error("URL 导入仓储永远不该绕开租户上下文");
      },
      close: async () => undefined,
    },
    queries,
  };
}

/** 从记录里抠出写进 `skill_version_files` 的那一行（按包内路径）。 */
function insertedFile(queries: readonly Recorded[], path: string): Recorded {
  const row = queries.find((q) => q.sql.includes("INSERT INTO skill_version_files") && q.params[2] === path);
  if (row === undefined) throw new Error(`没有写入 ${path}`);
  return row;
}

function insertedSkill(queries: readonly Recorded[]): Recorded {
  const row = queries.find((q) => q.sql.includes("INSERT INTO skills"));
  if (row === undefined) throw new Error("没有写入 skills");
  return row;
}

function insertedVersion(queries: readonly Recorded[]): Recorded {
  const row = queries.find((q) => q.sql.includes("INSERT INTO skill_versions"));
  if (row === undefined) throw new Error("没有写入 skill_versions");
  return row;
}

/** 前言里顶层 `name:` 的值。解析不出来返回 null——「没有 name」与「name 是空串」不同。 */
function frontmatterName(content: string): string | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (block === null) return null;
  for (const line of (block[1] ?? "").split(/\r?\n/)) {
    const kv = /^name:[ \t]*(.*)$/.exec(line);
    if (kv !== null) return (kv[1] ?? "").trim();
  }
  return null;
}

const UPSTREAM_SKILL_MD = `---
name: PDF Creator
description: Create and edit PDF files.
---

# PDF Creator

上游作者写的正文。
`;

async function importOnce(
  displayName: string,
  files: readonly { path: string; body: Buffer }[],
  contentDigest: string,
): Promise<{ queries: Recorded[]; result: Awaited<ReturnType<PgSkillUrlImportRepository["persist"]>> }> {
  const { db, queries } = fakeDb();
  const result = await new PgSkillUrlImportRepository(db).persist({
    orgId: "org-3066",
    actorId: "u-3066",
    idempotencyKey: `key-${displayName}`,
    name: displayName,
    sourceUrl: "https://github.com/acme/skills/tree/main/pdf-creator",
    contentDigest,
    files: files.map((f) => ({
      path: f.path,
      content: f.body,
      mediaType: "text/markdown",
      digest: sha256(f.body),
    })),
  });
  return { queries, result };
}

/** 用例层的包摘要构造（`manifestDigestOf`）——测试这边独立复述一遍，用来交叉核对。 */
function manifestDigest(files: readonly { path: string; digest: string }[]): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `${f.path}\0${f.digest}`)
      .join("\n"),
  );
}

describe("#3066 URL 导入：落库的 SKILL.md 前言 name == stable_name", () => {
  it("单文件导入：上游的 `name: PDF Creator` 被改写成 stable_name，且文件摘要/包摘要与新字节一致", async () => {
    const body = Buffer.from(UPSTREAM_SKILL_MD, "utf8");
    const { queries, result } = await importOnce("PDF Creator", [{ path: "SKILL.md", body }], sha256(body));

    const stableName = String(insertedSkill(queries).params[2]);
    expect(stableName).toBe("pdf-creator");

    const file = insertedFile(queries, "SKILL.md");
    const stored = file.params[3] as Buffer;
    // ① 规范本身：前言 name == 目录名（= stable_name）。
    expect(frontmatterName(stored.toString("utf8"))).toBe(stableName);
    // ② 只改这一行：正文与 description 原样保留，不是整份重写。
    expect(stored.toString("utf8")).toContain("description: Create and edit PDF files.");
    expect(stored.toString("utf8")).toContain("上游作者写的正文。");
    // ③ 摘要与**实际落库的字节**一致——Deep Agent 的身份判定是「路径 + 包摘要」，
    //    改了字节不重算摘要，身份就判不出来。
    expect(file.params[5]).toBe(sha256(stored));
    expect(insertedVersion(queries).params[3]).toBe(sha256(stored));
    expect(result.contentDigest).toBe(sha256(stored));
    // ④ 展示名不受影响：`skills.name` 仍是用户填的那个。
    expect(insertedSkill(queries).params[3]).toBe("PDF Creator");
  });

  it("目录导入：包摘要按 manifestDigestOf 重算，未被改写的文件摘要不动", async () => {
    const skillMd = Buffer.from(UPSTREAM_SKILL_MD, "utf8");
    const script = Buffer.from("print('hello')\n", "utf8");
    const before = [
      { path: "SKILL.md", digest: sha256(skillMd) },
      { path: "scripts/run.py", digest: sha256(script) },
    ];
    const { queries, result } = await importOnce(
      "PDF Creator Pack",
      [{ path: "SKILL.md", body: skillMd }, { path: "scripts/run.py", body: script }],
      manifestDigest(before),
    );

    const stableName = String(insertedSkill(queries).params[2]);
    const stored = insertedFile(queries, "SKILL.md").params[3] as Buffer;
    expect(frontmatterName(stored.toString("utf8"))).toBe(stableName);

    // 非根文件一个字节都没动。
    expect(insertedFile(queries, "scripts/run.py").params[3]).toEqual(script);
    expect(insertedFile(queries, "scripts/run.py").params[5]).toBe(sha256(script));

    const expected = manifestDigest([
      { path: "SKILL.md", digest: sha256(stored) },
      { path: "scripts/run.py", digest: sha256(script) },
    ]);
    expect(insertedVersion(queries).params[3]).toBe(expected);
    expect(result.contentDigest).toBe(expected);
    expect(expected).not.toBe(manifestDigest(before));
  });
});

describe("#3066 改写器本身：三种前言形状", () => {
  it("有前言有 name → 就地替换，其余行不动", () => {
    const out = alignSkillMdFrontmatterName(Buffer.from(UPSTREAM_SKILL_MD, "utf8"), "pdf-creator").toString("utf8");
    expect(frontmatterName(out)).toBe("pdf-creator");
    // 前言那一行的旧值没了；正文里的 `# PDF Creator` 标题**不该**被动。
    expect(out).not.toContain("name: PDF Creator");
    expect(out).toContain("# PDF Creator");
    expect(out).toContain("description: Create and edit PDF files.");
  });

  it("有前言但没有 name → 补一行（规范要求它存在）", () => {
    const src = "---\ndescription: no name here\n---\n\n正文\n";
    const out = alignSkillMdFrontmatterName(Buffer.from(src, "utf8"), "no-name").toString("utf8");
    expect(frontmatterName(out)).toBe("no-name");
    expect(out).toContain("description: no name here");
    expect(out).toContain("正文");
  });

  it("完全没有前言 → 前置一段最小前言，正文一字不动", () => {
    const src = "# 只有正文\n\n没有 YAML 前言。\n";
    const out = alignSkillMdFrontmatterName(Buffer.from(src, "utf8"), "body-only").toString("utf8");
    expect(frontmatterName(out)).toBe("body-only");
    expect(out.endsWith(src)).toBe(true);
  });

  it("正文里的 `---` 分隔线不会被当成前言", () => {
    const src = "# 标题\n\n---\n\nname: 这不是前言\n";
    const out = alignSkillMdFrontmatterName(Buffer.from(src, "utf8"), "hr-doc").toString("utf8");
    expect(frontmatterName(out)).toBe("hr-doc");
    expect(out).toContain("name: 这不是前言");
  });

  it("块标量 `name: >` 的续行一并被替换，不留悬空文本", () => {
    const src = "---\nname: >\n  Upstream\n  Multi Line\ndescription: d\n---\n正文\n";
    const out = alignSkillMdFrontmatterName(Buffer.from(src, "utf8"), "multi-line").toString("utf8");
    expect(frontmatterName(out)).toBe("multi-line");
    expect(out).not.toContain("Multi Line");
    expect(out).toContain("description: d");
  });

  it("已经等于 stable_name 时原样返回同一个 Buffer（不制造无谓的摘要变动）", () => {
    const buf = Buffer.from("---\nname: already-aligned\n---\n正文\n", "utf8");
    expect(alignSkillMdFrontmatterName(buf, "already-aligned")).toBe(buf);
  });

  it("CRLF 文件保持 CRLF", () => {
    const src = "---\r\nname: Upstream\r\ndescription: d\r\n---\r\n正文\r\n";
    const out = alignSkillMdFrontmatterName(Buffer.from(src, "utf8"), "crlf-doc").toString("utf8");
    expect(out).toContain("name: crlf-doc\r\n");
    expect(out).not.toContain("\n\n");
  });
});
