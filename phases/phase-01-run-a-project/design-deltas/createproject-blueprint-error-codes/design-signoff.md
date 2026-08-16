---
status: pending              # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: project
scope: createProject-blueprint-error-codes
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# project 束 delta —— `createProject` 补齐蓝本相关错误码

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的
`contracts/project/design-signoff.md`（2026-07-30，covers F116-F128 + F158）。
本文件的 `status` 变更归人类所有——**agent 不得改**（ADR-023）。

提出：2026-08-16（dev-chat-e2e）。起因：应用户直接指派接手 #991 backlog BP-08
（`createProject` 真执行六类初始化写入）开工前的勘探，发现 `project.createProject.err`
今天没有任何蓝本相关错误码，而 BP-08 要做的事（对一个可能无效的 `blueprintVersionId`
真正执行写入）第一次让"蓝本不合法该怎么报错"这个分支变得必须存在。已把选项摆给 coord-main
转述人类：

- **A. 补齐 `createProject.err`**（本 delta 采用），比照 BP-06/F186 走一轮小型契约签核 delta。
- B. 不改契约，创建时蓝本无效静默退化为空白项目（同 `blueprintVersionId: null`）。
- C. 不改契约但仍抛 `templates` 的错误码（会违反本仓自己的 `lint-error-leak` 门控，仅用于
  排除，不是真选项）。

**人类经 coord-main 转述已裁：选 A**（2026-08-16）。本文件记录这次裁决，等待人类在此文件
自己落一次 `status: confirmed` 的签核动作（同 `design-deltas/blueprint-read-path/` 的先例：
提案与最终签核是两次独立的、身份可核实的动作，agent 不能代替后一步）。

---

## 变更：`project.createProject.err` 新增五个码

**形状与逐字依据见同目录 `contract.md`；可执行验收见 `verification.md`。**

```ts
err: [
  "ORG_ROLE_INSUFFICIENT",
  "INVALID_KIND",
  "AUTH_SERVICE_UNAVAILABLE",
  "BLUEPRINT_NOT_FOUND",
  "BLUEPRINT_NOT_VISIBLE",
  "BLUEPRINT_NOT_PUBLISHED",
  "BLUEPRINT_VERSION_ARCHIVED",
  "INITIALIZATION_FAILED",
] as const,
```

`ProjectReason` 枚举同步追加五个成员（新增「④ templates 束同码同义」一节，逐条标明与
`templates.TemplateError` 对应成员语义完全相同，非首次声明）。

## 影响范围核对（三条件，供签核时核对，不是本文件在自行认定已满足）

1. **是否新增设计面**：是——`createProject` 的失败面首次能表达"蓝本不合法"，这五个码此前
   从未出现在 `project` 束的任何操作里，因此**没有**由 agent 自行走 covers 追加（那条自查规则
   明文要求"零新增设计面"才适用），走的是独立 delta 签核。
2. **是否影响已签核的读写形状**：`createProject.in`/`out` 一字未动；只扩大 `err` 集合。
   ⚠ 扩大错误面对调用方是**向后兼容**的（多了可能收到的失败码，不改变成功路径的响应形状），
   但契约层面仍算"新增设计面"，按本仓纪律不能用 covers 追加跳过评审。
3. **是否需要新表/新迁移**：否——不改任何存储结构，纯契约层扩展。

## 采纳后的后续工作（本 delta 只批契约面，不含实现）

- `project.ts` 里 `ProjectReason` 枚举追加五个成员 + `createProject.err` 数组扩展。
- `create-project.ts`（application 层）真正对 `blueprintVersionId` 做校验并抛出对应码，
  复用 `templates` 束已有的纯函数（`planSixCategoryInit`、`canBindNewProject` 等），
  不整体调用 `applyBlueprintUseCase()`（会带入它自己的 `canApplyBlueprint` lead-only 判断，
  与 createProject 的 `lead-or-admin` 门槛不一致——已投查明的结论：只复用纯函数与仓储层，
  角色判断唯一权威是 createProject 现有的 `canCreateProject`）。
- `createProject.controller`（`project.controller.ts` 或对应文件）把新增的应用层错误码
  映射成 HTTP 响应。
- 真库测试覆盖：蓝本不存在 / 不可见 / 未发布 / 版本已归档 / 六类写入失败回滚 五条路径。
