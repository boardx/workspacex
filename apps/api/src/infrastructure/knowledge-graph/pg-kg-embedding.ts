/**
 * S9（#4366）`KgEmbeddingQueuePort` 的 Postgres 实现：迁移 20260927200000 里几个函数的薄封装。
 *
 * app_rw 对 object_embeddings 只有 SELECT；向量只经 `kg_embedding_write` 落表，它在库里核对目标仍活、文本未变。
 * 取文本（`kg_embedding_pending`）只在本 org 的 withTenant 里、按 app.current_org 定位；文本只交给嵌入模型。
 * 几个 SQL 都只调函数、不点任何表名：租户表的读写全在函数体里，理由见迁移头注。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { KgEmbeddingQueuePort, KgEmbeddingTarget } from "../../application/knowledge-graph/ports";
import { toOrgId, type OrgId } from "../../domain/org-id";

export class PgKgEmbeddingQueue implements KgEmbeddingQueuePort {
  constructor(private readonly db: DatabasePort) {}

  async pendingOrgs(): Promise<readonly OrgId[]> {
    // 只读 org id（函数不返回任何内容）；每个 org 的取文本 / 写回在它自己的 withTenant 里做。
    const r = await this.db.withoutTenant((s) => s.query<{ org: string }>("SELECT kg_embedding_pending_orgs() AS org"));
    return r.rows.map((x) => toOrgId(x.org));
  }

  async pending(orgId: OrgId, limit: number): Promise<readonly KgEmbeddingTarget[]> {
    const r = await this.db.withTenant(orgId, (s) => s.query<{
      target_kind: "claim" | "object"; target_id: string; content: string; content_md5: string; max_id: string;
    }>("SELECT target_kind, target_id, content, content_md5, max_id::text AS max_id FROM kg_embedding_pending($1)", [limit]));
    return r.rows.map((x) => ({
      targetKind: x.target_kind, targetId: x.target_id, content: x.content, contentMd5: x.content_md5, maxId: x.max_id,
    }));
  }

  async write(
    orgId: OrgId, target: KgEmbeddingTarget, model: { readonly model: string; readonly modelVersion: string }, embedding: readonly number[],
  ): Promise<"written" | "stale"> {
    if (embedding.length === 0 || embedding.some((x) => !Number.isFinite(x))) throw new Error("embedding_unavailable");
    const r = await this.db.withTenant(orgId, (s) => s.query<{ outcome: "written" | "stale" }>(
      "SELECT kg_embedding_write($1, $2, $3, $4, $5, $6, $7::bigint) AS outcome",
      [target.targetKind, target.targetId, model.model, model.modelVersion, target.contentMd5, `[${embedding.join(",")}]`, target.maxId],
    ));
    return r.rows[0]!.outcome;
  }

  async fail(orgId: OrgId, target: KgEmbeddingTarget, code: string): Promise<void> {
    await this.db.withTenant(orgId, (s) => s.query(
      "SELECT kg_embedding_fail($1, $2, $3::bigint, $4)", [target.targetKind, target.targetId, target.maxId, code],
    ));
  }

  async deadCount(): Promise<number> {
    const r = await this.db.withoutTenant((s) => s.query<{ n: string }>("SELECT kg_embedding_dead_count()::text AS n"));
    return Number(r.rows[0]!.n);
  }
}
