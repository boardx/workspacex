/**
 * PostgreSQL implementation of `CapabilityRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and the `org_id`
 * predicates are the second.
 *
 * ## Why nothing here returns a plain row
 *
 * `capability_listings` carries tenant data with a per-row visibility scope, so it is a
 * table `lint-permission-paths` requires to be read behind the guard -- and rightly: the
 * admin console is the second-largest read surface in the product, and a repository handing
 * back raw rows makes forgetting to judge them an omission instead of a type error.
 *
 * The scope facts come back OUTSIDE the guard, because they are what the decision is made
 * FROM. Putting them inside would make the decision need the payload it is deciding about.
 *
 * ## Ids are minted here
 *
 * `cap-<uuid>`, never supplied by a caller. The prefix is for the same reason
 * `UuidIdFactory` uses one: these ids appear in `provenance_events.target_id`, where a bare
 * uuid tells a reader nothing about what it names.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CapabilityInsert,
  CapabilityPatch,
  CapabilityRepository,
  GuardedCapability,
} from "../../application/identity/capability-ports";
import { guard } from "../../application/security/permission-filter";
import type { CapabilityKind, CapabilityListing } from "../../domain/identity/capability-listing";
import type { VisibilityScope } from "../../domain/identity/roles";
import { PLATFORM_ORG_ID } from "../../domain/org-id";
import type { OrgId } from "../../domain/org-id";

interface Row {
  id: string;
  org_id: string;
  kind: string;
  name: string;
  scope: string;
  owner_team_id: string | null;
  enabled: boolean;
  endpoint: string | null;
  /** #619 */
  abbr: string | null;
  duty: string | null;
  /** #2514：只有 `LISTING_WITH_ORCHESTRATION` 的读路径会带上；写路径的 RETURNING 没有。 */
  skill_orchestration?: "all-enabled" | "curated" | null;
}

const COLUMNS = "id, org_id, kind, name, scope, owner_team_id, enabled, endpoint, abbr, duty";
/**
 * #2514 —— 读路径把 agent 的 skill 加载规则一并投影出来（契约 `CapabilityListing.
 * skillOrchestration`）：已发布版本钉了 skill ⇒ `curated`，没钉 ⇒ `all-enabled`，
 * 不是 agent / 读不到已发布版本 ⇒ null。规则本身只在 `message-roundtrip.ts` 的
 * `resolveRunSkillVersionIds` 实现，这里只是把「它会走哪条」告诉目录的读者。
 */
const LISTING_WITH_ORCHESTRATION = `
  SELECT cl.id, cl.org_id, cl.kind, cl.name, cl.scope, cl.owner_team_id, cl.enabled,
         cl.endpoint, cl.abbr, cl.duty,
         CASE
           WHEN cl.kind <> 'agent' OR av.id IS NULL THEN NULL
           WHEN cardinality(av.skill_version_ids) > 0 THEN 'curated'
           ELSE 'all-enabled'
         END AS skill_orchestration
    FROM capability_listings cl
    LEFT JOIN agents a ON a.id = cl.id AND a.org_id = cl.org_id
    LEFT JOIN agent_versions av ON av.id = a.published_version_id AND av.org_id = a.org_id`;

function toGuarded(row: Row): GuardedCapability {
  const listing: CapabilityListing = {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind as CapabilityKind,
    name: row.name,
    scope: row.scope as VisibilityScope,
    enabled: row.enabled,
    endpoint: row.endpoint,
    // #619: null for every kind but agent; the CHECK constraint guarantees non-null here
    // for a `kind='agent'` row, so this is a straight passthrough, not a default.
    abbr: row.abbr,
    duty: row.duty,
    // Derived by `projectListingForOrg` in the use case, which is the only place that knows
    // the organization's kind. Null here rather than a guessed string: a reason invented at
    // the storage layer would be a second, unreconciled answer to "why is this row grey".
    disabledReason: null,
    skillOrchestration: row.skill_orchestration ?? null,
  };
  return {
    facts: {
      id: row.id,
      scope: row.scope as VisibilityScope,
      ownerTeamId: row.owner_team_id,
      endpoint: row.endpoint,
    },
    listing: guard({ kind: "capability", id: row.id }, listing),
  };
}

export class PgCapabilityRepository implements CapabilityRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * design-delta `platform-owned-skills` -- every read here also matches rows owned by
   * `PLATFORM_ORG_ID` (the four official Skills' `capability_listings` row), not just the
   * caller's own org. RLS's `capability_listings_platform_read` policy is what actually
   * permits reading them; this `OR` is what makes them show up in results instead of just
   * being technically-readable-but-never-queried. Today only `kind='skill'` rows exist
   * under the platform org, so this has no effect on agents/MCP/other kinds -- it would
   * naturally extend to those too if the platform ever owns one.
   */
  async listByKind(orgId: OrgId, kind: CapabilityKind): Promise<readonly GuardedCapability[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `${LISTING_WITH_ORCHESTRATION}
          WHERE (cl.org_id = $1 OR cl.org_id = $3) AND cl.kind = $2
          ORDER BY cl.name`,
        [orgId, kind, PLATFORM_ORG_ID],
      );
      return r.rows.map(toGuarded);
    });
  }

  async listAll(orgId: OrgId): Promise<readonly GuardedCapability[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `${LISTING_WITH_ORCHESTRATION}
          WHERE cl.org_id = $1 OR cl.org_id = $2
          ORDER BY cl.kind, cl.name`,
        [orgId, PLATFORM_ORG_ID],
      );
      return r.rows.map(toGuarded);
    });
  }

  async findById(orgId: OrgId, id: string): Promise<GuardedCapability | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `${LISTING_WITH_ORCHESTRATION}
          WHERE (cl.org_id = $1 OR cl.org_id = $3) AND cl.id = $2`,
        [orgId, id, PLATFORM_ORG_ID],
      );
      const row = r.rows[0];
      return row ? toGuarded(row) : null;
    });
  }

  async insert(orgId: OrgId, input: CapabilityInsert): Promise<GuardedCapability> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `INSERT INTO capability_listings
           (id, org_id, kind, name, scope, owner_team_id, endpoint, abbr, duty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [
          `cap-${randomUUID()}`, orgId, input.kind, input.name, input.scope,
          input.ownerTeamId, input.endpoint, input.abbr, input.duty,
        ],
      );
      const row = r.rows[0];
      // An INSERT ... RETURNING with no row means the write did not happen; handing back a
      // fabricated listing would tell the admin their configuration was saved.
      if (!row) throw new Error("capability insert returned no row");
      return toGuarded(row);
    });
  }

  async update(orgId: OrgId, id: string, patch: CapabilityPatch): Promise<GuardedCapability | null> {
    return this.db.withTenant(orgId, async (s) => {
      // COALESCE on the parameter, so an absent field keeps its stored value. Building the
      // SET clause from whichever keys are present would put caller-supplied strings into
      // SQL text, which is the one thing this file must never do.
      //
      // ⚠ Consequence, stated rather than hidden: `ownerTeamId: null` cannot be told apart
      // from "not supplied" through this path, so a team-only capability cannot be widened to
      // org-wide by nulling the team alone -- it is done by setting `scope: "org-wide"`, and
      // the CHECK constraint then requires the team to go with it.
      const r = await s.query<Row>(
        `UPDATE capability_listings
            SET name          = COALESCE($3, name),
                scope         = COALESCE($4, scope),
                owner_team_id = CASE WHEN COALESCE($4, scope) = 'org-wide' THEN NULL
                                     ELSE COALESCE($5, owner_team_id) END,
                endpoint      = COALESCE($6, endpoint)
          WHERE org_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
        [orgId, id, patch.name ?? null, patch.scope ?? null, patch.ownerTeamId ?? null, patch.endpoint ?? null],
      );
      const row = r.rows[0];
      return row ? toGuarded(row) : null;
    });
  }

  /**
   * ⚠ 2026-09-03 补——「停用」对模型 A（wave2：`skills`/`skill_versions`）的 skill
   * 此前只是好看的假动作。目录页「停用」调的就是这个方法，它此前只翻
   * `capability_listings.enabled`；但挂载判定（`loadMountableRow`）与目录合并读
   * （`listAll`，`GET /skills` 的一半）走的是完全不同的一张表、认的是
   * `skills.status = 'enabled'`，从 URL/starter-pack 导入落库那一刻起就再也没人
   * 改过它。结果是：管理员点了「停用」，目录页上这一行确实变灰了，但这个 skill
   * 在 chat 的 `#` 挂载里原样能挂、能执行——「停用」这个词对模型 A 的行是假的。
   *
   * 修法：`capability_listings.id` 对 `kind === 'skill'` 的 wave2 行，就是同一个
   * `skills.id`（URL 导入 `pg-skill-url-import-repository.ts`/starter-pack 导入
   * `pg-skill-starter-import-repository.ts` 落库时用的同一个 id，不是巧合）——
   * 在同一次调用里把两张表一起写。对模型 B（`skill_contracts`，没有对应的
   * `skills` 行）或其它 kind（agent/model/…），下面这条 `UPDATE skills` 天然匹配
   * 不到任何行（各自的 id 命名空间不重叠），是安全的空操作，不需要按 kind 分支。
   *
   * `enabled` 目前只会被传 `false`（`mutate-capability.ts` 的 `op: "disable"` 是
   * 唯一调用点，契约上没有 `enable` 这条路——`CapabilityUpdatePayload` 的头注写
   * 明这是刻意的，「停用」是带确认弹窗/中断模式/留痕的一次性动作，不是开关）；
   * 这里仍按 `enabled` 的真实值写 `skills.status`，不是硬编码 `'disabled'`，如果
   * 未来契约真的加了 `enable`，这里不需要跟着改。
   */
  async setEnabled(orgId: OrgId, id: string, enabled: boolean): Promise<GuardedCapability | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `UPDATE capability_listings SET enabled = $3
          WHERE org_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
        [orgId, id, enabled],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      if (row.kind === "skill") {
        await s.query(
          `UPDATE skills SET status = $3, updated_at = now() WHERE org_id = $1 AND id = $2`,
          [orgId, id, enabled ? "enabled" : "disabled"],
        );
      }
      return toGuarded(row);
    });
  }
}
