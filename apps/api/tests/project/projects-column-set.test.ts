/**
 * I-P33 🔴 —— `projects` 的列集合是一个封闭清单，恰好 `{id, org_id, name, status, kind}`。
 *
 * 三道门，缺一条这条不变量就退化成一句纸面约定：
 *
 *   A 结构断言（主门）  真库的列集合 **恰好等于** 白名单
 *   B 反证             喂伪造的列集合，断言判定确实会红，且红在**哪一列**上
 *   C 意图断言         白名单长度恒为 5，且逐值等于契约 `project.Project` 的字段
 *
 * 只有 A 时，一个 `return {ok:true}` 的判定让主门永远绿。
 * 只有 A+B 时，「改白名单来消红」是一条无声的路径 —— C 让它必须同时改两处。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project } from "@repo/contracts";
import {
  PROJECTS_COLUMNS,
  checkProjectsColumnSet,
  contractProjectColumns,
} from "../../src/domain/project/projects-column-set";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";

describe("门控 B（反证）：判定不是空转的", () => {
  it("喂 [...白名单, 'agenda_segment_id'] —— 必须红，且 extra 恰为该项", () => {
    const v = checkProjectsColumnSet([...PROJECTS_COLUMNS, "agenda_segment_id"]);
    expect(v.ok).toBe(false);
    // 「恰为」而不是「包含」：一个把所有列都报成 extra 的实现也会包含它。
    expect(v.extra).toEqual(["agenda_segment_id"]);
    expect(v.missing).toEqual([]);
  });

  it("黑名单挡不住的那个名字（current_segment_id）也必须红 —— 白名单等值的全部理由", () => {
    // agenda_segment_id 是被想到的名字，current_segment_id 是下一个没被想到的。
    // 黑名单式门控（断言某几列不存在）在这一条上是绿的，白名单式不是。
    const v = checkProjectsColumnSet([...PROJECTS_COLUMNS, "current_segment_id"]);
    expect(v.ok).toBe(false);
    expect(v.extra).toEqual(["current_segment_id"]);
  });

  it("喂 ['id','org_id'] —— missing 非空（迁移没跑 / 被回退时的形状）", () => {
    const v = checkProjectsColumnSet(["id", "org_id"]);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["kind", "name", "status"]);
    expect(v.extra).toEqual([]);
  });

  it("顺序无关：集合相等就是相等（否则这道门会因为一次 ALTER 的列序变化误报）", () => {
    expect(checkProjectsColumnSet(["kind", "status", "name", "org_id", "id"]).ok).toBe(true);
  });
});

describe("门控 C（意图断言）：改白名单不可能是顺手的", () => {
  it("白名单长度恒为 5，且逐值等于字面量", () => {
    expect(PROJECTS_COLUMNS.length).toBe(5);
    expect([...PROJECTS_COLUMNS]).toEqual(["id", "org_id", "name", "status", "kind"]);
  });

  it("白名单与契约 `project.Project` 的字段**是同一个事实的两种拼写**", () => {
    // 少了这条，「往契约里加一个字段」与「往库里加一列」可以各自发生而两边都绿。
    expect(contractProjectColumns()).toEqual([...PROJECTS_COLUMNS].sort());
    // 非空转：契约确实读到了字段，而不是读到一个空对象。
    expect(Object.keys(project.Project.shape).length).toBe(5);
  });

  it("契约的 kind / status 是闭枚举，且与迁移里的 CHECK 同形", () => {
    expect(project.ProjectKind.options).toEqual(["workshop", "research_project", "user_insight"]);
    expect(project.ProjectStatus.options).toEqual(["active", "archived"]);
  });
});

describe("门控 A（主门）：真库的列集合", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  }, 180_000);

  afterAll(() => undefined);

  it("information_schema 读出的列集合恰好等于白名单", async () => {
    const cols = await asOwner(async (c) => {
      const r = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'projects'`,
      );
      return r.rows.map((x) => x.column_name);
    });

    // 非空转：读到 0 列说明查询本身坏了（表名打错、schema 不对），
    // 而 0 列会让 extra 为空、missing 为全部——那是一条真实的红，但红错了地方。
    expect(cols.length, "information_schema 读到 0 列 —— 查询本身坏了").toBeGreaterThan(0);

    const v = checkProjectsColumnSet(cols);
    expect(
      v,
      `projects 的列集合偏离了封闭清单。\n` +
        `  多出来：${v.extra.join(", ") || "(无)"}\n` +
        `  缺少：  ${v.missing.join(", ") || "(无)"}\n` +
        `⚠ 多出来的列若是工作坊专属字段（议程环节 / 分组 / 蓝本引用），` +
        `它违反 Q-12 裁决 C —— 该字段属于 workshops 子类型表，不属于超类型。`,
    ).toEqual({ ok: true, extra: [], missing: [] });
  });

  it("kind / status 的 DB CHECK 成员集逐个等于契约枚举", async () => {
    const members = await asOwner(async (c) => {
      const r = await c.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = 'projects'::regclass AND contype = 'c'`,
      );
      return Object.fromEntries(r.rows.map((x) => [x.conname, x.def]));
    });

    for (const k of project.ProjectKind.options) {
      expect(members["projects_kind_check"], `kind CHECK 少了 ${k}`).toContain(`'${k}'`);
    }
    for (const s of project.ProjectStatus.options) {
      expect(members["projects_status_check"], `status CHECK 少了 ${s}`).toContain(`'${s}'`);
    }
    // 反向：CHECK 里不许有契约之外的值。字符串计数比「包含」强一档——
    // 只断言包含时，一个 kind IN (...三值..., 'delivery') 的 CHECK 也全绿。
    expect((members["projects_kind_check"]?.match(/'/g) ?? []).length / 2).toBe(3);
    expect((members["projects_status_check"]?.match(/'/g) ?? []).length / 2).toBe(2);
  });

  it("kind 没有 DEFAULT —— 「忘了说这是哪一类」必须是写不进去的状态", async () => {
    const d = await asOwner(async (c) => {
      const r = await c.query<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
          WHERE table_schema='public' AND table_name='projects' AND column_name='kind'`,
      );
      return r.rows[0]?.column_default ?? null;
    });
    // 有默认值时，F117 的 INVALID_KIND 永远等不到一个空值，三类会静默都变成工作坊。
    expect(d).toBeNull();
  });
});
