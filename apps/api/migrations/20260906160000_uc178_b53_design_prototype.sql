/*
 * UC-17.8 B5.3 —— `design_projects.prototype`：原型画布的结构化组件树，每页一棵。
 *
 * 契约：`packages/contracts/src/design-prototype.ts`（`PrototypeNode`），投影到
 * `DesignProject.prototype`。不变量「长度为 0 或等于 frames 长度」在契约 `superRefine` 与
 * 仓储 `update` 的 CASE 里守（只改 frames ⇒ 清空 prototype）；数据库只守「是数组」——
 * jsonb 里的树形状不适合用 CHECK 表达，读出时逐页过契约（`toPrototype`）。
 *
 * 默认 `[]` = 还没生成：存量项目读出来画布仍是占位块，与之前行为一致，不回填。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS prototype jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(prototype) = 'array');
