# 邀请链接送达 + 三条读路径收口 contract delta（#638 / #639）

Status: proposed; human signoff required.（实现按 ADR-023 已开工，**合并等人类签**。）

本文件是本 delta 的**唯一规范来源**。四项变更全部出自 **coord-main 2026-08-11 正式裁决**
（人类离线期间按全权授权裁定，方向已定）；本文件记录契约形状与理由，不重新论证方向。
基线实测 SHA：`112c3166`。

## ① 邀请链接送达（裁决 A：token 返回式）

**问题**：邮件通道未接通，而激活令牌明文被安全注释（`org-invite.controller.ts`）挡在
响应体之外——邀请建了、令牌签了、受邀人**永远拿不到链接**，整条 UC-1.6 是断头路。

**裁决 A**：token 在**签发那一次**响应里回传给发起操作的管理员，由他自行转交受邀人。

```ts
// packages/contracts/src/org-admin.ts
inviteOrgMember.out += {
  /** 一次性激活令牌明文。幂等重放（quotaReserved=0）与 awaiting-review（I-3）时 null。 */
  activationToken: z.string().nullable(),
}
resendOrgInvite.out += {
  /** 新签发的令牌明文。成功即已签发，恒非空；旧令牌同一事务内已作废（I-6）。 */
  activationToken: z.string(),
}
```

**安全口径的改写（不是删除）**：旧注释「token 不进响应体」防的威胁是**任何管理员随时
可读他人链接**。那条线原样封死——`listOrgInvites`/`OrgInvite` 实体恒不含 token，幂等
重放不吐既有令牌，仓储返回值里没有 token 字段。放开的只有「刚触发签发的 admin 拿到
**他自己这次签发**的令牌**一次**」：能发起邀请的本来就是 admin，一次性回传不扩大任何
可再读的面。`reviewAdminInvite`（双人复核批准）**不**回传 token——批准人可用「重发」
生成新链接（approve 后状态是 `pending`，重发门放行），不为它单开第三条回传路径。

**前端落地**：
- 邀请/重发成功后展示一次性链接块（复制按钮 + 「只显示这一次」明示 + 复制失败降级
  为全选手抄），关闭/刷新后不可找回，只能重发。原「邮件通道未接通、受邀人拿不到链接」
  的诚实说明改写为新口径。
- 链接 = `{origin}/auth/activate?t=<token>`，路由与参数名的唯一事实源
  `apps/web/lib/activation-link.ts`。新增真实激活落地页
  `app/(entry)/auth/activate/page.tsx`（此前只有 API 与 mock 原型，链接无处可落）：
  新用户设姓名密码 / 已有账号确认加入，打真实 `POST /org-invites/activate`；
  失效四因只渲染同一句（V10 防枚举），不回显组织名。

## ② `listOrgInvites` 加 `invitedByUserId`

**问题**：发起人视角渲染「批准」按钮，点了必被 I-4（自批禁止）403——死按钮。
列表只有 `invitedBy`（展示名，可重名可改名），判不了「这条是不是我发起的」。

```ts
listOrgInvites.out.invites[] += { invitedByUserId: z.string() }
```

前端：`awaiting-review` 且 `invitedByUserId === session.userId` 时不渲染批准/拒绝，
改渲染「你发起的邀请：等待另一位管理员复核（不能自批）」。第二 admin 视角照常可批。

## ③ `inviteOrgMember.in.email` 收紧为服务端权威校验

基线里是 `z.string().min(1)`——`a@` 直接落库。contracts 包此前**没有**具名的
`EmailAddress` schema（派工单描述与实测不符，`auth.ts` 只有内联 `z.string().email()`），
故本 delta 在 `auth.ts` 新增 `export const EmailAddress = z.string().email()` 作为唯一
事实源（内联出现表达的本就是同一事实），`inviteOrgMember.in.email` 改用它。
`ZodBodyPipe` 的 400（`validation_failed`, path=`email`）由前端映射为可读的字段级文案。

## ④ `resolveIdentity` 带组织 `avatarUrl`

**问题**：组织头像的字节路由 `GET /organizations/:orgId/avatar-file/:id` 本来就允许
全员读（controller 长注在案），但**说出 URL** 的唯一读路径是 admin-only 的空补丁
`updateOrganization`——非 admin 永远拿不到 URL，左上角组织菜单回落首字。

```ts
// packages/contracts/src/identity.ts —— 加在 Organization 实体上
Organization += { avatarUrl: z.string().nullable() }
```

与迭代 1 Addendum A（displayName）、迭代 2 Addendum B（个人 avatarUrl）同一模式：
写路径存在、读路径缺席的补读。放实体而非 `resolveIdentity.out` 顶层，让
`switchOrganization`/`switchOrgAtLogin`（复用同一实体）一并得到。URL 拼装的唯一事实源
是后端 `avatarUrlFor`（`pg-org-profile-repository.ts`，`pg-identity-repository.ts` import
同一份）。`exportOrganization` 的 manifest 载荷无头像列，如实置 null（文内注释在案）。

**admin-only 空补丁读路径不退役**：组织资料标签页还需要 name/description（identity 只带
头像），且它是刚上传后不经 session 缓存的权威回读——两条读路径服务两种角色，不构成
同一事实的第二份声明。

**前端边界（有意分工）**：数据经 `session-provider` 的 `identity.org.avatarUrl` 全员可得。
左上角组织菜单组件 `org-menu.tsx` 在 PR #920（未合并）上，不在本分支基线里——该 PR 合并
后其 `useOrgAvatarUrl` 改为优先读 `identity.org.avatarUrl` 是几行的后续（本 delta 已把
数据递到手边），不在本 PR 里跨分支改别人未合并的文件。

## 不改的东西

- `OrgInvite` 实体、`listOrgInvites` 之外的列表读——token 仍然一处都不出现。
- 双人复核链路（I-3/I-4）、防枚举（V10）、限流（AUTH_POLICY）原样。
- `mutateTeam`/team-crud、org-profile 其余操作不在本 delta 范围。
