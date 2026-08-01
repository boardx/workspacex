-- F83: 反向抽取草案落盘（uc-6-1 A3 / R3 步骤5, V3）
--
-- ## 为什么草案是单独一张表，不是 `interview_template_versions` 提前插一行
--
-- V3 的硬约束是「草案必须经研究员确认后才入库」——`listTemplates`/`getTemplate` 读的是
-- `interview_templates`/`interview_template_versions`，如果草案也插进这两张表（哪怕加一个
-- `status='draft'` 列），就必须在每一处读它们的地方都记得过滤这个状态，漏一处就是「草案
-- 出现在了模板库列表里」——这正是 F82 迁移头部反复强调的「没有列可漏就没有过滤会漏」的
-- 同一条纪律。独立成表让「未确认」变成「压根不在那两张表里」，不是「在但被过滤」。
--
-- ## 这里没有什么
--
-- 没有片段级别的抽取素材字段——本迁移只存抽取算法的输出（合并后的 sections/dataFields），
-- 不存「为什么抽出这些」的中间产物。抽取算法本身在 `application/interview/extract-template-draft.ts`，
-- 目前是确定性合并已套用记录（非 AI），见该文件与 `domain/interview/template-draft.ts` 的
-- 判断取舍说明——这条草案表的形状不因抽取算法将来换成 AI 而需要改变（存的是结果，不是过程）。
--
-- 可独立重放：全程 IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS interview_template_drafts (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                  text NOT NULL,
  goal                  text NOT NULL DEFAULT '',
  sections              jsonb NOT NULL,
  data_fields           jsonb NOT NULL,
  -- 已按 O-05 过滤过、实际进入合并素材的来源——详情页「来自 N 场访谈」的可追溯性来源（V3）。
  source_interview_ids  text[] NOT NULL DEFAULT '{}',
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- 一次性：confirmTemplateDraft 成功后写入，此后同一草案不能再确认第二次
  -- （草案确认不可重放成两个模板）。`NULL` = 尚未确认。
  confirmed_template_id text NULL REFERENCES interview_templates (id),
  confirmed_at          timestamptz NULL
);

CREATE INDEX IF NOT EXISTS interview_template_drafts_org_idx
  ON interview_template_drafts (org_id, created_at DESC);

-- ---------------------------------------------------------------------------------------
-- 门：草案确认不可重放 —— 已确认过的草案再次尝试确认时数据库层也拒绝
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION interview_template_draft_confirm_once() RETURNS trigger AS $$
BEGIN
  IF OLD.confirmed_template_id IS NOT NULL AND NEW.confirmed_template_id IS DISTINCT FROM OLD.confirmed_template_id THEN
    RAISE EXCEPTION
      'TEMPLATE_DRAFT_ALREADY_CONFIRMED: draft % was already confirmed into template % and cannot be re-confirmed',
      OLD.id, OLD.confirmed_template_id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_template_draft_confirm_once_trg ON interview_template_drafts;
CREATE TRIGGER interview_template_draft_confirm_once_trg
  BEFORE UPDATE ON interview_template_drafts
  FOR EACH ROW EXECUTE FUNCTION interview_template_draft_confirm_once();

-- ---------------------------------------------------------------------------------------
-- RLS：与其它每张租户表同一条规则
-- ---------------------------------------------------------------------------------------
ALTER TABLE interview_template_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_template_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_template_drafts_tenant ON interview_template_drafts;
CREATE POLICY interview_template_drafts_tenant ON interview_template_drafts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON interview_template_drafts FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON interview_template_drafts TO app_rw;

-- F22 的停用冻结。理由同 0020：编号在前的迁移不会自动扫到本迁移新建的表。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE interview_template_drafts IS
  'F83: 反向抽取草案。经 confirmTemplateDraft 确认前不进 interview_templates/interview_template_versions'
  '（V3）；confirmed_template_id 一经写入不可再改（草案确认不可重放，见触发器）。';
