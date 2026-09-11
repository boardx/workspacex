-- issue #3405（#3399 的治因项）—— 未采纳的插话由服务端带入下一轮。
--
-- 此前：run 一进终态，`workbench_journal_unapplied_interjections` 给每条没应用的插话
-- 记一条 `not_applied` 事件就结束了，没有任何一处把那句话带进下一轮 —— 助手从头到尾
-- 没收到它。composer 逐字写着「随时补充要求，agent 会在下一步前纳入」，而这一轮
-- 没有「下一步」时那句承诺就断了。
--
-- 现在：终态转移这一刻就是「这句话还要不要继续送」的唯一判定点（本文件的 CASE），
-- 判定结果落在行状态上，投递由 `interjection-carry-over.ts` 的 sweep 走既有
-- `acceptHumanMessage` 全链路完成。判定与投递分离，但判定只有这一处。

ALTER TABLE agent_run_interjections
  ADD COLUMN IF NOT EXISTS carried_over_run_id text;

ALTER TABLE agent_run_interjections DROP CONSTRAINT IF EXISTS agent_run_interjections_status_check;
ALTER TABLE agent_run_interjections ADD CONSTRAINT agent_run_interjections_status_check
  CHECK (status IN ('queued','staged','applied','carry_over_pending','carried_over','not_applied'));

-- sweep 的取活索引：绝大多数行不在这个状态，部分索引让它保持 O(待投递条数)。
CREATE INDEX IF NOT EXISTS agent_run_interjections_carry_over_pending
  ON agent_run_interjections(org_id, run_id, sequence) WHERE status = 'carry_over_pending';

-- 带入产生的那条人类消息回指来源 run。**深度上限就靠它判**：一条消息带了这个值，
-- 它驱动的那一轮就是「带入轮」，那一轮自己再有未应用插话时不再自动带入（终止条件）。
-- 不用计数器：计数器要自己维护、会漂；这是一条写下去就不会变的血统事实。
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS carried_over_from_run_id text;

CREATE OR REPLACE FUNCTION workbench_journal_unapplied_interjections() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record; n integer; origin_is_carry_over boolean; carry boolean; public_status text;
BEGIN
 IF NEW.status NOT IN('succeeded','failed','cancelled') THEN RETURN NEW; END IF;

 -- 深度上限 ≤ 1：本轮自己就是上一次带入产生的 ⇒ 不再带入。这是自动循环的硬性终止
 -- 条件（新 run 又产生未应用插话时，链条在这里停，落回手动「重新发送」）。
 SELECT (m.carried_over_from_run_id IS NOT NULL) INTO origin_is_carry_over
   FROM chat_messages m WHERE m.org_id=NEW.org_id AND m.id=NEW.input_message_id;

 -- 用户主动取消 ⇒ 不带入。他刚表达了停止意图，替他把没执行的指令自动跑起来，
 -- 正是「它自己跑起来了而我停不下来」。`failed` 仍带入：用户的请求与这轮为什么
 -- 失败无关。这一个 CASE 就是「带不带」的唯一事实源。
 carry := (NEW.status <> 'cancelled') AND NOT COALESCE(origin_is_carry_over, false);
 public_status := CASE WHEN carry THEN 'carried_over' ELSE 'not_applied' END;

 FOR item IN SELECT * FROM agent_run_interjections
   WHERE org_id=NEW.org_id AND run_id=NEW.id AND status IN('queued','staged') ORDER BY sequence LOOP
  UPDATE agent_run_interjections
     SET status = CASE WHEN carry THEN 'carry_over_pending' ELSE 'not_applied' END
   WHERE org_id=NEW.org_id AND run_id=NEW.id AND interjection_id=item.interjection_id;
  SELECT COALESCE(MAX(seq)+1,0) INTO n FROM agent_execution_events WHERE org_id=NEW.org_id AND run_id=NEW.id;
  INSERT INTO agent_execution_events(org_id,run_id,seq,payload) VALUES(NEW.org_id,NEW.id,n,
    jsonb_build_object('kind','interjection','interjectionId',item.interjection_id,'text',item.text,'status',public_status));
 END LOOP;
 RETURN NEW;
END $$;
