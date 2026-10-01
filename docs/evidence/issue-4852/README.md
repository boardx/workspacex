# 问卷设计顶部操作与自动保存

关联 issue： https://github.com/boardx/workspacex/issues/4852

## 范围

- 设计页移除使用问卷模板、管理模板库以及模板快捷栏。
- 保存为问卷模板移入更多操作。
- 移除重复的保存状态与前往发布回收操作行。
- 顶部手动保存改为发布回收；设计修改默认延迟自动保存。
- 发布回收前先保存未保存修改，失败时保留当前内容并允许重试。
- 设计页可操作按钮使用主色背景和对应前景色；禁用态保留原 token。
- 题号内联编辑触发器保留正文样式，不作为实心操作按钮渲染。
- 非设计页的保存及发布版本锁定规则不变。

## 验证

2026-10-01，本次工作树基于 origin/main ca2d2808c42a。

- `./init.sh`：通过（脚本快速启动检查，不等同全量验证）。
- `pnpm --filter web exec vitest run tests/ui/survey-live-workspace.test.tsx tests/ui/survey-template-actions.test.tsx tests/ui/survey-live-publishing.test.tsx --maxWorkers=1 --minWorkers=1`：53 项通过。
- `pnpm --filter web lint`：通过，无 ESLint 错误或警告，设计 token 门禁通过。
- `pnpm --filter web exec tsc --noEmit`：通过。
- `git diff --check`：通过。
- 真实隔离 API / PostgreSQL / 浏览器链路先前一轮 4 项通过；题号样式排除后的两轮均在 webServer 的 600000ms 启动上限超时，尚未执行浏览器断言。没有把先前一轮当作最终版本通过证据。

浏览器命令：

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/survey-complete-flow.spec.ts --no-deps --workers=1
```

真实链路覆盖自动保存 PUT、刷新后的持久化、更多操作里的模板保存弹窗、创建、发布、真实答卷及报告。AI 提案 case 使用仓库配置的 provider fixture，不作为真实模型输出质量证据。

## 边界

全量 Web Vitest（`pnpm --filter web exec vitest run --maxWorkers=1 --minWorkers=1`）退出码 1：751 文件通过、19 文件失败；6416 项通过、66 项失败、5 项跳过，24 个未处理错误。失败涉及未修改的画布与图片模块，并存在本地 HTMLCanvasElement.getContext 缺失提示。没有修改这些模块，也没有据此宣称全站全绿，未将它们断言为已证明的 main 基线失败。

`pnpm harness tick` 因环境缺少 COORD_GATEWAY_URL 未启动协调循环；没有伪造角色、凭据或 passing 状态。本次直接交办已在 issue 中说明队列外执行原因。

## 交接

分支 `codex/survey-header-autosave`，继续使用当前工作树，不需另建 worktree。最终浏览器验证及全量失败边界未解除，因此按直接交办 SOP 暂不自动创建 PR。代码和相关验证改动已保留；下轮先处理应用启动耗时/验证环境，再运行上述浏览器命令。不要跳过断言或修改全局门禁来制造绿色。

执行状态：顶部操作、自动保存、按钮样式已实现；相关 53 项及 lint 通过；最终浏览器验收受启动超时阻塞；PR 未创建，未部署。

### 后续验证（2026-10-01）

- 已快进同步 main `a5afdb91292d26e4e3ca907b7164574c0a9d6e96`，恢复调整无冲突，仍沿用原 worktree。
- 当前 main 合并版本的上述 53 项、独立 `tsc --noEmit`、lint 全部退出 0，日志 `/tmp/survey-header-checks-main.log`。
- 使用既有 `FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000` 本机覆盖重跑，未修改仓库默认启动上限、用例超时或断言。
- 本机 load averages 实测 `80.79 60.63 42.17`，构建 PID 69672 运行近 12 分钟仍未完成；隔离 PostgreSQL healthy，但 API 后台出现连接超时。为释放本轮资源，向已核对身份的 wrapper PID 68342 发 SIGTERM，退出 143；没有将未执行用例视为通过。日志 `/tmp/survey-header-e2e-main.log`。
- 远程现有 `verify:fullstack-smoke` 只运行 `seeded-github-import`，不覆盖本次 survey spec；未将该 workflow 当作替代验收。全量远程车道范围更大，本轮没有擅自增加临时 CI 或关闭其他会话的进程。
- 继续条件：本机重任务负载回落后，以同一版本重跑真实 browser lane；成功后再提交 PR。基线失败复核尚未开始，原全量失败边界仍有效。

### 提交授权

用户随后明确要求仅提交本次修改，在本 session 的独立分支创建到 main 的 PR。按此新指令提交，不再把完整浏览器验收作为创建 PR 的前置条件；上述未通过/未执行的验证边界仍保留，不合并、不部署、不宣称全绿。
