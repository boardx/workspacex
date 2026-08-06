# 用户个人资料自助服务 contract delta（#638）

Status: proposed; human signoff required.

本文件是本 delta 的**唯一规范来源**。已签核的 `identity`/`auth` 束保持不变、不被静默修改；
若本包与既有束冲突，实现停下来，等人类签这份 delta。

## 背景（实测事实，SHA `76480df9`）

- `credentials.display_name` 字段存在（`0010-auth-credentials-sessions.sql`），但**没有任何
  UPDATE 路径**——本仓「本模型没有独立的 users 表」的设计原则下，改名就是改这一列。
- `credentials` 表**没有头像列**，需要迁移新增。
- 现有的 `passwordReset`（`packages/contracts/src/auth.ts`）是**未登录**、走邮箱令牌那条；
  **已登录用户主动改密码**是完全不同的操作，零契约。
- `login.out.orgIds` + `switchOrganization`（F22）已覆盖多组织切换；**只缺组织名的展示**，
  这条今晚已用 `resolveIdentity` 按组织多次调用的方式在 #596/#599 里绕过，**不需要新契约**。
- `adminAuditRead`（`packages/contracts/src/chat.ts:349`）是**管理员**审计读，不是自助端点。

## 1. 契约操作

```ts
// packages/contracts/src/identity.ts（追加，不新建文件——与 resolveIdentity 等同域）

updateOwnProfile: {
  method: "PATCH", path: "/identity/me",
  in: z.object({
    displayName: z.string().min(1).optional(),
    avatarUrl: z.string().url().optional(),
  }).strict(),
  out: z.object({ displayName: z.string(), avatarUrl: z.string().nullable() }).strict(),
  err: ["INVALID_INPUT"] as const,
},

changeOwnPassword: {
  method: "POST", path: "/identity/me/password",
  in: z.object({
    currentPassword: z.string().min(1),
    newPassword: PasswordPolicy,   // 复用 auth.ts 已有的密码策略单一事实源，不重开一份
  }).strict(),
  out: z.object({ changed: z.literal(true) }).strict(),
  err: ["CURRENT_PASSWORD_INVALID", "PASSWORD_POLICY_VIOLATION"] as const,
},

listOwnActivity: {
  method: "GET", path: "/identity/me/activity",
  in: z.object({ cursor: z.string().nullable(), limit: z.number().int().min(1).max(100) }).strict(),
  out: z.object({
    events: z.array(z.object({
      eventId: z.string(), kind: z.string(), occurredAt: z.string(), summary: z.string(),
    })),
    nextCursor: z.string().nullable(),
  }).strict(),
  err: [] as const,
},
```

## 2. 用例（application 层，跟随已有 identity 用例的写法）

- `updateOwnProfile`：读会话主体 `userId`，`UPDATE credentials SET display_name=…, avatar_url=…`。
  不接受修改邮箱——邮箱是登录凭据的一部分，改邮箱是另一个更敏感的操作，本包不做。
- `changeOwnPassword`：先用现有的密码校验器验 `currentPassword`，验过才允许写新哈希。
  **不允许跳过当前密码校验**——即使是已认证会话，这条是防会话劫持后静默改密的最后一道。
- `listOwnActivity`：按 `actorUserId = 会话主体` 过滤读 provenance/audit 表（表选型见 §4③）。

## 3. 边界与拒绝

- `avatarUrl` 一旦落库是存储层职责之外的事——本 delta 只定义"存一个 URL 字符串"，
  上传/校验/托管归 §4① 的裁决，不在本契约里预设答案。
- `changeOwnPassword` 的 `newPassword` 复用 `PasswordPolicy`，**不允许弱于**现有注册/重置路径的强度要求。

## 4. 需要你先拍板的三件

**① 头像存 URL 还是走已有的 artifact 上传链路？**
两条路径的错误处理、大小限制、审计口径完全不同，不是实现细节，是产品决定。

**② 改密后要不要吊销其他会话？**
建议参考 `password-reset.ts` 里"只吊销当前会话"还是"全部吊销"的先例——如果那条先例不适用于
"用户自己主动改密"（威胁模型不同：密码重置往往假设账号已失控，主动改密不一定），需要重新判断。

**③ 活动记录读哪张表？**
如果复用 `provenance_events`（`adminAuditRead` 读的那张），需要确认按 `actorUserId` 过滤
是否已有索引——没有的话全表扫是真实的性能问题，不是"以后再优化"。

## 5. 前端边界

- `/settings/profile` 或等价路径（testid 待定，跟随现有 `login-*`/`chat-*` 前缀风格）；
- 改姓名/头像、改密码、活动记录列表三块可以是同一页的三个区块，也可以拆页——UI 细节留给
  ui-prototyper，不在本 delta 里预定。

## 明确排除（本轮不做）

- 多组织**管理**（离开组织、转让所有权）——本包只做"查看"。
- 改邮箱——邮箱是登录凭据，另一个 delta。
