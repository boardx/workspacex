/**
 * #459 —— 声明式契约 skill 的 HTTP 边界。
 *
 * 暴露本波次收窄后的四条路径，**全部**取自 `packages/contracts/src/skills.ts`
 * 的 `operations`，路径与方法不手写字符串（ADR-020）：
 *
 *   · `createSkillDraft`  POST /skills                 ⚠ F192 起冻结，恒 410（见下方 `create`）
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
  GoneException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { skills as C } from "@repo/contracts";
import { listSkills } from "../../application/skill/list-skills";
import { disableSkill } from "../../application/skill/disable-skill";
import { decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import { decide } from "../../domain/identity/permission-decision";
import type { OrgMembershipRow } from "../../application/identity/ports";
import { discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import {
  SKILL_CONTRACT_REPOSITORY,
  SKILL_SECURITY_AUDIT,
  type SecurityAuditPort,
  type SkillContractRepositoryFactory,
  type SkillContractRow,
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
    tags: row.tags,
  };
}

/**
 * 唯一还在的写路由被判定时记录的 action 串（`disable`——`create` 已冻结为无条件
 * 410，不再走成员资格判定，见下方 `SKILL_CREATE_ACTION` 移除说明）。
 *
 * skill 是组织级资产，没有项目上下文 ⇒ `decide()` 的项目层整层不适用（I-11），
 * 于是它**不会**去查这个串。传它是为了让判定记录下「当时在试图做什么」——
 * 一条 action 为空的判定，事后没人解释得了。同 `CAPABILITY_READ_ACTION` 的理由。
 */
const SKILL_DISABLE_ACTION = "skill.disable";

@Controller()
export class SkillController {
  constructor(
    @Inject(SKILL_CONTRACT_REPOSITORY) private readonly repositories: SkillContractRepositoryFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_SECURITY_AUDIT) private readonly audit: SecurityAuditPort,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  /* ─────────────────────── POST /skills（冻结，F192）─────────────────── */

  /**
   * F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，已签核）——
   * 写入口冻结：对**任何**请求都返回 `410 Gone`，不再落库、不再判成员资格/数据范围。
   *
   * ⚠ 不接 `@Body(new ZodBodyPipe(...))`：那道校验会先对畸形请求体判 400，
   *   与「唯一入口被摘」这个性质不符——冻结必须是**无条件**的，不是「先校验、
   *   合法的那些才 410」。任何请求，无论 body 长什么样，都恒 410。
   * ⚠ 不是裸 404/500，也不静默 200：响应体带 `reasonCode` 与指向模型 A 编辑器
   *   工作流的引导信息，见 `SKILLS_FROZEN_ROUTES`（契约）与
   *   `tests/skill/post-skills-gone-410.test.ts`（真栈反证）。
   */
  @Post("/skills")
  create(): never {
    throw new GoneException({
      reasonCode: "SKILL_DRAFT_WRITE_PATH_FROZEN",
      message:
        "模型 B（声明式契约）的新建入口已冻结（F192：design-delta " +
        "skill-model-a-b-convergence 选项②）。模型 B 建出来的 skill 运行时读不到、" +
        "chat 里挂不上，是一条功能性死路。新建 skill 请改走模型 A 的编辑器工作流：" +
        "从 GitHub URL 导入（POST /admin/skills/url-imports）、上传文件，或从 " +
        "starter-pack 起步后用文件编辑器补内容。存量模型 B 数据不受影响，仍可经 " +
        "GET /skills 与 GET /skills/:skillId 只读查看。",
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

    // 可见性判定只走 `list-skills.ts` 那一条（I-14：四入口共用同一份），而它
    // 现在产出的是 `PermissionDecision`，载荷只能经 `discloseDecided` 取出。
    // 本 controller **不自己写过滤**——那就是同一事实的第二份声明。
    const visible = await listSkills(
      {
        orgId: input.orgId,
        entry: input.entry,
        requesterTeamId: membership?.teamId ?? null,
        orgRole: membership?.orgRole ?? null,
      },
      { catalog: repository, nextDecisionId: () => this.ids.next() },
    );

    const items = visible.items
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

    const guarded = await repository.loadDetail(skillId);
    if (guarded === null) throw new NotFoundException({ reasonCode: "SKILL_NOT_FOUND" });

    // ⚠ 「不存在」与「存在但范围外」折成**同一个** 404（I-14：范围外不返回其存在性）。
    //   载荷在判定之前取不出来——忘了判定是类型错误，不是疏漏。
    const disclosed = discloseDecided(
      guarded.detail,
      decideCapabilityVisibility({
        decisionId: this.ids.next(),
        orgRole: membership?.orgRole ?? null,
        requesterTeamId: membership?.teamId ?? null,
        scope: guarded.facts.scope,
        ownerTeamId: guarded.facts.ownerTeamId,
      }),
    );
    if (!isDisclosed(disclosed)) throw new NotFoundException({ reasonCode: "SKILL_NOT_FOUND" });
    const detail = disclosed.payload;

    // #552：两道门禁现在**有真实记录**（`skill_contract_security_scans` /
    // `skill_contract_reviews`），所以下面不再硬编码 `null` / `false`。
    const scan = await repository.latestScan(detail.bodyVersionId);
    const review = await repository.latestReview(detail.bodyVersionId);

    return C.operations.getSkillDetail.out.parse({
      skill: toListItem(detail.row),
      /**
       * ⚠ **本响应正文所属的那一版**，不是 `skill.currentVersionId`（＝生效版本，草稿期 null）。
       *
       * 契约把 `currentVersionId` 同时放在这里和 `SkillListItem` 里；两处返回同一个值
       * 就是本仓九次漂移的那个形状（同一事实声明两遍），而两个**不同的**事实各占一处
       * 才讲得通。#459 自己的注释已经指出这份不一致：正文取的是最大版本号那一版，
       * 而 `currentVersionId` 如实返回 null ——「能看到正文」与「有生效版本」是两件事。
       *
       * ⚠ 这条读法是 #552 让评审链在界面上**开得了头**的唯一取数口：三条门禁路径都挂在
       *   `/skill-versions/:versionId/…`，草稿没有生效版本，前端否则拿不到任何 versionId。
       *   新增一条契约外的「查最新版本 id」路由会违背 ADR-020。**已在 PR 里请签核人复看。**
       */
      currentVersionId: detail.bodyVersionId,
      contract: detail.contract,
      // ⚠ `null` 是**真实空态**（还没跑过），不是失败——契约 :501 逐字。
      //   `runTrialRun` 仍然没有 HTTP 边界（不在 #552 范围内），所以今天恒为 null。
      latestTrialRun: null,
      gateResults: {
        // `null` = **从未扫过**，不是「扫过没过」——两者必须可分辨（`security-gate.ts` 逐字）。
        securityScan: scan?.verdict ?? null,
        // `false` 同时覆盖「还没人审」与「审了没过」：契约这里只有一个 boolean，
        // 而**两者的区分活在 `skill_contract_reviews` 里**（有没有那一行）。
        // 界面要区分时读的是那张表，不是把这个 boolean 掰成三态——那会变成第二份事实。
        methodologyReviewPassed: review?.approved ?? false,
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

    // ⚠ 成员资格排在**存在性检查之前**（#532）：先 404 再判授权，会把
    //   「这个 org 里有没有这条 skill」漏给已被移出组织的人（I-14 同判）。
    //   也必须排在状态机之前——今天 R7 / `草稿 → 已停用` 必然拒绝，但那道拒绝
    //   来自状态机而不是授权，评审路径一落地就没得兜了。
    this.assertOrgMembership(
      await this.identities.findOrgMembership(principal.userId, toOrgId(principal.orgId)),
      SKILL_DISABLE_ACTION,
    );

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
   * 组织**成员资格**门 —— 唯一还在的写路由（`POST /skills/:id/disable`）的准入。
   *
   * ⚠ F192 之前这道门同时守着 `create`（`POST /skills`）与 `disable`；`create`
   *   现在无条件 410（见上方 `create` 方法的长注），不再走这道门——本注释保留
   *   #532 反证的历史事实（当年 `create` 缺这道门时的真实测出结果），但**今天**
   *   只有 `disable` 会调用 `assertOrgMembership`。
   *
   * ## 为什么它必须单独存在（#532）
   *
   * `assertOwnTenant` 只比 `body.orgId === principal.orgId`——那是**租户**校验：
   * 它答的是「你在说哪个组织」，不是「你还在不在这个组织里」。一个被移出组织、
   * 但会话还在手上的人，两者是一致的，于是一路畅通。实测（#532 反证，PR 正文有输出）：
   * 删掉 `org_memberships` 那行之后（F192 之前的）`POST /skills` 返回 **201 + 真实 skillId**。
   *
   * `disable` 此前连成员资格都没取。
   *
   * ## 为什么走 `decide()` 而不是在这里写 `membership === null`
   *
   * 那一行是三个字符，写在这里就是同一事实的第三份声明（读路径已经有
   * `decideCapabilityVisibility` → `decide()` 这一条）。「不是本组织成员」这个判断
   * 只应该有一处产出，且产出的必须是带 `reasonCode: NO_ORG_MEMBERSHIP` 的
   * `PermissionDecision`，而不是一个裸 boolean——后者事后无法解释是哪一层关的门。
   *
   * `project: null`：skill 是组织级资产，没有项目上下文，项目层整层不适用（I-11）。
   * `scope: org-wide`：这道门只判**成员资格**。写操作的可见性/归属团队判定是另一件事，
   * 由各自的用例负责——把它们混进来会让这道门在 `team-only` 上悄悄放宽或收紧。
   *
   * ⚠ 对外统一 `PERMISSION_REVOKED`（403）。`NO_ORG_MEMBERSHIP` 是**内部**判定码，
   *   `disableSkill` 的契约 `err` 闭集里只有 `PERMISSION_REVOKED`
   *   （`packages/contracts/src/skills.ts`），`all-exceptions.filter.ts` 的白名单
   *   也会把闭集外的码剥掉。
   */
  private assertOrgMembership(membership: OrgMembershipRow | null, action: string): void {
    const decision = decide({
      decisionId: this.ids.next(),
      action,
      org: { role: membership?.orgRole ?? null, teamId: membership?.teamId ?? null },
      project: null,
      scope: { scope: "org-wide", ownerTeamId: null },
    });
    if (!decision.allowed) throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
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

