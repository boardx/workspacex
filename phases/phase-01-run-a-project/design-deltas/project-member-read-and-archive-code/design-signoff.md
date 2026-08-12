---
status: pending                  # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: project
scope: member-roster-read + archive-blocked-error-code
decision: ~                      # ③ 的三个候选待人类选定
confirmed_by: ~
confirmed_at: ~
---

# project 束 delta —— 成员名单读端点 + 归档被拦截的错误码

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `contracts/project/design-signoff.md`。
本文件的 `status` 变更归人类所有——**agent 不得改**（ADR-023）。

提出：2026-08-12（dev-project）。攒批依据：coord-main 2026-08-12 裁 P7 时的原话——
「别为一个错误码单独开一轮签核，等该束攒出下一批契约变更一起走」。现在凑齐两条。

---

## 变更一：`listProjectMembers` —— 成员名单没有读端点

### 实测事实（不是推测）

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
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        isHost: z.boolean(),
        // ⚠ displayName 见下方「③ 待裁」——本草案**故意留空**，不预设答案
      }).strict(),
    ),
  }).strict(),
  err: ["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"],   // 与既有三个写操作同源
}
```

字段选取依据：与 `addProjectMember.out` 的 `{projectId, userId, projectRole, isHost}` **逐字对齐**，
不新造字段、不改写 phase-00 的 `identity.ProjectRole` 语义（该束原则）。

### ③ 待裁：名单要不要带显示名，从哪来

F125 的行为契约里逐字写着「**展示别名不落库**」。所以成员表里没有可直接返回的名字，
名单只能给 `userId`。三个候选：

| 候选 | 做法 | 代价 |
|---|---|---|
| **A** | `out` 只给 `userId`，前端另调身份服务解析显示名 | ⛔ **今天不可行**，见下 |
| **B** | `out` 带 `displayName`，服务端 join 身份表后返回 | 前端一次拿全；需确认「不落库」的边界（不落库 ≠ 不可返回，但这是人类要确认的事） |
| **C** | 本版只给 `userId`，`displayName` 留待身份束新增批量解析端点后再补 | 边界最清；但要**先在 identity 束加一个新端点**（另一份 delta + 另一轮签核），且第一版界面显示 id 而非人名 |

#### ⛔ 候选 A 已被实测排除

我原本把 A 写成「前端另调身份服务解析」并标注「该端点是否存在未核」。**核了，不存在**：

- `identity` 契约里唯一解析身份的是 `resolveIdentity`，其 path 是 **`GET /identity/me`**，
  `in` 只有 `{orgId, projectId?}` ——**只能解析当前登录者，不能按 userId 解析别人**。
- `authorizeBatch`（`POST /identity/authorize-batch`）是**批量鉴权**，不返回 `displayName`。
- 全束**没有**「按 userId 批量取显示名」的端点。

⇒ **A 今天做不到**；C 实质上是「A + 先给 identity 束加一个新端点」，代价是多一轮签核。

**我倾向 B**：「不落库」防的是**把别名写进 project 的表**，不是「不许在响应里出现」——
B 不违反它，且不需要动 identity 束。**但这句话是我对该约束的解读，必须由人类确认**，
所以本草案的 `out` 里没有预先塞 `displayName`。

若人类选 C，请一并裁「identity 束新增批量解析端点」那份 delta 由谁提、走哪个束。

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

### 落地时必须同时改的两处（否则补了码等于没补）

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

1. 确认**变更一**的形状，并在 ③ 的 A / B / C 里选一个（填进 frontmatter 的 `decision`）。
2. 确认**变更二**的码名与 422 语义。
3. 把 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。

**在此之前，PJ-05（成员管理接真）不开工**——`claim` 门会拒，这是设计如此。
