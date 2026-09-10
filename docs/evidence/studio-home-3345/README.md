# Studio 首页统一（#3345）

对应 [issue #3345](https://github.com/boardx/workspacex/issues/3345)。

## 行为

- `/rec`、`/research`、`/itv` 共用页头、标签与搜索筛选、更新时间排序、卡片和新建入口。
- 统一名称/标签编辑和删除确认弹窗；保存时包括尚未按回车确认的标签，防止重复提交，失败保留输入。
- 录音沿用真实 API 的永久删除；研究/访谈删除为从首页归档，保留引用证据、报告和在途任务，弹窗明确区分。
- 研究允许 owner/显式 collaborator 管理；访谈仅创建者管理，列表通过 `canManage` 控制菜单，服务端再次鉴权。
- 录音首页使用真实会话 AppShell，与研究/访谈共享组织导航；项目转录原型入口不变。

## 验证边界

前端核心回归 4 suites / 55 tests、研究既有视觉契约 7 tests 已通过；研究契约 21 tests 已通过。完整 web/API lint 已通过。web/API typecheck 均通过；最终留白调整后的前端 typecheck 与定向 lint 再次通过。

真实 API/DB 六 suites 首轮在独立数据库运行：3 suites / 25 tests 通过，其余 3 suites / 52 tests 因初始化阶段 120 秒超时未执行。两组 HTTP 测试诊断重跑 17 通过、2 失败，实际 setup 分别约 65 秒和 12 秒。发现并修复归档列缺少 app_rw 列级 UPDATE 授权、访谈旧 CHECK 不允许空标签两项问题；修复后恢复标准 120 秒预算，两组直接受影响 HTTP/DB suites 的 19 tests 全部通过。首轮额外拓展的 runtime persistence suite（33 tests）未重跑，不计入本次通过数。

浏览器布局脚本：`cd apps/web && node scripts/studio-home-visual-check.cjs`。使用显式 API fixture 验证三档视口、编辑刷新、保留筛选、取消删除与确认删除；这不是生产数据或 DB 落库证据。当前 Google Fonts 下载超时，本地截图使用 `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` 配合系统字体替身，生产字体配置未改。12 张截图已逐张检查；研究首页额外 16px 留白已修复并重跑研究页四张截图。三页 1440/768/375 视口无横向溢出，编辑、未回车标签保存、刷新持久化、保留筛选、取消及确认删除全部通过。

独立静态 review 已检查鉴权、归档与在途更新、列表刷新、异步错误/重复提交；发现的访谈刷新清空标签问题已修复。

## 后续交接

工作区 `/private/tmp/workspacex-studio-home`，分支 `codex/unify-studio-home`。直接交办任务不修改 sprint/feature 状态。已完成本次直接受影响功能验证，创建关联 issue 的 PR 后跟踪到检查全绿，交 `coord-main` 合并；尚未部署。

## 可重复命令

```sh
pnpm --filter web typecheck
pnpm --filter api typecheck
pnpm --filter web lint
pnpm --filter api lint
pnpm --filter web exec vitest run tests/ui/guided-research-home-live.test.tsx tests/ui/interview-studio-home.test.tsx tests/ui/realtime-transcription-history.test.tsx tests/ui/studio-history-management.test.tsx
pnpm --filter web exec vitest run tests/ui/guided-research-visual-contract.test.tsx
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/itv/digital-interview-controller.test.ts tests/research/guided-session-list-and-recovery.test.ts
# 浏览器：先启动 apps/web，再运行该目录下的 scripts/studio-home-visual-check.cjs。
```

## PR review 修复

针对录音历史列表在详情读取、标签刷新或停止操作失败后消失的 review，拆分列表错误与辅助操作错误。先运行新增回归得到 4 failed / 17 passed；修复后同一组 21/21 通过（`recording-error-regression.log`）。覆盖详情重试、停止重试、标签初始化失败、删除后的剩余卡片可见，同时验证真正的列表筛选请求失败仍阻止展示旧结果。

## CI 修复验证

- `verify-affected`：访谈修改/删除操作补齐必需的 `err` 契约，完整 contracts 74 suites / 739 tests 通过（`contracts-full.log`）。
- `gates-runtime`：研究归档列与索引增加 `IF NOT EXISTS`。标准 test-isolation 包装器下 `pnpm --filter api run migrate:check` 从空数据库应用 248 份迁移并强制重放，schema/data digest 一致，引用及 append-only 夹具保持，退出码 0；隔离栈已清理（`migrations-replay.log`）。
