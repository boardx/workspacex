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

/** ⚠ §4① 已签：头像走 artifact 存储纪律，不接受外部裸 URL（O-17 同款审计口径）。
 *  但 `files.ts` 的 `uploadArtifact` 是**项目态**契约（projectId/agendaSegmentId/confidential/
 *  visibilityScope 均是项目语义），个人头像没有项目上下文，字面复用会硬凑不适用的字段。
 *  ⇒ 新开一个**极简版**、专属头像的上传操作，复用的是"对象存储 + PG 元数据"这条**纪律**
 *  （大小/内容类型限制、失败不留幽灵对象），不是那个 contract 操作本身。 */
uploadOwnAvatar: {
  method: "POST", path: "/identity/me/avatar",
  in: z.object({
    filename: z.string().min(1),
    sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),  // 5MB 上限，头像不需要更大
    sha256: z.string(),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }).strict(),
  out: z.object({ avatarArtifactId: z.string(), avatarUrl: z.string() }).strict(),
  err: ["FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE"] as const,
},

updateOwnProfile: {
  method: "PATCH", path: "/identity/me",
  in: z.object({
    displayName: z.string().min(1).optional(),
    /** null = 清空头像回默认；非 null 必须是 uploadOwnAvatar 刚返回的 avatarArtifactId —— 
     *  不接受任意字符串,服务端要校验这个 artifact 属于当前用户 */
    avatarArtifactId: z.string().nullable().optional(),
  }).strict(),
  out: z.object({ displayName: z.string(), avatarUrl: z.string().nullable() }).strict(),
  err: ["INVALID_INPUT", "AVATAR_ARTIFACT_NOT_OWNED"] as const,
},

/** ⚠ §4② 已签：主动改密 = 全部吊销——除本次请求所在会话外，强制其它设备/会话下线。
 *  与 `password-reset.ts`「未登录邮箱令牌流程只吊销当前会话」是**不同威胁模型**，
 *  不要把那条先例的实现抄过来；这里必须新写「吊销除本会话外的全部」这条路径。 */
changeOwnPassword: {
  method: "POST", path: "/identity/me/password",
  in: z.object({
    currentPassword: z.string().min(1),
    newPassword: PasswordPolicy,   // 复用 auth.ts 已有的密码策略单一事实源，不重开一份
  }).strict(),
  out: z.object({ changed: z.literal(true), revokedSessionCount: z.number().int().nonnegative() }).strict(),
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

- 头像走 `uploadOwnAvatar` → 拿到 `avatarArtifactId` → 再传给 `updateOwnProfile`，两步而非一步，
  跟 `uploadArtifact` 的"先落对象存储再落 PG 元数据"纪律一致；`updateOwnProfile` 收到的
  `avatarArtifactId` 必须校验属于当前用户，否则 `AVATAR_ARTIFACT_NOT_OWNED`。
- `changeOwnPassword` 的 `newPassword` 复用 `PasswordPolicy`，**不允许弱于**现有注册/重置路径的强度要求。
- `changeOwnPassword` 成功后**必须**吊销除当前会话外的全部会话，`revokedSessionCount` 如实回传
  （哪怕是 0——不能为了看起来"有效果"就编数）。

## 4. 需要你先拍板的三件 —— 已签（2026-08-07，人类在会话中经 AskUserQuestion 逐条选定）

**① 头像存 URL 还是走已有的 artifact 上传链路？→ 选了"走 artifact 上传链路"。**
实测发现 `uploadArtifact`（`files.ts`）是**项目态**契约（projectId/agendaSegmentId/confidential/
visibilityScope 全是项目语义），个人头像没有项目上下文，字面复用会硬凑不适用的字段。
⇒ 落地为新开 `uploadOwnAvatar`（见 §1），复用的是"对象存储 + PG 元数据、大小/类型限制、失败不留
幽灵对象"这条**纪律**，不是那个 contract 操作字面本身——这个技术调整已经如实记在这里，不是自己
悄悄改了人类的决定。

**② 改密后要不要吊销其他会话？→ 选了"全部吊销"。**
`changeOwnPassword` 成功后强制吊销除当前会话外的全部会话，`out.revokedSessionCount` 回传实际数字。

**③ 活动记录读哪张表？→ 复用 `provenance_events`，索引已存在，不需要新迁移。**
实测 `0005-f03-admin-boundary.sql`：`provenance_events_actor_idx ON provenance_events (org_id, actor_id, at DESC)`
已覆盖按 `actorUserId`（即 `actor_id`）过滤的查询模式，不是全表扫——这条是工程判断，不占用人类的三个裁决位。

## 5. 前端边界

- `/settings/profile` 或等价路径（testid 待定，跟随现有 `login-*`/`chat-*` 前缀风格）；
- 改姓名/头像、改密码、活动记录列表三块可以是同一页的三个区块，也可以拆页——UI 细节留给
  ui-prototyper，不在本 delta 里预定。

## 明确排除（本轮不做）

- 多组织**管理**（离开组织、转让所有权）——本包只做"查看"。
- 改邮箱——邮箱是登录凭据，另一个 delta。

## Addendum A（2026-08-08，迭代 1 独立 UIUX 复核后追加，需要单独签核）

**发现**：迭代 1（PR #736）实现了 `updateOwnProfile` 的写路径（`displayName` 落库），但**没有对应
的读路径**——`identity.ts` 里已签核的 `resolveIdentity`（登录/会话解析用的那个契约操作）不带
`displayName` 字段，前端 `session-provider.tsx` 只能拿 `userId` 当显示名占位。结果是：用户改名、
界面提示"已保存"、数据库也确实更新了，但**产品里所有读到"显示名"的地方都不会变**——这是
rev-uiux 独立复核给出的最严重扣分项（评分 8/10，`saved` 反馈判定为"看起来有效果实际没有"）。

**契约变更**（`packages/contracts/src/identity.ts`，扩展**已签核**的 `resolveIdentity`，不新建操作）：

```ts
resolveIdentity: {
  // ...其余字段不变...
  out: z.object({
    // ...其余字段不变...
    displayName: z.string(),   // 新增：来自 credentials.display_name；这一列已存在，只是从未被读出来过
  }).strict(),
},
```

**这条 Addendum 需要单独签核**——它扩展的是一个已经 `confirmed` 的契约操作，不是本包里那三条
待签裁决的一部分，不能被"整包已签"覆盖过去。见 `design-signoff.md` 底部的独立签核块。
