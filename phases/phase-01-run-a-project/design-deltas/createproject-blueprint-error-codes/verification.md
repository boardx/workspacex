# `createProject` 蓝本错误码 delta —— 可执行验收

采纳后，BP-08 实现方需要满足：

## 契约层

1. `pnpm --filter @repo/contracts run typecheck` 全绿。
2. `project.createProject.err` 字面量数组包含五个新码；`ProjectReason` 枚举同步包含它们。
3. 反证：`TemplateError`（`templates` 束）与新增五个码逐字相同（拼写、大小写一致）——
   同码同义不能变成同义不同码。

## 应用层 / 真库测试（BP-08 实现时新增，参考 `create-blueprint-persistence.test.ts` 约定）

1. **蓝本不存在**：传入不存在的 `blueprintVersionId` → `BLUEPRINT_NOT_FOUND`，不建出项目。
2. **蓝本不可见**：team-only 蓝本、调用者不在该 team → `BLUEPRINT_NOT_VISIBLE`。
3. **蓝本未发布**：蓝本存在但从未发布过版本 → `BLUEPRINT_NOT_PUBLISHED`。
4. **版本已归档**：传入版本号对应一个已归档版本 → `BLUEPRINT_VERSION_ARCHIVED`；同时反证
   **存量场景不受影响**（已绑定该归档版本的既有项目不受此码影响，I-7）。
5. **六类写入失败回滚**：故障注入使六类写入的某一步失败 → 整体回滚，不留半成品项目
   （`projects` 表也不留孤行——`INITIALIZATION_FAILED` 时必须连 `projects` 一行都不落库，
   不是"项目建了、六类没写全"）。
6. **权限口径反证**：以 `admin`（非 `lead`）身份、携带一个有效已发布蓝本调用 `createProject`
   → 六类初始化真实执行成功（钉住"唯一权威是 createProject 现有的 lead-or-admin，不会被
   `apply-blueprint.ts` 的 lead-only 挡下"这条结论，防止未来有人把 `applyBlueprintUseCase()`
   整体接进来又悄悄改变这条边）。
7. **幂等**：同一 `idempotencyKey`（若创建路径已有该机制）或重复提交同参数只建出一个项目
   （复用 F117 既有的幂等指纹反证套路）。

## typecheck / lint

`pnpm --filter api run typecheck` 全绿；`pnpm --filter api run lint`（含 `lint-error-leak.mjs`）
全绿——新增的五个错误码必须每一个都能在 `createProject.err` 里找到出处，不能出现"抛了但契约
没声明"的码。
