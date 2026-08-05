-- ⚠ 时间戳原为 20260805190000，与 #519 的 20260805190000_i519_agent_run_retry.sql（PR #582）相撞，
--   两条同号迁移的执行顺序未定义。改用 20260805200000。时间戳只降低抢号概率，不消除。
--
-- issue #533 —— X-7 / XC-18 裁决落地：录音同意项由三项收敛为**与访谈侧逐字相同的四项**。
--
-- 2026-08-05 coord-main 经人类授权裁决：`recording` 的三项是 `interview` 四位的严格子集、
-- 逐字相同、只少一位 `attribution` —— 那是**遗漏**的形状，不是两套设计的形状。
-- 唯一事实源现在是 `packages/contracts/src/consent-item.ts` 的 `CONSENT_ITEMS`。
--
-- ⚠ 这条 CHECK 是那份枚举**不得不存在的一份拷贝**（SQL 没法 import TypeScript）。
--   本仓对这种拷贝的既定处置不是删约束（那样数据库什么都收），而是**机械对账**：
--   `tests/rec/recording-consent-single-source.test.ts` 第 ① 条把
--   `pg_get_constraintdef` 的取值与 `RecordingConsentItem.options` 逐字比对。
--   ⇒ **不要手改这里的取值来「修红」**，改契约枚举，让对账驱动这份迁移。
--
-- ⚠ 行为差异（本次裁决的核心）：`blocksStart` 读的是 `.options.length`（#465 铺的路），
--   基数 3 → 4 后，**只答了 3/4 的授权矩阵从放行变为拒绝**。存量数据里凡是没有
--   `attribution` 行的来源，下一次 `startRecording` 会得到 `CONSENT_NOT_COMPLETED`。
--   这是裁决要的结果：没问过「能不能署名引述你」就不算问全。
--   ⇒ **不回填 `attribution` 行**。回填等于替在场者代答，那正是这条同意项存在的理由的反面。

ALTER TABLE recording_consent_cells
  DROP CONSTRAINT IF EXISTS recording_consent_cells_item_check;

ALTER TABLE recording_consent_cells
  ADD CONSTRAINT recording_consent_cells_item_check
  CHECK (item IN ('record', 'transcript', 'ai_analysis', 'attribution'));
