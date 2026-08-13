---
status: confirmed                # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: project
scope: member-roster-read + archive-blocked-error-code
decision: joinedAt-with-migration   # 本 delta 追加迁移 + 回填，照 org 侧 i363 形制
field_naming: as-drafted           # userId/projectRole 按本稿实测口径执行，不改回 memberId/role
archive_error_code: adopted        # ARCHIVE_BLOCKED_ACTIVE_SEGMENT（422 fail-closed）按提议形状采纳，落地需联动改 F164 反证测试
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-08-13"
---

# project 束 delta —— 成员名单读端点 + 归档被拦截的错误码

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `contracts/project/design-signoff.md`。
本文件的 `status` 变更归人类所有——**agent 不得改**（ADR-023）。

提出：2026-08-12（dev-project）。攒批依据：coord-main 2026-08-12 裁 P7 时的原话——
「别为一个错误码单独开一轮签核，等该束攒出下一批契约变更一起走」。现在凑齐两条。

---

## 变更一：`listProjectMembers` —— 成员名单没有读端点

### 实测事实（不是推测）

**形状与字段依据见同目录 `contract.md`；可执行验收见 `verification.md`。**

`packages/contracts/src/project.ts` 的全部 12 个 operation：

```
createProject / listProjects / getProjectOverview / archiveProject / unarchiveProject
createAgendaSegment / listAgendaSegments / advanceAgendaSegment / setAcceptedSources
addProjectMember / changeProjectRole / removeProjectMember
```

**三个写成员的操作齐全，零个读。** 唯一沾边的是 `getProjectOverview.out.roleCounts`，
其定义（第 277-284 行）是：

```ts
export const WorkshopRoleCounts = z.object({
  facilitator: z.number().int().nonnegative(),
  groupLead:   z.number().int().nonnegative(),
  member:      z.number().int().nonnegative(),
  observer:    z.number().int().nonnegative(),
}).strict();
```

**四个整数，是计数不是名单。**

### 后果

成员管理界面**建不出来**：

1. 列不出「这个项目有谁」；
2. `changeProjectRole` / `removeProjectMember` 都要求一个 `userId`，而界面无从得知有哪些 userId
   ——**三个写端点全部不可用，不是因为它们坏了，是因为够不着**。

后端侧 F125（加入/改角色/移除三用例）**已 passing**；缺的纯粹是读这一侧。

⚠ 这也让 `PROP-PROJECT-LIFECYCLE-E2E-001` 的 **P10「成员管理」结构性不可达**——
不是没做，是做不了。

### 提议的形状

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
  err: ["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"],   // 与既有三个写操作同源
}
```

字段选取依据：与 `addProjectMember.out` 的 `{projectId, userId, projectRole, isHost}` **逐字对齐**，
`displayName` 照同类读端点 `listOrgMembers` 的先例；不新造字段、不改写 phase-00 的
`identity.ProjectRole` 语义（该束原则）。逐字段依据见 `contract.md`。

### 显示名：已定 B（服务端 join 后返回）

F125 的行为契约里逐字写着「**展示别名不落库**」，所以这一条需要确认。

**已定：`out` 带 `displayName`，服务端 join 后返回**（coord-main 2026-08-12 口径）。

这不是新模式：同类读端点 `listOrgMembers`（`org-admin.ts:668-686`）就是这么做的，
其 `out[]` 逐字含 `userId` / `displayName` / `joinedAt`。「展示别名不落库」防的是
**把别名写进 project 的表**，不是「不许在响应里出现」——与该先例一致。

> 起草时曾列过「前端自己解析显示名」的候选，**实测排除**：identity 束唯一的解析端点是
> `GET /identity/me`（只解析当前登录者），`authorizeBatch` 是批量鉴权不返回名字，
> 全束没有「按 userId 批量取显示名」的端点。留着这个候选等于把研究成本转嫁给签核的人。

### ⚠ 两处与 coord-main 口径的**有依据偏离**（请人类一并确认）

coord-main 给的字段口径是「`memberId` / `displayName` / `role` / `joinedAt`」。落稿时按实测改了两处：

| 口径 | 本稿 | 依据 |
|---|---|---|
| `memberId` | **`userId`** | `addProjectMember.out.userId`（同束写操作）+ `listOrgMembers.out[].userId`（同类读先例）。用 `memberId` 会让同一概念在仓里有两个名字 |
| `role` | **`projectRole`** | `addProjectMember.in/out.projectRole`；先例 `listOrgMembers` 用的是束内限定名 `orgRole` |
| `joinedAt` | **本版不含** | `project_memberships` 表（`0003-identity.sql:60`）**没有 `joined_at` 列**；`org_memberships` 那一列是 i363 专门加的迁移。要它就要同形加迁移 + 回填——**是 schema 变更，不该藏在「顺手加个字段」里** |

⇒ **人类需就 `joinedAt` 做一次选择**：本 delta 追加迁移（照 i363 形制）｜ 本版不要、将来另提。
前两处若人类认为应照口径字面执行，改回即可，实现尚未开始。

---

## 变更二：`ARCHIVE_BLOCKED_ACTIVE_SEGMENT` —— 归档被拦截却没有码

### 实测事实

`KNOWN_CONTRACT_GAPS.P7`。U-2⑵「有进行中环节时拒绝归档」这条**已裁定的失败**：

- 仓储返回 `active-segment-exists`（`pg-project-archive-repository.ts:83`）
- → 用例抛 `ProjectArchiveBlockedByActiveSegmentError`（`application/project/errors.ts:46`，**故意不带 reasonCode**）
- → 控制器 catch 后抛**裸 400，无 reasonCode 字段**（`project.controller.ts:516-518`）

`archiveProject.err` 现为 `["ORG_ROLE_INSUFFICIENT", "PROJECT_ARCHIVED", "AUTH_SERVICE_UNAVAILABLE"]`，
**表达不了这一条**。

### 后果（已在产品里可见）

前端拿到 `HTTP 400` 且 `reasonCode` 为空，**无法如实告诉用户「因为有环节正在进行」**。
F164（#1038，已合入）按 coord-main 裁决 (a) 显示通用「操作失败（HTTP 400）」，
并有一条测试**断言文案里不得出现「环节/进行中/正在/收尾」**——即产品里现在有一处
**已知的、被测试钉住的表达缺失**，等本 delta 补码后才能解开。

### 提议的形状

```ts
archiveProject.err: [
  "ORG_ROLE_INSUFFICIENT",
  "PROJECT_ARCHIVED",
+ "ARCHIVE_BLOCKED_ACTIVE_SEGMENT",     // 422 fail-closed
  "AUTH_SERVICE_UNAVAILABLE",
]
```

命名与状态码依据：与 PJ-13 已裁的 `BLUEPRINT_NOT_APPLICABLE`（422 fail-closed）**同形**，
不新造一套约定。

### 落地时必须同时改的三处（否则补了码等于没补）

1. `application/project/errors.ts:46` 的 `ProjectArchiveBlockedByActiveSegmentError` 补上 reasonCode；
2. `project.controller.ts:516-518` 从抛裸 400 改为抛带码的 422；
3. **F164 那条反证测试要跟着改**：把「不得出现原因文案」改成「必须显示该 reasonCode」。
   ⚠ 不改它，测试会挡住正确的实现——这正是那条测试该有的行为（它钉的是「不许编」，
   补码后「说出来」就不再是编）。

---

## 本 delta **不**改什么

- 不改 `contracts/project/design-signoff.md` 的任何字段（那是已签核束，本包与它并列）。
- 不改 `identity.ProjectRole` 的语义（四取值闭集，phase-00 权威）。
- 不新增删除项目的任何接口（Q-9 裁「不提供删除项目」，`no-forbidden-routes.test.ts` 有断言）。
- 不动 `roleCounts`——它继续服务概览页的计数用途，与名单各司其职。

## 签核这份 delta 需要人类做的

1. 确认**变更一**的形状（四字段 + `NO_PROJECT_ROLE` 权限口径）。
2. **就 `joinedAt` 二选一**，填进 frontmatter 的 `decision`：
   - `joinedAt-with-migration` —— 本 delta 追加一条迁移 + 回填，照 i363 形制；
   - `no-joinedAt` —— 本版 out 不含该字段（当前稿即此），将来需要时另提。
3. 确认**变更二**的码名与 422 语义。
4. 把 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。

⚠ 另请一并确认第 100 节那两处**与 coord-main 口径的有依据偏离**（`memberId → userId`、
`role → projectRole`）。若认为应照口径字面执行，改回即可——实现尚未开始，改动成本为零。

**在此之前，PJ-05（成员管理接真）不开工**——`claim` 门会拒，这是设计如此。

## 人类裁决（2026-08-13）

三点全部按本稿默认/建议方向确认：
1. 变更一形状（四字段 + `NO_PROJECT_ROLE`）——确认。
2. `joinedAt` —— **`joinedAt-with-migration`**：本 delta 需要追加一条迁移 + 回填，照 i363 形制，
   不是本版默认（本版原稿是 `no-joinedAt`）——实现时请注意这一条比原稿多了 schema 变更范围。
3. 字段命名 `userId`/`projectRole` —— 按本稿实测口径执行，不改回 `memberId`/`role`。
4. 变更二 `ARCHIVE_BLOCKED_ACTIVE_SEGMENT`（422 fail-closed）—— 采纳，落地时三处联动
   （`errors.ts` 补码 / controller 改 422 / F164 反证测试同步改断言方向）缺一不可。
