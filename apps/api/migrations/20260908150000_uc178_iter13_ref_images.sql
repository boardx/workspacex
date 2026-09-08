/*
 * UC-17.8 迭代 13（design-delta `design-chat-inputs` §1）—— 设计项目的**参考图**。
 *
 * ## 为什么单独一张表，而不是塞进 design_projects 的一个 jsonb 列
 *
 * 迭代 11 刚把三份平行数组收敛成一列 `screens`，看起来"再加一列 jsonb"是同一个思路。
 * 但那次收敛解决的是「一屏的多份数据按下标配对」这个不变量，而参考图不是按下标配对的东西：
 * 它有独立的生命周期（单独上传、单独删除、字节在对象存储里另有一份），jsonb 列没法给
 * `object_key` 做外键式的清理，也没法在"删项目"时顺带回收对象。
 *
 * ## 字节不进库
 *
 * 与 `feedback_attachments` 同一形态：库里只存元信息 + `object_key`，字节在对象存储。
 * 这不只是省空间——`DesignProject` 的列表接口会带上 `refImages`，字节进库迟早会有人
 * `SELECT *` 把它捎出去（V55 用「元信息不含字节」把这件事钉在契约层）。
 *
 * ## 上限写进 CHECK
 *
 * 单张 4MB、类型三选一，与契约 `PROTOTYPE_REF_IMAGE_MAX_BYTES` / `IMAGE_MIMES` 同值。
 * ⚠ 这是**第二处**声明——但它是数据库这一侧的最后一道，删掉它意味着应用层一处 bug 就能
 * 写进违规行。契约测试 V51 覆盖应用层，这条 CHECK 覆盖"绕过应用层直接写库"。
 * 改上限要两处一起改；契约那份是权威。
 *
 * 「一个项目最多 3 张」不写 CHECK：那是跨行约束，SQL 表达它要么加触发器要么加冗余计数列，
 * 两者都比"应用层插入前先 count"更容易出错。应用层判，V51 钉。
 */
CREATE TABLE IF NOT EXISTS design_project_ref_images (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id   text NOT NULL REFERENCES design_projects (id) ON DELETE CASCADE,
  uploaded_by  text NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  object_key   text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4 * 1024 * 1024),
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 读侧恒按项目取，且要按上传顺序稳定排列（参考图条的顺序不该每次刷新都变）。
CREATE INDEX IF NOT EXISTS design_project_ref_images_project_idx
  ON design_project_ref_images (project_id, created_at);

-- RLS 与 design_projects 同源：跨组织读不到别人的参考图。
ALTER TABLE design_project_ref_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_project_ref_images FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_project_ref_images_org_isolation ON design_project_ref_images;
CREATE POLICY design_project_ref_images_org_isolation ON design_project_ref_images
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

/*
 * 迭代 13（delta §5.2）—— 原型自己的明暗主题。
 *
 * 它是**原型的属性**，不是"看的人后台开了哪个色"：同一份原型给谁看都该是设计者定的那个色，
 * 导出的 HTML 也跟随它（V69）。所以进项目行，而不是进浏览器的偏好存储。
 *
 * 默认 'dark' 与这一列出现之前的行为逐字相同——旧行读出来是 dark，屏上不会因为这次迁移变色。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark'
  CHECK (theme IN ('light', 'dark'));
