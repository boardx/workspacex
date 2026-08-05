/**
 * #595 —— 应用层的 `normalizedPath` 与 `skill_version_files` 的 DB CHECK
 * **到底是不是同义**。
 *
 * ## 为什么这个文件必须存在
 *
 * 段 1 的 PR 里我写过一句：DB CHECK 是「第二道**机械**门，不是第二份定义」。
 * ⚠ **那是推理，不是证据。** 两者是两处独立写下的规则：
 *
 *   · 应用层 `domain/skill/starter-pack.ts` 的 `normalizedPath`
 *     —— 拒反斜杠 / 绝对路径 / NUL / `posix.normalize` 改写过的形状 / `.` / `..`；
 *   · DB `20260804031000_wave2_skill_starter_import.sql` 的
 *     `skill_version_files_normal_path` —— 两条正则。
 *
 * 「同义」如果只是推理，那它就是本仓**第七次「同一事实两处声明」**的候选。
 * 本文件用**同一批路径**同时喂给两边，逐条比对判定。
 *
 * ## 判定规则
 *
 * 两边对每条路径的 accept/reject **必须一致**。不一致就是分叉，
 * ⛔ **不在本文件里"修"任何一边**——那是设计决定，要人来定哪边是对的。
 * 本文件只负责让分叉**变成一条红**，而不是继续当作没看见。
 *
 * ⚠ 特别注意方向性：DB **更严**是安全的（应用放行、DB 拒 ⇒ 写入失败，吵但安全）；
 *   DB **更松**才是危险的（应用层若被绕过，DB 兜不住）。所以断言里把这两类
 *   分开报，便于人判断严重度。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { normalizedPath } from "../../src/domain/skill/starter-pack";

const ORG = "org-i595-path-parity";
const SKILL = "skill-i595-parity";
const VERSION = "sv-i595-parity";
const DIGEST = "a".repeat(64);

/**
 * 语料。⚠ 必须**两类都有**：只有非法路径的话，一个「DB 恒拒」的实现会全绿。
 */
const PATHS: readonly string[] = [
  // 合法
  "SKILL.md",
  "scripts/run.py",
  "a/b/c/d.txt",
  "with space.md",
  "中文.md",
  "dot.in.name.md",
  "_leading_underscore.md",
  ".hidden",
  "a/.hidden",
  // 非法（穿越 / 绝对 / 反斜杠 / 点段）
  "../etc/passwd",
  "a/../../b",
  "/etc/passwd",
  "a\\b",
  ".",
  "..",
  "./a",
  "a/./b",
  "a/../b",
  "a//b",
  "a/",
  "/",
  "",
];

function appLayerAccepts(path: string): boolean {
  try {
    normalizedPath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * ⚠ 必须用 `asApp(ORG, …)` 而不是 `asOwner`。
 *
 * 实测踩过：用 `asOwner` 时**每一条路径都被拒**，包括 `SKILL.md`——
 * 输出长得完全像「应用层与 DB CHECK 大面积分叉」（一个第七次「同一事实两处」
 * 的重大发现）。真实原因是 `asOwner` 没有设租户 GUC，触发器先一步拒绝：
 * **`Skill file tenant does not match current tenant`**，CHECK 根本没轮到执行。
 *
 * ⇒ 又一次「红来自测试装置，不是来自被测对象」，而且这次的假象**指向一个
 *   听起来很重要的结论**。没有先去看真实错误文本的话，我会报出一个不存在的分叉。
 */
async function dbAccepts(path: string): Promise<boolean> {
  return asApp(ORG, async (client) => {
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ORG, VERSION, path, Buffer.from("x"), "text/plain", DIGEST],
      );
      await client.query("ROLLBACK");
      return true;
    } catch {
      await client.query("ROLLBACK");
      return false;
    }
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i595-parity" });
  await asOwner(async (client) => {
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'enabled','u-i595',$5,$5) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, "parity-skill", "parity-skill", now],
    );
    await client.query(
      `INSERT INTO skill_versions
         (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,'u-i595',$5,false) ON CONFLICT DO NOTHING`,
      [VERSION, ORG, SKILL, DIGEST, now],
    );
  });
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
});

describe("normalizedPath 与 skill_version_files CHECK 的同义性（实测，非推理）", () => {
  /** 正样本：装置本身是好的——合法路径 DB 真的收得下。 */
  it("装置自检：至少一条合法路径两边都放行", async () => {
    expect(appLayerAccepts("SKILL.md")).toBe(true);
    expect(await dbAccepts("SKILL.md")).toBe(true);
  });

  /** 反样本：DB 真的会拒——否则「DB 恒收」会让下面全绿。 */
  it("装置自检：至少一条穿越路径 DB 真的拒", async () => {
    expect(await dbAccepts("../etc/passwd")).toBe(false);
  });

/**
 * ⚠⚠ **已实测确认的分叉，尚未修复 —— 这是一条被登记的债，不是被接受的现状。**
 *
 * 两条路径**应用层放行、DB 拒**：
 *   · `".."`  —— `normalizedPath` 的规则拒 `"."`、拒 `"../"` 开头，
 *                **但一个光秃秃的 `".."` 两条都不沾**，于是被放行。
 *   · `"a/"`  —— 结尾斜杠，`posix.normalize` 不改写它，于是被放行。
 *
 * **方向是安全的那一侧**（DB 更严 ⇒ 今天写不进库）。但危害不为零：
 * 我在 #595 段 1 里明确要求「路径判定一律复用 `normalizedPath`，不另起一套」，
 * ⇒ 任何**没有 DB CHECK 兜底**的复用点（文件系统路径、zip 解压目标、
 *   对象存储 key）都会因为这条放行而向上逃一级目录。
 *
 * ⛔ **本轮不修**：哪边是对的是设计决定，已回报 coordinator。
 * ⚠ 这个常量把债变成**机械**的：新增分叉会红，分叉被修好**也会红**
 *   （提醒来更新这里），两个方向都不会静悄悄地过去。
 */
const KNOWN_DIVERGENCES_DB_STRICTER: readonly string[] = ["..", "a/"];

  it("逐条比对：两边判定必须一致（已知分叉除外，且已知分叉本身被锁住）", async () => {
    const dbStricter: string[] = [];
    const dbLooser: string[] = [];

    for (const path of PATHS) {
      const app = appLayerAccepts(path);
      const db = await dbAccepts(path);
      if (app && !db) dbStricter.push(path);
      if (!app && db) dbLooser.push(path);
    }

    // ⚠ DB 更松 = 危险：应用层一旦被绕过，DB 兜不住。这一类必须恒为空。
    expect(dbLooser).toEqual([]);
    // 已知分叉被逐字锁住：多一条会红，少一条（修好了）也会红。
    expect(dbStricter).toEqual([...KNOWN_DIVERGENCES_DB_STRICTER]);
  });
});
