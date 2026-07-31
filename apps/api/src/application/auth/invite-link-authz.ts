/**
 * 「只有本项目的引导师能管链接与名单」这一句 —— **一个落点**。
 *
 * F15 有四个写用例（签发 / 群发 / 撤销 / 落名单）与两个读用例，`pre` 逐字相同。
 * 在四个文件里各写一次 `if (input.actorProjectRole !== "facilitator") throw` 的表现
 * 不是重复代码难看，而是：`[待定 H]`（组长与项目负责人是否有撤销权）一旦被裁决，
 * 有人会改其中三处。漏掉的那一处不会报错，它只是继续用旧规则。
 *
 * ⚠ 判据本身在 domain（`canManageInviteLinks`），这里只负责把它变成契约里的码。
 */
import { canManageInviteLinks } from "../../domain/auth/invite-link";
import { OrgAdminError } from "./org-invite-errors";

export interface InviteLinkActor {
  /**
   * 已由 Guard 认证过的调用者。
   * ⚠ 绝不从请求体里取——那是可伪造字段，而这条路径的整个前置条件是「他是引导师」。
   */
  readonly actorId: string;
  /** 调用者**在本项目**的角色，由 identity 侧解析后传入。null = 他不在这个项目里。 */
  readonly actorProjectRole: string | null;
}

/**
 * ⚠ 两个码而不是一个：「你不在这个项目」与「你在但不是引导师」要用户做的事不同。
 *   契约的 `err` 数组也把它们并列写着。
 * ⚠ 这与「三码对参与者统一渲染」不冲突：那条讲的是**进场失败**（不泄露项目是否存在），
 *   而这条路径的调用者已经登录、且项目 id 是他自己给的。
 */
export function assertCanManageInviteLinks(actor: InviteLinkActor): void {
  if (canManageInviteLinks(actor.actorProjectRole)) return;
  throw new OrgAdminError(
    actor.actorProjectRole === null ? "NO_PROJECT_ROLE" : "PROJECT_ROLE_INSUFFICIENT",
  );
}
