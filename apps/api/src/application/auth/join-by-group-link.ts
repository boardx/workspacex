/**
 * `JoinByGroupLink`（F12 / UC-1.2）—— 免注册进场：令牌 + 手机号名单双核对，不建账号只建
 * 免注册身份（D-01 + O-06）。
 *
 * ⚠ **两个条件同时成立才放行**（I-19）：令牌有效 ∧ 手机号在本场名单内。
 *   只验令牌 = 链接一转发全网可进；只验名单 = 令牌成了装饰。两个判定点都在
 *   `JoinRepository.joinByGroupLink` 的同一个事务里，这里不重复判一遍。
 * ⚠ **不创建账号**（I-18）——`credentials` 表行数前后相等，见
 *   `tests/auth/join-no-account-created.test.ts`。
 * ⚠ `stage` 的结构「来自 06-现场协作，本束只读不定义」（契约 `StagePosition` 注释逐字）。
 *   现场议程模块尚未建成，这里返回一个**占位环节**（index 0 / total 1），
 *   不是对现场协作模块的裁决——那个模块建成后，这一行换成真实读取。
 *
 * ## 已知缺口：`existingSessionId`「已是组织成员直接免登」分支未实现
 *
 * usecases.md：「已是组织成员时走 existingSessionId 免登分支，不再要手机号」。
 * 它的凭据来源是 phase-00 的 `SessionTokenStore`——与 `JoinRepository` 所在的
 * Postgres 事务是**不同的存储**（见 `login.ts` 关于会话存储的注释）。跨存储的
 * 「先在别处验证会话、再在这里原子写入」需要一套两阶段的组合，本轮时间盒内
 * 未交付，为免假装支持而悄悄吞掉手机号校验，这里显式拒绝并说明原因——
 * 而不是接一个查了也查不出东西的假分支。**不由本 feature 关闭**，留给
 * 专门处理该分支的后续改动（同 `KNOWN_CONTRACT_GAPS` 的登记方式）。
 */
import { normalizePhone } from "./upsert-participant-roster";
import { OrgAdminError } from "./org-invite-errors";
import type { ProjectRoleValue } from "../../domain/auth/invite-link";
import type { JoinRepository } from "./join-ports";

export interface JoinByGroupLinkDeps {
  readonly repo: JoinRepository;
  /** 免注册身份 id 生成器。测试注入固定值来断言幂等重放。 */
  readonly newGuestIdentityId: () => string;
  readonly now?: () => Date;
}

export interface JoinByGroupLinkUseCaseInput {
  /** ⚠ `null` / 空串 = 请求里根本没带 `?t=`。 */
  readonly linkToken: string | null;
  readonly phone: string | null;
  /** 已是组织成员时的免登分支——见文件头「已知缺口」，本轮传非空值一律拒绝。 */
  readonly existingSessionId: string | null;
}

/** 现场议程模块未建成前的占位环节。见文件头。 */
const STUB_STAGE = { id: "stage-pending", index: 0, total: 1 } as const;

export interface JoinByGroupLinkOutput {
  readonly guestIdentityId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly projectRole: ProjectRoleValue;
  readonly alias: string;
  readonly stage: typeof STUB_STAGE;
  readonly redirectedFromLinkGroup: boolean;
}

export async function joinByGroupLink(
  deps: JoinByGroupLinkDeps,
  input: JoinByGroupLinkUseCaseInput,
): Promise<JoinByGroupLinkOutput> {
  /**
   * I-10 的另一半：不带令牌的进场请求一律被拒。
   * 去掉 `?t=` 直接访问被拒（V6a ①）——这条断言不依赖名单、不依赖会话，
   * 是唯一一条在触碰仓储之前就能下结论的检查。
   */
  if (input.linkToken === null || input.linkToken === "") {
    throw new OrgAdminError("LINK_TOKEN_REQUIRED");
  }

  // 见文件头「已知缺口」：本轮不支持免登分支，显式拒绝而不是假装校验过。
  if (input.existingSessionId !== null && input.existingSessionId !== "") {
    throw new OrgAdminError("AUTH_SERVICE_UNAVAILABLE");
  }

  if (input.phone === null || input.phone.trim() === "") {
    // 空手机号在名单里同样查不到任何一行，语义与「查过、没在名单里」一致，
    // 不需要为它发明第二个错误码。
    throw new OrgAdminError("PHONE_NOT_ON_ROSTER");
  }

  const result = await deps.repo.joinByGroupLink({
    token: input.linkToken,
    phone: normalizePhone(input.phone),
    candidateGuestIdentityId: deps.newGuestIdentityId(),
    now: (deps.now ?? (() => new Date()))(),
  });

  if (!result.ok) {
    if (result.reason === "not-found") throw new OrgAdminError("LINK_REVOKED");
    if (result.reason === "phone-not-on-roster") throw new OrgAdminError("PHONE_NOT_ON_ROSTER");
    const CODE = {
      revoked: "LINK_REVOKED",
      expired: "LINK_EXPIRED",
      used: "LINK_ALREADY_USED",
    } as const;
    throw new OrgAdminError(CODE[result.reason]);
  }

  const g = result.grant;
  return {
    guestIdentityId: g.guestIdentityId,
    projectId: g.projectId,
    groupId: g.groupId,
    projectRole: g.projectRole,
    alias: g.alias,
    stage: STUB_STAGE,
    redirectedFromLinkGroup: g.redirectedFromLinkGroup,
  };
}
