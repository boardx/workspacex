/**
 * #459 —— 声明式契约 skill 的 HTTP 边界。
 *
 * 暴露本波次收窄后的四条路径，**全部**取自 `packages/contracts/src/skills.ts`
 * 的 `operations`，路径与方法不手写字符串（ADR-020）：
 *
 *   · `createSkillDraft`  POST /skills
 *   · `listSkills`        GET  /skills
 *   · `getSkillDetail`    GET  /skills/:skillId
 *   · `disableSkill`      POST /skills/:skillId/disable
 *
 * ## ⚠ 这里刻意**没有**的路由
 *
 * `SKILLS_FORBIDDEN_ROUTES`（契约 :336）逐字禁止 `POST /skills/:skillId/enable`，
 * 理由是「一条直达的启用路由**就是那条绕过路径本身**」。本文件因此没有任何
 * 把 `status` 置为 `已启用` 的入口；`已启用` 只能由 `reviewSkillVersion` 的
 * approve 分支产生（`domain/skill/security-gate.ts:144`），而那条用例
 * **不在 #459 范围内**——所以本波次交付的 skill 只能停在 `草稿`。
 * 这不是半成品，是门禁本来就该有的形状：没有第二个评审人，就没有 `已启用`。
 *
 * ## 出参一律过契约的 `out`
 *
 * 用 `.parse()` 而不是直接返回对象。契约的 `out` 都是 `.strict()` 的，
 * 所以多出来的键会**抛错**而不是被静默剥掉（zod 默认剥未知键——#19 记过这个坑）。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { skills as C } from "@repo/contracts";
import { createSkillDraft } from "../../application/skill/create-skill-draft";
import { listSkills } from "../../application/skill/list-skills";
import { checkSkillVisible } from "../../application/skill/get-skill-detail";
import { disableSkill } from "../../application/skill/disable-skill";
import {
  SKILL_CONTRACT_REPOSITORY,
  SKILL_SECURITY_AUDIT,
  SKILL_SUBMITTER_GRANTS,
  SkillNameConflictError,
  type SecurityAuditPort,
  type SkillContractRepositoryFactory,
  type SkillContractRow,
  type SubmitterGrantsPort,
} from "../../application/skill/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type CreateBody = {
  readonly orgId: string;
  readonly name: string;
  readonly duty: string;
  readonly contract: {
    readonly promptTemplate: string;
    readonly inputSchema: string;
    readonly outputSchema: string;
    readonly dataScope: string[];
    readonly readsRawTranscript: boolean;
    readonly fallbackDeclaration: string;
  };
  readonly visibility: "org-wide" | "team-only";
  readonly modelRef: string;
};

type DisableBody = {
  readonly skillId: string;
  readonly referenceSnapshotId: string;
  readonly mode: "interrupt" | "drain";
  readonly archive: boolean;
  readonly replacementSkillId: string | null;
};

/**
 * `SkillListItem` 里两个**今天恒为 null / 恒缺样本**的字段，集中在一个地方解释，
 * 免得三处路由各写一遍「这里为什么是 null」。
 *
 * · `satisfaction`：👍/👎 评价（F68 `rateMessage`）不在 #459 范围内，
 *   所以任何 skill 的样本量都是 0。契约写死了 `null ⟺ 样本不足`，且逐字要求
 *   「**不得为了填满界面而给一个 0%**」——返回 null 是遵守契约，不是缺口。
 */
const SATISFACTION_SAMPLE_INSUFFICIENT = null;

function toListItem(row: SkillContractRow) {
  return {
    skillId: row.skillId,
    name: row.name,
    duty: row.duty,
    source: row.source,
    status: row.status,
    visibility: row.visibility,
    currentVersionId: row.currentVersionId,
    satisfaction: SATISFACTION_SAMPLE_INSUFFICIENT,
  };
}

@Controller()
export class SkillController {
  constructor(
    @Inject(SKILL_CONTRACT_REPOSITORY) private readonly repositories: SkillContractRepositoryFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_SUBMITTER_GRANTS) private readonly grants: SubmitterGrantsPort,
    @Inject(SKILL_SECURITY_AUDIT) private readonly audit: SecurityAuditPort,
  ) {}

  /* ─────────────────────── POST /skills ─────────────────────── */

  @Post("/skills")
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.createSkillDraft.in)) body: CreateBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    this.assertOwnTenant(principal, body.orgId);

    const repository = this.repositories.forOrg(principal.orgId);
    const membership = await this.identities.findOrgMembership(
      principal.userId,
      toOrgId(principal.orgId),
    );

    const created = await this.rejectNameConflict(() =>
      createSkillDraft(
      {
        orgId: body.orgId,
        submitterId: principal.userId,
        name: body.name,
        duty: body.duty,
        contract: body.contract,
        // ⚠ 入口，不是「调用方声称的来源」。本路由就是「自建」那个入口，
        //   `source` 由 `assignSourceByEntry` 打标；调用方写它 ⇒ `SOURCE_TAG_IMMUTABLE`。
        entry: "admin-new",
        visibility: body.visibility,
        // `team-only` 归属发起人当前所在团队。契约的入参里没有 `ownerTeamId`，
        // 而 `SkillListItem.visibility = team-only` 必须有归属团队才有意义。
        ownerTeamId: body.visibility === "team-only" ? (membership?.teamId ?? null) : null,
        modelRef: body.modelRef,
        // ⚠ 未经契约解析的原始请求体：`createSkillDraft.in` 是 `.strict()` 的，
        //   解析后永远看不到 `source`，所以「有人试图写 source」只在这一层可见。
        rawBody: body as unknown,
      },
      { grants: this.grants, store: repository, audit: this.audit },
      ),
    );

    if (!created.ok) throw this.toHttpError(created.code);

    response.status(HttpStatus.CREATED);
    return C.operations.createSkillDraft.out.parse({
      skillId: created.skillId,
      versionId: created.versionId,
      source: created.source,
      status: created.status,
    });
  }

  /* ─────────────────────── GET /skills ─────────────────────── */

  @Get("/skills")
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, string>) {
    assertPrincipal(principal);

    // 契约的 `in` 里 `source`/`status`/`visibility`/`q` 是 `.nullable()`，不是
    // `.optional()`：缺省必须显式折成 `null`。查询串里「没写」与「写了空串」
    // 是两件事，前者是 null，后者会被下面的 schema 判成非法枚举值——刻意不做兼容。
    const input = C.operations.listSkills.in.parse({
      orgId: query.orgId ?? principal.orgId,
      entry: query.entry ?? "library",
      source: query.source ?? null,
      status: query.status ?? null,
      visibility: query.visibility ?? null,
      q: query.q ?? null,
    });
    this.assertOwnTenant(principal, input.orgId);

    const repository = this.repositories.forOrg(principal.orgId);
    const membership = await this.identities.findOrgMembership(
      principal.userId,
      toOrgId(principal.orgId),
    );
    const all = await repository.listAll(input.orgId);
    const byId = new Map(all.map((row) => [row.skillId, row]));

    // 可见性过滤只走 `list-skills.ts` 那一条判定（I-14：四入口共用同一份）。
    // 本 controller **不自己写过滤**——那就是同一事实的第二份声明。
    const visible = await listSkills(
      { orgId: input.orgId, entry: input.entry, requesterTeamId: membership?.teamId ?? null },
      { catalog: { listAll: async () => all } },
    );

    const items = visible.items
      .map((entry) => byId.get(entry.skillId))
      .filter((row): row is SkillContractRow => row !== undefined)
      .filter((row) => input.source === null || row.source === input.source)
      .filter((row) => input.status === null || row.status === input.status)
      .filter((row) => input.visibility === null || row.visibility === input.visibility)
      .filter((row) => input.q === null || matchesQuery(row, input.q))
      .map(toListItem);

    // ⚠ 空结果就是 `[]`（A1/V10：前端渲染真实空态，**不生成示例 skill**）。
    return C.operations.listSkills.out.parse({ items, total: items.length });
  }

  /* ─────────────────── GET /skills/:skillId ─────────────────── */

  @Get("/skills/:skillId")
  async detail(@CurrentPrincipal() principal: Principal, @Param("skillId") skillId: string) {
    assertPrincipal(principal);
    const repository = this.repositories.forOrg(principal.orgId);
    const membership = await this.identities.findOrgMembership(
      principal.userId,
      toOrgId(principal.orgId),
    );

    // ⚠ 先判可见性，再取数。`checkSkillVisible` 把「不存在」与「存在但范围外」
    //   折成同一个 `SKILL_NOT_FOUND`（404 而非 403，I-14：范围外不返回其存在性）。
    const allowed = await checkSkillVisible(
      { skillId, requesterTeamId: membership?.teamId ?? null },
      { scope: repository },
    );
    if (!allowed.visible) throw new NotFoundException({ reasonCode: allowed.code });

    const detail = await repository.loadDetail(skillId);
    if (detail === null) throw new NotFoundException({ reasonCode: "SKILL_NOT_FOUND" });

    return C.operations.getSkillDetail.out.parse({
      skill: toListItem(detail.row),
      currentVersionId: detail.row.currentVersionId,
      contract: detail.contract,
      // ⚠ `null` 是**真实空态**（还没跑过），不是失败——契约 :501 逐字。
      //   `runTrialRun` 不在 #459 范围内，所以今天恒为 null。
      latestTrialRun: null,
      gateResults: {
        // 两道门禁（`runSecurityScan` / `reviewSkillVersion`）都不在 #459 范围内。
        // `null` = 还没扫过；`false` = 方法论审核未通过。草稿本来就两道都没过。
        securityScan: null,
        methodologyReviewPassed: false,
      },
      satisfaction: SATISFACTION_SAMPLE_INSUFFICIENT,
      promotionKnowledgeItemId: null,
    });
  }

  /* ─────────────── POST /skills/:skillId/disable ─────────────── */

  /**
   * ⚠ 本波次这条路由**必然拒绝**，而那是正确行为，不是未完成：
   *
   *   ① R7「无清单不得停用」：`referenceSnapshotId` 必须是该 skill **最新一次**
   *      `listReferences` 的产出。`listReferences` 被 coord-main 移出 #459，
   *      没有生产者 ⇒ 没有任何快照是新鲜的 ⇒ `REFERENCES_NOT_ENUMERATED`。
   *   ② 即便清单存在：本波次能造出来的 skill 只有 `草稿`，而状态机里
   *      **没有 `草稿 → 已停用` 这条边**（`skill-status.ts` 的 `TRANSITIONS`），
   *      于是 `SKILL_VERSION_CHANGED`。
   *
   * 两条都**不改库里的状态**——这正是要断言的性质。
   */
  @Post("/skills/:skillId/disable")
  async disable(
    @CurrentPrincipal() principal: Principal,
    @Param("skillId") skillId: string,
    @Body(new ZodBodyPipe(C.operations.disableSkill.in)) body: DisableBody,
  ) {
    assertPrincipal(principal);
    const repository = this.repositories.forOrg(principal.orgId);

    // 状态机的 `from` 来自库，不来自调用方的假设（#459 修的就是这一处）。
    const currentStatus = await repository.statusOf(skillId);
    if (currentStatus === null) throw new NotFoundException({ reasonCode: "SKILL_NOT_FOUND" });

    const result = await disableSkill(
      {
        skillId,
        principalId: principal.userId,
        referenceSnapshotId: body.referenceSnapshotId,
        mode: body.mode,
        archive: body.archive,
        replacementSkillId: body.replacementSkillId,
        currentStatus,
      },
      { snapshots: repository, audit: this.audit },
    );

    if (!result.ok) throw this.toHttpError(result.code);

    // 只有用例放行后才落库，且带 `from` 做乐观并发。
    const applied = await repository.applyTransition({
      skillId,
      from: currentStatus,
      to: "已停用",
      archived: result.archived,
    });
    if (!applied.changed) throw new ConflictException({ reasonCode: "SKILL_VERSION_CHANGED" });

    return C.operations.disableSkill.out.parse({ status: result.status, archived: result.archived });
  }

  /* ─────────────────────────── 内部 ─────────────────────────── */

  /**
   * 租户来自**已认证的 principal**，不来自请求体。
   *
   * ⚠ 契约的 `createSkillDraft.in` / `listSkills.in` 都带 `orgId`，所以它是必填的；
   *   但它**不是**权限来源。两者不一致时拒绝（`PERMISSION_REVOKED`），
   *   而不是「以 principal 为准、悄悄忽略请求体里的那个」——后者会让调用方
   *   以为自己在读 B 组织，实际读到 A 组织的数据，且没有任何地方看得出来。
   */
  private assertOwnTenant(principal: Principal, orgId: string): void {
    if (orgId !== principal.orgId) {
      throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
    }
  }

  /**
   * 重名 ⇒ 409。
   *
   * ⚠ 这个 `reasonCode` **不在契约的 `SkillError` 闭集里**（那是已上报的缺口），
   *   所以 `all-exceptions.filter.ts` 的白名单会把它剥掉，前端只看到 409。
   *   这是**对的**：那道 `safeParse` 就是防枚举探测的门，为了让一个自造的码穿过去
   *   而放宽它，等于为一个缺口拆掉一道安全设施。409 + 服务端日志足够定位，
   *   等契约补码后这里换成那个码即可。
   */
  private async rejectNameConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SkillNameConflictError) {
        throw new ConflictException({ reasonCode: "SKILL_NAME_CONFLICT" });
      }
      throw error;
    }
  }

  private toHttpError(code: string): Error {
    switch (code) {
      case "SKILL_NOT_FOUND":
        return new NotFoundException({ reasonCode: code });
      case "PERMISSION_REVOKED":
      case "DATA_SCOPE_EXCEEDS_SUBMITTER":
      case "RAW_TRANSCRIPT_NOT_AUTHORIZED":
      case "SOURCE_TAG_IMMUTABLE":
      case "GATE_NOT_PASSED":
        return new ForbiddenException({ reasonCode: code });
      case "SKILL_VERSION_CHANGED":
        return new ConflictException({ reasonCode: code });
      default:
        // `CONTRACT_VALIDATION_FAILED` / `REFERENCES_NOT_ENUMERATED` /
        // `MODEL_UNAVAILABLE` / `DEPENDENCY_UNAVAILABLE` …
        return new UnprocessableEntityException({ reasonCode: code });
    }
  }
}

/** `q` 的匹配面：名称与职责。⚠ 不搜契约正文——那会把未过门禁的提示词泄露进搜索结果。 */
function matchesQuery(row: SkillContractRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  return (
    row.name.toLowerCase().includes(needle) || row.duty.toLowerCase().includes(needle)
  );
}

