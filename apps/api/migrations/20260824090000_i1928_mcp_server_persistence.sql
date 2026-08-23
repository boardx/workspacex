-- issue #1928 —— MCP 远程发现结果持久化。
--
-- ## 这条迁移补的是哪个洞
--
-- `apps/api/src/application/mcp/ports.ts` 头注一直写着「F52 刻意不带 PostgreSQL 实现」，
-- 理由是持久化服务器与工具的表结构属于 F53/F54 该定的形状，提前建表是在猜。F53
-- （`review-mcp-server.ts`）、F54（`set-security-policy.ts`）现在都已经存在、都已经在用
-- `McpReviewStatus` / `McpConnectionStatus` 这两个契约枚举——形状已经不是猜的了，是既有
-- 用例逐字用着的形状。本迁移原样复用它们，不发明第二套状态词汇。
--
-- ## 三张表，同 0019（model pool）一个纪律：凭据单独一张表、列级 GRANT 拒绝读密文
--
-- `mcp_servers`——列表要看的一切（端点、review/connection 状态、工具计数、上次发现时间）。
-- `mcp_server_secrets`——鉴权 token 的密文，`ciphertext` 列不对 `app_rw` 开放 SELECT，
--   与 `model_secrets` 同一条纪律（见 0019 头注的完整论证，这里不重复）。
-- `mcp_tools`——`McpToolStore` 端口（`current`/`replace`）的 Postgres 实现落点，按
--   `(org_id, server_id, full_name)` 唯一，替换掉进程内存版本（`in-memory-mcp-tool-store.ts`
--   仍然存在，供未接 DB 的测试/组合使用，不删除）。
--
-- ## 初始状态不是本迁移定的，是 `initialStatusOnRegister`（domain/mcp/server-status.ts）算的
--
-- `review_status`/`connection_status` 两列没有默认值——应用层在插入时必须显式传入，
-- 值来自既有的 `initialStatusOnRegister(defaultIsolationOn)`，不在 SQL 侧另定一个默认值
-- （两处定义默认值 = 迟早漂移的第二份副本，AGENTS.md 那条硬约束逐字写着）。
--
-- Replayable: 每条语句 IF NOT EXISTS / DROP-then-CREATE。

CREATE TABLE IF NOT EXISTS mcp_servers (
  org_id                 text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  server_id              text NOT NULL,
  -- 发现面板目前不收集单独的展示名——`serverId` 兼作 `name`（`McpServerRow.name`）。
  -- 完整注册流程（`registerMcpServer`，独立可改名）仍未接线，见 ports.ts 头注。
  name                   text NOT NULL,
  description            text NOT NULL,
  endpoint               text NOT NULL,
  -- ① 服务器级授权范围上限。发现出来的服务器恒为「未开放」，与
  -- `NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE` 同一立场（I-21：不静默扩大权限）。
  auth_scope             text NOT NULL CHECK (
                           auth_scope IN ('全体成员', '仅某团队', '仅项目负责人', '需人工确认每次', '未开放')
                         ),
  -- ② 流程状态、③ 运行事实——两列独立，不合并（I-17，见 server-status.ts 头注）。
  review_status          text NOT NULL CHECK (
                           review_status IN ('待安全评审', '已放行', '维持隔离', '有条件放行', '已到期待复核')
                         ),
  connection_status      text NOT NULL CHECK (
                           connection_status IN ('已连接', '限流中', '已隔离', '不可达', '凭据失效')
                         ),
  -- 🔴 F131 的隔离期字段留位；本轮的发现流程不收集 `isThirdParty`，恒为 NULL
  -- （非第三方源语义），到 `registerMcpServer` 真正接线时再由那条用例写入。
  quarantine_until       timestamptz NULL,
  involves_customer_data boolean NOT NULL DEFAULT false,
  -- 本轮只做远程 HTTP/SSE 发现，出站是既成事实。
  is_egress              boolean NOT NULL DEFAULT true,
  registered_by_actor_id text NOT NULL,
  tool_count             integer NOT NULL DEFAULT 0 CHECK (tool_count >= 0),
  first_discovered_at    timestamptz NOT NULL,
  last_discovered_at     timestamptz NOT NULL,
  PRIMARY KEY (org_id, server_id)
);

CREATE INDEX IF NOT EXISTS mcp_servers_org_review_idx ON mcp_servers (org_id, review_status);

-- ---------------------------------------------------------------------------------------
-- 鉴权 token 密文。只加密不解密（domain/model/credential-vault.ts 的纪律原样复用于 MCP：
-- 唯一读者是发起出站请求的那个网关调用，凭据是逐请求现传的，从不从这张表读回明文）。
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_server_secrets (
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  server_id  text NOT NULL,
  -- ⚠ 密文。没有明文列，所以不存在"明文临时写过"的中间态。
  ciphertext text NOT NULL,
  algorithm  text NOT NULL,
  key_id     text NOT NULL,
  sealed_at  timestamptz NOT NULL,
  PRIMARY KEY (org_id, server_id),
  FOREIGN KEY (org_id, server_id) REFERENCES mcp_servers (org_id, server_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------------------
-- 发现出的工具集。`McpToolStore.replace` 全量覆盖式写入（不是增量 upsert），
-- 与端口注释「callers pass the full new set, not a delta」一致。
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_tools (
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  server_id          text NOT NULL,
  full_name          text NOT NULL,
  signature          text NOT NULL,
  schema_fingerprint text NOT NULL,
  side_effect        text NOT NULL CHECK (side_effect IN ('只读', '对外发送', '写入外部')),
  auth_scope         text NOT NULL CHECK (
                       auth_scope IN ('全体成员', '仅某团队', '仅项目负责人', '需人工确认每次', '未开放')
                     ),
  PRIMARY KEY (org_id, server_id, full_name)
);

CREATE INDEX IF NOT EXISTS mcp_tools_org_server_idx ON mcp_tools (org_id, server_id);

-- ---------------------------------------------------------------------------------------
-- RLS，同每一张租户表一样的规则
-- ---------------------------------------------------------------------------------------
ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_servers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_servers_tenant ON mcp_servers;
CREATE POLICY mcp_servers_tenant ON mcp_servers
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE mcp_server_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_server_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_server_secrets_tenant ON mcp_server_secrets;
CREATE POLICY mcp_server_secrets_tenant ON mcp_server_secrets
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tools FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tools_tenant ON mcp_tools;
CREATE POLICY mcp_tools_tenant ON mcp_tools
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON mcp_servers FROM app_rw;
REVOKE ALL ON mcp_server_secrets FROM app_rw;
REVOKE ALL ON mcp_tools FROM app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_servers TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_tools TO app_rw;

-- ⚠ 同 0019：列级 GRANT，`ciphertext` 不在授予列表里——`SELECT *` 在数据库层直接
-- `permission denied for column ciphertext`，不依赖某个 repository 记得排除它。
GRANT SELECT (org_id, server_id, algorithm, key_id, sealed_at) ON mcp_server_secrets TO app_rw;
GRANT INSERT, UPDATE, DELETE ON mcp_server_secrets TO app_rw;

-- F22 三条冻结策略
SELECT kernel_apply_org_freeze_policies();
