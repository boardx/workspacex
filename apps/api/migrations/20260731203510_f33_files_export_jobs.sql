-- F33: 批量 zip 导出的任务记录（`export_jobs`）。
--
-- 契约：`files.operations.createExportJob` / `getExportJob`（已签核）。
--
-- ## 为什么这是「同步完成」的一张表，而不是队列
--
-- 契约的 `ExportJobStatus` 是 `queued | running | done | failed`，usecases.md 描述的是「异步
-- 任务，不阻塞界面」。本迁移与它对应的应用层（`export-artifacts.ts`）都如实声明：这里没有
-- worker，`createExportJob` 在一次调用内同步取字节、打包、写对象存储、写这张表——所以这张
-- 表**只有一条写入路径**（`saveDone`，状态恒为 `done`），`queued`/`running` 是契约允许但本
-- 实现从不写入的值。失败在任何字节写入对象存储之前抛出，因此不存在「半截 zip 对应的半截
-- 任务行」需要清理——这也是本迁移不需要 `failed` 状态的写入路径的原因。
--
-- ## `download_url` 直接落列，不是 `download_grants` 那一套令牌哈希
--
-- F32 的 `issueDownloadUrl` 必须哈希存令牌，因为那是「不得可转发」的一次性凭证（N-24）。
-- `createExportJob` / `getExportJob` 的签名错误列表里**没有** `DOWNLOAD_URL_EXPIRED` /
-- `DOWNLOAD_URL_CONSUMED`——契约本身没有对这个操作提出「一次性」的要求。所以这里退化为
-- 「生成时构造一次 URL，原样存下，`getExportJob` 原样读出」，不做兑付/一次性核销。
-- ⚠ **诚实声明**：本 feature 没有接一条真正把这个 `download_url` 对应到字节流的 HTTP 路由
-- ——`object_key` 是真的（zip 真的在对象存储里），但「访问这个 URL 能拿到 zip」这条链路
-- 留给后续把它接上 F32 那套隔离域名下载路由的 feature，见 `export-ports.ts` 的注释。
--
-- Replayable：IF NOT EXISTS，`migrate:check` 忽略版本表重放每个文件。

CREATE TABLE IF NOT EXISTS export_jobs (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, 同 artifacts.project_id (0006)：项目被删不应级联抹掉「谁曾经导出过
  -- 什么」这条审计痕迹的落点，即便 project_id 本身变得不可解释。
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  requested_by text NOT NULL,

  status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),

  -- 「文件数 = manifest 条目数」这条断言的服务端一半：本表记的就是打包时数下来的那个数，
  -- 与 zip 里 manifest.json 的 files.length 必须相等——测试比对两边，不在这里重复约束。
  item_count integer NOT NULL CHECK (item_count >= 0),

  object_key text NOT NULL CHECK (length(object_key) > 0),
  -- 整份 manifest.json 字节的 sha256，供离线核对「这份 manifest 有没有被之后动过」。
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),

  download_url text NOT NULL,
  expires_at   timestamptz NOT NULL,
  -- null = status != 'failed'。本实现从不写非 null 值（见文件头），列保留是因为契约的
  -- `getExportJob.out.failureReason` 需要一个可读的落点，即便这条路径今天不可达。
  failure_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT export_jobs_failure_reason_iff_failed
    CHECK ((status = 'failed') = (failure_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS export_jobs_project_idx ON export_jobs (org_id, project_id, created_at DESC);

DO $$
BEGIN
  ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS export_jobs_tenant ON export_jobs;
  CREATE POLICY export_jobs_tenant ON export_jobs
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
END
$$;

GRANT SELECT, INSERT ON export_jobs TO app_rw;

-- F22 的停用冻结：新租户表必须显式调用一次，见 0027 同一注释的第四次重申。
SELECT kernel_apply_org_freeze_policies();
