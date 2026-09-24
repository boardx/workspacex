/**
 * Phase 18 F02 —— 数据库 CHECK 里的枚举与契约逐项对账。
 *
 * SQL 引用不了 TypeScript，所以同一组枚举不可避免地写了两份：契约
 * `packages/contracts/src/chat-knowledge-graph.ts` 是唯一事实源，迁移里的 CHECK 是它的副本。
 * 这个测试就是 AGENTS.md「第二份副本必须有机械门控」要求的那道门：从库里读出真正生效的
 * 约束定义（pg_get_constraintdef），与契约的 `.options` 比较，任一边改了另一边没改就红。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

/** 表上所有 CHECK 的定义里，`<column> = ANY (ARRAY[...])` 的字面量集合（去重排序）。 */
async function checkedValues(table: string, column: string): Promise<string[]> {
  const defs = await asOwner((c) => c.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'`, [table],
  ));
  const re = new RegExp(`\\(?${column}\\)?\\s*=\\s*ANY\\s*\\(\\(?ARRAY\\[([^\\]]*)\\]`, "g");
  const values = new Set<string>();
  for (const { def } of defs.rows) {
    for (const m of def.matchAll(re)) {
      for (const lit of m[1]!.matchAll(/'([^']+)'/g)) values.add(lit[1]!);
    }
  }
  return [...values].sort();
}

const sorted = (xs: readonly string[]) => [...xs].sort();

/*
 * 对账范围 = 契约里有同名枚举的列。`ontology_actions.actor_kind` / `outcome`、
 * `object_embeddings.target_kind`、`ontology_edges.status` 是存储内部的状态位，只存在于迁移里；
 * 哪天契约暴露了其中之一，就把它加进下面的表。
 */
describe("F02：CHECK 枚举 ≡ 契约枚举", () => {
  it.each([
    ["ontology_objects", "scope_kind", KG.KgScopeKind.options],
    ["ontology_actions", "scope_kind", KG.KgScopeKind.options],
    ["ontology_objects", "object_kind", KG.KgObjectKind.options],
    ["ontology_objects", "created_by", KG.KgCreatedBy.options],
    ["claims", "created_by", KG.KgCreatedBy.options],
    ["claims", "claim_kind", KG.KgClaimKind.options],
    ["claims", "decision_state", KG.KgDecisionState.options],
    ["ontology_edges", "created_by", KG.KgCreatedBy.options],
  ] as const)("%s.%s", async (table, column, contract) => {
    const got = await checkedValues(table, column);
    expect(got.length, `no CHECK found for ${table}.${column}`).toBeGreaterThan(0);
    expect(got).toEqual(sorted(contract));
  });

  it("ontology_edges.relation（实体 / 结论端点时）≡ KgClaimRelation ∪ KgStructuralRelation", async () => {
    expect(await checkedValues("ontology_edges", "relation"))
      .toEqual(sorted([...KG.KgClaimRelation.options, ...KG.KgStructuralRelation.options]));
  });

  it("claims / ontology_edges 的作用域 CHECK 同样 ≡ KgScopeKind", async () => {
    for (const t of ["claims", "ontology_edges"]) {
      expect(await checkedValues(t, "scope_kind"), t).toEqual(sorted(KG.KgScopeKind.options));
    }
  });
});
