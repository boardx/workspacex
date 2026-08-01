-- F84: 三步新建向导（选模板→选对象→生成提纲）+ AI 生成大纲「待你确认」服务端闸门
-- (uc-6-2 R3 / R7, contracts/interview/domain.md I-10 / I-11, AC1 / AC2 / AC5)
--
-- ## 一张表,不是一个版本链
--
-- 与 F82 的 `interview_template_versions` 不同,`interview_outlines` 每场访谈只有
-- **一行**——`regenerateOutline` 覆盖的是这一行,不是追加新版本供别人引用。理由见
-- `outline-ports.ts` 文件头。`sections` 存成 jsonb 数组（与 `interview_template_applications`
-- 同样的手法：套用记录也没有为 sections/data_fields 拆一张按段的表),F85 的逐段编辑
-- 若需要按 sectionId 行级并发控制,是那个 feature 迁移到按行存储的时机,不是本迁移
-- 提前建一张现在没有调用方的表。
--
-- ## `manually_edited` 现在恒为 false
--
-- 本 feature 没有实现 `updateOutlineSection`（F85 的范围）,所以没有任何写路径会把
-- 这一列置真。列先建出来,是为了 `regenerateOutline` 的 `OUTLINE_OVERWRITE_NEEDS_CONFIRM`
-- 判断有一个稳定的读取点,而不是等 F85 落地时再给这张表加列、再迁一次已有数据。
--
-- ## 大纲的身份不挂在 `interview_sessions` 上
--
-- 没有在 `interview_sessions` 加 `outline_id` 列——`interview_outlines.interview_id`
-- 唯一索引已经是「一场访谈至多一份大纲」的单一事实源,加一列反向指针只会造出
-- 「这两处会不会不同步」的第二个问题,而不解决任何查询性能问题（一次索引查找足够）。
--
-- 可独立重放：全程 IF NOT EXISTS / DROP-then-CREATE，因为 migrate:check 会忽略版本表强制重放。

CREATE TABLE IF NOT EXISTS interview_outlines (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  interview_id     text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  -- 封闭二值，与契约 `interview.OutlineStatus` 逐字同步（0005/0006/0008 用过的手法：
  -- 测试从 pg_catalog 读出这条 CHECK 并与契约枚举逐成员比对）。
  status           text NOT NULL CHECK (status IN ('pending_confirm', 'confirmed')),
  -- `OutlineSectionDraft[]`：{objective, openers, minutes, order}[]，I-11 顺序在
  -- 应用层的类型定义里就已固定，这里不重复校验字段顺序（jsonb 本身不保证 key 顺序）。
  sections         jsonb NOT NULL,
  manually_edited  boolean NOT NULL DEFAULT false,
  generated_by     text NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_outlines_status_check') THEN
    ALTER TABLE interview_outlines
      ADD CONSTRAINT interview_outlines_status_check
      CHECK (status IN ('pending_confirm', 'confirmed'));
  END IF;
END
$$;

-- 一场访谈至多一份大纲——`create`/`replaceSections` 都是「找到就更新，找不到就插入」
-- 的语义，仓储实现靠这条唯一约束做 upsert。
CREATE UNIQUE INDEX IF NOT EXISTS interview_outlines_interview_uniq
  ON interview_outlines (org_id, interview_id);

-- ---------------------------------------------------------------------------------------
-- RLS：与其它每张租户表同一条规则
-- ---------------------------------------------------------------------------------------
ALTER TABLE interview_outlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_outlines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_outlines_tenant ON interview_outlines;
CREATE POLICY interview_outlines_tenant ON interview_outlines
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_outlines FROM app_rw;
-- SELECT/INSERT/UPDATE：生成、重新生成（覆盖同一行）、确认（状态转正）都要写；
-- 没有 DELETE——uc-6-2 没有「删大纲」这个操作。
GRANT SELECT, INSERT, UPDATE ON interview_outlines TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE 策略：INSERT / UPDATE / DELETE）。
-- ⚠ 必须显式调用：0014 的编号在前，首次跑迁移时这张表还不存在。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_outlines IS
  'F84: 三步向导第三步生成的大纲草案。一场访谈至多一行（regenerate 覆盖同一行，不追加版本）。'
  'status=pending_confirm 时 startSession 服务端拒绝进现场（I-10），不只是前端标记。';
