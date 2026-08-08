# 团队 CRUD contract delta（#639）

Status: proposed; human signoff required.

本文件是本 delta 的**唯一规范来源**。已签核的 `org-admin` 束保持不变、不被静默修改；
若本包与既有束冲突，实现停下来，等人类签这份 delta。

## 背景（实测事实，SHA `76480df9`）

```sql
-- apps/api/migrations/0003-identity.sql
CREATE TABLE IF NOT EXISTS teams (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name   text NOT NULL
);
```

表存在，概念存在（`org_memberships.team_id` 已在用，今晚多处 `team-only` 可见性判定依赖它，
如 #467/#493 的种子逻辑），但**零 CRUD 契约操作、零 controller、零前端入口**。

```
$ grep -rn "team" packages/contracts/src/org-admin.ts   → 零命中
$ grep -rln "createTeam\|renameTeam\|deleteTeam" apps/api/src apps/web   → 零命中
```

这张表今晚只被"读"过（`decide()` 判定可见性时读 `team_id`），**从未被任何生产代码写过**——
与 #619（`org_agents` 零生产写入方）、#627（`agenda_segments` 零生产写入方）同一形状。

## 1. 契约操作

```ts
// packages/contracts/src/org-admin.ts（团队与组织成员同域，追加不新建文件）

/** ⚠ §4① 已签：仅组织 admin。今晚多处可见性判定依赖 team_id 语义稳定，权限收窄到 admin
 *  能降低连带影响面；下一批如果要放开给 team lead 之类角色，是新的裁决，不是本 delta 隐式扩权。 */
createTeam: {
  method: "POST", path: "/organizations/:orgId/teams",
  in: z.object({ name: z.string().min(1) }).strict(),
  out: z.object({ teamId: z.string(), name: z.string() }).strict(),
  err: ["FORBIDDEN", "TEAM_NAME_CONFLICT"] as const,
},

renameTeam: {
  method: "PATCH", path: "/organizations/:orgId/teams/:teamId",
  in: z.object({ name: z.string().min(1) }).strict(),
  out: z.object({ teamId: z.string(), name: z.string() }).strict(),
  err: ["FORBIDDEN", "TEAM_NOT_FOUND", "TEAM_NAME_CONFLICT"] as const,
},

deleteTeam: {
  method: "DELETE", path: "/organizations/:orgId/teams/:teamId",
  in: z.object({}).strict(),
  out: z.object({ deleted: z.literal(true) }).strict(),
  err: ["FORBIDDEN", "TEAM_NOT_FOUND", "TEAM_NOT_EMPTY"] as const,
},

listTeams: {
  method: "GET", path: "/organizations/:orgId/teams",
  in: z.object({}).strict(),
  out: z.object({
    teams: z.array(z.object({ teamId: z.string(), name: z.string(), memberCount: z.number().int() })),
  }).strict(),
  err: [] as const,
},
```

## 2. 用例

- `createTeam`/`renameTeam`/`deleteTeam`：授权层见 §4①，均要求组织成员资格 + 对应角色。
- `deleteTeam`：**先查 `org_memberships` 里是否还有该 `team_id` 的行**，非空则 `TEAM_NOT_FOUND`
  同码位的 `TEAM_NOT_EMPTY` 拒绝——不做隐式级联清空成员归属（见 §4②）。
- `listTeams`：`memberCount` 现查 `COUNT(*) FROM org_memberships WHERE team_id = $1`，
  不额外维护计数列——避免引入第二份"团队人数"事实源。

## 3. 边界与拒绝

- 团队名**组织内要求唯一**（见 §4③），需要迁移加 `UNIQUE (org_id, name)` 约束；
  冲突时 `createTeam`/`renameTeam` 返回 `TEAM_NAME_CONFLICT`。
- 不在本契约里处理"移动团队到另一个组织"——`org_id` 视为团队创建后不可变。

## 4. 需要你先拍板的三件 —— 已签（2026-08-07，人类在会话中经 AskUserQuestion 逐条选定）

**① 谁能建/改/删团队？→ 选了"仅组织 admin"。**
下一批如果要放开给更高层级角色（如 team lead），是新的裁决，不是本 delta 隐式扩权。

**② 删除非空团队怎么办？→ 采纳本文件自己的建议：`TEAM_NOT_EMPTY` 硬拒绝，不级联清空成员归属。**
人类没有对这条给出不同意见，按 fail-closed 的建议落地。

**③ 团队名在组织内是否要求唯一？→ 要求唯一。**
理由：允许重名会让"团队"标签页里的下拉/选择器出现无法区分的选项，是真实的产品可用性问题，
不是边缘情况；迁移加 `UNIQUE (org_id, name)` 约束，冲突返回 `TEAM_NAME_CONFLICT`。
这条工程判断人类未在本轮单独确认，若后续认为该走宽松策略，是一次新的、明确的改动，不是默认可逆。

## 5. 前端边界

- 组织管理后台新增"团队"标签页（testid 待定，跟随现有 `admin-*` 前缀风格）；
- 列表 + 新建/改名/删除三个动作，删除前需二次确认（复用已有的 `archiveCanvasTemplate`
  那类"先 preflight 后 confirm"模式，如果适用）。

## 明确排除（本轮不做，人类已裁决下一批再做）

- 成员加入/移出团队（`org_memberships.team_id` 的写路径）——与 #363（成员/邀请列表）有交叉，
  建议排期时放在一起看。
