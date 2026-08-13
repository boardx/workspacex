# 成员名单读端点 + 归档拦截错误码 可执行验收契约

签核通过后，实现必须让下列每一条都能跑通。**每条都写明了「不做会怎样」**——
一条验收如果拆掉之后测试照样绿，它就是空转的（本仓已九次栽在「全绿但空转」上）。

## 契约门（现在就能跑）

```bash
pnpm --filter @repo/contracts exec vitest run
```

- `listProjectMembers` 出现在 `project.operations` 里，`out.members[]` 的四个字段
  （`userId` / `displayName` / `projectRole` / `isHost`）**逐字**与 `addProjectMember.out` 同名同型。
  **反证**：把 `userId` 改成 `memberId` ⇒ 同名断言必须红（防止同一概念长出第二个名字）。
- `archiveProject.err` 含 `ARCHIVE_BLOCKED_ACTIVE_SEGMENT`。
- `KNOWN_CONTRACT_GAPS.P7` 从缺口清单里**移除**（补上了就不该继续挂着）。

## 单测门（API）

```bash
pnpm --filter api exec vitest run tests/project/list-project-members.test.ts
pnpm --filter api exec vitest run tests/project/archive-blocked-code.test.ts
```

- **名单只含该项目的成员**：两个项目各有成员时，查 A 不返回 B 的人。
  **反证**：去掉 SQL 的 `WHERE project_id = $1` ⇒ 必须红。
- **四个角色都能出现在名单里**（不是只返回 facilitator）。
- **非项目成员读 ⇒ `NO_PROJECT_ROLE`**，不是空数组。
  ⚠ 空数组和「无权限」必须可分辨——返回空数组会让越权读**静默通过**。
  **反证**：把权限判断去掉 ⇒ 必须红。
- **归档被进行中环节拦截 ⇒ 422 + `ARCHIVE_BLOCKED_ACTIVE_SEGMENT`**（不再是裸 400）。
  **反证**：把 reasonCode 去掉 ⇒ 必须红。

## API 层（起真实栈后）

```bash
# ① 项目成员读全名单 → 200，数组含自己
curl -sf -H "Authorization: Bearer $TOK" localhost:3000/projects/$PID/members | jq -e '.members | length > 0'

# ② 非成员读 → 403 且 reasonCode=NO_PROJECT_ROLE（不是 200 空数组）
curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OTHER" localhost:3000/projects/$PID/members   # 期望 403

# ③ 有进行中环节时归档 → 422 且带码
curl -s -X POST -H "Authorization: Bearer $TOK" localhost:3000/projects/$PID/archive | jq -e '.reasonCode=="ARCHIVE_BLOCKED_ACTIVE_SEGMENT"'
```

## UI 门（PJ-05 实现时）

- 成员区渲染的是**真实名单**（来自 ①），不是 `lib/mock/project.ts` 的 `PARTICIPANTS`。
  **反证**：把接线打断成「只渲染不请求」⇒ 断言 fetch 的用例必须红
  （同 F164 在 #1038 里做过的那次反证，形制一致）。
- 改角色 / 移除针对**名单里选中的那个 userId** 发出请求，不是硬编码。
- `displayName` 显示的是真名，不是 userId。

## 回归门（必须同改，否则挡住正确实现）

```bash
pnpm --filter web exec vitest run tests/ui/projects-screen-live.test.tsx
```

F164 现有一条 P7 反证：断言归档失败文案里**不得**出现「环节/进行中/正在/收尾」。
补码后**必须改成**「显示 `ARCHIVE_BLOCKED_ACTIVE_SEGMENT`」。

⚠ 这条不是「测试碍事所以改掉」——它钉的是「**不许编造未证实的原因**」；
补码之后原因不再是编造的，所以断言的对象跟着变。改动本身要在 PR 里写清这层理由。

## 基线门

```bash
pnpm -w run verify:base
pnpm run verify:fullstack-smoke
```

⚠ 跑之前先 `ls .harness/state/.cache/stacks/` 确认没有泄漏的租约占死准入槽位
（2026-08-12 因此耗掉整晚，见 #1032 / #1010）。
