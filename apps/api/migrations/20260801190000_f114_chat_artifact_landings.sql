-- F114：对话产出落地——三模式绑定接线 + 出处回链 + 标灰门（chat 束 domain.md F 组 · uc-8-3 UC-20/21/22）
--
-- ## 为什么是本模块自己的一张表，不是 phase-00 `artifact_bindings` 的一行
--
-- `usecases.md`（chat 束）明写「三模式绑定与定版调 phase-00 `artifact` 的
-- `bindToProjectStep` / `pinVersion`，本束不另立版本机制」。但 `bindToProjectStep`
-- 的输入要求一个真实的 `agendaSegmentId`（把产出提交到项目的某个环节），而
-- `chat.landAsArtifact` 的契约输入只有 `{threadId, messageId, mode, title, payloadRef}`——
-- **没有** `agendaSegmentId`。对话里的一条结论落地时，落地者往往还没有（也不需要）
-- 决定它对应项目议程的哪一环节；把"这是不是要提交到某个环节"与"这条结论该不该
-- 被下游引用"耦合在一起，会让"仅仅想给自己存一份草稿"的组员也被 `bindToProjectStep`
-- 内部的 `group.submitOutput` 项目角色门槛挡住。
--
-- 这是一个如实登记的契约缺口（同 `packages/contracts/src/chat.ts` 的
-- `KNOWN_CONTRACT_GAPS.C_CHAT_1`/`C_CHAT_2` 一样的登记方式，见该文件新增的 `C_CHAT_10`）：
-- 版本与字节仍然全部通过 phase-00 `artifact` 的 `materializeArtifact`（F04）写
-- （对象存储 + `artifact_versions`，这一半**没有**重新实现），本表只多记「这次落地
-- 选的是哪个模式、挂没挂来源」——三模式的**合法性判断**（I-33/I-37/V4d）在
-- `domain/chat/artifact-landing.ts` 一处，本表只存判断完之后的结果。
--
-- 可重放：IF NOT EXISTS，`migrate:check` 强制重放每个文件。

CREATE TABLE IF NOT EXISTS chat_artifact_landings (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 出处回链三项之二：thread_id + message_id（I-33）。级联删除线程即视为该落地产出
  -- 的来源上下文一并消失——不保留一个指向鬼线程的落地记录。
  thread_id         text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  message_id        text NOT NULL,
  artifact_id       text NOT NULL,
  -- pinned 模式下非空（F04 `materializeArtifact` 写下的那一行 `artifact_versions.id`）；
  -- draft/live 恒为 NULL——这两种模式在 phase-00 的语义里本就"不冻结到某个版本"。
  version_id        text,
  title             text NOT NULL,
  mode              text NOT NULL,
  -- I-37 的落库半边：服务端可判定的状态，不是纯视觉。与 `citation_count` 同时写，
  -- 后者留作审计/调试用的原始计数，`has_source` 才是判断结果（`citation_count > 0`）。
  has_source        boolean NOT NULL,
  citation_count    integer NOT NULL CHECK (citation_count >= 0),
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_artifact_landings DROP CONSTRAINT IF EXISTS chat_artifact_landings_mode_check;
ALTER TABLE chat_artifact_landings ADD CONSTRAINT chat_artifact_landings_mode_check CHECK (
  -- 三值封闭，与契约 `chat.LandingMode` 同值。
  mode IN ('draft', 'live', 'pinned')
);

-- pinned 恒有 version_id，draft/live 恒没有——两者一致，不许出现"pinned 却没有版本"
-- 或"draft 却挂着一个版本"的行。
ALTER TABLE chat_artifact_landings DROP CONSTRAINT IF EXISTS chat_artifact_landings_pinned_has_version;
ALTER TABLE chat_artifact_landings ADD CONSTRAINT chat_artifact_landings_pinned_has_version CHECK (
  (mode = 'pinned' AND version_id IS NOT NULL) OR (mode <> 'pinned' AND version_id IS NULL)
);

CREATE INDEX IF NOT EXISTS chat_artifact_landings_thread_idx
  ON chat_artifact_landings (org_id, thread_id);

CREATE INDEX IF NOT EXISTS chat_artifact_landings_artifact_idx
  ON chat_artifact_landings (org_id, artifact_id);

ALTER TABLE chat_artifact_landings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_artifact_landings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_artifact_landings_tenant ON chat_artifact_landings;
CREATE POLICY chat_artifact_landings_tenant ON chat_artifact_landings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT ON chat_artifact_landings TO app_rw;

-- F22 的停用冻结：新建租户表必须自己补这一次调用（0014 见不到本文件之后才建的表）。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE chat_artifact_landings IS
  'F114 UC-20/21/22 的对话侧落地记录：三模式与 hasSource 的落库结果。'
  '版本与字节仍全部走 phase-00 artifact 的 materializeArtifact（F04），本表不重复实现版本机制。';
