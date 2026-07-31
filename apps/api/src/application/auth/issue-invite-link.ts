/**
 * `IssueInviteLink`（F15 / UC-1.3）—— 编排。不知道 HTTP，不知道 PostgreSQL。
 *
 * 做：① 越权判定（只有本项目的引导师能签发）② 身份四选 → 落库角色（一处换算）
 *     ③ 按有效期档算 `expiresAt`（数值来自契约枚举字面量本身，见 domain/auth/invite-link.ts）
 *     ④ 邀请码：**只有主链接配**。
 *
 * 不做：**二维码渲染**。契约 `out.qrPayload` 在这里恒等于 `url`——
 * 「二维码服务不可用时降级为可复制的纯 URL，不静默失败」（usecases.md）说明
 * 二维码是一层**呈现**，载荷就是那个 URL。在后端画一张 PNG 会让
 * `AUTH_SERVICE_UNAVAILABLE` 这条降级路径变成后端的事，而它是前端的事。
 * ⇒ 这不是「没做」，是这一层本来就只欠一个载荷。
 */
import {
  inviteCodeForDisplay,
  linkExpiresAt,
  newInviteCode,
  newInviteLinkId,
  newInviteLinkToken,
  projectRoleOf,
  type InviteLinkKind,
  type InviteLinkValidity,
  type ParticipantIdentityChoice,
} from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import { assertCanManageInviteLinks, type InviteLinkActor } from "./invite-link-authz";
import type { InviteLinkRepository } from "./invite-link-ports";

export interface IssueInviteLinkDeps {
  readonly repo: InviteLinkRepository;
  /** 注入，好让「24 小时后失效」这条能在不等 24 小时的情况下被断言。 */
  readonly now?: () => Date;
  /**
   * 链接的对外前缀（`https://…/w/<项目>`）。注入而不是常量：
   * 域名是**部署事实**，写死在 application 里会让它在两处（这里与前端配置）各有一份。
   */
  readonly baseUrl?: string;
}

export interface IssueInviteLinkInput extends InviteLinkActor {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly kind: InviteLinkKind;
  readonly groupId: string | null;
  readonly identity: ParticipantIdentityChoice;
  readonly validity: InviteLinkValidity;
}

export interface IssueInviteLinkOutput {
  readonly linkId: string;
  readonly url: string;
  readonly token: string;
  /** 展示形态（每 4 位一个连字符）。库里存的是无连字符的原值。 */
  readonly inviteCode: string | null;
  readonly qrPayload: string | null;
  readonly replayed: boolean;
}

const DEFAULT_BASE_URL = "https://workspacex.invalid";

export async function issueInviteLink(
  deps: IssueInviteLinkDeps,
  input: IssueInviteLinkInput,
): Promise<IssueInviteLinkOutput> {
  assertCanManageInviteLinks(input);

  // 分组链接必带组号，主链接必不带。迁移里有 CHECK 兜底，但那会在这一层之外
  // 变成一个 23514 异常——用例层认得出它，好让调用者拿到一个契约里的码。
  if ((input.kind === "group") !== (input.groupId !== null)) {
    throw new OrgAdminError("VERSION_CHANGED");
  }

  const now = (deps.now ?? (() => new Date()))();
  const projectRole = projectRoleOf(input.identity);

  /**
   * 邀请码**只有主链接配**（`user_visible_behavior` 逐字：
   * 「配主链接 ?r=member 与有效期三档、复制/二维码、邀请码 KCK-8F21-EU24」，
   * 而分组链接那句只有「每组一条分组链接」）。
   *
   * ⚠ 这是**按已写下的那一条实现**，不是裁定「分组链接永远不配码」。
   *   给分组链接也配码是加一行，撤回不是——所以取原文那一侧。
   */
  const inviteCode = input.kind === "main" ? newInviteCode() : null;

  const issued = await deps.repo.issue({
    linkId: newInviteLinkId(),
    orgId: input.orgId,
    projectId: input.projectId,
    actorId: input.actorId,
    kind: input.kind,
    groupId: input.groupId,
    projectRole,
    validity: input.validity,
    token: newInviteLinkToken(),
    inviteCode,
    expiresAt: linkExpiresAt(now, input.validity),
    now,
  });

  /**
   * `?r=` 是**展示层的可读参数**，权威恒在服务端的 `linkId → project_role` 映射。
   * 它在这里被拼进 URL，是因为原型上就有它（`?r=member`），而不是因为有人会读它。
   * ⚠ 契约 `KNOWN_CONTRACT_GAPS.OA4`：没有任何契约级的东西能让「前端读了 `?r=` 就当真」
   *   变红。本实现里它进不了任何判定路径——`consume` 只收 token。
   */
  const base = deps.baseUrl ?? DEFAULT_BASE_URL;
  const url =
    input.kind === "group"
      ? `${base}/w/${input.projectId}/g/${input.groupId}?r=${input.identity}&t=${issued.token}`
      : `${base}/w/${input.projectId}?r=${input.identity}&t=${issued.token}`;

  return {
    linkId: issued.linkId,
    url,
    token: issued.token,
    inviteCode: issued.inviteCode === null ? null : inviteCodeForDisplay(issued.inviteCode),
    // 见文件头：载荷就是那个 URL，二维码是一层呈现。
    qrPayload: url,
    replayed: issued.replayed,
  };
}
