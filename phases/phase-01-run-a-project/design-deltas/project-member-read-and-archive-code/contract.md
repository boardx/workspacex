# 成员名单读端点 + 归档拦截错误码 contract delta（#999 / PJ-05）

本文件描述**契约面的两处变更**。`design-signoff.md` 是签核件，本文件是它的依据材料。

---

## ① `listProjectMembers` —— 新增读端点

```ts
listProjectMembers: {
  method: "GET",
  path: "/projects/:projectId/members",     // 与 addProjectMember 同路径，方法不同
  in: z.object({ projectId: z.string() }).strict(),
  out: z.object({
    members: z.array(
      z.object({
        userId: z.string(),
        displayName: z.string(),
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        isHost: z.boolean(),
      }).strict(),
    ),
  }).strict(),
  err: ["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"] as const,
}
```

### 字段命名的依据（不是新造，是对齐既有两处）

| 字段 | 依据 |
|---|---|
| `userId` | `addProjectMember.out.userId`（同束写操作）+ `listOrgMembers.out[].userId`（`org-admin.ts:677`，同类读端点先例） |
| `displayName` | `listOrgMembers.out[].displayName`（`org-admin.ts:678`）—— 同一模式，服务端 join 后返回 |
| `projectRole` | `addProjectMember.in/out.projectRole`；先例 `listOrgMembers` 用的是束内限定名 `orgRole`，项目侧对应即 `projectRole` |
| `isHost` | `addProjectMember.out.isHost` |

⚠ **不用 `memberId` / `role`**。coord-main 2026-08-12 的口径给的是「memberId/displayName/role/joinedAt」，
但实测两处先例（`addProjectMember.out`、`listOrgMembers.out`）都用 `userId` 与束内限定的角色名。
沿用口径的字面会让**同一个概念在仓里有两个名字**——这正是 AGENTS.md 点名的
「同一事实不得声明在两处」反模式（本项目已因此漂移五次）。**已向 coord-main 回报并按先例落。**

### ⚠ `joinedAt` 未纳入本版 —— 它不是免费字段

coord-main 的口径里有 `joinedAt`。实测：

```sql
-- apps/api/migrations/0003-identity.sql:60
CREATE TABLE IF NOT EXISTS project_memberships (
  user_id, project_id, org_id, project_role, group_id, is_host
  -- 没有 joined_at
);
```

`org_memberships` 的 `joined_at` 是 **i363 专门加的一列**
（`20260809060000_i363_org_profile_membership.sql:38`，正是为了 `listOrgMembers.out.joinedAt`）。

⇒ 项目侧要 `joinedAt` 就要**同形加一次迁移 + 回填**。这是可以做的（先例现成），但它是
**一次 schema 变更**，不该藏在「顺手加个字段」里。**留给人类在签核时决定**：

- **要**：本 delta 追加一条迁移（`ALTER TABLE project_memberships ADD COLUMN joined_at timestamptz` + 回填），照 i363 形制；
- **不要**：本版 out 不含该字段（当前草案即此），将来需要时另提。

### 权限

**项目成员可读全名单。** 依据：`getProjectOverview.out.roleCounts` 已经把四个角色的**计数**暴露给
项目成员；从「知道有 3 个组员」到「知道这 3 个组员是谁」不构成新的可见性层级。
⇒ `err` 用 `NO_PROJECT_ROLE`（与同束三个写操作同源），不新增可见性判据。

### 明确不做

- **不加分页 / 搜索 / 排序**。成员数量级用不上；加了就是新设计面（coord-main 口径，采纳）。
- 不改 `roleCounts`——它继续服务概览页计数，与名单各司其职。
- 不改 `identity.ProjectRole` 语义（四取值闭集，phase-00 权威）。

---

## ② `archiveProject.err` 追加 `ARCHIVE_BLOCKED_ACTIVE_SEGMENT`

```diff
 archiveProject.err: [
   "ORG_ROLE_INSUFFICIENT",
   "PROJECT_ARCHIVED",
+  "ARCHIVE_BLOCKED_ACTIVE_SEGMENT",   // 422 fail-closed
   "AUTH_SERVICE_UNAVAILABLE",
 ]
```

### 依据

`KNOWN_CONTRACT_GAPS.P7`。U-2⑵「有进行中环节时拒绝归档」是**已裁定的失败**，后端**已实现拦截**：

- `pg-project-archive-repository.ts:83` 返回 `active-segment-exists`
- → `application/project/errors.ts:46` 抛 `ProjectArchiveBlockedByActiveSegmentError`（**故意不带 reasonCode**）
- → `project.controller.ts:516-518` catch 后抛**裸 400**

命名与状态码对齐 PJ-13 已裁的 `BLUEPRINT_NOT_APPLICABLE`（422 fail-closed），不新造约定。

### 落地时必须同改的三处

1. `application/project/errors.ts:46` —— 补 reasonCode；
2. `project.controller.ts:516-518` —— 裸 400 改为带码 422；
3. **`apps/web/tests/ui/projects-screen-live.test.tsx` 的 P7 反证测试** —— 现在断言
   「错误文案里**不得**出现『环节/进行中/正在/收尾』」，补码后要改成「**必须**显示该 reasonCode」。

⚠ 第 3 条不改，测试会挡住正确的实现——**而那正是它该有的行为**：它钉的是「不许编造原因」，
补码之后「说出真原因」不再是编造。

---

## 本 delta 不改什么

- 不改 `contracts/project/design-signoff.md` 的任何字段（本包与它**并列**，不是修改）
- 不新增删除项目的任何接口（Q-9 裁「不提供删除项目」，`no-forbidden-routes.test.ts` 有断言）
- 不动 phase-00 的 `identity.ProjectRole`
