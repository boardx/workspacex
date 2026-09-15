-- Team3 研判工作流的脊柱：一条 chat 线程 = 一个研判会话（阶段 + 血缘 + 材料清单）。
--
-- 为什么阶段与血缘落库而不是留在 Agent 的 instructions 里：需求文档 §4 写着
-- 「任何一门不过，Agent 不得自动进入下一步」。instructions 是请求，模型可以不照做，
-- 而且没有任何东西会发现它没照做。落库 + 服务端状态机才让这句话在系统里为真。

CREATE TABLE IF NOT EXISTS research_sessions (
  thread_id                uuid PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  -- 与本仓所有业务表同一条纪律：每行带 org_id，查询一律经 withTenant。
  org_id                   uuid NOT NULL,
  phase                    text NOT NULL DEFAULT 'empty',
  -- 血缘三件：三个月后的复盘（测试 C）全靠它们回答「当时基于哪批材料、哪版口径与逻辑」
  material_batch_id        uuid,
  field_scheme_version     integer NOT NULL DEFAULT 0,
  logic_version            integer NOT NULL DEFAULT 0,
  published_graph_version  integer NOT NULL DEFAULT 0,
  verify_due_at            timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- 阶段值由契约 RESEARCH_PHASES 声明；这里复述是为了让库自己也能拒绝脏值。
  -- 两处一致由 tests/research-workflow/phase-enum-parity.test.ts 机械核对。
  CONSTRAINT research_session_phase_known CHECK (phase IN (
    'empty','collecting','materials_review','materials_approved','fields_pending',
    'logic_pending','generating','graph_review','graph_published',
    'awaiting_verification','backfilling','plan_review'
  )),
  -- 已发布过图谱，就必然有人过了门①（门②要求血缘非空）。
  -- 这条是「不得自动发布」在**数据层**的最后一道保险：即便应用层被绕过，
  -- 一条 published_graph_version>0 而 material_batch_id 为空的行也写不进来。
  CONSTRAINT research_session_published_needs_batch CHECK (
    published_graph_version = 0 OR material_batch_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS research_materials (
  id           uuid PRIMARY KEY,
  thread_id    uuid NOT NULL REFERENCES research_sessions(thread_id) ON DELETE CASCADE,
  org_id       uuid NOT NULL,
  source       text NOT NULL,
  label        text NOT NULL,
  -- 三态是门①的判据本身：整批一句「看着行」等于没审
  verdict      text NOT NULL DEFAULT 'pending',
  note         text,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_material_verdict_known CHECK (verdict IN ('pending','accepted','missing','wrong')),
  CONSTRAINT research_material_source_known CHECK (source IN ('paste','upload','url','transcript','agent_search'))
);
CREATE INDEX IF NOT EXISTS research_materials_thread_idx ON research_materials (thread_id, created_at);

-- 越权尝试的留痕。没有它，「Agent 试图跳门」这件事发生了也没人知道——
-- 而"拒绝并留痕"与"静默拒绝"的区别，正是三个月后能不能统计出问题的区别。
CREATE TABLE IF NOT EXISTS research_gate_audit (
  id           bigserial PRIMARY KEY,
  thread_id    uuid NOT NULL,
  org_id       uuid NOT NULL,
  actor_kind   text NOT NULL,          -- 'human' | 'agent'
  action       text NOT NULL,          -- 'gate:<name>' | 'advance:<phase>'
  from_phase   text NOT NULL,
  outcome      text NOT NULL,          -- 'allowed' | 'refused'
  refusal      text,                   -- RESEARCH_REFUSALS 之一；allowed 时为空
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_gate_audit_outcome_known CHECK (outcome IN ('allowed','refused')),
  CONSTRAINT research_gate_audit_refusal_shape CHECK (
    (outcome = 'refused' AND refusal IS NOT NULL) OR (outcome = 'allowed' AND refusal IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS research_gate_audit_thread_idx ON research_gate_audit (thread_id, created_at DESC);

-- 第三步：验证回填。
--
-- 需求文档的第三步是「数月后回来看当初的判断对不对」，判据是**逐条预测**的兑现情况，
-- 不是一句"大体还行"。所以预测必须在发布时就逐条落下来——事后凭记忆补写的"当初的
-- 预测"，是用已知结果反推出来的，那不是验证，是自我确认。
CREATE TABLE IF NOT EXISTS research_predictions (
  id             uuid PRIMARY KEY,
  thread_id      uuid NOT NULL REFERENCES research_sessions(thread_id) ON DELETE CASCADE,
  org_id         uuid NOT NULL,
  -- 这条预测属于哪一版图谱。三个月后回来要能回答"当时那一版是怎么说的"。
  graph_version  integer NOT NULL,
  statement      text NOT NULL,
  -- 回填结果。null = 还没回填。
  actual         text,
  verdict        text,
  -- 根因分类：框架性（判断逻辑本身错了）vs 执行性（逻辑对，这次执行没做到位）。
  -- 两者对应完全不同的调整动作，混成一句"没做好"就什么也改不了。
  root_cause     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  filled_at      timestamptz,
  CONSTRAINT research_prediction_verdict_known CHECK (
    verdict IS NULL OR verdict IN ('matched','partial','missed')
  ),
  CONSTRAINT research_prediction_root_cause_known CHECK (
    root_cause IS NULL OR root_cause IN ('framework','execution')
  ),
  -- 回填过的必须同时有实际值与判定：只填一半等于没填，而"填了一半"看起来像"填了"。
  CONSTRAINT research_prediction_filled_shape CHECK (
    (filled_at IS NULL AND actual IS NULL AND verdict IS NULL)
    OR (filled_at IS NOT NULL AND actual IS NOT NULL AND verdict IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS research_predictions_thread_idx
  ON research_predictions (thread_id, graph_version, created_at);
