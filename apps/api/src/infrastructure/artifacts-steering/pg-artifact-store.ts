import { lockArtifactVersions } from "./lock-artifact-versions";
/**
 * `ArtifactStore` 的 PostgreSQL 实现（F09）。表结构见
 * `migrations/20260905000000_f09_agent_artifacts.sql`。
 *
 * `getArtifact`/`listVersions`/`findVersion` 返回 `Guarded<T>`，不是裸行——UC-0.3 R7 /
 * coherence X-1：一条把 Artifact 内容交出去的读路径必须经 `discloseDecided()` 配一个
 * 真实的 `PermissionDecision` 才能拆出来（同 `pg-agent-run-repository.ts` `readRun` 的
 * 既有先例，`guard()` 用的 `ObjectRef` 是 Artifact 所在线程的 project——Artifact 本身
 * 没有独立的 `acl_bindings` 行，可见性判定沿用它所在线程的项目范围）。
 * `createArtifact`/`appendVersion`（写路径）与 `findLocator`（ids-only，判定前的定位，
 * 同 `RunLocator` 先例）不需要：前者不是把内容交给请求方，后者压根没有内容。
 */
import type { artifactsSteering as AS } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  AppendArtifactVersionInput, ArtifactLocator, ArtifactStore, CreateArtifactInput,
} from "../../application/artifacts-steering/ports";

interface ArtifactRow {
  id: string;
  thread_id: string;
  name: string;
  kind: string;
}

interface VersionRow {
  version: number;
  produced_by_run_id: string;
  produced_by_step_id: string;
  change_note: string;
  storage_key: string;
  size_bytes: string; // bigint 经 pg 驱动回来是字符串
  created_at: Date;
  attachment_id?: string | null;
  based_on_version?: number | null;
}

function toVersionInfo(row: VersionRow): AS.ArtifactVersionInfo {
  return {
    version: row.version,
    ...(row.attachment_id ? { attachmentId: row.attachment_id } : {}),
    ...(row.based_on_version ? { basedOnVersion: row.based_on_version } : {}),
    producedByRunId: row.produced_by_run_id,
    producedByStepId: row.produced_by_step_id,
    changeNote: row.change_note,
    storageKey: row.storage_key,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
  };
}

const VERSIONS_BY_ARTIFACT_SQL = `
  SELECT version, produced_by_run_id, produced_by_step_id, change_note, storage_key, size_bytes, created_at, attachment_id, based_on_version
    FROM agent_artifact_versions
   WHERE org_id = $1 AND artifact_id = $2
   ORDER BY version ASC`;

/** `guard()` 的 `ObjectRef` 要用 Artifact 所在线程的 project——查不到（已删除的线程）
 *  时返回 `null`，调用方把它当"这条 Artifact 现在够不上可判定的对象"处理。 */
async function projectIdFor(s: TenantSession, orgId: OrgId, artifactId: string): Promise<string | null> {
  const result = await s.query<{ project_id: string | null; created_by: string }>(
    `SELECT t.project_id,t.created_by
       FROM agent_artifacts a JOIN chat_threads t ON t.id = a.thread_id AND t.org_id = a.org_id
      WHERE a.org_id = $1 AND a.id = $2`,
    [orgId, artifactId],
  );
  const row = result.rows[0];
  return row ? row.project_id ?? `personal:${row.created_by}` : null;
}

export class PgArtifactStore implements ArtifactStore {
  constructor(private readonly db: DatabasePort) {}

  async listByThread(orgId: OrgId, threadId: string): Promise<readonly string[]> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ id: string }>(`SELECT id FROM agent_artifacts WHERE org_id=$1 AND thread_id=$2 ORDER BY created_at,id`, [orgId, threadId]);
      return result.rows.map(row => row.id);
    });
  }

  createArtifact(orgId: OrgId, input: CreateArtifactInput): Promise<AS.ArtifactRecord> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO agent_artifacts (id, org_id, thread_id, name, kind) VALUES ($1,$2,$3,$4,$5)`,
        [input.id, orgId, input.threadId, input.name, input.kind],
      );
      const versionId = `${input.id}-v1`;
      await s.query(
        `INSERT INTO agent_artifact_versions
           (id, org_id, artifact_id, version, produced_by_run_id, produced_by_step_id,
            change_note, storage_key, size_bytes)
         VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8)`,
        [
          versionId, orgId, input.id, input.producedByRunId, input.producedByStepId,
          input.changeNote, input.storageKey, input.sizeBytes,
        ],
      );
      const versions = await s.query<VersionRow>(VERSIONS_BY_ARTIFACT_SQL, [orgId, input.id]);
      return {
        artifactId: input.id,
        threadId: input.threadId,
        name: input.name,
        kind: input.kind,
        versions: versions.rows.map(toVersionInfo),
      };
    });
  }

  appendVersion(orgId: OrgId, input: AppendArtifactVersionInput): Promise<AS.ArtifactVersionInfo> {
    return this.db.withTenant(orgId, async (s) => {
      // 把"读当前最大版本号 + 插入下一个"序列化——两次并发的 continue 完成回调不能都
      // 算出同一个"下一个版本号"（I-2 的并发面）。用事务级 advisory lock 而不是
      // `SELECT ... FOR UPDATE`：后者要求 `app_rw` 有 `UPDATE` 权限，而 `app_rw` 对
      // `agent_artifacts` 只被授予 SELECT/INSERT（迁移文件头注：父行本身也是
      // append-only，运行时角色不应该拿到能触发这条门槛的权限）。advisory lock 只按
      // 会话持有，不依赖表级权限——同 `0001-kernel-roles.sql` 头注里"advisory lock
      // 是数据库范围"的既有先例，这里换成锁在 artifactId 上。
      const exists = await s.query<{ id: string }>(
        `SELECT id FROM agent_artifacts WHERE org_id = $1 AND id = $2`,
        [orgId, input.artifactId],
      );
      if (exists.rows.length === 0) {
        throw new Error(`appendVersion: artifact ${input.artifactId} not found`);
      }
      await lockArtifactVersions(s,orgId,input.artifactId);
      const maxVersion = await s.query<{ max: number | null }>(
        `SELECT MAX(version) AS max FROM agent_artifact_versions WHERE org_id = $1 AND artifact_id = $2`,
        [orgId, input.artifactId],
      );
      const nextVersion = (maxVersion.rows[0]?.max ?? 0) + 1;
      const versionId = `${input.artifactId}-v${nextVersion}`;
      await s.query(
        `INSERT INTO agent_artifact_versions
           (id, org_id, artifact_id, version, produced_by_run_id, produced_by_step_id,
            change_note, storage_key, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          versionId, orgId, input.artifactId, nextVersion, input.producedByRunId,
          input.producedByStepId, input.changeNote, input.storageKey, input.sizeBytes,
        ],
      );
      const inserted = await s.query<VersionRow>(
        `SELECT version, produced_by_run_id, produced_by_step_id, change_note, storage_key, size_bytes, created_at, attachment_id, based_on_version
           FROM agent_artifact_versions WHERE org_id = $1 AND id = $2`,
        [orgId, versionId],
      );
      return toVersionInfo(inserted.rows[0]!);
    });
  }

  getArtifact(orgId: OrgId, artifactId: string): Promise<Guarded<AS.ArtifactRecord> | null> {
    return this.db.withTenant(orgId, async (s) => {
      const artifact = await s.query<ArtifactRow>(
        `SELECT id, thread_id, name, kind FROM agent_artifacts WHERE org_id = $1 AND id = $2`,
        [orgId, artifactId],
      );
      const row = artifact.rows[0];
      if (!row) return null;
      const projectId = await projectIdFor(s, orgId, artifactId);
      if (projectId === null) return null;
      const versions = await s.query<VersionRow>(VERSIONS_BY_ARTIFACT_SQL, [orgId, artifactId]);
      const record: AS.ArtifactRecord = {
        artifactId: row.id,
        threadId: row.thread_id,
        name: row.name,
        kind: row.kind as AS.ArtifactKind,
        versions: versions.rows.map(toVersionInfo),
      };
      return guard({ kind: "project", id: projectId }, record);
    });
  }

  listVersions(
    orgId: OrgId,
    input: AS.ListArtifactVersionsInput,
  ): Promise<Guarded<AS.ListArtifactVersionsOutput>> {
    return this.db.withTenant(orgId, async (s) => {
      // R9：分页。游标是"到此为止已经看过的最大版本号"的字符串编码——版本号单调
      // 递增且从不改写（I-2），拿它当游标不会因为并发追加而错位。
      const afterVersion = input.cursor === null ? 0 : Number(input.cursor);
      const result = await s.query<VersionRow>(
        `SELECT version, produced_by_run_id, produced_by_step_id, change_note, storage_key, size_bytes, created_at, attachment_id, based_on_version
           FROM agent_artifact_versions
          WHERE org_id = $1 AND artifact_id = $2 AND version > $3
          ORDER BY version ASC
          LIMIT $4`,
        [orgId, input.artifactId, afterVersion, input.limit + 1],
      );
      const hasMore = result.rows.length > input.limit;
      const page = hasMore ? result.rows.slice(0, input.limit) : result.rows;
      const nextCursor = hasMore ? String(page[page.length - 1]!.version) : null;
      const projectId = await projectIdFor(s, orgId, input.artifactId);
      const output: AS.ListArtifactVersionsOutput = { versions: page.map(toVersionInfo), nextCursor };
      // `projectId === null`（调用方在可见性判定通过之后、这次查询之前，Artifact 所在
      // 线程被删除——极窄的竞态）时仍然要返回一个 `Guarded`：挂到一个必然判不出的
      // project id 上，`discloseDecided` 会因为找不到匹配的绑定而拒绝，不是抛异常。
      return guard({ kind: "project", id: projectId ?? "" }, output);
    });
  }

  findVersion(
    orgId: OrgId,
    artifactId: string,
    version: number,
  ): Promise<Guarded<AS.ArtifactVersionInfo> | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<VersionRow>(
        `SELECT version, produced_by_run_id, produced_by_step_id, change_note, storage_key, size_bytes, created_at, attachment_id, based_on_version
           FROM agent_artifact_versions WHERE org_id = $1 AND artifact_id = $2 AND version = $3`,
        [orgId, artifactId, version],
      );
      const row = result.rows[0];
      if (!row) return null;
      const projectId = await projectIdFor(s, orgId, artifactId);
      if (projectId === null) return null;
      return guard({ kind: "project", id: projectId }, toVersionInfo(row));
    });
  }

  findLocator(orgId: OrgId, artifactId: string): Promise<ArtifactLocator | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ thread_id: string; project_id: string | null }>(
        `SELECT a.thread_id, t.project_id
           FROM agent_artifacts a JOIN chat_threads t ON t.id = a.thread_id AND t.org_id = a.org_id
          WHERE a.org_id = $1 AND a.id = $2`,
        [orgId, artifactId],
      );
      const row = result.rows[0];
      return row ? { threadId: row.thread_id, projectId: row.project_id } : null;
    });
  }
}
