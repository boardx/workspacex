-- 0016 F17: 本地组织 → 正式组织的导出 —— **隐私承诺的唯一豁口**
-- (uc-0-5 R10 / V11, contracts/identity/usecases.md `ExportToOrganization`)
--
-- ## 这个文件在防什么
--
-- F16 把「最隐私的数据不出本机」做成了三层可断言的性质（迁移 0015 的触发器、
-- 进程级出网守卫、拒绝而非降级的用例）。F17 是那条承诺**唯一**被允许打开的口子。
-- 一个豁口的危险不在于它存在，而在于它**比声称的宽**：
--
--   · 方向反了       —— 正式组织的数据流进本地组织，本地组织从此不再是「只有我」的
--   · 没人按过按钮   —— 后台同步 / 定时推送，每天悄悄推一次，界面上什么都看不到
--   · 预览是摆设     —— 令牌可复用，于是「人确认过」是一次历史声明而不是当下事实
--   · 没留痕         —— 导出发生了但没有记录，等于没发生过
--
-- 这四条里，**前两条能做成数据库属性**，本文件把它们做成数据库属性；
-- 后两条一半在这里（一次性令牌是条件 UPDATE）、一半在应用层（两侧留痕同事务）。
--
-- ## ⚠ CREATE TABLE IF NOT EXISTS 在表已存在时是**静默空操作**
--
-- `local_export_previews` 是新表，所以它的列定义在这里是权威的。
-- `artifacts` 已存在，因此它的两个新列以 ALTER ... ADD COLUMN IF NOT EXISTS 到达，
-- 约束以 DROP-then-ADD 到达——这两种写法在**已有数据的库上也会收敛**，
-- 而 CREATE TABLE IF NOT EXISTS 不会。同 0015 头部那条。
--
-- 可重放：全部 IF NOT EXISTS / OR REPLACE / DROP-then-CREATE，migrate:check 会忽略
-- 版本表强制重放每个文件。

/* ═══════════════ 一、方向：单向，且由数据库回答 ═══════════════ */

-- 「本地 → 正式」这条方向规则，若只写在用例里，它成立到**第二个调用方**为止。
-- 这里把它做成一个 SECURITY DEFINER 的判定函数：任何写入者都绕不过去。
--
-- ⚠ 为什么必须 SECURITY DEFINER：判定要同时读**两个组织**的 kind，而 RLS 只让当前
--   租户看见自己那一行。以调用者身份跑，`SELECT kind FROM organizations WHERE id = to_org`
--   会返回 NULL——不是「拒绝」，是**看不见**，而看不见会被下游读成「不知道，放行吧」。
--   函数体刻意只读 `organizations.kind` 一列，不返回任何行，所以提权面就是这一句。
CREATE OR REPLACE FUNCTION kernel_export_direction_ok(from_org text, to_org text)
RETURNS boolean AS $$
DECLARE
  from_kind text;
  to_kind   text;
BEGIN
  SELECT kind INTO from_kind FROM organizations WHERE id = from_org;
  SELECT kind INTO to_kind   FROM organizations WHERE id = to_org;
  -- 任一不存在 ⇒ 不成立。缺席的默认必须是「拒绝」，否则一个打错的 id 就是一次放行。
  IF from_kind IS NULL OR to_kind IS NULL THEN
    RETURN false;
  END IF;
  -- 源必须是本地组织，目标必须不是。两个条件都要：
  --   只查源  ⇒ 本地 → 本地也会过（把 A 的私有数据搬进 B 的私有组织）
  --   只查目标⇒ 正式 → 正式也会过（这不是本操作，会绕过正式组织自己的入库审核）
  RETURN from_kind = 'personal-local' AND to_kind <> 'personal-local';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION kernel_export_direction_ok(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_export_direction_ok(text, text) TO app_rw;

COMMENT ON FUNCTION kernel_export_direction_ok(text, text) IS
  'F17: 导出方向的唯一判定（本地 -> 正式）。SECURITY DEFINER，因为判定要同时看两个 '
  '组织的 kind 而 RLS 只让当前租户看见自己那一行——看不见会被读成「不知道，放行吧」。';

/* ═══════════════ 二、预览令牌：一次人工动作的可验证凭据 ═══════════════ */

-- V11① 说「显式一次性人工动作，禁止任何自动同步/后台上传/定时推送」。
-- 这张表是那句话的可断言形式：
--
--   · 一行 = 一次「人看过将要离开本机的清单」
--   · `artifact_ids` 冻结了**当时看到的那一组**，导出时必须完全相等
--     （否则「确认过」这件事可以被套用到另一组内容上）
--   · `consumed_at` + 条件 UPDATE = 一次性
--   · `expires_at` = 新鲜度。永不过期的令牌可以放进 cron，而那正是 V11① 禁止的东西
CREATE TABLE IF NOT EXISTS local_export_previews (
  token        text PRIMARY KEY,
  -- 归属的租户 = **源本地组织**。预览是本地组织里的动作，RLS 也按它隔离：
  -- 令牌落在目标组织的租户里，会让目标组织的成员看见「谁打算导出什么」。
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  to_org_id    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id     text NOT NULL,
  -- 冻结的清单。空数组无意义（导出零件东西不是一次导出），故 CHECK 挡掉。
  artifact_ids text[] NOT NULL CHECK (array_length(artifact_ids, 1) >= 1),
  created_at   timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  expires_at   timestamptz NOT NULL,
  -- NULL = 还没用过。非 NULL = 用过了，且这一列**只会被写一次**（见下方触发器）。
  consumed_at  timestamptz,
  CONSTRAINT local_export_previews_ttl CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS local_export_previews_actor_idx
  ON local_export_previews (org_id, actor_id, created_at DESC);

-- 方向规则在**令牌诞生的那一刻**就生效。
-- 放在这里而不是只放在导出那一步：一个方向错误的令牌根本不该存在——
-- 它存在就意味着界面上出现过一份「反向导入的预览」，而那份预览本身就是在教用户
-- 去做一件被禁止的事。
CREATE OR REPLACE FUNCTION local_export_preview_direction() RETURNS trigger AS $$
BEGIN
  IF NOT kernel_export_direction_ok(NEW.org_id, NEW.to_org_id) THEN
    RAISE EXCEPTION
      'EXPORT_DIRECTION_FORBIDDEN: % -> % is not a local-to-real export',
      NEW.org_id, NEW.to_org_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'The aperture is one-way: only a personal-local organization may export, and only into an organization that is not personal-local.',
            HINT    = 'Importing INTO a personal-local organization has no contracted operation and never will -- it would make "only I am in here" false.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_export_preview_direction_trg ON local_export_previews;
CREATE TRIGGER local_export_preview_direction_trg
  BEFORE INSERT OR UPDATE ON local_export_previews
  FOR EACH ROW EXECUTE FUNCTION local_export_preview_direction();

-- 令牌**只能被核销，不能被改回未核销、不能被改内容**。
--
-- 为什么不是只靠应用层的条件 UPDATE：条件 UPDATE 保证的是「两个并发的导出只有一个
-- 成功」，它保证不了「没有第二段代码把 consumed_at 抹回 NULL」。
-- 抹回 NULL 的那段代码会长得非常无辜——「重试失败的导出」。
CREATE OR REPLACE FUNCTION local_export_preview_consume_only() RETURNS trigger AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'EXPORT_PREVIEW_SPENT: preview token % was already consumed at %', OLD.token, OLD.consumed_at
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'A preview token is one human action. Re-arming it turns "somebody confirmed this" into a claim about the past.';
  END IF;
  IF NEW.token IS DISTINCT FROM OLD.token
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.to_org_id IS DISTINCT FROM OLD.to_org_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.artifact_ids IS DISTINCT FROM OLD.artifact_ids
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION
      'EXPORT_PREVIEW_IMMUTABLE: only consumed_at may change on preview token %', OLD.token
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'The frozen list is what "the human saw this" refers to. Editing it re-points an existing confirmation at different content.';
  END IF;
  IF NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION
      'EXPORT_PREVIEW_IMMUTABLE: preview token % cannot be un-consumed', OLD.token
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_export_preview_consume_only_trg ON local_export_previews;
CREATE TRIGGER local_export_preview_consume_only_trg
  BEFORE UPDATE ON local_export_previews
  FOR EACH ROW EXECUTE FUNCTION local_export_preview_consume_only();

ALTER TABLE local_export_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_export_previews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS local_export_previews_tenant ON local_export_previews;
CREATE POLICY local_export_previews_tenant ON local_export_previews
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON local_export_previews FROM app_rw;
-- UPDATE 是核销所必需的，DELETE 不是：一次预览发生过就是发生过，
-- 而「导出前先把自己的预览记录删掉」是一条不该存在的路径。
GRANT SELECT, INSERT, UPDATE ON local_export_previews TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE 策略）。
--
-- ⚠ 必须显式调用一次，而**不能**指望 0014 自己扫到这张表：0014 的编号在前，
--   首次跑迁移时这张表还不存在。这不是推测——第一版 0016 少了这一行，
--   `verify-migrations.sh` 的强制重放当场报「重放后 schema 摘要不一致」，
--   多出来的正是这张表的三条冻结策略。也就是说新库上它**没有**冻结，
--   而 F22 的全部断言依然全绿（它们测的是当时已存在的那些表）。
--
-- 规则本身仍只声明在 0014 —— 在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE local_export_previews IS
  'F17 V11①: 一行 = 一次「人看过将要离开本机的清单」。artifact_ids 冻结当时那一组，'
  '导出时必须完全相等；consumed_at 由条件 UPDATE 一次性核销；expires_at 让'
  '「人刚刚确认过」是当下事实而不是历史声明（永不过期的令牌可以放进 cron）。';

/* ═══════════════ 三、目标侧的来源标注 ═══════════════ */

-- user_visible_behavior：「目标侧的条目明确标注『来自某成员的本地组织，
-- 未经本组织入库审核』」。
--
-- ⚠ 它是**列**而不是只写进 provenance。两者都要，理由不同：
--   provenance 回答「这次导出发生过吗」——它是事件。
--   这两列回答「我现在看着的这条东西是哪来的」——它是**状态**，
--   而在目标组织里判断「这份材料能不能当作结论依据」的人看的正是状态。
--   只有事件的话，那个判断要靠一次审计检索，于是实际上没人做。
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS imported_from_org_id text;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS imported_from_artifact_id text;
-- 标注文案本身。⚠ 落库的是**契约函数生成的那一句**（`localExportUnvettedNote`），
-- 不是数据库自己拼的——数据库拼一句、界面拼一句，就是第六次「同一事实两处声明」。
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS imported_from_note text;

-- 三列同生共死：有来源就必须有条目 id 和标注，没有来源就三列全空。
-- 半填的行是最糟的形态：它看起来「有来源信息」，于是读的人不会再去查，
-- 而它实际上答不出是谁的本地组织。
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_import_marks_travel_together;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_import_marks_travel_together
  CHECK (
    (imported_from_org_id IS NULL AND imported_from_artifact_id IS NULL AND imported_from_note IS NULL)
    OR
    (imported_from_org_id IS NOT NULL AND imported_from_artifact_id IS NOT NULL
     AND imported_from_note IS NOT NULL AND length(imported_from_note) > 0)
  );

-- 一条被导入的成果，其方向必须仍然成立。
--
-- 这不是重复第二节那条：那条守的是**令牌**，这条守的是**行**。
-- 没有这条，一段绕开预览直接 INSERT 的代码（比如一个「批量迁移脚本」）
-- 可以把正式组织的东西标成本地来源，或者把东西写进本地组织并声称是导入的。
CREATE OR REPLACE FUNCTION artifact_import_is_one_way() RETURNS trigger AS $$
BEGIN
  IF NEW.imported_from_org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT kernel_export_direction_ok(NEW.imported_from_org_id, NEW.org_id) THEN
    RAISE EXCEPTION
      'EXPORT_DIRECTION_FORBIDDEN: artifact % claims to come from % into %, which is not a local-to-real export',
      NEW.id, NEW.imported_from_org_id, NEW.org_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'The mark says "this arrived through the one aperture". The aperture only ever points one way.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifact_import_is_one_way_trg ON artifacts;
CREATE TRIGGER artifact_import_is_one_way_trg
  BEFORE INSERT OR UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION artifact_import_is_one_way();

CREATE INDEX IF NOT EXISTS artifacts_imported_from_idx
  ON artifacts (org_id, imported_from_org_id)
  WHERE imported_from_org_id IS NOT NULL;

COMMENT ON COLUMN artifacts.imported_from_note IS
  'F17: 「来自成员 X 的本地组织，未经本组织入库审核」。⚠ 内容由契约函数 '
  'localExportUnvettedNote() 生成——数据库拼一句、界面拼一句就是同一事实两处声明。';
