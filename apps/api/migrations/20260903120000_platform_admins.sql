-- `platform_admins` —— 新的"平台管理员"身份（platform-admin-role delta）。落库、可在界面上
-- 由平台超管授予/撤销，权限比"平台超管"窄：能看/改平台成员名册、能读系统异常
-- （`GET /system/error-logs`），但不能授予/撤销任何人的平台管理员或平台超管身份。
--
-- ## 为什么不是给"平台超管"本身开一个可落库的开关
--
-- `domain/system/platform-superuser.ts` 的头注钉死了这条：平台超管只能靠部署环境变量
-- `PLATFORM_SUPERUSER_EMAILS` 授予，落库会让这个身份继承全部组织级账户管理操作面，
-- 且任何鉴权代码的 bug 都可能被用来自我提权。这条设计没有变，也不该被这张新表间接
-- 绕开——所以 `grantPlatformAdmin`/`revokePlatformAdmin`（授予/撤销这张表里的行）继续
-- 只认 `PlatformSuperuserGuard`（环境变量白名单），不认 `platform_admins` 本身：一个
-- 平台管理员不能把别人、也不能把自己再提成平台管理员或平台超管。见
-- `apps/api/src/interface/controllers/platform-member.controller.ts`。
--
-- ⚠ Deliberately NO `org_id`：与 `credentials`（0010）同一个理由——这个身份跨组织生效，
--   不属于任何一个租户，`kernel_tenant_table_audit()` 需要下面的 COMMENT 豁免声明。
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id     text PRIMARY KEY REFERENCES credentials (user_id),
  granted_by  text NOT NULL REFERENCES credentials (user_id),
  granted_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform_admins IS
  'kernel-no-tenant-data: platform-admin-role delta 的名册，与 credentials 同维度、无租户。'
  '这张表只回答"谁是平台管理员"；授予/撤销一律走 PlatformMemberController 的 '
  'grantPlatformAdmin/revokePlatformAdmin，且那两条路由额外叠一层只认环境变量白名单的 '
  'PlatformSuperuserGuard——本表的存在本身不构成新的提权路径，见 '
  'domain/system/platform-superuser.ts 头注。';

-- `app_rw`（运行时应用身份）读写这张表：内容只是"谁被授予了这个角色"，敏感度与
-- `org_memberships.org_role` 同级——不是 error_logs 那类需要单独角色隔离的诊断内容
-- （对比 `20260902012105_error_logs_admin_read_grant.sql` 的三次教训：那张表要隔离的是
-- 诊断正文，这张表要保护的是"谁能授予"，已经由 HTTP 层的 PlatformSuperuserGuard 把住）。
REVOKE ALL ON platform_admins FROM app_rw;
GRANT SELECT, INSERT, DELETE ON platform_admins TO app_rw;
