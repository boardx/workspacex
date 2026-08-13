# 组织共享邀请链接（Slack/Discord 式）contract delta

Status: proposed; human signoff required.（实现按 ADR-023 已开工，**合并等人类签**。）

本文件是本 delta 的**唯一规范来源**。三条核心设计出自**人类 2026-08-13 会话内逐条拍板**
（coord-agent-auth 转达派工），本文件记录契约形状与理由，不重新论证方向。
基线：`origin/main`（含已合入的 PR #953 invite-link-and-reads delta）。

## 已裁三点（人类拍板，逐条照录）

1. **形态**【已裁】：**多次使用**的共享链接。建链时选：角色（全部角色可选，含管理员——
   见第 3 条）、有效期（1 天 / 7 天 / 30 天，默认 7 天）、人数上限（可选填，默认无上限）。
   随时可手动作废。实际加入人数仍受组织席位配额硬闸（配额满时链接加入被拒，文案指向配额）。
2. **有效期/上限默认**【已裁】：7 天、无人数上限，建链时可改。
3. **admin 级链接的双人复核**【已裁，关键冲突解法】：已签不变量 O-28⑥「管理员邀请必须
   双人复核」**不动**——复核前移到**建链环节**：建 admin 级共享链接时链接进「待复核」态
   （**不可用**），另一位管理员批准后链接才生效；生效后共享语义照常（谁点谁加入）。
   非 admin 角色链接即建即用。复用现有双人复核的机制模式（发起人不能自批——参照
   `reviewAdminInvite` 的 `INVITE_SELF_REVIEW_FORBIDDEN` 先例）。

**与 O-28⑥ 的关系**：这是不变量适用点的**扩展**，不是绕过。单人邀请的复核对象是
「一条指向具体邮箱的 admin 邀请」；共享链接的复核对象是「一枚能把**任何持有者**变成
admin 的凭据」——威胁面只大不小，所以复核必须发生在凭据**能用之前**（建链环节），而不是
每次加入时（那会把「谁点谁加入」的共享语义变成逐人审批，等于没有共享链接）。落地与
单人邀请同构：`pending-review` 态**根本不存在令牌**（不是「签了但拦着」，同 I-3 的
字面派），批准那一刻才签发。

## 契约形状（org-admin 束追加）

⚠ **操作名与派工单不同，记录在案的技术判断**：派工单写的 `createInviteLink` /
`listInviteLinks` / `revokeInviteLink` 与本束**已有的项目链接操作**（UC-1.3
`issueInviteLink` / `revokeInviteLink`）同名冲突——契约束是一个 TS 对象字面量，同名键
直接互相覆盖。⇒ 前缀 `Org` 区分：`createOrgInviteLink` / `listOrgInviteLinks` /
`revokeOrgInviteLink` / `reviewOrgInviteLink` / `activateViaOrgInviteLink`。
与 `createTeam` 撞 path 门禁时改动作后缀是同一类处置（该操作头注先例）。

```ts
// packages/contracts/src/org-admin.ts
export const OrgInviteLinkExpiry = z.enum(["1d", "7d", "30d"]);   // 已裁①：三档，默认 7d 由前端表单体现
export const OrgInviteLinkStatus = z.enum([
  "pending-review",  // admin 级链接建后、批准前（不可用，令牌不存在）
  "active",
  "expired",         // 派生：expires_at 已过
  "revoked",         // 手动作废 或 复核被拒
  "exhausted",       // 派生：max_uses 用满
]);

createOrgInviteLink:   POST /organizations/:orgId/invite-links
  in : { orgId, orgRole: OrgRole, expiry: OrgInviteLinkExpiry, maxUses: int>0 | null }
  out: { linkId, status: "pending-review"|"active",
         /** 链接令牌明文——只在签发那一次响应出现（admin 级建链时为 null：令牌尚不存在） */
         linkToken: string | null,
         expiresAt: string | null /* pending-review 时 null：有效期窗口从批准起算 */ }
listOrgInviteLinks:    GET  /organizations/:orgId/invite-links      （仅 admin，恒不含令牌）
revokeOrgInviteLink:   POST /organizations/:orgId/invite-links/:linkId/revoke   （幂等）
reviewOrgInviteLink:   POST /organizations/:orgId/invite-links/:linkId/review
  in : { orgId, linkId, decision: "approve"|"reject", reason: string|null }
  out: { status, linkToken: string | null /* 只在批准签发那一次回传给批准人 */ }
activateViaOrgInviteLink: POST /org-invites/activate-via-link     （@Public，无鉴权，同 activate 先例）
  in : { token, email: EmailAddress, profile: { name, password } }
  out: { userId, orgId, orgRole, teamId, sessionId }               （同 activateOrgMember.out 形状）
```

**错误码零新增**：失效四因+待复核+已用满统一 `INVITE_NOT_FOUND`（V10 防枚举，同
`activateOrgMember` 先例——共享链接长期有效，被枚举的价值更高，防枚举只紧不松）；
邮箱已有账号/已是成员 → `INVITE_ALREADY_MEMBER`（**明确拒绝、不重复建号**——已裁①的
查重要求；本操作上该码的语义覆盖「该邮箱已有账号（无论是否本组织成员）」，因为链接
激活只走建新号一条分支，已有账号的人该去登录）；配额满 → `QUOTA_EXHAUSTED`
（已裁①「文案指向配额」——这一条**刻意不并入防枚举**：它发生在令牌校验通过之后，
持有效令牌的人本来就会在成功时知道组织存在）；复核类沿用
`INVITE_SELF_REVIEW_FORBIDDEN` / `VERSION_CHANGED`。

## 与 #953 一次性 token 的语义区分

| | 单人邀请 token（#953） | 共享链接 token（本 delta） |
|---|---|---|
| 使用次数 | 一次，核销即死 | 多次，直到过期/作废/用满 |
| 落库 | **明文**（`org_invite_tokens.token`，一次性、短窗口） | **只存 hash**（sha-256）——长期有效凭据，DB 泄露不可给出可用链接 |
| 明文出现 | 签发那一次响应 | 同：创建（非 admin 级）/ 复核批准那一次响应；列表恒不含 |
| 授予身份 | 邀请行记录的邮箱 | 受邀人**自填**邮箱+姓名+密码 |

一次性展示纪律与 #953 完全一致（同一个 UI 块模式）；hash 化是**新增**的更严纪律，
理由如上表。单人 token 是否也该 hash 化不在本 delta 范围（它有自己的签核记录）。

## 数据面

`org_invite_links`（租户表，FORCE RLS）+ `org_invite_link_tokens`（**无租户键**——
激活请求匿名，与 `org_invite_tokens` 迁移 0022 文件头逐字同一段推理；存 `token_hash`
不存明文，`org_id_hint` 只回答「去哪查」不回答「授予什么」）。
`used_count` 原子递增：激活事务内对链接行 `FOR UPDATE`，判上限与 +1 在同一次锁定里
（与 `create` 的配额锁定同形）。席位配额复用 `seat_quota` 现查现数机制，不另立账本。

## ⚠ 待人类确认点（签核时请明示）

**共享链接建号的 `email_verified_at`**：本实现置为激活时刻（与单人邀请激活相同），
否则该账号下次登录必撞 `EMAIL_NOT_VERIFIED` 死路（邮件通道未接通，无从验证）。
与单人路径的差别：单人路径点链接即证明邮箱所有权（O-28⑤），共享链接的邮箱是自填的，
**不证明所有权**。风险边界：链接本身由 admin 在信任边界内转交；重复邮箱明确拒绝；
错误占用他人邮箱可由 admin 移除成员纠正。若人类否定这一点，替代方案是接通邮件验证
通道后改为未验证建号（那是跨 delta 的裁决）。

## 不改的东西

- 单人邀请全链路（`inviteOrgMember`/`reviewAdminInvite`/`resendOrgInvite`/
  `revokeOrgInvite`/`activateOrgMember`）与其 token 语义原样。
- 项目侧链接（UC-1.3 `issueInviteLink` 等）原样——两套链接服务两个层（组织 / 工作坊）。
- 防枚举（V10）、席位配额（I-9）、双人复核不变量（O-28⑥/I-4）原样，只扩适用点。
