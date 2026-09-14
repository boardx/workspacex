/*
 * issue #3628 —— 产品反馈提交时可选带的标签。
 *
 * 形状同 `20260903120000_error_logs_lifecycle_tags.sql`：`text[] NOT NULL DEFAULT '{}'`，
 * 不是 jsonb、不是独立表。理由与该迁移一致——标签是提交人自己起的自由词，
 * 不需要跨行聚合查询，一列足够；上限（`FEEDBACK_TAG_MAX`）与单条长度
 * （`FEEDBACK_TAG_MAX_CHARS`）只在契约 `feedback-loop.ts` 校验一次，这里不重复约束。
 *
 * 唯一用途：`triage-feedback.ts` 转「已进入迭代」建 GitHub issue 时，把这些标签
 * 并入 `labels`（见该文件 `mergeIssueLabels`）。不走 D3 门控——同 `title`/`votes`。
 */
ALTER TABLE product_feedback ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
