/**
 * #459 —— 声明式契约 skill 的 PostgreSQL 适配器。
 *
 * 一个类实现四个端口（`SkillDraftStorePort` / `SkillContractReadPort` /
 * `SkillStatusStorePort` / `SkillVisibilityScopePort` / `ReferenceSnapshotStorePort`），
 * 因为它们读写的是同一组表、同一个租户事务。端口**仍然是分开的五个**：
 * 「方法名集合就是结构性证据」那条纪律靠的是 application 层看到的类型，
 * 不是 infrastructure 有几个 class —— 用例只拿得到自己那个端口的方法。
 *
 * ⚠ 每个方法恰好一次 `withTenant`：那一次调用**就是**事务，且它负责
 *   `SET LOCAL app.current_org`（见 `application/ports/database.port.ts` 的理由）。
 *   本文件没有 `withoutTenant` —— 业务仓储用它等于关掉 RLS 后读到「没有数据」而不是报错。
 * ⚠ 每个 WHERE 仍然带 `org_id = $1`，即使 RLS 已经在挡。第二道防线，同既有仓储。
 */
import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { DeclarativeContract } from "../../domain/skill/declarative-contract";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import { isSkillStatus } from "../../domain/skill/skill-status";
import {
  isSkillOriginTag,
  storedSourceWithinContract,
  uncontractedStoredSourceReason,
} from "../../domain/skill/source-tag";
import type { ReferenceSnapshot } from "../../domain/skill/reference-enumeration";
import type { RiskItem, SecurityScanResult } from "../../domain/skill/security-gate";
import type { ReviewerFunctionValue } from "../../domain/skill/review-authorization";
import { guard } from "../../application/security/permission-filter";
import {
  SkillNameConflictError,
  type GuardedSkillContract,
  type GuardedSkillContractDetail,
  type MethodologyReviewStorePort,
  type ReferenceSnapshotStorePort,
  type ReviewerFunctionPort,
  type SecurityScanStorePort,
  type SkillContractDetail,
  type SkillContractReadPort,
  type SkillContractRepositoryFactory,
  type SkillContractRow,
  type SkillDraftStorePort,
  type SkillStatusStorePort,
  type SkillVersionForReview,
  type SkillVersionLifecyclePort,
  type SkillVisibilityScopePort,
} from "../../application/skill/ports";

/**
 * 契约 `SkillVersionState` 的五个取值。⚠ 类型守卫而不是 `as`，理由同 `toRow` 里的
 * `isSkillStatus`：库里的 CHECK 与本域今天一致，但一次迁移就能让它们分岔。
 */
const VERSION_STATES = ["草稿", "待审核", "已生效", "已归档", "待上线"] as const;
function isVersionState(v: string): v is SkillVersionForReview["state"] {
  return (VERSION_STATES as readonly string[]).includes(v);
}

/** 唯一约束冲突。23505 = unique_violation。 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

interface SkillContractDbRow {
  readonly id: string;
  readonly name: string;
  readonly duty: string;
  readonly source: string;
  readonly status: string;
  readonly visibility: string;
  readonly owner_team_id: string | null;
  readonly current_version_id: string | null;
}

/**
 * DB 行 → 端口行。**读侧的唯一收口**：`listAll` / `loadDetail` / `scopeOf` 都过这里。
 *
 * ⚠ `status` 过 `isSkillStatus` 这道类型守卫而不是 `as SkillLifecycleStatus`。
 *   库里的 CHECK 与本域的四态今天一致，但一次迁移就能让它们分岔，
 *   而 `as` 会让分岔在**渲染时**才被发现（或者根本不被发现）。
 *
 * ⚠ #580：`source` 此前是这里**唯一一个裸转型**的列（`row.source as SkillOriginTag`）。
 *   #514 / PR #579 修的是写侧，读侧一行没动，于是库里若已躺着一行契约外的
 *   `source`，它会一路无声地走到 `listSkills.out.parse()` 才炸成一个**匿名 ZodError**
 *   （只说取值非法，不说是哪一行），而且**整份列表一起挂**。
 *   两道守卫因此对称补上，理由与 `status` 完全一样：
 *     ① `isSkillOriginTag`         —— 本域（domain.md 五档）认不认识；
 *     ② `storedSourceWithinContract` —— 本域认识，但契约（三档）收不收（D09）。
 *   ⚠ 两道都**不映射、不跳过**：把「画布」折成「自建」是拿「能过」换「说谎」
 *     （#514 已明确否掉同型做法），悄悄跳过那一行则让脏数据永远不被发现。
 *     fail-closed，且报错**指名 skillId 与取值**——运维拿着它才知道该修哪条数据。
 */
function toRow(row: SkillContractDbRow): SkillContractRow {
  if (!isSkillStatus(row.status)) {
    throw new Error(`skill_contracts.status 存了本域状态机不认识的值：${row.status}（skillId=${row.id}）`);
  }
  if (row.visibility !== "org-wide" && row.visibility !== "team-only") {
    throw new Error(`skill_contracts.visibility 非法：${row.visibility}（skillId=${row.id}）`);
  }
  if (!isSkillOriginTag(row.source)) {
    throw new Error(`skill_contracts.source 存了本域不认识的来源取值：${row.source}（skillId=${row.id}）`);
  }
  if (!storedSourceWithinContract(row.source)) {
    throw new Error(uncontractedStoredSourceReason(row.id, row.source));
  }
  return {
    skillId: row.id,
    name: row.name,
    duty: row.duty,
    source: row.source,
    status: row.status,
    visibility: row.visibility,
    ownerTeamId: row.owner_team_id,
    currentVersionId: row.current_version_id,
  };
}

const ROW_COLUMNS = "id, name, duty, source, status, visibility, owner_team_id, current_version_id";

/**
 * 把一行包成 `Guarded`，`ref.kind` 恒为 `"capability"`。
 *
 * ⚠ **不是** `"project"` / `"artifact"` / `"segment"`：那三种走 `acl_bindings`，
 *   而一个 skill 的可见范围是**它自己行上的一列**（同 F15 的 capability listing）。
 *   传错门道不会静默放行——`permission-filter.ts` 的 `toAclRef` 对
 *   `kind === "capability"` **直接抛错**，逼调用方改用
 *   `decideCapabilityVisibility` + `discloseDecided`。
 *   这正是 coord-main 裁决要的那条正门。
 */
function toGuarded(row: SkillContractRow): GuardedSkillContract {
  return {
    facts: { scope: row.visibility, ownerTeamId: row.ownerTeamId },
    row: guard({ kind: "capability", id: row.skillId }, row),
  };
}

/**
 * 请求级作用域的仓储。
 *
 * ⚠ `orgId` 是**构造参数**，不是可变字段。契约里按 id 直取的操作
 *   （`getSkillDetail` / `disableSkill` / `restoreSkill`）入参没有 `orgId`，
 *   而租户必须来自**已认证的 principal**，不能来自路径参数。把它做成构造参数，
 *   一个「忘了绑定租户」的调用方连对象都构造不出来；做成可变字段的话，
 *   它会读到上一个请求的租户**而且不报错**——那是最难查的一类越权。
 *
 * 由 `PgSkillContractRepository.forOrg()` 产出，见文件末尾。
 */
export class ScopedPgSkillContractRepository
  implements
    SkillDraftStorePort,
    SkillContractReadPort,
    SkillStatusStorePort,
    SkillVisibilityScopePort,
    ReferenceSnapshotStorePort,
    // #552：门禁两道的落库面 ＋ 版本生命周期 ＋ 评审职能解析。同一组表、同一个租户事务。
    SecurityScanStorePort,
    MethodologyReviewStorePort,
    SkillVersionLifecyclePort,
    ReviewerFunctionPort
{
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  /* ─────────────────────── 写：建草稿（SkillDraftStorePort）─────────────────────── */

  async saveDraft(input: {
    readonly orgId: string;
    readonly name: string;
    readonly duty: string;
    readonly contract: DeclarativeContract;
    readonly source: string;
    readonly submitterId: string;
    readonly visibility: "org-wide" | "team-only";
    readonly ownerTeamId: string | null;
    readonly modelRef: string;
  }): Promise<{ readonly skillId: string; readonly versionId: string }> {
    // 端口签名带 `orgId`（它是 `createSkillDraft` 的入参之一），而本实例已经绑定了
    // 一个租户。两者不一致说明调用方在拿 A 的会话往 B 里写——拒绝，不是二选一。
    if (input.orgId !== this.orgId) {
      throw new Error(`saveDraft 的 orgId(${input.orgId}) 与本次请求的租户(${this.orgId}) 不一致`);
    }
    const skillId = `skill-contract-${randomUUID()}`;
    const versionId = `skill-contract-version-${randomUUID()}`;

    try {
      return await this.db.withTenant(toOrgId(input.orgId), async (s) => {
        // 草稿：status = 草稿，且 **current_version_id 为 null** —— 草稿版本不是「生效版本」。
        // 把它填成 v1 会让 `SkillListItem.currentVersionId` 对一个没过门禁的版本非空，
        // 而那个字段的读者（绑定面板 / 挂载面板）拿它去锁版本。
        await s.query(
          `INSERT INTO skill_contracts
             (id, org_id, name, duty, source, status, visibility, owner_team_id,
              current_version_id, archived, created_by)
           VALUES ($1,$2,$3,$4,$5,'草稿',$6,$7,NULL,false,$8)`,
          [
            skillId,
            input.orgId,
            input.name,
            input.duty,
            input.source,
            input.visibility,
            input.ownerTeamId,
            input.submitterId,
          ],
        );

        await s.query(
          `INSERT INTO skill_contract_versions
             (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
              output_schema, data_scope, reads_raw_transcript, fallback_declaration,
              model_ref, content_hash, created_by)
           VALUES ($1,$2,$3,1,'草稿',$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
          [
            versionId,
            input.orgId,
            skillId,
            input.contract.promptTemplate,
            input.contract.inputSchema,
            input.contract.outputSchema,
            JSON.stringify(input.contract.dataScope),
            input.contract.readsRawTranscript,
            input.contract.fallbackDeclaration,
            input.modelRef,
            contentHashOf(input.contract),
            input.submitterId,
          ],
        );

        // 一个 skill 目录（coord-main 裁决 ①）：与定义在**同一个事务**里投影进
        // `capability_listings`，所以界面不可能看到「有定义没目录行」或「目录里有、
        // 定义已回滚」的中间态。`/admin/skill` 读的就是这张表。
        //
        // ⚠ `enabled` 是目录行的可选中性，与本域的 `Skill.status` 不是同一个字段：
        //   草稿**不进可绑定池**，所以它以 `enabled = false` 落目录。
        await s.query(
          `INSERT INTO capability_listings
             (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
           VALUES ($1,$2,'skill',$3,$4,$5,false,NULL)`,
          [skillId, input.orgId, input.name, input.visibility, input.ownerTeamId],
        );

        return { skillId, versionId };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SkillNameConflictError(input.name);
      throw error;
    }
  }

  /* ─────────────────────── 读（SkillContractReadPort）─────────────────────── */

  /**
   * ⚠ 2026-08-07 真实复现（人类实测报告："我在后台不能看到导入了的 skills"）：
   * 这个方法此前只读 `skill_contracts`（声明式契约 skill 的表，#459）——`skill.controller.ts`
   * 的 URL 导入路径（#595/#600）写的是完全不同的另一张表 `skills`/`skill_versions`
   * （wave2 模型，运行时唯一真读的那套，见 `pg-default-agent-repository.ts` 同类注释）。
   * 两套"skill"数据模型互不知道对方存在，是本仓 AGENTS.md 反复提醒的"同一事实声明在
   * 两处"里最新一次——只是这次不是同一张表两份拷贝，是两张完全独立的表服务同一个
   * "组织有哪些 skill"问题。
   *
   * 这里只合并**列表读**，不碰 `skill_contracts` 的草稿/审核/停用生命周期——那套五态
   * 机器（`skill-status.ts`）对 wave2 skill 不适用（wave2 的双重门禁是它自己的，见
   * `skill-review-gate.test.ts`），装作它们共用一套生命周期才是真正的数据漂移风险。
   * 字段映射到既有 `SkillContractRow` 形状时，凡是 wave2 模型没有的概念，选**最接近的
   * 既有取值**而不是发明新枚举值（发明新值要过 `isSkillOriginTag`/`isSkillStatus` 这两道
   * 契约守卫，需要一次真正的契约变更，不是这次要解决的问题范围）：
   *   · `source`："自建"——不是完全准确（真实来源是"URL 导入"），但契约的 `SkillSource`
   *     三值里没有更贴切的选项，且语义上离"由这个组织的人显式添加"最近。
   *   · `status`：wave2 skill 落库即 `status='enabled'`，唯一映射到 `"已启用"`。
   *   · `visibility`：URL 导入不写 `capability_listings`（另一个已知缺口，见
   *     backfill 系列 PR 的"已知限制"），没有可读的可见范围来源，取 `"org-wide"`——
   *     与它们在 `GET /capabilities?kind=skill` 缺席的现状一致（那边同样没有可读来源）。
   *   · `currentVersionId`：`agents` 表有 `published_version_id` 那一列，`skills` 表
   *     没有——wave2 的"当前版本"是 `skill_versions.published=true` 里最新的一条。
   */
  async listAll(orgId: string): Promise<readonly GuardedSkillContract[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const contractRows = await s.query<SkillContractDbRow>(
        `SELECT ${ROW_COLUMNS} FROM skill_contracts WHERE org_id = $1 ORDER BY created_at DESC, id`,
        [orgId],
      );
      const wave2Rows = await s.query<{ id: string; name: string; current_version_id: string | null }>(
        `SELECT sk.id, sk.name,
                (SELECT sv.id FROM skill_versions sv
                  WHERE sv.skill_id = sk.id AND sv.org_id = sk.org_id AND sv.published
                  ORDER BY sv.created_at DESC LIMIT 1) AS current_version_id
           FROM skills sk
          WHERE sk.org_id = $1 AND sk.status = 'enabled'
          ORDER BY sk.created_at DESC, sk.id`,
        [orgId],
      );
      const fromContracts = contractRows.rows.map((raw) => toGuarded(toRow(raw)));
      const fromWave2 = wave2Rows.rows.map((raw) => toGuarded(toRow({
        id: raw.id,
        name: raw.name,
        duty: "从外部 URL 导入的 skill（后台暂不支持在这里编辑详情，见 /admin/skills/:skillId/versions）",
        source: "自建",
        status: "已启用",
        visibility: "org-wide",
        owner_team_id: null,
        current_version_id: raw.current_version_id,
      })));
      return [...fromContracts, ...fromWave2];
    });
  }

  /**
   * ⚠ 取的是**最大版本号**那一版的正文，不是 `current_version_id` 那一版。
   *   草稿期 `current_version_id` 恒为 null（见 `saveDraft`），而 `getSkillDetail.out.contract`
   *   不是 nullable —— 「刚建好的草稿看不到自己刚写的契约正文」会是一个用户当场能撞见的洞。
   *   `currentVersionId` 字段仍然如实返回 null：**能看到正文**与**有生效版本**是两件事。
   */
  async loadDetail(skillId: string): Promise<GuardedSkillContractDetail | null> {
    const orgId = await this.orgOf(skillId);
    if (orgId === null) return null;

    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const skill = await s.query<SkillContractDbRow>(
        `SELECT ${ROW_COLUMNS} FROM skill_contracts WHERE org_id = $1 AND id = $2`,
        [orgId, skillId],
      );
      const row = skill.rows[0];
      if (row === undefined) return null;

      const version = await s.query<{
        id: string;
        prompt_template: string;
        input_schema: string;
        output_schema: string;
        data_scope: unknown;
        reads_raw_transcript: boolean;
        fallback_declaration: string;
      }>(
        `SELECT id, prompt_template, input_schema, output_schema, data_scope,
                reads_raw_transcript, fallback_declaration
           FROM skill_contract_versions
          WHERE org_id = $1 AND skill_id = $2
          ORDER BY version_number DESC
          LIMIT 1`,
        [orgId, skillId],
      );
      const v = version.rows[0];
      if (v === undefined) return null;

      const mapped = toRow(row);
      const detail: SkillContractDetail = {
        row: mapped,
        // ⚠ 与上面那条 `ORDER BY version_number DESC LIMIT 1` 取的是**同一行**：
        //   正文与它的 id 必须来自同一次查询，否则「这份正文是哪一版」会在并发发版时说错。
        bodyVersionId: v.id,
        contract: {
          promptTemplate: v.prompt_template,
          inputSchema: v.input_schema,
          outputSchema: v.output_schema,
          dataScope: Array.isArray(v.data_scope) ? (v.data_scope as string[]) : [],
          readsRawTranscript: v.reads_raw_transcript,
          fallbackDeclaration: v.fallback_declaration,
        },
      };
      return {
        facts: { scope: mapped.visibility, ownerTeamId: mapped.ownerTeamId },
        detail: guard({ kind: "capability", id: mapped.skillId }, detail),
      };
    });
  }

  async statusOf(skillId: string): Promise<SkillLifecycleStatus | null> {
    const orgId = await this.orgOf(skillId);
    if (orgId === null) return null;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{ status: string }>(
        `SELECT status FROM skill_contracts WHERE org_id = $1 AND id = $2`,
        [orgId, skillId],
      );
      const status = result.rows[0]?.status;
      if (status === undefined) return null;
      if (!isSkillStatus(status)) {
        throw new Error(`skill_contracts.status 存了本域状态机不认识的值：${status}（skillId=${skillId}）`);
      }
      return status;
    });
  }

  /* ─────────────────────── 写：状态迁移（SkillStatusStorePort）─────────────────────── */

  /**
   * ⚠ `WHERE status = $from` —— 乐观并发。读到 `from` 与写下去之间状态若已被别人改掉，
   *   这次更新影响 0 行并如实返回 `changed: false`，而不是把别人的写覆盖掉。
   */
  async applyTransition(input: {
    readonly skillId: string;
    readonly from: SkillLifecycleStatus;
    readonly to: SkillLifecycleStatus;
    readonly archived: boolean;
  }): Promise<{ readonly changed: boolean }> {
    const orgId = await this.orgOf(input.skillId);
    if (orgId === null) return { changed: false };

    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const updated = await s.query<{ id: string }>(
        `UPDATE skill_contracts
            SET status = $3, archived = $4, updated_at = now()
          WHERE org_id = $1 AND id = $2 AND status = $5
        RETURNING id`,
        [orgId, input.skillId, input.to, input.archived, input.from],
      );
      if (updated.rows.length === 0) return { changed: false };

      // 目录行跟着走：只有 `已启用` 才是可选中的能力。两处同一事务，不会分岔。
      await s.query(
        `UPDATE capability_listings SET enabled = $3
          WHERE org_id = $1 AND id = $2 AND kind = 'skill'`,
        [orgId, input.skillId, input.to === "已启用"],
      );
      return { changed: true };
    });
  }

  /* ────────────── 可见性范围（SkillVisibilityScopePort）────────────── */

  async scopeOf(
    skillId: string,
  ): Promise<{ readonly visibility: "org-wide" | "team-only"; readonly ownerTeamId: string | null } | null> {
    const detail = await this.loadDetail(skillId);
    if (detail === null) return null;
    // ⚠ 读 `facts` 而不是拆 `Guarded` 的载荷：可见性范围本身就是判定的**输入**，
    //   不是被判定保护的内容（见 `SkillVisibilityFacts` 的注释）。
    return { visibility: detail.facts.scope, ownerTeamId: detail.facts.ownerTeamId };
  }

  /* ────────────── 引用清单快照（ReferenceSnapshotStorePort）────────────── */

  async save(snapshot: ReferenceSnapshot): Promise<void> {
    const orgId = await this.orgOf(snapshot.skillId);
    if (orgId === null) throw new Error(`skill 不存在：${snapshot.skillId}`);
    await this.db.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `INSERT INTO skill_contract_reference_snapshots
           (id, org_id, skill_id, in_flight_projects, template_bindings, agent_mounts, async_task_id)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)`,
        [
          snapshot.referenceSnapshotId,
          orgId,
          snapshot.skillId,
          JSON.stringify(snapshot.inFlightProjects),
          JSON.stringify(snapshot.templateBindings),
          JSON.stringify(snapshot.agentMounts),
          snapshot.asyncTaskId,
        ],
      );
    });
  }

  /**
   * ⚠ 今天这张表**没有生产者**（`listReferences` 被 coord-main 移出 #459），
   *   所以本方法恒返回 `null`，`disableSkill` 因此对每一个调用方
   *   `REFERENCES_NOT_ENUMERATED` —— **fail closed**。
   *   这是 R7「无清单不得停用」的正确行为，不是缺口：清单功能未交付时，
   *   能停用才是缺口。
   */
  async loadLatest(skillId: string): Promise<ReferenceSnapshot | null> {
    const orgId = await this.orgOf(skillId);
    if (orgId === null) return null;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{
        id: string;
        skill_id: string;
        in_flight_projects: unknown;
        template_bindings: unknown;
        agent_mounts: unknown;
        async_task_id: string | null;
      }>(
        `SELECT id, skill_id, in_flight_projects, template_bindings, agent_mounts, async_task_id
           FROM skill_contract_reference_snapshots
          WHERE org_id = $1 AND skill_id = $2
          ORDER BY taken_at DESC
          LIMIT 1`,
        [orgId, skillId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const asArray = (v: unknown): readonly string[] => (Array.isArray(v) ? (v as string[]) : []);
      return {
        referenceSnapshotId: row.id,
        skillId: row.skill_id,
        inFlightProjects: asArray(row.in_flight_projects),
        templateBindings: asArray(row.template_bindings),
        agentMounts: asArray(row.agent_mounts),
        asyncTaskId: row.async_task_id,
      };
    });
  }

  /* ────────── #552 门禁第一道：安全扫描（SecurityScanStorePort）────────── */

  async saveScan(input: {
    readonly scanId: string;
    readonly skillId: string;
    readonly versionId: string;
    readonly result: SecurityScanResult;
    readonly scannedBy: string;
  }): Promise<void> {
    const { orgId } = this;
    await this.db.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `INSERT INTO skill_contract_security_scans
           (id, org_id, skill_id, version_id, verdict, findings, scanned_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          input.scanId,
          orgId,
          input.skillId,
          input.versionId,
          input.result.verdict,
          JSON.stringify(input.result.findings),
          input.scannedBy,
        ],
      );
    });
  }

  /**
   * ⚠ **最新一条**，不是「有没有一条 pass 的」。重扫之后旧结论作废，
   *   而一个 `EXISTS (… verdict='pass')` 的查询会让「先扫一份干净的、再改坏内容重扫」
   *   永远读到那条旧的 pass —— 那正是门禁被绕过的形状。
   */
  async latestScan(versionId: string): Promise<SecurityScanResult | null> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{ verdict: string; findings: unknown }>(
        `SELECT verdict, findings
           FROM skill_contract_security_scans
          WHERE org_id = $1 AND version_id = $2
          ORDER BY scanned_at DESC, id
          LIMIT 1`,
        [orgId, versionId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      if (
        row.verdict !== "pass" &&
        row.verdict !== "risk-pending-confirm" &&
        row.verdict !== "reject"
      ) {
        throw new Error(`skill_contract_security_scans.verdict 非法：${row.verdict}`);
      }
      return {
        verdict: row.verdict,
        findings: Array.isArray(row.findings) ? (row.findings as RiskItem[]) : [],
      };
    });
  }

  /* ────────── #552 门禁第二道：人工审核（MethodologyReviewStorePort）────────── */

  async saveReview(input: {
    readonly reviewRecordId: string;
    readonly skillId: string;
    readonly versionId: string;
    readonly submitterId: string;
    readonly reviewerId: string;
    readonly decision: "approve" | "reject";
    readonly reason: string;
    readonly riskAcks: readonly string[];
  }): Promise<void> {
    const { orgId } = this;
    await this.db.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `INSERT INTO skill_contract_reviews
           (id, org_id, skill_id, version_id, submitter_id, reviewer_id, decision, reason, risk_acks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          input.reviewRecordId,
          orgId,
          input.skillId,
          input.versionId,
          input.submitterId,
          input.reviewerId,
          input.decision,
          input.reason,
          JSON.stringify([...input.riskAcks]),
        ],
      );
    });
  }

  async latestReview(
    versionId: string,
  ): Promise<{ readonly approved: boolean; readonly reviewRecordId: string } | null> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{ id: string; decision: string }>(
        `SELECT id, decision
           FROM skill_contract_reviews
          WHERE org_id = $1 AND version_id = $2
          ORDER BY reviewed_at DESC, id
          LIMIT 1`,
        [orgId, versionId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return { approved: row.decision === "approve", reviewRecordId: row.id };
    });
  }

  /* ────────── #552 版本生命周期（SkillVersionLifecyclePort）────────── */

  async loadVersionForReview(versionId: string): Promise<SkillVersionForReview | null> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{
        id: string;
        skill_id: string;
        version_number: number;
        state: string;
        created_by: string;
        prompt_template: string;
        input_schema: string;
        output_schema: string;
        data_scope: unknown;
        reads_raw_transcript: boolean;
        fallback_declaration: string;
      }>(
        `SELECT id, skill_id, version_number, state, created_by, prompt_template, input_schema,
                output_schema, data_scope, reads_raw_transcript, fallback_declaration
           FROM skill_contract_versions
          WHERE org_id = $1 AND id = $2`,
        [orgId, versionId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      if (!isVersionState(row.state)) {
        throw new Error(`skill_contract_versions.state 非法：${row.state}（versionId=${versionId}）`);
      }
      return {
        versionId: row.id,
        skillId: row.skill_id,
        versionNumber: row.version_number,
        state: row.state,
        // ⚠ 提交人来自**版本行**，不来自请求体。`review-skill-version.ts` 逐字：
        //   「来自版本记录，不是入参可篡改的字段」——否则报一个别人的 id 就能绕过自审拦截。
        submitterId: row.created_by,
        contract: {
          promptTemplate: row.prompt_template,
          inputSchema: row.input_schema,
          outputSchema: row.output_schema,
          dataScope: Array.isArray(row.data_scope) ? (row.data_scope as string[]) : [],
          readsRawTranscript: row.reads_raw_transcript,
          fallbackDeclaration: row.fallback_declaration,
        },
      };
    });
  }

  async markVersionSubmitted(versionId: string): Promise<{ readonly changed: boolean }> {
    return this.moveVersionState(versionId, "草稿", "待审核");
  }

  async returnVersionToDraft(versionId: string): Promise<{ readonly changed: boolean }> {
    return this.moveVersionState(versionId, "待审核", "草稿");
  }

  /**
   * approve 落库：版本置 `已生效` **并且**把该 skill 的当前生效版本指向它。
   *
   * ⚠ 两条 UPDATE 在**同一个** `withTenant`（即同一个事务）里。分成两次调用会产生一个
   *   「已生效但不是当前版本」的中间态，而挂载正是在那一刻读 `current_version_id`：
   *   `skill-mount.controller.ts` 对 `currentVersionId === null` 折成 `SKILL_NOT_FOUND`，
   *   于是一个刚刚被批准的 skill 会以「不存在」的样子挂不上去。
   */
  async releaseVersion(versionId: string): Promise<{ readonly changed: boolean }> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const updated = await s.query<{ skill_id: string }>(
        `UPDATE skill_contract_versions
            SET state = '已生效'
          WHERE org_id = $1 AND id = $2 AND state = '待审核'
        RETURNING skill_id`,
        [orgId, versionId],
      );
      const skillId = updated.rows[0]?.skill_id;
      if (skillId === undefined) return { changed: false };

      await s.query(
        `UPDATE skill_contracts
            SET current_version_id = $3, updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [orgId, skillId, versionId],
      );
      return { changed: true };
    });
  }

  /* ────────── #552 评审职能（ReviewerFunctionPort）────────── */

  async functionOf(principalId: string): Promise<ReviewerFunctionValue | null> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{ reviewer_function: string }>(
        `SELECT reviewer_function FROM skill_reviewer_functions
          WHERE org_id = $1 AND principal_id = $2`,
        [orgId, principalId],
      );
      const value = result.rows[0]?.reviewer_function;
      if (value === undefined) return null;
      if (value !== "methodology-reviewer" && value !== "security-reviewer") {
        throw new Error(`skill_reviewer_functions.reviewer_function 非法：${value}`);
      }
      return value;
    });
  }

  /**
   * ⚠ 只问「**存不存在**至少一名」，不列名单：`NO_SECOND_REVIEWER` 的判据只需要这一个
   *   布尔值（`ports.ts` 逐字），而一份名单会让调用方顺手把它显示出来 ——
   *   「谁能审我」在组织里不是给提交人看的信息。
   */
  async anotherMethodologyReviewerExists(
    orgId: string,
    excludePrincipalId: string,
  ): Promise<boolean> {
    if (orgId !== this.orgId) {
      throw new Error(
        `anotherMethodologyReviewerExists 的 orgId(${orgId}) 与本次请求的租户(${this.orgId}) 不一致`,
      );
    }
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const result = await s.query<{ one: number }>(
        `SELECT 1 AS one FROM skill_reviewer_functions
          WHERE org_id = $1 AND principal_id <> $2 AND reviewer_function = 'methodology-reviewer'
          LIMIT 1`,
        [orgId, excludePrincipalId],
      );
      return result.rows.length > 0;
    });
  }

  /* ─────────────────────────── 内部 ─────────────────────────── */

  /**
   * 版本状态迁移。⚠ `WHERE state = $from` —— 与 `applyTransition` 同一条乐观并发纪律：
   *   读到的状态与写下去时的状态不一致时影响 0 行，而不是覆盖别人刚写的状态。
   */
  private async moveVersionState(
    versionId: string,
    from: string,
    to: string,
  ): Promise<{ readonly changed: boolean }> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const updated = await s.query<{ id: string }>(
        `UPDATE skill_contract_versions
            SET state = $4
          WHERE org_id = $1 AND id = $2 AND state = $3
        RETURNING id`,
        [orgId, versionId, from, to],
      );
      return { changed: updated.rows.length > 0 };
    });
  }


  /**
   * 「这个 id 在**本租户**里存在吗」。
   *
   * ⚠ 不用 `withoutTenant` 反查归属：那会绕过 RLS，把跨租户的 id 也查出来。
   *   这里只在已绑定的租户里查，别的租户的 skillId 在这一步就读不到，
   *   由调用方折成 `SKILL_NOT_FOUND`（404 而非 403 —— I-14：范围外不返回其存在性）。
   */
  private async orgOf(skillId: string): Promise<string | null> {
    const { orgId } = this;
    return this.db.withTenant(toOrgId(orgId), async (s: TenantSession) => {
      const result = await s.query<{ org_id: string }>(
        `SELECT org_id FROM skill_contracts WHERE org_id = $1 AND id = $2`,
        [orgId, skillId],
      );
      return result.rows[0]?.org_id ?? null;
    });
  }
}

/**
 * 单例 provider。**本身不实现任何端口** —— 它只能产出绑定了租户的仓储。
 *
 * ⚠ 这是刻意的：如果它自己也实现端口，就存在一个「没有租户的仓储」，
 *   而那正是需要被结构性排除掉的东西。
 */
export class PgSkillContractRepository implements SkillContractRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): ScopedPgSkillContractRepository {
    return new ScopedPgSkillContractRepository(this.db, orgId);
  }
}

/**
 * 声明正文的内容哈希（I-6 的版本身份）。
 *
 * ⚠ 字段顺序固定并逐个显式列出，**不是** `JSON.stringify(contract)` —— 后者的输出
 *   取决于对象字面量的键序，同一份契约经过一次无关重构就会换一个 hash。
 */
export function contentHashOf(contract: DeclarativeContract): string {
  const canonical = JSON.stringify([
    contract.promptTemplate,
    contract.inputSchema,
    contract.outputSchema,
    [...contract.dataScope].sort(),
    contract.readsRawTranscript,
    contract.fallbackDeclaration,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
