/*
 * WF06（Phase 20 work-stack-foundation）—— WorkflowTrigger（domain.md「WorkflowTrigger」）：
 * pg-boss 定时唤醒（`{kind:'workflow',triggerId}`）与 webhook 触发（`POST
 * /workflow-triggers/:triggerId/webhook`）共用的触发器登记表。
 *
 * 两张表的原因与 0022/`shared_org_invite_links` 逐字相同（见后者文件头注）：webhook 调用方
 * 与 pg-boss 作业只带 triggerId,还没有任何租户上下文——查这一行时 `app.current_org` 必然
 * 未设置,一条 org_id 的 RLS 策略会让恰好要找的那一行读不到。所以拆成：
 *
 *   workflow_triggers         触发器的业务事实（workflow_key/version/owner/agent）。带 org_id
 *                             ⇒ 租户表 ⇒ FORCE RLS,只在解出 org_id 后才能读。
 *   workflow_trigger_lookup   id → org_id_hint（+ webhook 的 HMAC 密钥）。**不带租户键**——
 *                             这是 webhook 签名校验/pg-boss 唤醒唯一能在「还不知道是哪个组织」
 *                             时读到的东西,也是本迁移里持有 webhook 密钥的唯一一行。
 *
 * ⚠ 密钥列存的是 **HMAC 共享密钥明文**（验签必须能拿到原值；本仓库的 AES 封装只有 encrypt,
 *   解密需要单独门控的模块与评审,见 aes-credential-cipher.ts 文件头——不在 WF06 范围）。所以：
 *   - 列名直说 `webhook_secret`,不叫 `*_ref`（它不是引用,就是凭据本身）；
 *   - app_rw 对本表只有 **列级** SELECT (id, org_id_hint)——不能 `SELECT webhook_secret`,不能批量导出；
 *   - 唯一读路径是 SECURITY DEFINER 函数 `workflow_trigger_webhook_secrets(id)`：按单个 id 取回
 *     「当前 + 上一把」两个槽位,供验签使用（R9 轮换：换钥时旧钥挪到 previous 槽,窗口内两把都认）。
 * 密钥从不经任何读 API 返回（domain I-15）；PgWorkflowTriggerStore 只在验签内部用它,
 * 事件/日志/响应体都不落它。改成引用/密文是已记录的后续项（见 WF06 issue 评论）。
 */
CREATE TABLE IF NOT EXISTS workflow_triggers (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('schedule', 'webhook')),
  workflow_key  text NOT NULL,
  version       integer CHECK (version IS NULL OR version >= 1),
  owner_user_id text NOT NULL,
  agent_id      text NOT NULL,
  -- 定时唤醒没有调用方能带 payload（pg-boss 作业只有 {kind,triggerId}），所以运行输入在建
  -- 触发器时冻结在这里；webhook 触发器忽略本列,输入来自请求体（trigger-webhook.ts）。
  default_input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(default_input) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_triggers_org_idx ON workflow_triggers (org_id);

CREATE TABLE IF NOT EXISTS workflow_trigger_lookup (
  id          text PRIMARY KEY REFERENCES workflow_triggers (id) ON DELETE CASCADE,
  org_id_hint text NOT NULL,
  -- 仅 webhook 触发器非空；schedule 触发器没有签名校验。明文 HMAC 密钥,见文件头注。
  webhook_secret          text,
  -- R9 轮换槽：换钥时把旧钥挪到这里,验签接受两者之一；轮换完成后置 NULL。
  webhook_secret_previous text
);

COMMENT ON TABLE workflow_trigger_lookup IS
  'kernel-no-tenant-data: webhook 调用方与 pg-boss 定时作业只带 triggerId、没有租户上下文时的'
  '唯一可查路径。WHAT app_rw CAN ACTUALLY SEE HERE: 一个 org_id_hint（「存在某个组织 id」这一'
  '事实）（密钥列无列级 SELECT,只能经 workflow_trigger_webhook_secrets(id) 按单个 id 取）。workflow_key / agent_id / owner'
  '等业务内容都在 workflow_triggers（租户表, FORCE RLS）,须先以 org_id_hint 重开租户会话才能读。';

DO $$
BEGIN
  EXECUTE 'ALTER TABLE workflow_triggers ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE workflow_triggers FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS workflow_triggers_tenant ON workflow_triggers';
  EXECUTE 'CREATE POLICY workflow_triggers_tenant ON workflow_triggers '
       || 'USING (org_id = current_setting(''app.current_org'', true)) '
       || 'WITH CHECK (org_id = current_setting(''app.current_org'', true))';
END
$$;
REVOKE ALL ON workflow_triggers FROM app_rw;
GRANT SELECT, INSERT ON workflow_triggers TO app_rw;

SELECT kernel_apply_org_freeze_policies();

-- 无租户表：没有 DELETE（触发器停用走应用层「不再解析出可用记录」,不是本迁移范围）。
-- 列级 SELECT：app_rw 读不到密钥列（见文件头注）；INSERT 保留给建触发器的写路径。
REVOKE ALL ON workflow_trigger_lookup FROM app_rw;
GRANT SELECT (id, org_id_hint) ON workflow_trigger_lookup TO app_rw;
GRANT INSERT ON workflow_trigger_lookup TO app_rw;

CREATE OR REPLACE FUNCTION workflow_trigger_webhook_secrets(p_trigger_id text)
RETURNS TABLE (webhook_secret text, webhook_secret_previous text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.webhook_secret, l.webhook_secret_previous FROM workflow_trigger_lookup l WHERE l.id = p_trigger_id
$$;
REVOKE ALL ON FUNCTION workflow_trigger_webhook_secrets(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow_trigger_webhook_secrets(text) TO app_rw;
