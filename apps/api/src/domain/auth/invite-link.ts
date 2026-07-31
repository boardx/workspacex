/**
 * 项目邀请链接的域规则（F15 / UC-1.3）—— 最内层，纯函数，没有库、没有 HTTP。
 *
 * ## 有效期三档的数值住在哪里：**契约枚举的字面量本身**
 *
 * `orgAdmin.InviteLinkValidity` 是 `["24h", "7d", "once"]`。这三个字面量**已经**
 * 把时长说全了——`"24h"` 的意思就是 24 小时。所以本文件**不写第二份数值表**
 * （不写 `{ "24h": 24 * 3600_000, "7d": 7 * 86400_000 }`），而是**解析枚举成员本身**。
 *
 * 理由是本仓已九次因「同一事实声明在两处」漂移。一份手写映射表的漂移方向很具体：
 * 有人把契约改成 `"48h"`，映射表纹丝不动 —— 要么 TypeScript 报一个键名错误
 * （运气好），要么（更常见）有人顺手补上 `"48h": 24 * 3600_000` 的复制粘贴，
 * 于是**链接上写着 48 小时、实际 24 小时失效**，没有任何东西会红。
 * 解析字面量则不可能漂移：值是从名字算出来的。
 *
 * ⚠ 这与 `ORG_INVITE_LINK_VALIDITY_MS`（`org-invite.ts`，7 天）**不是同一个事实**：
 *   那是 UC-1.6 的**组织成员**激活链接（一个组织级授予），这里是 UC-1.3 的
 *   **项目进场**链接的三档之一（一个项目级授予）。两者恰好都有一个「7 天」，
 *   但它们各自的出处不同（O-28 ④ vs R10 链接有效期统一表），改一个不该改另一个。
 *   本文件因此**不 import 它**，也不把自己的 7 天写成数字。
 * ⚠ `KNOWN_CONTRACT_GAPS.OA3`（组织邀请链接 7 天无单一事实源）**不由本 feature 关闭**，
 *   也不由本 feature 扩大：它说的是 `AUTH_POLICY` 缺一个 `orgInviteLinkDays`，需人裁。
 *
 * ## 这里**没有**的东西
 *
 * 没有「撤销」「核销」。I-11（一次性链接用过即失效，且 `usedBy` 记录使用者）与
 * I-15（单条撤销只作废该条）都是**一串写操作**的性质，不是一次计算的性质：
 * 纯函数托不住「恰好一次」。它们被断言在真正住着它们的地方——
 * `pg-invite-link-repository.ts` 的条件 UPDATE 与部分唯一索引，
 * 由 `tests/auth/invite-onetime-used-by.test.ts` 对真实事务断言。
 */
import { randomBytes, randomInt } from "node:crypto";
import { orgAdmin } from "@repo/contracts";
import type { z } from "zod";
/** ⚠ 项目角色的词汇表已经在 `domain/identity/roles.ts` 从契约派生过一次，这里**引用**它。 */
import type { ProjectRole as ProjectRoleValue } from "../identity/roles";
import type { PermissionDecision } from "../identity/permission-decision";

export type { ProjectRoleValue };
export type InviteLinkValidity = z.infer<typeof orgAdmin.InviteLinkValidity>;
export type InviteLinkKind = z.infer<typeof orgAdmin.InviteLinkKind>;
export type ParticipantIdentityChoice = z.infer<typeof orgAdmin.ParticipantIdentityChoice>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 一档有效期能撑多久，`null` = **不按时间失效**。
 *
 * 解析规则：`<正整数><h|d>`。任何不匹配的成员**必须**在这里显式列出它的语义，
 * 否则抛错——「默认当成永不过期」是这个函数唯一不能有的行为：
 * 契约新增一档 `"30d"` 而这里悄悄给它 `null`，表现是**链接永不失效**。
 *
 * ⚠ `"once"` 返回 `null` 是**一次裁定的缺席**，不是「它无限期有效」的结论：
 *   它的失效条件是「被用过」（I-11），而三档里只有它没有时间语义。
 *   「一次性链接是否另有时间上限」在需求里没有出处 ⇒ 已登记为
 *   `KNOWN_CONTRACT_GAPS.OA8`，**agent 不替人裁**。
 */
export function validityDurationMs(validity: InviteLinkValidity): number | null {
  if (validity === "once") return null;
  const m = /^(\d+)([hd])$/.exec(validity);
  if (m === null) {
    throw new Error(
      `InviteLinkValidity "${validity}" 既不是 <数字><h|d> 也不是 "once"：` +
        `本函数拒绝猜。请在 domain/auth/invite-link.ts 里显式给出它的时长语义。`,
    );
  }
  return Number(m[1]) * (m[2] === "h" ? HOUR_MS : DAY_MS);
}

/** 签发时刻 + 该档时长。`null` = 该档不按时间失效（`once`）。 */
export function linkExpiresAt(issuedAt: Date, validity: InviteLinkValidity): Date | null {
  const ms = validityDurationMs(validity);
  return ms === null ? null : new Date(issuedAt.getTime() + ms);
}

/** 该档是否一次性（用过即失效，I-11）。 */
export function isSingleUse(validity: InviteLinkValidity): boolean {
  return validity === "once";
}

/**
 * 身份四选 → 落库的 `project_memberships.project_role`（I-17 / O-03）。
 *
 * ⚠ 「协同引导师」是**展示别名**，落库 `facilitator`，**不产生第五种取值**。
 * ⚠ 写成 `satisfies Record<四选, 四值>` 而不是一个 `switch`：契约给四选加一个成员时，
 *   这里**编译期**就红（缺键），而 `switch` 的 default 分支会让新成员安静地落到某个角色上。
 *
 * ⚠ 这个映射是**单射**（四个选项落到四个不同的角色上），所以库里
 *   **只存 `project_role` 一列**，`identity` 由 `identityChoiceOf` 反推——
 *   两列都存就是同一事实的第二份副本，而漂移方向是
 *   「有人改了角色没改选项」，界面上显示「组员」而实际是引导师。
 */
export const IDENTITY_CHOICE_TO_PROJECT_ROLE = {
  member: "member",
  groupLead: "groupLead",
  observer: "observer",
  coFacilitator: "facilitator",
} as const satisfies Record<ParticipantIdentityChoice, ProjectRoleValue>;

export function projectRoleOf(choice: ParticipantIdentityChoice): ProjectRoleValue {
  return IDENTITY_CHOICE_TO_PROJECT_ROLE[choice];
}

/** `projectRoleOf` 的逆。单射保证它是全函数；不是单射的那一天这里会抛。 */
export function identityChoiceOf(role: ProjectRoleValue): ParticipantIdentityChoice {
  const hit = (Object.keys(IDENTITY_CHOICE_TO_PROJECT_ROLE) as ParticipantIdentityChoice[]).filter(
    (c) => IDENTITY_CHOICE_TO_PROJECT_ROLE[c] === role,
  );
  if (hit.length !== 1) {
    throw new Error(
      `project_role "${role}" 对应 ${hit.length} 个身份四选 —— IDENTITY_CHOICE_TO_PROJECT_ROLE ` +
        `不再是单射，库里只存 project_role 一列的前提失效了。`,
    );
  }
  return hit[0] as ParticipantIdentityChoice;
}

/**
 * 进场令牌。**这一枚是秘密**——持有它即可以该链接记录的身份进入该项目。
 *
 * 256 位 CSPRNG，base64url。与 `newOrgInviteToken` 同规格同理由，并且同样
 * **刻意不把 projectId / groupId / role 编进令牌**：`?r=member` 是展示层的可读参数，
 * 权威恒在服务端的 `linkId → project_role` 映射（usecases.md 逐字）。
 * 可解码的令牌只是把「链接里明文写着角色」从查询串搬进令牌，客户端照样能改。
 */
export function newInviteLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 链接行 id。不可从项目/组号推导：它会进 URL 与日志。 */
export function newInviteLinkId(): string {
  return `il-${randomBytes(12).toString("hex")}`;
}

/** 名单条目 id。 */
export function newParticipantId(): string {
  return `pp-${randomBytes(12).toString("hex")}`;
}

/**
 * 邀请码字母表 —— 刻意**排除** `I O 0 1`。
 *
 * 它是**读出来 / 抄下来**的载体（原型：现场大屏上的 `KCK-8F21-EU24`），
 * 而这四个字形在投影与手写里互相认错。排除它们不是在契约之外发明约束：
 * 契约 `InviteCodeValue` 只断言长度并**明说字母表刻意未收窄**（线下签发的码可能用别的），
 * 那条讲的是**校验**要宽；这里讲的是**生成**要好认。校验仍然只看长度。
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * 邀请码。长度读 `AUTH_POLICY.inviteCodeLength`，**本束不写死**（契约逐字要求）。
 *
 * ⚠ **这里有一处未解的矛盾，不由 agent 选边**：`AUTH_POLICY.inviteCodeLength = 14`
 *   的出处是 UC-1.5 / O-29 ①（**建组织**的邀请码），而原型上的项目邀请码
 *   `KCK-8F21-EU24` 是 **12 个字母数字**分成 3 组、带连字符。两者长度与形态都不同。
 *   契约说「读 AUTH_POLICY.inviteCodeLength」，所以这里生成 14 位；
 *   分组连字符是**纯展示**（`groupInviteCodeForDisplay`），不进库、不参与比较。
 *   ⇒ 已登记 `KNOWN_CONTRACT_GAPS.OA9`。
 */
export function newInviteCode(): string {
  const n = orgAdmin.ORG_ADMIN_POLICY.inviteCodeLength;
  let out = "";
  for (let i = 0; i < n; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * 展示形态：每 4 位一个连字符（`KCK8F21EU24` → `KCK8-F21E-U24`）。
 *
 * ⚠ **只用于呈现**。库里存的、比较用的恒是无连字符的原值——
 * 存展示形态就是把「怎么分组」变成数据，而分组规则一改，历史的码就对不上了。
 */
export function inviteCodeForDisplay(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join("-");
}

/* ─────────────────── 链接可用性：一处判定，三个码 ─────────────────── */

export type LinkUsability =
  | { readonly usable: true }
  | { readonly usable: false; readonly reason: "revoked" | "expired" | "used" };

export interface InviteLinkState {
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly usedAt: Date | null;
  readonly singleUse: boolean;
}

/**
 * 一条链接现在还能不能用。
 *
 * ⚠ 三种不可用**在这里是分得开的**，在**响应里**才合并（契约：三码对参与者统一渲染
 *   为「找引导师重发」）。分开在这里，是因为引导师的管理面要显示「已撤销 / 已过期 /
 *   已使用」这三种不同的状态，而合并在响应层由 interface 决定给谁看哪一种。
 *   把它们在这里就合并成一个布尔，管理面就再也拿不到这个区别。
 *
 * ⚠ 顺序是**撤销优先**：一条既过期又被撤销的链接，管理面要显示的是「已撤销」——
 *   那是有人做过的动作，而过期是没人做过任何事。
 *
 * ⚠ `usedAt` 只在 `singleUse` 时构成不可用。一条 7 天的链接被用过 30 次仍然可用，
 *   这正是主链接的用法；把 `usedAt` 无条件当成失效，主链接就变成一次性的了。
 */
export function linkUsability(state: InviteLinkState, now: Date): LinkUsability {
  if (state.revokedAt !== null) return { usable: false, reason: "revoked" };
  if (state.singleUse && state.usedAt !== null) return { usable: false, reason: "used" };
  if (state.expiresAt !== null && state.expiresAt.getTime() <= now.getTime()) {
    return { usable: false, reason: "expired" };
  }
  return { usable: true };
}

/** 不可用原因 → 契约 `OrgAdminError` 的码。**一处映射**，interface 不再各自发明。 */
export const USABILITY_REASON_TO_CODE = {
  revoked: "LINK_REVOKED",
  expired: "LINK_EXPIRED",
  used: "LINK_ALREADY_USED",
} as const satisfies Record<
  Exclude<LinkUsability, { usable: true }>["reason"],
  z.infer<typeof orgAdmin.OrgAdminError>
>;

/**
 * 谁能签发 / 撤销链接：**只有引导师**（usecases.md `IssueInviteLink.pre` /
 * `RevokeInviteLink.pre` 逐字）。
 *
 * ⚠ 「组长与项目负责人是否有撤销权」是 `domain.md [待定 H]`，**没有裁决**。
 *   这里实现的是**已写下的那一条**（引导师），而不是把待定项按某个方向猜死。
 *   放宽是加一个 `||`，收紧不是——所以默认取严的那一侧。
 */
export function canManageInviteLinks(projectRole: string | null): boolean {
  return projectRole === "facilitator";
}

/**
 * 管理面（签发 / 撤销 / 看链接与名单）的判定 —— **`authorize` 表达不了它**。
 *
 * 与 `decideOrgExport` 同型同理由：一条邀请链接没有 `acl_bindings` 行，
 * `authorize` 找不到绑定就退回宽松默认 scope（org-wide），看见非空的组织角色，
 * 于是给**组织里的每一个人**返回 `allowed: true`——包括不在这个项目里的顾问。
 * 而这条规则是「本项目的引导师」。判定对象看起来会完全正常，还带着一个 decisionId。
 * ⇒ 规则住在 domain 里被直接测试，载荷经 `discloseDecided` 取出。
 *
 * ⚠ 两层都要过（F01 的交集）：组织层看「你是不是这个组织的人」，
 *   项目层看「你在这个项目里是不是引导师」。少了组织层那一半，
 *   一条跨组织伪造的 `project_memberships` 就能单独放行。
 */
export function decideInviteLinkManagement(input: {
  readonly decisionId: string;
  readonly orgRole: string | null;
  readonly teamId: string | null;
  readonly projectRole: string | null;
  readonly groupId: string | null;
}): PermissionDecision {
  const orgPassed = input.orgRole !== null;
  const projectPassed = canManageInviteLinks(input.projectRole);
  const allowed = orgPassed && projectPassed;
  return {
    allowed,
    orgLayer: {
      role: input.orgRole as PermissionDecision["orgLayer"]["role"],
      teamId: input.teamId,
      passed: orgPassed,
    },
    projectLayer: {
      role: input.projectRole as NonNullable<PermissionDecision["projectLayer"]>["role"],
      groupId: input.groupId,
      passed: projectPassed,
    },
    /**
     * ⚠ 恒 `org-wide`。链接是**项目级**对象，没有 team-only 的形态——
     * 填一个假的 team-only 会让「为什么被拒」指向一个用户根本改不了、
     * 而且在这条规则里压根不参与判断的地方。
     */
    scopeLayer: { scope: "org-wide" as const, passed: allowed },
    /**
     * ⚠ 三档而不是一档：R4 E3 要求「团队范围的拒绝要说清它来自组织层」。
     * 「你不在这个组织」「你不在这个项目」「你在这个项目但不是引导师」
     * 要用户做的事完全不同，合并成一个码等于让他去找一个他已经有的角色。
     * ⚠ 这与「对**参与者**三码统一渲染」不矛盾：那条讲的是**进场失败**的响应
     *   （不泄露项目是否存在），这里是**管理面**的响应，调用者已经登录且已知项目存在。
     */
    reasonCode: allowed
      ? null
      : !orgPassed
        ? "NO_ORG_MEMBERSHIP"
        : input.projectRole === null
          ? "NO_PROJECT_ROLE"
          : "PROJECT_ROLE_INSUFFICIENT",
    decisionId: input.decisionId,
  };
}
