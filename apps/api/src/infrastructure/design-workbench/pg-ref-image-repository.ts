/**
 * 迭代 13（design-delta `design-chat-inputs` §1）—— `design_project_ref_images` 的
 * PostgreSQL 适配器（迁移 `20260908150000_uc178_iter13_ref_images.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，没有 `withoutTenant`——同 `pg-design-project-repository.ts`。
 * ⚠ 这里**不带** `owner_id` 谓词：可见性口径跟随所属项目（全组织可读、仅 owner 可改），
 *   而"是不是 owner"已经在用例层 `uploadRefImage` / `deleteRefImage` 取项目时判过了。
 *   在这一层再判一次不是更安全，是把同一条规则声明在两处。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import { designWorkbench } from "@repo/contracts";
import type { RefImageRepository, RefImageRow } from "../../application/design-workbench/ref-images";
import type { DesignRefImageRepositoryFactory } from "../../application/design-workbench/ref-image-ports";

interface RefImageDbRow {
  readonly id: string;
  readonly name: string;
  readonly object_key: string;
  readonly content_type: string;
  readonly size_bytes: string | number;
  readonly created_at: Date | string;
}

/**
 * `content_type` 在库里有 CHECK 约束，但读侧仍然过一遍契约的判定：迁移可以被回滚、
 * 约束可以被后来的迁移放宽，而**读到一个不合法的 mime 会一路传到模型调用那一层**。
 * 读不出来的行跳过而不是整次列表失败——少一张参考图不该让项目打不开。
 */
function toRow(row: RefImageDbRow): RefImageRow | null {
  if (!designWorkbench.isImageMime(row.content_type)) return null;
  return {
    id: row.id,
    name: row.name,
    objectKey: row.object_key,
    mime: row.content_type,
    size: Number(row.size_bytes),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

class ScopedPgRefImageRepository implements RefImageRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  async listByProject(projectId: string): Promise<readonly RefImageRow[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<RefImageDbRow>(
        `SELECT id, name, object_key, content_type, size_bytes, created_at
           FROM design_project_ref_images
          WHERE org_id = $1 AND project_id = $2
          ORDER BY created_at ASC, id ASC`,
        [this.orgId, projectId],
      );
      return rows.map(toRow).filter((r): r is RefImageRow => r !== null);
    });
  }

  async insert(row: RefImageRow & { readonly projectId: string; readonly uploadedBy: string; readonly sha256: string }): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO design_project_ref_images
           (id, org_id, project_id, uploaded_by, name, object_key, content_type, size_bytes, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, this.orgId, row.projectId, row.uploadedBy, row.name, row.objectKey, row.mime, row.size, row.sha256],
      );
    });
  }

  async remove(projectId: string, imageId: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ id: string }>(
        `DELETE FROM design_project_ref_images
          WHERE org_id = $1 AND project_id = $2 AND id = $3 RETURNING id`,
        [this.orgId, projectId, imageId],
      );
      return rows.length > 0;
    });
  }
}

export class PgRefImageRepository implements DesignRefImageRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): RefImageRepository {
    return new ScopedPgRefImageRepository(this.db, orgId);
  }
}
