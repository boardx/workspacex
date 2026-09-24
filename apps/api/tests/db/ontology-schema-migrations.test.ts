/**
 * Phase 18 F02 —— 本体 canonical 表与扩列真的落在库里，并且约束是真约束（能挡住坏数据）。
 * 只断言「列在」不够：CHECK 写错一个字，表照样建得出来。所以每条关键约束都各插一行坏数据看它被拒。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-kg-f02-schema";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
});

const columns = (table: string) =>
  asOwner(async (c) =>
    (await c.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table],
    )).rows.map((r) => r.column_name),
  );

describe("F02: 表与列", () => {
  it("三张新表存在", async () => {
    for (const t of ["ontology_objects", "ontology_actions", "object_embeddings"]) {
      expect(await columns(t), t).not.toHaveLength(0);
    }
  });

  it("claims 补齐生命周期字段 + 作用域 + 决策七态（仍只有一个 status 字段）", async () => {
    const cols = await columns("claims");
    for (const c of [
      "confidence", "valid_from", "valid_to", "created_by", "reviewed_by", "supersedes_claim_id",
      "claim_kind", "scope_kind", "scope_id", "revoked_at", "rejected_at", "decision_state",
    ]) expect(cols, c).toContain(c);
    // I-2：不许出现第二个生命周期字段
    expect(cols.filter((c) => /status/.test(c))).toEqual(["status"]);
  });

  it("ontology_edges 扩出 status / created_by / provenance / 作用域", async () => {
    const cols = await columns("ontology_edges");
    for (const c of ["status", "invalidated_at", "created_by", "provenance_event_id", "scope_kind", "scope_id"]) {
      expect(cols, c).toContain(c);
    }
  });
});

describe("F02: 约束真的挡得住", () => {
  const insertClaim = (fields: Record<string, unknown>) =>
    asOwner((c) => {
      const row = { id: `c-${Math.random().toString(36).slice(2)}`, org_id: ORG, statement: "x", status: "proposed", tsv: "", ...fields };
      const keys = Object.keys(row);
      return c.query(
        `INSERT INTO claims (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(row),
      );
    });

  it("claim_kind 枚举外被拒", async () => {
    await expect(insertClaim({ claim_kind: "opinion" })).rejects.toThrow(/claims_claim_kind_chk/);
  });

  it("scope_kind / scope_id 必须同时有或同时无", async () => {
    await expect(insertClaim({ scope_kind: "chat_session" })).rejects.toThrow(/claims_scope_chk/);
  });

  it("模型产出的结论不经人确认不能是 accepted（I-4）", async () => {
    await expect(insertClaim({ created_by: "model", status: "accepted" })).rejects.toThrow(/claims_accept_needs_reviewer_chk/);
    await expect(insertClaim({ created_by: "model", status: "accepted", reviewed_by: "u-1" })).resolves.toBeDefined();
  });

  it("决策七态之外的值被拒", async () => {
    await expect(insertClaim({ decision_state: "maybe" })).rejects.toThrow(/claims_decision_state_chk/);
  });

  it("本体边的关系必须在 KgRelation 里；旧边的关系词不受影响", async () => {
    const edge = (src: string, rel: string) =>
      asOwner((c) => c.query(
        "INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation) VALUES ($1,$2,$3,'a','claim','b',$4)",
        [`e-${Math.random().toString(36).slice(2)}`, ORG, src, rel],
      ));
    await expect(edge("object", "likes")).rejects.toThrow(/ontology_edges_kg_relation_chk/);
    await expect(edge("object", "about")).resolves.toBeDefined();
    await expect(
      asOwner((c) => c.query(
        "INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation) VALUES ($1,$2,'person','p','decision','d','decided')",
        [`e-legacy-${Date.now()}`, ORG],
      )),
    ).resolves.toBeDefined();
  });

  it("失效边必须带失效时间", async () => {
    await expect(
      asOwner((c) => c.query(
        "INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, status) VALUES ($1,$2,'object','a','claim','b','about','invalidated')",
        [`e-inv-${Date.now()}`, ORG],
      )),
    ).rejects.toThrow(/ontology_edges_status_chk/);
  });

  it("ontology_actions 只能追加：UPDATE / DELETE 被拒", async () => {
    const id = `a-${Date.now()}`;
    await asOwner((c) => c.query(
      `INSERT INTO ontology_actions (id, org_id, scope_kind, scope_id, actor_kind, actor_id, action_type, payload, outcome)
       VALUES ($1,$2,'chat_session','t-1','system','sys','probe','{}','accepted')`, [id, ORG],
    ));
    await expect(asOwner((c) => c.query("UPDATE ontology_actions SET action_type = 'x' WHERE id = $1", [id]))).rejects.toThrow(/append-only/);
    await expect(asOwner((c) => c.query("DELETE FROM ontology_actions WHERE id = $1", [id]))).rejects.toThrow(/append-only/);
  });

  it("object_embeddings 的维度必须与登记的模型一致", async () => {
    await asOwner((c) => c.query("INSERT INTO embedding_models (model, model_version, dims) VALUES ('kg-f02-probe','1',3) ON CONFLICT DO NOTHING"));
    await expect(
      asOwner((c) => c.query(
        "INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding) VALUES ($1,'object','o-1','kg-f02-probe','1','[1,2]')",
        [ORG],
      )),
    ).rejects.toThrow(/has 2 dimensions/);
  });
});
