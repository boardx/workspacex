/**
 * #552 —— **双重门禁的 HTTP 边界**。
 *
 * 在这个文件之前，`advanceSkillStatus` / `reviewSkillVersion` / `releaseSkillVersion`
 * 在 interface 层的引用数都是 **0**：三个用例有完整实现与单测，**没有任何路由到得了它们**。
 * 后果不是「少了个接口」，而是 `mountSkillToThread` 硬要求 `entry.status === "已启用"`
 * 而全系统造不出一个 `已启用` —— 用户自己新建的 skill，用户自己用不了。
 * `fullstack-smoke-fixture.ts` 里 `mountableSkillId` 那段注释就是这个缺口的现场记录。
 *
 * 三条路径**全部**取自 `packages/contracts/src/skills.ts` 的 `operations`，
 * 路径与方法不手写字符串（ADR-020）：
 *
 *   · `runSecurityScan`       POST /skill-versions/:versionId/security-scan  （门禁一，自动）
 *   · `submitSkillForReview`  POST /skill-versions/:versionId/submit         （草稿 → 待审核）
 *   · `reviewSkillVersion`    POST /skill-versions/:versionId/review         （门禁二，人工）
 *
 * ## ⛔ 这里**没有**、也不会有 `POST /skills/:skillId/enable`
 *
 * `SKILLS_FORBIDDEN_ROUTES`（契约 :336）逐字禁止它，理由是「一条直达的启用路由**就是
 * 那条绕过路径本身**」。本 controller 因此**没有任何**把 `status` 直接置为 `已启用` 的
 * 分支：`已启用` 只在 `review()` 里、只在 `reviewSkillVersion` 返回 `ok: true` 且
 * `decision === "approve"` 时产生，而那条用例先过人员维度（I-4/I-5）、再过门禁维度（I-3/I-23）。
 *
 * ## ⚠ 两职能不合并，且这条判定**不在本文件里**
 *
 * 安全评审人调用 `review()` 拿到 `REVIEWER_FUNCTION_MISMATCH`（I-5/V14）。判定住在
 * `domain/skill/review-authorization.ts`，本 controller 只负责**取真实的事实**交给它：
 * 职能来自 `skill_reviewer_functions`（不是请求体），提交人来自版本行（不是请求体）。
 * 在这里加一个「不是方法论审核人就 403」的分支，就是同一条规则的第二份副本 ——
 * 而它与用例里那份必然有一天不一致（同 `skill-mount.controller.ts` 文件头的既定纪律）。
 *
 * ## ⚠ 先判定、后落库，且落库带 `from`
 *
 * 每条路径都是「读库拿真实前态 → 交用例判定 → 只有放行才落库」。落库一律走
 * `applyTransition(from, to)`（乐观并发），所以并发的两次评审不会互相顶替。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { skills as C } from "@repo/contracts";
import { runSecurityScan } from "../../application/skill/run-security-scan";
import { submitSkillForReview } from "../../application/skill/submit-skill-for-review";
import { reviewSkillVersion } from "../../application/skill/review-skill-version";
import {
  SKILL_CONTRACT_REPOSITORY,
  SKILL_SECURITY_AUDIT,
  SKILL_SUBMITTER_GRANTS,
  type SecurityAuditPort,
  type SkillContractRepository,
  type SkillContractRepositoryFactory,
  type SkillVersionForReview,
  type SubmitterGrantsPort,
} from "../../application/skill/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type ScanBody = { readonly versionId: string };
type SubmitBody = { readonly versionId: string; readonly expectedVersion: string };
type ReviewBody = {
  readonly versionId: string;
  readonly decision: "approve" | "reject";
  readonly reason: string;
  readonly riskAcks: string[];
};

/**
 * ⚠ **反证开关（红线 2）。** 本仓的规矩是「写完门控立刻造反证」，而反证必须能钉死
 *   **具体那一步**，否则「红了」不等于「红得对」。
 *
 *   · `skip-status-persist` —— 评审照常判定、评审记录照常写、HTTP 200 照常返回
 *     `skillStatus: 已启用`，但 **`applyTransition` 一次都不调用**。于是界面上那一步
 *     照常变绿，红点精确落在**刷新之后**那一句（「刷新后仍是已启用」）以及随后的
 *     「会话内挂得上」——后者会拿到 `SKILL_NOT_ENABLED`，因为库里那一行还是 `待审核`。
 *
 *   它由 `WORKSPACEX_COUNTERPROOF_SKILL_REVIEW` 开启，**只在非 production 下生效** ——
 *   与 `WORKSPACEX_COUNTERPROOF_INGEST`（`interface/recording/segment-ingestion.ts`）
 *   同一条纪律：一个能在生产被打开的开关，迟早会在生产被打开。
 *
 * ⚠ 它刻意放在**状态落库**这一刀上，而不是放在整条路由上：放整条路由上就只能证明
 *   「路由是活的」，证明不了「状态真的写进了库」——而后者正是 #552 要补的那件事。
 */
function skipsStatusPersist(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.WORKSPACEX_COUNTERPROOF_SKILL_REVIEW === "skip-status-persist";
}

@Controller()
export class SkillReviewController {
  constructor(
    @Inject(SKILL_CONTRACT_REPOSITORY) private readonly repositories: SkillContractRepositoryFactory,
    @Inject(SKILL_SUBMITTER_GRANTS) private readonly grants: SubmitterGrantsPort,
    @Inject(SKILL_SECURITY_AUDIT) private readonly audit: SecurityAuditPort,
  ) {}

  /* ───────── POST /skill-versions/:versionId/security-scan ───────── */

  /**
   * 门禁第一道。⚠ **判拒也是 200 之外的一个明确失败**（`SECURITY_SCAN_REJECTED` ⇒ 422），
   *   但记录照写：「扫过并被拒」与「从未扫过」在数据上必须可分辨（见 `run-security-scan.ts`）。
   */
  @Post(C.operations.runSecurityScan.path)
  async scan(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(C.operations.runSecurityScan.in)) body: ScanBody,
  ) {
    assertPrincipal(principal);
    this.assertPathMatchesBody(versionId, body.versionId);
    const repository = this.repositories.forOrg(principal.orgId);

    const result = await runSecurityScan(
      { versionId, principalId: principal.userId, scanId: `skill-scan-${randomUUID()}` },
      { versions: repository, scans: repository, grants: this.grants },
    );

    if (!result.ok) {
      if (result.code === "SKILL_NOT_FOUND") {
        throw new NotFoundException({ reasonCode: result.code });
      }
      throw new UnprocessableEntityException({ reasonCode: result.code });
    }

    return C.operations.runSecurityScan.out.parse({
      verdict: result.result.verdict,
      findings: result.result.findings,
    });
  }

  /* ───────── POST /skill-versions/:versionId/submit ───────── */

  /**
   * `草稿 → 待审核`。两道门禁**并列**：没扫过就提交 ⇒ `SECURITY_SCAN_REJECTED`，
   * 不是「先提交再补扫描」（`usecases.md` 逐字）。
   */
  @Post(C.operations.submitSkillForReview.path)
  async submit(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(C.operations.submitSkillForReview.in)) body: SubmitBody,
  ) {
    assertPrincipal(principal);
    this.assertPathMatchesBody(versionId, body.versionId);
    const repository = this.repositories.forOrg(principal.orgId);
    const { version, status } = await this.loadVersionAndStatus(repository, versionId);

    // 乐观并发：调用方以为自己在提交一份**它上次看到的那个状态**的版本。
    // ⚠ 比对的是版本自身的 `state`，不是 `Skill.status` —— 两者是两个字段（domain.md §2）。
    if (body.expectedVersion !== version.state) {
      throw new ConflictException({ reasonCode: "SKILL_VERSION_CHANGED" });
    }

    const scan = await repository.latestScan(versionId);
    const decided = await submitSkillForReview(
      { skillId: version.skillId, versionId, principalId: principal.userId, from: status, scan },
      { audit: this.audit },
    );
    if (!decided.ok) throw this.toHttpError(decided.code);

    const applied = await repository.applyTransition({
      skillId: version.skillId,
      from: status,
      to: "待审核",
      archived: false,
    });
    if (!applied.changed) throw new ConflictException({ reasonCode: "SKILL_VERSION_CHANGED" });

    // ⚠ 版本状态**单独**推进，不由 `Skill.status` 推导（domain.md §2 逐字）。
    const moved = await repository.markVersionSubmitted(versionId);
    if (!moved.changed) throw new ConflictException({ reasonCode: "SKILL_VERSION_CHANGED" });

    return C.operations.submitSkillForReview.out.parse({
      status: "待审核",
      versionState: "待审核",
    });
  }

  /* ───────── POST /skill-versions/:versionId/review ───────── */

  /**
   * 门禁第二道（人工）—— **系统里唯一产生 `已启用` 的产品路径**
   * （另一条是 `restoreSkill` 的 `已停用 → 已启用`，那条恢复的是状态，不重新过门禁）。
   */
  @Post(C.operations.reviewSkillVersion.path)
  async review(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(C.operations.reviewSkillVersion.in)) body: ReviewBody,
  ) {
    assertPrincipal(principal);
    this.assertPathMatchesBody(versionId, body.versionId);
    const repository = this.repositories.forOrg(principal.orgId);
    const { version, status } = await this.loadVersionAndStatus(repository, versionId);

    const decided = await reviewSkillVersion(
      {
        skillId: version.skillId,
        // ⚠ 三个「谁」全部来自服务端事实，一个都不来自请求体：
        //   提交人 ← 版本行；审核人 ← 已认证的 principal；职能 ← `skill_reviewer_functions`。
        submitterId: version.submitterId,
        reviewerId: principal.userId,
        reviewerFunction: await repository.functionOf(principal.userId),
        anotherMethodologyReviewerExists: await repository.anotherMethodologyReviewerExists(
          principal.orgId,
          principal.userId,
        ),
        decision: body.decision,
        from: status,
        scan: await repository.latestScan(versionId),
        acknowledgedRiskItemIds: body.riskAcks,
      },
      { audit: this.audit },
    );

    // ⚠ 被拒时**一个字都不写**：既不写评审记录，也不动状态。一次越权的评审尝试留下的是
    //   安全审计（`advanceSkillStatus` 里 I-23 那条），不是一条看起来像正常评审的记录。
    if (!decided.ok) throw this.toHttpError(decided.code);

    const reviewRecordId = `skill-review-${randomUUID()}`;
    await repository.saveReview({
      reviewRecordId,
      skillId: version.skillId,
      versionId,
      submitterId: version.submitterId,
      reviewerId: principal.userId,
      decision: body.decision,
      reason: body.reason,
      riskAcks: body.riskAcks,
    });

    const to = decided.status;
    if (!skipsStatusPersist()) {
      const applied = await repository.applyTransition({
        skillId: version.skillId,
        from: status,
        to,
        archived: false,
      });
      if (!applied.changed) throw new ConflictException({ reasonCode: "SKILL_VERSION_CHANGED" });

      const moved =
        body.decision === "approve"
          ? await repository.releaseVersion(versionId)
          : await repository.returnVersionToDraft(versionId);
      if (!moved.changed) throw new ConflictException({ reasonCode: "SKILL_VERSION_CHANGED" });
    }

    return C.operations.reviewSkillVersion.out.parse({
      skillStatus: to,
      versionState: body.decision === "approve" ? "已生效" : "草稿",
      reviewRecordId,
    });
  }

  /* ─────────────────────────── 内部 ─────────────────────────── */

  /**
   * 版本行 ＋ 该 skill **此刻**的状态。
   *
   * ⚠ `from` 来自库，不来自调用方的假设 —— #459 在 `disableSkill` 上修的就是这一处：
   *   硬编码一个 `from` 会让状态机把一条非法迁移判成合法并持久化下来。
   */
  private async loadVersionAndStatus(
    repository: SkillContractRepository,
    versionId: string,
  ): Promise<{ version: SkillVersionForReview; status: NonNullable<Awaited<ReturnType<SkillContractRepository["statusOf"]>>> }> {
    const version = await repository.loadVersionForReview(versionId);
    // 「不存在」与「在别的租户里」折成同一个 404：仓储是按租户绑定的，别的租户的 id 在
    // 这一步就读不到（I-14：范围外不返回其存在性）。
    if (version === null) throw new NotFoundException({ reasonCode: "SKILL_NOT_FOUND" });
    const status = await repository.statusOf(version.skillId);
    if (status === null) throw new NotFoundException({ reasonCode: "SKILL_NOT_FOUND" });
    return { version, status };
  }

  /**
   * 契约的三个 `in` 里都带 `versionId`，而路径里也有一个。
   *
   * ⚠ 不一致时**拒绝**，而不是「以路径为准、悄悄忽略请求体里那个」：后者会让调用方
   *   以为自己在审 A 版本、实际审了 B 版本，且没有任何地方看得出来。
   *   同 `skill.controller.ts` 的 `assertOwnTenant` 对 `orgId` 的处置。
   */
  private assertPathMatchesBody(pathVersionId: string, bodyVersionId: string): void {
    if (pathVersionId !== bodyVersionId) {
      throw new UnprocessableEntityException({ reasonCode: "CONTRACT_VALIDATION_FAILED" });
    }
  }

  private toHttpError(code: string): Error {
    switch (code) {
      case "SKILL_NOT_FOUND":
        return new NotFoundException({ reasonCode: code });
      case "PERMISSION_REVOKED":
      case "GATE_NOT_PASSED":
      case "SELF_REVIEW_FORBIDDEN":
      case "REVIEWER_FUNCTION_MISMATCH":
        return new ForbiddenException({ reasonCode: code });
      case "SKILL_VERSION_CHANGED":
        return new ConflictException({ reasonCode: code });
      default:
        // `SECURITY_SCAN_REJECTED` / `NO_SECOND_REVIEWER` / `CONTRACT_VALIDATION_FAILED` …
        // ⚠ `NO_SECOND_REVIEWER` 刻意落 422 而不是 403：它不是「你没权限」，
        //   而是**组织配置问题**（A4）——界面文案要提示「找组织管理员再指派一名审核人」。
        return new UnprocessableEntityException({ reasonCode: code });
    }
  }
}
