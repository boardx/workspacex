# 组织管理员任命「Skill 审核人职能」—— contract delta

Status: proposed; human/coord-main signoff required（ADR-023：新增契约 operation = 新增
设计面，即使是纯粹的「补一条已被设计承认但从未开的口子」，也不满足「零新增设计面」的
免签核条件——照 `skill-tags` delta 先例）。

来源：issue #852（CLR track R，R8）。实测 SHA `29f587b3`：`skill_reviewer_functions`
全仓零生产写入方，`functionOf()` 恒返回 null，一个新组织永远造不出「已启用」的 skill。

派工依据：dev-chat-e2e worker 按 issue 指示，在实现前先出本 delta；不自行把 status 改
成 confirmed，等人类或 coord-main 代人类确认（照 skill-tags / token-quota-and-usage 先例，
实现与签核可并行，PR 合并前需要这份文件或对应 PR 评论留痕确认）。

---

## 0. 这不是一个全新的设计面，是补一个已经被设计承认、从未开口子的操作

`skills/domain.md`「`ReviewerFunction`（值对象）」一节原文：

> `methodology-reviewer` / `security-reviewer`……**授予方式**：组织管理员指派，
> **组织级**职能授权，可跨团队。

`skills/coverage.md` V14 与缺口清单 #6 原文：

> 两种审核职能不合并：各自越界裁决被拒；**指派只有组织管理员可做**……
> **两种审核职能的指派动作无落点**：`/admin/members` 没有职能授权面……
> 职能授权属组织角色层，应在 `identity` 束定义并在本束消费。提一致性复核

`apps/api/migrations/20260805200000_i552_skill_review_gates.sql` 建表时已经把
`assigned_by` 列和 `GRANT ... UPDATE, DELETE`（注释：「Assignments change over time」）
都准备好了——存储层从一开始就是按「将来会有人写」设计的，只是没人写。

`domain.md` 第一节读者引用 `skills/coverage.md` 的复核结论时提到「归属 identity/org-admin
束」，但 phase-01 实际承接组织成员管理面的束是 **`org-admin`**（`identity` 本体在
phase-00-shared-kernel，只定义 `OrgRole` 枚举，不含成员管理 UI/API——`org-admin` 束的
`design-signoff.md` 明确写着「建在 phase-00 `identity/` 之上，不重复声明其不变量」）。
`/admin/members` 也物理落在 `org-admin` 束的 `MembersTab`
（`apps/web/components/org-admin/org-admin-screen.tsx`）。**本 delta 因此把新操作放进
`org-admin` 契约束**，而不是 `identity`——这是「跟着已建成的真实归属走」，不是重新裁决
一次「职能授权算谁的地盘」。

## 1. 新增操作（`packages/contracts/src/org-admin.ts`）

```ts
/** 复用 skills 束已定义的两值枚举，不在这里重新声明一份（防第 6 次「同一事实两处声明」）。 */
export const SkillReviewerFunction = z.enum(["methodology-reviewer", "security-reviewer"]);

assignSkillReviewerFunction: {
  method: "POST",
  path: "/organizations/:orgId/members/:userId/skill-reviewer-function",
  in: z.object({
    orgId: z.string(),
    userId: z.string(),
    reviewerFunction: SkillReviewerFunction,
  }).strict(),
  out: z.object({
    userId: z.string(),
    reviewerFunction: SkillReviewerFunction,
    assignedBy: z.string(),
    assignedAt: z.string(),
  }).strict(),
  // PROJECT_ROLE_INSUFFICIENT 复用既有码（同 removeOrgMember 的先例：契约里
  // 「你无权对这个目标执行这个操作」的既有码，不发明新码）。
  err: ["PROJECT_ROLE_INSUFFICIENT", "MEMBER_NOT_FOUND"] as const,
},

revokeSkillReviewerFunction: {
  method: "POST",
  path: "/organizations/:orgId/members/:userId/skill-reviewer-function/revoke",
  in: z.object({ orgId: z.string(), userId: z.string() }).strict(),
  out: z.object({ userId: z.string(), revoked: z.literal(true) }).strict(),
  err: ["PROJECT_ROLE_INSUFFICIENT", "MEMBER_NOT_FOUND", "NOT_ASSIGNED"] as const,
},

listSkillReviewerFunctions: {
  method: "GET",
  path: "/organizations/:orgId/skill-reviewer-functions",
  in: z.object({ orgId: z.string() }).strict(),
  out: z.object({
    assignments: z.array(z.object({
      userId: z.string(),
      reviewerFunction: SkillReviewerFunction,
      assignedBy: z.string(),
      assignedAt: z.string(),
    })),
  }).strict(),
  err: ["PROJECT_ROLE_INSUFFICIENT"] as const,
},
```

路由不违反 `ORG_ADMIN_FORBIDDEN_ROUTES`（`no-forbidden-routes.test.ts` 只禁
`^DELETE\s+/organizations` 前缀；三条都是 `POST`/`GET`，撤销走 `.../revoke` 子路径，
同 `resend`/`revoke` 邀请的既有处置）。

## 2. 为什么加、加在哪

- **为什么加三条而不是一条**：`assign` 单独存在时无法**改变**已有指派（PK 是
  `(org_id, principal_id)`，同一人只能有一种职能）——`assign` 用 upsert 语义覆盖，
  但「撤销」（变回无职能）upsert 表达不出来，需要独立的 `revoke`。`list` 是
  `/admin/members` 渲染「谁已经是审核人」的必需读端点，缺了它界面只能显示写操作、
  读不到当前状态，等于半个功能。
- **`assign` 用 upsert（覆盖）不是先 revoke 再 assign**：`skill_reviewer_functions`
  的 PK 就是 `(org_id, principal_id)`，「改指派」这件事在数据模型里从设计起就是
  一行的更新，不是两次写。
- **`assignedBy` 来自服务端 principal，不是请求体**：同 `reviewSkillVersion` 的既有
  纪律（「三个『谁』全部来自服务端事实，一个都不来自请求体」），这里「谁指派的」
  同理必须来自认证身份，防止请求体伪造审计字段。
- **不新增错误码 `REVIEWER_FUNCTION_MISMATCH` 之外的东西**：`assign`/`revoke` 复用
  `PROJECT_ROLE_INSUFFICIENT`（非 admin）与新增 `MEMBER_NOT_FOUND`（目标用户不在本组织）
  /`NOT_ASSIGNED`（撤销一个从未被指派的人）——后两个是本 delta**唯一**新增的错误码，
  且都是「操作对象不存在/状态不符」这类标准形状，不携带新语义。

## 3. 落库 —— 复用已有仓储，不新造第二个

`SkillContractRepository`（`apps/api/src/infrastructure/skill/pg-skill-contract-repository.ts`）
已经是 `skill_reviewer_functions` 表唯一的读方（`functionOf` / `anotherMethodologyReviewerExists`）。
本 delta 在同一个仓储上补三个写/列方法：

```ts
assignReviewerFunction(principalId: string, reviewerFunction: ReviewerFunctionValue, assignedBy: string):
  Promise<{ assignedAt: string }>;   // INSERT ... ON CONFLICT (org_id, principal_id) DO UPDATE
revokeReviewerFunction(principalId: string): Promise<{ readonly revoked: boolean }>;  // DELETE ... RETURNING
listReviewerFunctions(): Promise<readonly { principalId: string; reviewerFunction: ReviewerFunctionValue; assignedBy: string; assignedAt: string }[]>;
```

**不新造 `ReviewerFunctionAdminRepository` 或类似的第二个仓储**：同一张表的读、写、列
都应该只有一个仓储实现，两个仓储对同一张表各自维护连接/RLS 上下文是「同一事实两处
声明」的基础设施版本。`org-admin-management.controller.ts` 直接注入
`SKILL_CONTRACT_REPOSITORY`（已存在的 DI token）调用这三个新方法，不经过 skill 束的
任何 application 用例（`review-skill-version.ts` 等）——那些用例的输入边界是「一次评审」，
不是「管理职能名单」，硬塞进去会让用例签名多出与评审无关的参数。

## 4. 向后兼容性

- 三个操作全部是新增路由，不改、不删任何既有契约字段或路由。
- `SkillReviewerFunction` 枚举与 `skills.ts` 里 domain 层 `ReviewerFunctionValue`
  取值集合逐字相同（`methodology-reviewer` / `security-reviewer`），后端用
  `apps/api/src/domain/skill/review-authorization.ts` 的 `ReviewerFunctionValue`
  做运行时类型，不重新定义。

## 5. 请人类 / coord-main 在签核时确认

- [ ] 三条操作放进 `org-admin` 契约束（而非新开 `identity` 束或塞进 `skills` 束）是否
      接受？依据见 §0：跟着 `/admin/members` 已建成的真实归属走。
- [ ] `assign` 为 upsert 覆盖式指派（而不是「先必须 revoke 才能改指派」）是否接受？
- [ ] 本 delta**不做**「谁能审我」名单展示给普通成员——`listSkillReviewerFunctions`
      的 `err` 只允许 admin 调用，普通成员看不到组织内审核人名单（同 `anotherMethodologyReviewerExists`
      故意不列名单的既有纪律：「谁能审我」在组织里不是给提交人看的信息）。是否接受？
