/*
 * Phase 18 F06 再追加（部署级抽取开关落库，用户直接交办，非 sprint 排期）—— 部署级开关
 * 从「环境变量 + 重启才能改」改成「落库、平台管理员可来回切换」。
 *
 * ## 为什么要改
 *
 * 迁移 20260924210000 把 `kg_extraction_state` 设计成**全库单例、只能 false → true**：要打开
 * 全靠部署方设 `KG_EXTRACTION_ENABLED=1` 再重启进程；要关闭，运维直接 `UPDATE ... SET
 * enabled = false`（同一份文件头注写明"只开不关"是有意的，见该文件）。这在真实运维里
 * 撞了一次实际事故：devapp 的部署流水线坏了好几天（`/usr/local/bin/workspacex-deploy`
 * 落后于仓库里的 `deploy.sh`），当时没有任何办法把这个开关从关翻成开——而按本项目自己
 * 的约定，这台机器的凭据不出机器，remote 也没法直接 SSH 上去改。一个纯粹的功能开关，
 * 因为被绑死在"改部署配置 + 重启"这条路径上，在部署流水线本身坏掉的时候变得不可操作。
 *
 * ## 现在怎么分
 *
 * 与 issue #4178 的组织级开关同一个思路、同一张表结构（`kg_extraction_state` 本身不换）：
 * 把"翻转这个开关"从"改部署配置"搬进"平台管理员调一次后台接口"，不再需要重启，也不再
 * 需要碰这台机器。`kg_extraction_state.enabled` 语义不变，仍然是"这次部署要不要让抽取
 * 排队"；变的只是**怎么写它**——`kg_extraction_enable()`（只能 false → true，单向）继续
 * 保留，供既有调用方（worker 启动、旧测试夹具）兼容；新增 `kg_extraction_set_enabled(v)`，
 * 双向、供平台管理员的后台接口调用。`kg_enqueue_extraction()` 触发器的 SQL 一个字不用改——
 * 它已经在查这一行的 `enabled`，这正是这次迁移唯一要做的事：让这一行的值可以被人为、
 * 随时改回来，而不是新造一道闸门。
 *
 * ## 默认值改成开（issue #4178 的组织级开关当时也是同一人类指令"默认是打开的"）
 *
 * 迁移 20260924210000 把这一行的默认值种成 `false`，理由是"避免悄悄改变没打算用知识图谱
 * 的部署、以及大量 e2e 测试的行为与成本"——但那份顾虑本来就已经被 `KERNEL_MODEL_PROVIDER`
 * 这道更早的闸门挡住了（`kg-extraction-model-config.ts`：没有配置模型 provider，
 * `enabled` 恒为 false，压根不会跑到这一行）。真正配置了模型 provider 的部署，绝大多数
 * 打算就是要用知识图谱——继续默认关，只是把同一个"忘了开"的坑从"忘了设环境变量"换成
 * "忘了调一次后台接口"，没有解决问题。这里把默认值改成 `true`，并把已存在的单例行
 * 一并回填成 `true`（这张表全库只有一行，回填不影响任何组织的数据）。
 *
 * ## 权限模型
 *
 * 这是部署级、非租户数据（同 `kg_extraction_state` 本身：没有 RLS，因为它不是任何一个
 * 组织的数据）。写权限的裁决在应用层——新增的 `KgDeploymentExtractionSettingsPort` 只被
 * 平台管理员专属的 controller 路由调用（`PlatformOperatorGuard`），数据库这一侧不叠
 * 第二道角色判定（与 `kg_org_extraction_settings` 的写权限裁决同一个理由：应用层已经
 * 判过，这里再判一次只是同一件事声明两遍）。
 */

-- 既有单例行回填为开；新插入的默认值一并改成开（虽然这张表此后不会再有新插入——
-- ON CONFLICT DO NOTHING 早在上一条迁移就把唯一一行种出来了，这里只是让 DEFAULT 与
-- 现在的语义保持一致，不留一个「新环境种出来的默认值」与「老环境回填后的值」不一致的缝）。
ALTER TABLE kg_extraction_state ALTER COLUMN enabled SET DEFAULT true;
UPDATE kg_extraction_state SET enabled = true, enabled_at = coalesce(enabled_at, now()) WHERE singleton;

-- 双向切换：平台管理员的后台接口调这个，不再要求「只能开一次」。`kg_extraction_enable()`
-- （单向）原样保留——worker 启动时、以及既有测试夹具仍然调它，语义不变、不重复声明。
CREATE OR REPLACE FUNCTION kg_extraction_set_enabled(v boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ UPDATE public.kg_extraction_state SET enabled = v, enabled_at = CASE WHEN v THEN coalesce(enabled_at, now()) ELSE enabled_at END WHERE singleton $$;
REVOKE ALL ON FUNCTION kg_extraction_set_enabled(boolean) FROM PUBLIC;

-- 读：这张表没有 RLS（不是租户数据，全库一行），直接 SELECT 即可，不必再包一层
-- SECURITY DEFINER 读函数——`kg_org_extraction_settings` 的读也是直接 SELECT（同一先例）。
-- 这条 GRANT 让 app_rw 首次真的能读这张表（上一条迁移 REVOKE ALL），verify-rls.sh 的
-- kernel_tenant_table_audit() 会把「无租户列 + app_rw 有 SELECT」的表判成
-- UNTENANTED_BUT_GRANTED，除非表上有一份 `kernel-no-tenant-data:` 开头的 COMMENT
-- 声明这是有意的豁免（0004 迁移的先例）——这里补上。
COMMENT ON TABLE kg_extraction_state IS
  'kernel-no-tenant-data: 部署级知识图谱抽取开关，全库单例（singleton 行），不属于任何组织，'
  '没有 org_id 也不应该有——它是一次部署的运行时配置，不是租户数据。';
GRANT SELECT ON kg_extraction_state TO app_rw;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_extraction_set_enabled(boolean) TO app_rw;
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();
