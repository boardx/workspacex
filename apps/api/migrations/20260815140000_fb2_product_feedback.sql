/*
 * FB-2 —— 人主动提的反馈的落库面：`product_feedback` + 票 + 状态变更留痕。
 *
 * 契约：`packages/contracts/src/feedback-loop.ts`。
 * 提案：`docs/proposals/PROP-FEEDBACK-LOOP-E2E-001.md` §2 FB-2。
 *
 * ## 为什么是三张表而不是一张
 *
 *   · `product_feedback`             —— 反馈本体。
 *   · `product_feedback_votes`       —— 一人一票的**行**。契约 I-F2 逐字：票数是
 *     `COUNT(*)`，**没有 `vote_count` 列**。存一列计数就是立刻多出第二份可能对不上的
 *     事实，而且对不上的时候没有任何东西会报——本仓已五次栽在「同一事实两处声明」。
 *     代价是每次列表都要 join 一次聚合；那是可以用索引解决的性能问题，
 *     而计数漂移是一个没有解法的正确性问题。
 *   · `product_feedback_status_events` —— 状态变更的 append-only 流水。
 *     本体上的 `status` 是**当前值**，这张表是**怎么走到这一步的**。
 *     只留当前值时，「为什么我提的这条一个月没人管」在系统里没有任何地方能回答。
 *
 * ## 复现上下文是三列，不是一个 jsonb 口袋（契约 I-F1）
 *
 * `occurred_route` / `app_version` / `submitted_by` 各一列。一个「什么都能塞」的
 * jsonb 在提交侧很舒服，到排查侧就什么都查不出来——没有人知道里面该有哪些键，
 * 于是每个入口塞的键都不一样，而 `WHERE payload->>'route'` 对一半的行返回 NULL。
 *
 * ## 目标三列同生同死（与 F176 归因列同一条纪律）
 *
 * `target_kind` 决定 `target_agent_id` / `target_skill_id` 里恰好哪一个非空。
 * CHECK 写死这件事，是因为「只有 target_kind='skill' 却 skill_id IS NULL」这种行
 * 在读取侧等价于一条指向不明的反馈——让它能存进来，只会制造一种没人处理的状态。
 *
 * ⚠ 目标两列**不加 FK**。agent 可以被停用、skill 可以被归档，而「当时有人对它提过意见」
 *   是历史事实：不该因为那个对象后来被清理，反馈就写不进来或被级联删掉。
 *   同 `message_ratings` 归因三列、`token_usage_events.user_id` 不加 FK 的理由。
 *   代价是可能出现指向已消失对象的反馈——`target_label` 存了**当时的名字**，
 *   所以那条反馈仍然读得懂，而不是变成一个裸 id。
 *
 * ## 本体**不是** append-only，但可改的只有状态两列
 *
 * 状态必须能改（这就是分诊）。而正文/标题/类型/目标**不许改**——契约头注逐字：
 * 反馈是一条历史事实，提交人事后改正文会让已经据此分诊、已经生成 PR 的链路
 * 指向一段不再存在的文字。所以这里不是「靠调用方自觉只 UPDATE 那两列」，
 * 而是一个 BEFORE UPDATE 触发器逐列比对，改了别的列就抛。
 *
 * ⚠ 触发器里**逐列列出**不可变列，而不是 `row_to_json(OLD) - 'status'` 之类的通用写法：
 *   通用写法在**新加一列**时会自动把新列纳入不可变集合，读起来像是覆盖了它，
 *   但没有人在加列时想过这件事。逐列列出会在加列时保持沉默——沉默是诚实的，
 *   加列的人必须显式决定它属于哪一边。
 *
 * Replayable：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，重放安全。
 */

CREATE TABLE IF NOT EXISTS product_feedback (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 提交人。⚠ 与 message_ratings.rater_id 不同：反馈**是署名的**（提交人自己要能
  -- 在弹层里看到"我提的"及其状态），所以它会被投影出去。不加 FK 到 credentials，
  -- 同 token_usage_events.user_id：账号清理不该让历史反馈消失。
  submitted_by    text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('缺陷', '需求')),

  target_kind     text NOT NULL CHECK (target_kind IN ('product', 'agent', 'skill')),
  target_agent_id text NULL,
  target_skill_id text NULL,
  -- 目标**当时**的名字。展示用，不作标识——见文件头「不加 FK」。
  target_label    text NULL,

  title           text NOT NULL CHECK (btrim(title) <> ''),
  -- ⚠ 非空是契约那条语义的载体：投影里 `detail: null` 恒等于"无权查看正文"
  --   （D3），绝不等于"正文是空的"。两者若可混淆，界面只能写一句模棱两可的
  --   "暂无内容"，而用户分不清是没写还是不给看。
  detail          text NOT NULL CHECK (btrim(detail) <> ''),

  status          text NOT NULL DEFAULT '待处理'
                    CHECK (status IN ('待处理', '已进入迭代', '已修复', '不做')),
  status_reason   text NULL,

  -- I-F1：客户端给的复现上下文，分列存。可空——有些入口确实没有有意义的"发生位置"。
  occurred_route  text NULL,
  app_version     text NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- 目标三列同生同死。见文件头。
  CONSTRAINT product_feedback_target_pairing CHECK (
    (target_kind = 'agent') = (target_agent_id IS NOT NULL)
    AND (target_kind = 'skill') = (target_skill_id IS NOT NULL)
  ),
  -- 「不做」必须带理由（契约 TRIAGE_REASON_REQUIRED）。用例层也判一次：
  -- 那一次负责回一个具名错误码，这一次负责保证并发/直连 SQL 下也没有无理由的"不做"。
  -- 两者不重复，是同一条规则的两半。
  CONSTRAINT product_feedback_decline_needs_reason CHECK (
    status <> '不做' OR (status_reason IS NOT NULL AND btrim(status_reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS product_feedback_org_created_idx
  ON product_feedback (org_id, created_at DESC);

/* 后台左列按状态分列 + `getFeedbackCounts` 的分组。 */
CREATE INDEX IF NOT EXISTS product_feedback_org_status_idx
  ON product_feedback (org_id, status);

/* chat 内"这个 agent / 这个 skill 的反馈"按目标取。两个部分索引而不是一个联合索引：
   两列同一时刻只有一个非空，联合索引的第二列对每一行都是 NULL。 */
CREATE INDEX IF NOT EXISTS product_feedback_target_agent_idx
  ON product_feedback (org_id, target_agent_id)
  WHERE target_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_feedback_target_skill_idx
  ON product_feedback (org_id, target_skill_id)
  WHERE target_skill_id IS NOT NULL;

/* "我提的" —— 弹层第二个标签页的唯一查询。 */
CREATE INDEX IF NOT EXISTS product_feedback_submitter_idx
  ON product_feedback (org_id, submitted_by, created_at DESC);

/*
 * 票。主键即幂等键：同一个人对同一条反馈重复投票是 no-op，不是 +1。
 * ⚠ 这里**可以 DELETE**（撤票），所以没有 append-only 触发器——
 *   与 message_ratings 的分歧是刻意的：评价是一次对某条回答的判断（历史事实），
 *   而票是"我现在也想要这个"的当前意愿，意愿可以收回。
 */
CREATE TABLE IF NOT EXISTS product_feedback_votes (
  feedback_id text NOT NULL REFERENCES product_feedback (id) ON DELETE CASCADE,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  voter_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, voter_id)
);

CREATE INDEX IF NOT EXISTS product_feedback_votes_org_idx
  ON product_feedback_votes (org_id, feedback_id);

/*
 * 状态变更流水。append-only。
 * ⚠ `from_status` 可空：第一条事件（创建）没有前驱状态。写成 '' 或 '无' 会让
 *   "从空字符串转到待处理"变成一条读起来像真的、实际不存在的转移。
 */
CREATE TABLE IF NOT EXISTS product_feedback_status_events (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  feedback_id text NOT NULL REFERENCES product_feedback (id) ON DELETE CASCADE,
  from_status text NULL CHECK (from_status IN ('待处理', '已进入迭代', '已修复', '不做')),
  to_status   text NOT NULL CHECK (to_status IN ('待处理', '已进入迭代', '已修复', '不做')),
  reason      text NULL,
  actor_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_feedback_status_events_feedback_idx
  ON product_feedback_status_events (org_id, feedback_id, created_at ASC);

/*
 * 本体的可变列只有 status / status_reason。见文件头「本体不是 append-only」。
 * 逐列比对，不用通用 row diff——通用写法会在加列时静默把新列纳入不可变集合。
 */
CREATE OR REPLACE FUNCTION fb2_product_feedback_immutable_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.org_id          IS DISTINCT FROM OLD.org_id
     OR NEW.submitted_by    IS DISTINCT FROM OLD.submitted_by
     OR NEW.kind            IS DISTINCT FROM OLD.kind
     OR NEW.target_kind     IS DISTINCT FROM OLD.target_kind
     OR NEW.target_agent_id IS DISTINCT FROM OLD.target_agent_id
     OR NEW.target_skill_id IS DISTINCT FROM OLD.target_skill_id
     OR NEW.target_label    IS DISTINCT FROM OLD.target_label
     OR NEW.title           IS DISTINCT FROM OLD.title
     OR NEW.detail          IS DISTINCT FROM OLD.detail
     OR NEW.occurred_route  IS DISTINCT FROM OLD.occurred_route
     OR NEW.app_version     IS DISTINCT FROM OLD.app_version
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'product_feedback: only status/status_reason are mutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_feedback_immutable_columns_trg ON product_feedback;
CREATE TRIGGER product_feedback_immutable_columns_trg
  BEFORE UPDATE ON product_feedback
  FOR EACH ROW EXECUTE FUNCTION fb2_product_feedback_immutable_columns();

/*
 * 状态流水 append-only。组织删除时的级联是生命周期清理不是调用方改写，
 * 沿用 F159 / F176 同一个豁口写法。
 */
CREATE OR REPLACE FUNCTION fb2_status_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'product feedback status events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_feedback_status_events_append_only_trg ON product_feedback_status_events;
CREATE TRIGGER product_feedback_status_events_append_only_trg
  BEFORE UPDATE OR DELETE ON product_feedback_status_events
  FOR EACH ROW EXECUTE FUNCTION fb2_status_events_append_only();

/*
 * 租户隔离 + 最小权限。三张表的 GRANT 各不相同，逐张说明：
 *   · product_feedback               SELECT / INSERT / UPDATE（UPDATE 已被上面的触发器收窄到两列）
 *   · product_feedback_votes         SELECT / INSERT / DELETE（撤票）
 *   · product_feedback_status_events SELECT / INSERT（append-only）
 */
DO $$
BEGIN
  EXECUTE 'ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE product_feedback FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE product_feedback_votes ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE product_feedback_votes FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE product_feedback_status_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE product_feedback_status_events FORCE ROW LEVEL SECURITY';
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_feedback', 'product_feedback_votes', 'product_feedback_status_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
    EXECUTE format('REVOKE ALL ON %I FROM app_rw', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON product_feedback TO app_rw;
GRANT SELECT, INSERT, DELETE ON product_feedback_votes TO app_rw;
GRANT SELECT, INSERT ON product_feedback_status_events TO app_rw;

SELECT kernel_apply_org_freeze_policies();
