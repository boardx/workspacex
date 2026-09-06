/*
 * UC-17.8 B5.3 迭代 8 —— 每页交互说明。
 *
 * `design_projects.frame_notes`：与 `frames` 同长（或空）的字符串数组，`frame_notes[i]` 是第 i 页的交互说明
 * （契约 `DesignProject.frameNotes`，模型经 `PrototypeScreen.notes` 写回）。只改标签（frames 被替换而没有
 * 新说明）时清空，同 `prototype` 的规则——旧说明属于旧的页面划分。
 * `design_project_prototype_versions.notes`：那一版的说明，恢复时一起写回。
 * 默认 `[]`，存量行不回填。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS frame_notes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(frame_notes) = 'array');

ALTER TABLE design_project_prototype_versions
  ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notes) = 'array');
