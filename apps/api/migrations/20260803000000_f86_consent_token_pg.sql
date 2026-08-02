-- F86 (issue #356 part 1): consent-token 从内存态迁到真实 Postgres 持久化。
-- (application/interview/consent-token-ports.ts, 原 in-memory-consent-token-repository.ts)
--
-- ## 为什么这三张表**没有 org_id 列、不带租户 RLS**（与本仓大多数业务表不同）
--
-- `SigningTokenRepository.issue/findActive/consume`、`PortalTokenRepository` 的全部方法、
-- `ConsentSnapshotRepository.save` 的入参里**没有 orgId**（见 consent-token-ports.ts 逐个
-- 方法签名）——这不是本迁移的疏漏，是 F86 五个用例（issue-signing-token / get-consent-page /
-- submit-consent / resend-portal-token / revoke-portal-token）本身的调用链上没有认证会话：
-- 受访者是揣着 URL 里的一枚令牌点进来的匿名访问者，此刻既没有 principal 也没有 org 上下文，
-- 而发起签发的研究员一侧的用例（issue-signing-token）目前也没有任何 controller 调它
-- （interview-scope.controller.ts 只暴露 list/get/attach/detach 四条路由，见 #356 调查）。
--
-- 曾经考虑「在 INSERT 时顺手从 interview_sessions 查出 org_id 存一份」，但那张表
-- 也有强制 RLS（0020），而运行时角色 `app_rw` 是 `NOBYPASSRLS`（0001）：在没有
-- `app.current_org` 的事务里查它，永远是 0 行——不是查询写错了，是这张表对匿名
-- 上下文而言本来就应该读不到。伪造一个「看起来查到了」的 org_id 只会制造一个
-- 从未被真正验证过的外键值。
--
-- ⚠ 已知缺口（写进 PR，不假装在这里解决）：等 F86 的用例签名接上 orgId（比如研究员
-- 管理面要「列出本项目全部门户令牌」），这三张表需要重新设计——参照
-- `invite_link_tokens`（无 RLS 查找表）+ 真正租户表 的两层模式，而不是在这一层
-- 硬塞一个查不出真实值的 org_id。`interview_id`/`subject_id` 两个外键足以在
-- 事后需要时经 JOIN 反查 org_id（那条 JOIN 本身要在真正有租户上下文的路径里跑）。
--
-- 可独立重放：全程 IF NOT EXISTS，约束回填走 DO 块（同仓惯例）。

CREATE TABLE IF NOT EXISTS interview_signing_tokens (
  token_id      text PRIMARY KEY,
  token         text NOT NULL,
  interview_id  text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  subject_id    text NOT NULL REFERENCES interview_subjects (id) ON DELETE CASCADE,
  issued_at     timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  -- 非 null = 已核销（一次性用过）。核销即作废，不可能再次核销（consent-token-ports.ts 头部）。
  consumed_at   timestamptz NULL,
  revoked_at    timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS interview_signing_tokens_token_uniq
  ON interview_signing_tokens (token);

CREATE TABLE IF NOT EXISTS interview_portal_tokens (
  token_id      text PRIMARY KEY,
  token         text NOT NULL,
  interview_id  text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  subject_id    text NOT NULL REFERENCES interview_subjects (id) ON DELETE CASCADE,
  issued_at     timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS interview_portal_tokens_token_uniq
  ON interview_portal_tokens (token);

-- 同意书渲染快照——「当时告知了什么，事后不可回溯改写」，append-only（同 F97 的
-- interview_consent_submissions 立场：只 INSERT，不给 UPDATE/DELETE 权限）。
CREATE TABLE IF NOT EXISTS interview_consent_snapshots (
  snapshot_id       text PRIMARY KEY,
  submission_id     text NOT NULL,
  interview_id      text NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  subject_id        text NOT NULL REFERENCES interview_subjects (id) ON DELETE CASCADE,
  render_params     jsonb NOT NULL,
  bit_record        boolean NOT NULL,
  bit_transcript    boolean NOT NULL,
  bit_ai_analysis   boolean NOT NULL,
  bit_attribution   boolean NOT NULL,
  submitted_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS interview_consent_snapshots_submission_idx
  ON interview_consent_snapshots (submission_id);

-- `findBySubject`（F96 自助门户回看「原始」快照）按 (interview_id, subject_id) 取
-- submitted_at 最早的一条——见 consent-token-ports.ts 的方法注释。
CREATE INDEX IF NOT EXISTS interview_consent_snapshots_subject_idx
  ON interview_consent_snapshots (interview_id, subject_id, submitted_at ASC);

GRANT SELECT, INSERT, UPDATE ON interview_signing_tokens TO app_rw;
GRANT SELECT, INSERT, UPDATE ON interview_portal_tokens TO app_rw;
-- append-only：没有 UPDATE、没有 DELETE。
GRANT SELECT, INSERT ON interview_consent_snapshots TO app_rw;

-- `kernel_tenant_table_audit()`（0004）会把「有 GRANT 却没有 org_id 列」的表报成
-- `UNTENANTED_BUT_GRANTED`，除非表上有一份以 `kernel-no-tenant-data:` 开头的 COMMENT
-- 声明这不是疏漏（同 0010 credentials/login_attempts 的先例）。声明要窄——只claim
-- 「没有租户维度」，不 claim「无害」。

COMMENT ON TABLE interview_signing_tokens IS
  'kernel-no-tenant-data: F86/#356 一次性签署令牌，替换 in-memory-consent-token-repository.ts。'
  '受访者揣着 URL 里的令牌匿名访问——此刻既没有 principal 也没有 org 上下文，调用链本身'
  '不带 orgId（consent-token-ports.ts 逐个方法签名）。伪造一个从 interview_sessions 查出来'
  '却验证不了的 org_id，比不存它更糟。访问控制就是"手里有没有这枚未过期/未核销/未撤销'
  '的令牌"，不是租户边界。';
COMMENT ON TABLE interview_portal_tokens IS
  'kernel-no-tenant-data: F86/#356 门户长效令牌，替换 in-memory-consent-token-repository.ts。'
  '理由同 interview_signing_tokens——受访者自助操作（重发/门户回看）同样是匿名令牌持有者，'
  '不带 orgId。';
COMMENT ON TABLE interview_consent_snapshots IS
  'kernel-no-tenant-data: F86/#356 同意书渲染快照，append-only，替换'
  'in-memory-consent-token-repository.ts。写入时机（受访者提交同意书）同样没有 org 上下文。';
