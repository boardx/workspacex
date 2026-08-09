# 组织资料编辑 + 成员/邀请列表读 contract delta

Status: proposed; human signoff required.

本文件是本 delta 的**唯一规范来源**。已签核的 `org-admin` 束保持不变、不被静默修改；
若本包与既有束冲突，实现停下来，等人类签这份 delta。

## 背景（实测事实）

- **写侧大部分已存在且已签核/已接线**：`inviteOrgMember`（`org-admin.ts:278`，controller+use case
  均已实现）、`resendOrgInvite`/`revokeOrgInvite`（今晚 PR #590 已接线）——邀请发送/重发/撤销
  这条链路是真的，不是本 delta 的范围。
- **读侧是真正的缺口（#363，2026-08-05 提出，一直未签）**：`GET /organizations/:orgId/members`、
  `GET /organizations/:orgId/invites` 契约里都没有，`apps/web/components/org-admin/
  members-screen.tsx`/`invites-screen.tsx` 现在整页读 `lib/mock/org-admin.ts`，UI 存在但数据
  是假的——邀请出去的人进不了这张列表。
- **组织资料编辑完全不存在**：`organizations` 表（`0003-identity.sql`）只有
  `id / name / kind / model_policy` 四列，没有头像、没有简介；也没有任何 `updateOrganization`
  一类的契约操作。`name` 目前只在创建时写一次。

## 1. 契约操作

```ts
// packages/contracts/src/org-admin.ts（追加，不新建文件）

listOrgMembers: {
  method: "GET",
  path: "/organizations/:orgId/members",
  in: z.object({ orgId: z.string() }).strict(),
  out: z.object({
    members: z.array(z.object({
      userId: z.string(),
      displayName: z.string(),
      email: z.string(),
      orgRole: OrgRole,          // 复用已有的角色枚举，不新造
      teamId: z.string().nullable(),
      joinedAt: z.string(),
      status: z.enum(["active", "suspended"]),
    })),
  }).strict(),
  err: ["FORBIDDEN"] as const,
},

listOrgInvites: {
  method: "GET",
  path: "/organizations/:orgId/invites",
  in: z.object({ orgId: z.string() }).strict(),
  out: z.object({
    invites: z.array(z.object({
      inviteId: z.string(),
      email: z.string(),
      status: OrgInviteStatus,   // 复用已有枚举
      invitedBy: z.string(),
      expiresAt: z.string(),
    })),
  }).strict(),
  err: ["FORBIDDEN"] as const,
},

/** ⚠ §4② 已签：头像走同 uploadOwnAvatar 的纪律（对象存储+PG元数据），不接受裸 URL。
 *  简介长度上限 500 字——超出前端裁断言，不是产品上限的裁决点，属工程默认。 */
uploadOrgAvatar: {
  method: "POST", path: "/organizations/:orgId/avatar",
  in: z.object({
    orgId: z.string(),
    filename: z.string().min(1),
    sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
    sha256: z.string(),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }).strict(),
  out: z.object({ orgAvatarArtifactId: z.string(), avatarUrl: z.string() }).strict(),
  err: ["FORBIDDEN", "FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE"] as const,
},

updateOrganization: {
  method: "PATCH", path: "/organizations/:orgId",
  in: z.object({
    orgId: z.string(),
    name: z.string().min(1).optional(),
    description: z.string().max(500).optional(),
    avatarArtifactId: z.string().nullable().optional(),
  }).strict(),
  out: z.object({
    name: z.string(),
    description: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }).strict(),
  err: ["FORBIDDEN", "AVATAR_ARTIFACT_NOT_OWNED"] as const,
},
```

## 2. 用例

- `listOrgMembers`/`listOrgInvites`：任何组织成员可读（不限 admin——看到"组织里有谁"不是敏感操作，
  见 §4①）；`orgId` 与会话主体的组织成员资格核对，非成员 `FORBIDDEN`。
- `updateOrganization`：仅组织 admin（与 team-crud 的先例一致）。
- `uploadOrgAvatar`：仅组织 admin；校验同 `uploadOwnAvatar`（服务端重新做 magic-byte 嗅探，
  不信任客户端声明的 content-type）。

## 3. 边界与拒绝

- `organizations` 表需要迁移新增 `avatar_artifact_id`、`description` 两列（`avatar_url` 由
  artifact 记录派生，不额外存列，与 `credentials`/头像那条同一模式）。
- 不在本 delta 处理"删除组织"或"转让所有权"——那是更大的裁决，不混进来。

## 4. 需要你先拍板的两件

**① 成员/邀请列表谁能读？**
建议"任何组织成员可读成员列表"（不限 admin）——原因：这是协作场景的常见需求（知道同事是谁），
且比读取更敏感的操作（改角色、移除成员）本来就已经有 admin 限制。但**邀请列表**可能想更严格
（未接受的邀请邮箱是否该让所有成员看到？）——如果你认为邀请列表也要限 admin，请明确说，
两个列表的权限可以不同。

**② 组织简介的内容边界？**
纯文本、还是要支持简单 markdown（加粗/链接）？纯文本更安全（不用担心 XSS/渲染成本），
markdown 更好看但要多一层 sanitize。建议先做纯文本，这不是不可逆决定——markdown 可以下一轮加。

## 5. 前端边界

- `/org-admin` 增加"组织资料"标签页（名称/头像/简介编辑）；"成员"、"邀请"两个标签页从
  `apps/web/components/org-admin/{members-screen,invites-screen}.tsx` 迁移过来并接真实数据
  （这两个组件已经存在，只是现在读 mock——迁移时把 `lib/mock/org-admin.ts` 的导入换成真实
  `live-org-admin.ts` 调用，UI 结构基本不用重画）。
- 这两个组件原来挂在 `/admin/[module]` 下（系统级后台），迁移到 `/org-admin` 后**从 `/admin`
  的导航里摘掉**，避免同一功能两个入口（本仓已经因为这个踩过五次坑）。

## 明确排除（本轮不做）

- 修改成员角色、移除成员的 UI 接线——虽然后端 `remove-org-member.ts` 已存在，本 delta 只做
  "列出"，角色变更/移除留给下一轮（读会先暴露真实数据，才知道改/删的 UI 该长什么样）。
- 组织头像/简介以外的组织级设置（比如 `model_policy`）——不在本轮范围。
