/**
 * #580 —— **读侧**遇到契约外 `source` 时会怎样。
 *
 * ## 为什么这个文件必须存在
 *
 * #514 / PR #579 修的是**写侧**：`createSkillDraft` 现在对「入口打出的来源标记
 * 契约收不下」fail-closed。但**读侧一行都没动**，而 #514 的实现者自己把这条
 * 列进了未验证清单：「库里若已存在一行 `source = 画布`，`listSkills` /
 * `getSkillDetail` 会在读侧炸」——那是**推理，不是证据**。
 *
 * 「库里不可能有」今天成立的依据是 `skill.controller.ts` 把 `entry` 写死成
 * `admin-new`。那是一句**实现细节**，不是约束；改一行就不成立。
 *
 * ## 本文件测的是**从数据库回到进程里的那一行**，不是 HTTP 层
 *
 * 用一个替身 `DatabasePort` 喂出一行 `source = 画布`，然后走**真实的**
 * `ScopedPgSkillContractRepository.listAll / loadDetail` → `listSkills` 用例。
 * 替身换掉的只有「行从哪来」；映射、守卫、用例全是生产代码那一份。
 *
 * ⚠ 这**不能**替代打真实 Postgres 的那一半（`read-side-db-source-check.test.ts`）：
 *   那一半证的是另一件事——`skill_contracts.source` 上到底有没有 DB 级 CHECK。
 *   两件事都要证，因为它们各挡一类写入者（应用层挡调用方，CHECK 挡迁移/修数据脚本）。
 *
 * ## 每条「炸」都配一条「不炸」
 *
 * 一个「什么都抛」的实现——守卫写成恒真、fixture 根本没建出行、端口签名对不上——
 * 会让只有负样本的文件全绿。所以每一条负样本旁边都有一条**同一批数据、
 * 同一条调用路径**、只换 `source` 取值的正样本，且正样本要断言到**真的取到了那一行**。
 *
 * ## 反证
 *
 * 把 `pg-skill-contract-repository.ts` 的 `toRow` 里那两句 source 守卫删掉、
 * 退回 `row.source as SkillOriginTag` 的裸转型：下面「契约收不下的取值」与
 * 「本域不认识的取值」两组必须**当场变红**，且红在 `rejects.toThrow` 那一步
 * （不是红在正样本上）。反证输出见 PR 正文。
 */
import { describe, expect, it } from "vitest";
import { skills as C } from "@repo/contracts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ScopedPgSkillContractRepository } from "../../src/infrastructure/skill/pg-skill-contract-repository";
import { listSkills } from "../../src/application/skill/list-skills";
import type { DatabasePort, QueryResult, TenantSession } from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { SKILL_SOURCES } from "../../src/domain/skill/source-tag";

const ORG = "org-i580-read-side";
const SKILL = "skill-contract-i580";

/** 契约今天收得下的取值之一 —— 正样本用它。 */
const CONTRACTED = C.SkillSource.options[0];

/**
 * 本域（`domain.md` 五档）认识、**契约（三档）收不下**的取值。
 *
 * ⚠ 不硬编码成字符串字面量：D09 一旦被裁成五档，契约自然收得下，这个常量
 *   就取不到值，本文件会**跳过**这两条而不是继续断言一个已经不成立的性质。
 *   写死 `"画布"` 的话，裁决之后它会红在一个早就不该红的地方。
 */
const UNCONTRACTED = SKILL_SOURCES.find(
  (s) => !(C.SkillSource.options as readonly string[]).includes(s),
);

/** 本域**也**不认识的取值：迁移写错、别的服务直插、手工修数据都能造出来。 */
const ALIEN = "从别处抄来的来源";

interface FakeRow {
  readonly id: string;
  readonly name: string;
  readonly duty: string;
  readonly source: string;
  readonly status: string;
  readonly visibility: string;
  readonly owner_team_id: string | null;
  readonly current_version_id: string | null;
}

const rowWith = (source: string): FakeRow => ({
  id: SKILL,
  name: "访谈纪要压缩",
  duty: "访谈纪要 → 结论",
  source,
  status: "草稿",
  visibility: "org-wide",
  owner_team_id: null,
  current_version_id: null,
});

/**
 * 只回放 `skill_contracts` / `skill_contract_versions` 两张表的替身。
 *
 * ⚠ 按 SQL 文本分派而不是按调用顺序：`loadDetail` 内部先 `orgOf` 再查行再查版本，
 *   顺序是实现细节；一个按顺序回放的替身会在实现重排语句时静默错位。
 */
function fakeDb(source: string): DatabasePort {
  const session: TenantSession = {
    async query<R = Record<string, unknown>>(sql: string): Promise<QueryResult<R>> {
      if (sql.includes("FROM skill_contract_versions")) {
        return {
          rows: [
            {
              prompt_template: "把访谈纪要压成三条结论",
              input_schema: "{}",
              output_schema: "{}",
              data_scope: [],
              reads_raw_transcript: false,
              fallback_declaration: "模型不可用时提示人工整理",
            },
          ] as unknown as R[],
        };
      }
      if (sql.includes("SELECT org_id FROM skill_contracts")) {
        return { rows: [{ org_id: ORG }] as unknown as R[] };
      }
      if (sql.includes("FROM skill_contracts")) {
        return { rows: [rowWith(source)] as unknown as R[] };
      }
      // 2026-08-07 起 `listAll` 还会合并读一遍 wave2 的 `skills` 表（另一套 skill
      // 数据模型，见 `pg-skill-contract-repository.ts` 该方法头注）——这份测试只关心
      // `skill_contracts` 那一侧契约外 source 的报错行为，wave2 那侧回空即可。
      if (sql.includes("FROM skills sk")) {
        return { rows: [] as unknown as R[] };
      }
      throw new Error(`替身没有准备这条 SQL：${sql}`);
    },
  };
  return {
    async withTenant<T>(_orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
      return fn(session);
    },
    async withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
      return fn(session);
    },
    async close(): Promise<void> {},
  };
}

const repoFor = (source: string) => new ScopedPgSkillContractRepository(fakeDb(source), ORG);

/** 真实用例，成员在册、org-wide ⇒ 这条路径本身是通的。 */
const runListSkills = (source: string) =>
  listSkills(
    { orgId: ORG, entry: "library", requesterTeamId: null, orgRole: "consultant" },
    { catalog: repoFor(source), nextDecisionId: () => "decision-i580" },
  );

describe("#580 读侧：库里已有契约外 source 时的真实行为", () => {
  /* ───────────────── 正样本：同一条路径必须真的能成功 ───────────────── */

  it("[正样本] 契约内的 source：listSkills 取到那一行，且出参过契约 strict 校验", async () => {
    const result = await runListSkills(CONTRACTED);

    // 断言到「真的有那一行」，不是「没抛错」——后者对一个恒返回 [] 的实现也成立。
    expect(result.items.map((r) => r.skillId)).toEqual([SKILL]);
    expect(result.items[0]?.source).toBe(CONTRACTED);

    // 契约 `out` 是 `.strict()` 的：这一句证明这条链路真的走得通到契约边界。
    const parsed = C.operations.listSkills.out.parse({
      items: result.items.map((row) => ({
        skillId: row.skillId,
        name: row.name,
        duty: row.duty,
        source: row.source,
        status: row.status,
        visibility: row.visibility,
        currentVersionId: row.currentVersionId,
        satisfaction: null,
      })),
      total: result.items.length,
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("[正样本] 契约内的 source：loadDetail 取到那一行", async () => {
    const detail = await repoFor(CONTRACTED).loadDetail(SKILL);
    expect(detail).not.toBeNull();
    expect(detail?.facts.scope).toBe("org-wide");
  });

  /* ─────────── 负样本 ①：本域认识、契约收不下（正是 #580 的那一行） ─────────── */

  it.skipIf(UNCONTRACTED === undefined)(
    "[负样本] 契约收不下的 source：listSkills 在映射处指名 skillId 与取值抛出，不是匿名 ZodError",
    async () => {
      // 报错必须**指得出是哪一行、哪个取值、为什么**。
      // 一个只说 "Invalid enum value" 的 ZodError 让运维拿不到 skillId，
      // 而那正是今天（守卫之前）的行为——见 PR 正文的「量出来的现状」。
      const error = await runListSkills(UNCONTRACTED as string).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(SKILL);
      expect(message).toContain(UNCONTRACTED as string);
      expect(message).toContain("D09");
      // ⚠ 不许静默跳过：不能是「返回空列表」那种把脏数据永远藏起来的处置。
      expect(message).not.toMatch(/skipped|忽略/);
    },
  );

  it.skipIf(UNCONTRACTED === undefined)(
    "[负样本] 契约收不下的 source：getSkillDetail 方向（loadDetail）同样抛出",
    async () => {
      await expect(repoFor(UNCONTRACTED as string).loadDetail(SKILL)).rejects.toThrow(/D09/);
    },
  );

  /* ─────────── 负样本 ②：本域也不认识的取值（裸转型今天直接放行） ─────────── */

  it("[负样本] 本域不认识的 source：listSkills 抛出并指名列与 skillId", async () => {
    const error = await runListSkills(ALIEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("skill_contracts.source");
    expect(message).toContain(SKILL);
    expect(message).toContain(ALIEN);
  });
});

/* ────────── 契约边界本身的性质：一行坏数据毒死整个列表（守卫与否都成立） ────────── */

/**
 * 这一组**不测我加的守卫**，测的是 `listSkills.out` 这个契约形状固有的性质——
 * coord-chat-e2e 点名要先用代码证据回答的那一条。
 *
 * `skill.controller.ts` 对**整份响应**调**一次** `C.operations.listSkills.out.parse({items, total})`。
 * zod 的对象解析是全或无：数组里任何一个元素不合法 ⇒ 整次 `parse` 抛 ⇒
 * **所有幸存行一起拿不到**。所以「库里有一行契约外 source」的爆炸半径不是那一行，
 * 是**这个组织的整个 skill 列表**。
 *
 * ⇒ 这就是为什么读侧的正确处置只能是 fail-closed 且**报错指名 skillId**：
 *   炸是躲不掉的（除非放宽 strict，而那被明确禁止），能改的是「炸得有没有人看得懂」。
 */
describe("#580 契约边界：一行坏数据的爆炸半径是整份列表", () => {
  const listItem = (skillId: string, source: string) => ({
    skillId,
    name: "n",
    duty: "d",
    source,
    status: "草稿",
    visibility: "org-wide",
    currentVersionId: null,
    satisfaction: null,
  });

  it.skipIf(UNCONTRACTED === undefined)(
    "一好一坏两行：out.parse 整体抛出，好的那一行也交付不出去",
    () => {
      const payload = {
        items: [listItem("skill-good", CONTRACTED), listItem("skill-bad", UNCONTRACTED as string)],
        total: 2,
      };
      const parsed = C.operations.listSkills.out.safeParse(payload);
      expect(parsed.success).toBe(false);

      // 配对正样本：把坏的那一行换成契约内取值，同一个 payload 形状必须解析成功。
      // 少了这一条，一个「out.parse 恒失败」的实现（字段名写错、schema 拿错）也会绿。
      const allGood = C.operations.listSkills.out.safeParse({
        items: [listItem("skill-good", CONTRACTED), listItem("skill-also-good", CONTRACTED)],
        total: 2,
      });
      expect(allGood.success).toBe(true);
    },
  );

  it.skipIf(UNCONTRACTED === undefined)(
    "契约自己的报错**不含 skillId** —— 这正是守卫要补的那部分",
    () => {
      const parsed = C.operations.listSkills.out.safeParse({
        items: [listItem("skill-bad", UNCONTRACTED as string)],
        total: 1,
      });
      expect(parsed.success).toBe(false);
      const message = parsed.success ? "" : parsed.error.message;
      // zod 给的是 `items[0].source` 这样的**下标**路径，不是 skillId。
      // 一份 200 行的列表里，运维拿着 `items[137]` 查不到该修哪条数据。
      expect(message).not.toContain("skill-bad");
    },
  );
});

/* ───────────────── DB 侧最后一道防线：CHECK 与契约同值域 ───────────────── */

describe("#580 skill_contracts.source 的 DB 级约束", () => {
  const MIGRATION = fileURLToPath(
    new URL(
      "../../migrations/20260805140000_i459_skill_declarative_contract_store.sql",
      import.meta.url,
    ),
  );

  /**
   * ⚠ 这是**同一事实的第二份声明**（契约枚举 vs 迁移里的 CHECK 字面量），
   *   而同一事实不得声明在两处（AGENTS.md）。既有的迁移已经把三个取值抄了一遍，
   *   本 issue 不改签核过的迁移文件，所以补一条**机械门控**把两份钉在一起：
   *   任何一侧变了而另一侧没变，这条当场红。
   */
  it("CHECK 存在，且取值集合与契约 SkillSource 逐字一致", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const match = /source\s+text NOT NULL CHECK \(source IN \(([^)]*)\)\)/.exec(sql);
    expect(match, "skill_contracts.source 上没有 CHECK —— 绕过应用层的写入（迁移/修数据脚本/别的服务）就没有任何东西挡了").not.toBeNull();

    const values = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter((s) => s.length > 0);
    expect([...values].sort()).toEqual([...C.SkillSource.options].sort());
  });
});
