-- backlog D3 —— CRM「边缘存 ID、源站存个人信息」的源站（境内）一侧。
--
-- 线索个人信息（姓名 / 公司 / 电话 / 邮箱 / 备注）**只**存在这里。Cloudflare 运营平面
-- （apps/ops-console）只存不透明 `lead_id` 与非个人信息状态；详情页在查看时由运营人员浏览器
-- 直接回源读取本表，边缘不代取、不缓存、不落盘。个人信息跨境传输待法务确认——不建任何导出通道。
--
-- 访问控制两层：
--   ① HTTP：PlatformOperatorGuard（平台超管或平台管理员），见 crm-contact.controller.ts；
--   ② 行级：RLS FORCE，策略只在会话设置了 `app.crm_operator = 'on'` 时放行。仓储在守卫之后的
--      事务里 `set_config(..., true)`（事务级）；其他任何代码路径——哪怕拿到 app_rw 连接——
--      默认一行都读不到、写不进。这是纵深防御，不替代 ①。
--
-- ⚠ 无 `org_id`：线索是平台运营自己的业务数据，不属于任何客户租户（下方 COMMENT 豁免声明）。
CREATE TABLE IF NOT EXISTS crm_contacts (
  lead_id     text PRIMARY KEY CHECK (lead_id ~ '^lead_[a-f0-9]{16}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  company     text NULL CHECK (company IS NULL OR length(company) <= 200),
  phone       text NULL CHECK (phone IS NULL OR length(phone) <= 32),
  email       text NULL CHECK (email IS NULL OR length(email) <= 254),
  notes       text NULL CHECK (notes IS NULL OR length(notes) <= 4000),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_contacts_operator_only ON crm_contacts;
CREATE POLICY crm_contacts_operator_only ON crm_contacts
  USING (current_setting('app.crm_operator', true) = 'on')
  WITH CHECK (current_setting('app.crm_operator', true) = 'on');

REVOKE ALL ON crm_contacts FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_contacts TO app_rw;

COMMENT ON TABLE crm_contacts IS
  'kernel-no-tenant-data: D3 CRM 线索个人信息（境内源站），平台运营自有数据，不属于任何客户租户。'
  'HTTP 层 PlatformOperatorGuard + RLS FORCE（app.crm_operator 会话标记），见 crm-contact.controller.ts。';
