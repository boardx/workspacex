---
status: proposed
bundle: skill-reviewer-function-assignment
base_bundle: org-admin
scope: assign-skill-reviewer-function
covers: []
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# design delta 签核 · 组织管理员任命 Skill 审核人职能

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。coord-main 可代人类在
会话内确认后把这份改成 `confirmed`（同 `shared-invite-links` / `token-quota-and-usage` /
`skill-tags` 先例），但那次确认要在这份文件或对应 PR 评论里留痕。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。

## 这份 delta 为什么存在

issue #852：`skills` 契约束的 `design-signoff.md` 早在 2026-07-30 就已签核确认
`ReviewerFunction`「组织管理员指派」这个概念（`domain.md`），`coverage.md` 也早已
把「指派动作无落点」记为缺口 #6 并建议放进 identity/组织角色层——但**指派本身
从未开出一个 API 操作**，`skill_reviewer_functions` 表全仓只有种子脚本/测试在写。
新增三条契约操作（`assignSkillReviewerFunction` / `revokeSkillReviewerFunction` /
`listSkillReviewerFunctions`）满足不了 ADR-023「零新增设计面」的免签核条件（新增
operation 本身就是新增设计面），所以需要这份轻量签核记录，照 `skill-tags` 的先例：
实现与签核并行，PR 合并前需要签核留痕。

## ① UI

`/admin` → 成员标签页（`org-admin-screen.tsx` 的 `MembersTab`，真实数据，非 mock）
每一行成员新增一个「Skill 审核职能」的指派入口（下拉：无 / 方法论审核人 / 安全评审人），
仅 `orgRole === "admin"` 的调用者可操作；已指派的成员在名单行内显示当前职能徽标。
不新建独立页面/路由，落在已建成的 `/admin` 成员标签页内。见
[`contract.md`](./contract.md) §0 的归属依据。

## ② 用例

新增的三个操作是**纯管理动作**，不改变 `reviewSkillVersion` / `submitSkillForReview`
等既有用例的判定顺序或输入边界——它们只是让 `functionOf()` 从「恒 null」变成「能读到
真实指派」的**唯一前置条件**。「组织管理员指派、组织级、可跨团队」「同一人只能持有
一种职能」两条既有不变量（`skills/domain.md`）由 PK `(org_id, principal_id)` 与
`assign` 的 upsert 语义在存储层保证，不在 API 层重复判断一次（同一条规则不出现
第二份实现）。

## ③ API 契约

三处新增，见 [`contract.md`](./contract.md) §1。零修改、零删除既有 `org-admin` /
`skills` 契约字段；新增两个错误码（`MEMBER_NOT_FOUND` / `NOT_ASSIGNED`），复用既有
`PROJECT_ROLE_INSUFFICIENT`。

---

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字，或 'coord-main 代抄确认' 并注明依据>"
confirmed_at: "<ISO8601 时间戳>"
confirmed_via: "<在哪次会话/哪条消息里确认的>"
```

`contract.md` §5 列了三条需要明确回答的取舍；若否定其中任何一条，请在本文件里写明
替代方案，实现会照替代方案调整。
