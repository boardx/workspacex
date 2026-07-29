/**
 * `SwitchOrgAtLogin` (F22) -- usecases.md 的 F22 用例，coverage V5、UC-1.5 V10 ③④.
 *
 * ## ⚠ 这个文件最重要的性质是它**有多短**
 *
 * usecases.md 逐字写着：
 *
 *   > 它不重新实现切换 —— `identity.switchOrganization` 已经有了完整的副作用语义
 *   > （清项目上下文、清鉴权缓存、按新组织重新求值，O-12）。本用例只做会话侧的那一半，
 *   > 然后**调用它**。两处各写一遍就是第八次漂移。
 *
 * 所以这里没有 `clearProjectScoped`、没有 `invalidateUser`、没有 `setOrg`——
 * 那三样是被调用方的语义，在这里再写一遍就是第二份实现。
 * 而第二份实现的失效方式是最阴的那种：**两份都在跑**，
 * 有一天 identity 那份加了第四个副作用（比如清 Context Pack 缓存），
 * 走 `/auth/switch-org` 的用户不会得到它，也不会有任何东西报错。
 *
 * ⚠ 这条纪律不是靠注释守的：`tests/auth/multi-org-membership.test.ts` 解析本文件，
 * 断言它**调用了** `switchOrganization` 且**没有**自己碰那三个副作用。
 * 「不重新实现」是可机械判定的，就不该只是一句约定。
 *
 * ## 「会话侧的那一半」是什么
 *
 * Guard 的 principal 来自 `validateSession`，而它读的是 Redis 里那条 bearer 会话记录的
 * `currentOrgId`。`identity.switchOrganization` 碰不到那条记录（它写的是 identity 自己的
 * `SessionStore`，按 user 存项目级上下文）。⇒ 少了这一半，切换之后
 * **服务端认的还是旧组织**，界面却已经是新的。见契约 `KNOWN_CONTRACT_GAPS.C8`。
 *
 * ## 顺序：先判成员关系，再动会话
 *
 * `switchOrganization` 在没有成员关系时抛 `NoOrgMembershipError`。先调它，
 * 意味着一次失败的切换**不会**留下一个指向陌生组织的会话记录。
 * 反过来写（先改会话再校验）在失败路径上会把用户的会话指到一个他不属于的组织，
 * 而 RLS 会让那个会话下的每一次读都返回空——表现为「切过去之后什么都没有」，
 * 一个看起来像数据丢失的鉴权 bug。
 */
import type { OrgId } from "../../domain/org-id";
import { switchOrganization, type SwitchOrgDeps } from "../identity/switch-organization";
import type { SessionTokenStore } from "./ports";
import type { OrganizationRow } from "../identity/ports";
import { AuthError } from "./errors";
import { checkSession } from "../../domain/auth/session-lifetime";
import type { Clock } from "./ports";

export interface SwitchOrgAtLoginDeps {
  readonly sessions: SessionTokenStore;
  readonly clock: Clock;
  /** 原样转交给 `identity.switchOrganization`——本用例不解释它们中的任何一个。 */
  readonly identity: SwitchOrgDeps;
}

export interface SwitchOrgAtLoginInput {
  /**
   * ⚠ HTTP 上它走 Authorization 头，不在 body 里（契约 `switchOrgAtLogin.in` 只有 toOrgId）。
   * application 层的签名保留 usecases.md 的原样 `{ sessionToken, toOrgId }`。
   */
  readonly sessionToken: string;
  readonly toOrgId: OrgId;
}

export interface SwitchOrgAtLoginOutput {
  readonly org: OrganizationRow;
}

export async function switchOrgAtLogin(
  deps: SwitchOrgAtLoginDeps,
  input: SwitchOrgAtLoginInput,
): Promise<SwitchOrgAtLoginOutput> {
  /* 1. 会话必须是活的，且失败原因要能分辨。
   *
   * ⚠ 这里没有复用 `validateSession`：它把三种情形都收敛成 null（Guard 只需要结构性的
   * 「principal 非空」）。而本用例的契约 err 里 `SESSION_EXPIRED` 与 `SESSION_REVOKED`
   * 是**两个码**——usecases.md 明写「用户需要知道是『被踢了』还是『太久没用』」。
   * 复用会把这个区别丢掉，而丢掉之后没有任何东西会报。 */
  const record = await deps.sessions.findByToken(input.sessionToken);
  if (record === null) throw new AuthError("SESSION_EXPIRED");
  const invalid = checkSession(record, deps.clock.now().getTime());
  if (invalid !== null) throw new AuthError(invalid);

  /* 2. 真正的切换 —— 调用，不重写。
   * 成员关系不存在时它抛 NoOrgMembershipError，向上冒泡到 controller 映成 404。 */
  const result = await switchOrganization(deps.identity, {
    userId: record.userId,
    toOrgId: input.toOrgId,
  });

  /* 3. 会话侧的那一半。
   *
   * ⚠ 只有走到这里才动会话：上一步已经确认了成员关系存在。
   * 返回 false 意味着会话在这两步之间没了（并发登出 / 被踢），
   * 那时**不能**报告切换成功——响应会让客户端按新组织渲染，而下一次请求就是 401。 */
  const moved = await deps.sessions.setCurrentOrg(input.sessionToken, input.toOrgId);
  if (!moved) throw new AuthError("SESSION_REVOKED");

  return { org: result.org };
}
