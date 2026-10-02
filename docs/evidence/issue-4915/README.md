# 问卷设计器原位编辑 — 当前验证边界

- 分支：`codex/survey-paper-editing`，复用原 worktree；最终验收基于 main `6588d6389ea68d1cfaf151fa9c0b22b9460a83ae`。
- 已确认范围：轻量工具/导航、白色问卷画布、题号标题必答同排、字段点击原位编辑与离焦展示、上下文操作；保留自动保存、拖拽、试填与发布契约。
- 不改线上数据、API、发布版本，不混入其他模块改动。

## 当前结论（2026-10-02；下方为历史排错记录）

- 全部受影响问卷回归：37 文件、336 项通过，退出 0，`/private/tmp/survey-paper-pr-unit.log`。
- 真实隔离 API/数据库与浏览器：5 条完整流程通过，退出 0，`/private/tmp/survey-paper-pr-browser.log`；包括原位编辑真实保存/刷新恢复、创建、发布、填写、答卷与报告链路。AI 使用隔离模型 fixture，不据此宣称真实模型输出质量已验收。
- 最终 typecheck / lint：退出 0，`/private/tmp/survey-paper-pr-types.log`、`/private/tmp/survey-paper-pr-lint.log`；production build 亦在浏览器启动流程中通过。
- 桌面 1586 × 992、375/768 窄屏截图已刷新并人工检查；保存在本目录。`git diff --check` 通过。
- 本次 compose `wsx-e82a7992f7f52679ae19` 清理成功，容器清单中无该栈；未清理其他会话服务。
- 按直接交办 SOP 提交独立 PR，不合并、不部署；全仓 CI 结果在 PR 上跟进，不把历史中断回归称为通过。

## 已执行

- `./init.sh`：退出 0，快速路径基础检查通过；日志 `/private/tmp/survey-paper-init.log`。
- 原位编辑新增回归在旧实现失败：默认选中题目仍有“问题内容”文本框；日志 `/private/tmp/survey-paper-red.log`。
- `pnpm --filter web exec vitest run tests/ui/survey-responsive-designer.test.tsx tests/ui/survey-live-workspace.test.tsx`：45 项通过；日志 `/private/tmp/survey-paper-ui.log`。
- 更新后的设计器回归：13 项通过（包含未选中题目选项修改不覆盖邻题、复制/删除/撤销）；日志 `/private/tmp/survey-paper-interactions.log`。该命令的另外两个过滤文件不存在，实际只有设计器文件被发现，不宣称额外覆盖。
- `pnpm --filter web typecheck`：退出 0；日志 `/private/tmp/survey-paper-types.log`。
- `pnpm --filter web lint`：退出 0，ESLint、light-scope、lint-design 均通过；日志 `/private/tmp/survey-paper-lint.log`。
- `git diff --check`：退出 0。

## 未完成，不宣称通过

- `pnpm --filter web test` 全量运行期间出现下列文件失败：`board-content-tools.test.tsx`、`canvas-template-live.test.tsx`、`knowledge-panel-list-graph.test.tsx`、`copilotkit-v2-panel-scroll-to-bottom.test.tsx`、`canvas-stage-mindmap-keyboard.test.tsx`、`chat-host-interjection.test.tsx`、`workbench-restored-approval.test.tsx`。日志 `/private/tmp/survey-paper-suite.log`。未完成基线反证，不认定这些失败已被证明为历史失败。
- 主机负载升至 56 后停止本会话全量 Vitest，退出 143；检查其工作进程已退出。随后全机负载仍升至 87，不追加重型构建，也不停止其他会话进程。
- 真实浏览器、持久化刷新与视觉对照尚未完成。内置浏览器可用，但 `localhost:3197` 无运行服务。已询问用户是否允许执行仓库 Playwright 隔离验收脚本。
- 浏览器回归新增到 `survey-complete-flow.spec.ts`，但尚未运行；不能用组件测试代替真实服务证据。
- 最后补充的 renderer 隐藏重复说明和内联字段 `cn` 合并仅有静态检查覆盖，还需新一轮组件回归。
- 未提交 PR、未推送、未部署、未标记完成。

## 控制平面

用户直接交办的 UI 调整优先于其他模块 readiness 队列。`pnpm harness tick` 因未配置 `COORD_GATEWAY_URL` 失败，不伪造注册或角色状态。readiness 当前 CLR 3/10，与本次 UI 改动不是同一个验收目标。

下一步：主机资源恢复后，运行新一轮相关回归与真实浏览器验收，保存同视口阅读/编辑截图，完成参考图对照后再提交独立 PR（Refs #4915）。

## 2026-10-01 继续验收结果（覆盖上文待执行状态）

- 新一轮四个相关文件 145 项通过：`/private/tmp/survey-paper-final-ui.log`。
- 完整真实浏览器 5 条流程通过：`/private/tmp/survey-paper-responsive-e2e.log`；含原位编辑、真实 PUT 保存、刷新恢复和 1586/768/375 视口。
- 首轮浏览器同名问卷卡片定位失败，已按创建 ID 修复，再运行退出 0；没有降低断言。
- 全量 Web：786 文件中 772 通过、14 失败，6566 项通过、49 项失败、14 个运行错误。日志 `/private/tmp/survey-paper-suite-final.log`。
- 验收 worktree 的 Canvas 原生二进制缺失；执行该现有包标准 install 脚本恢复，无产品或依赖清单修改。旧 timeline 背景断言更新为 aria-current 步骤语义。
- 失败项复跑：15 文件通过，剩白板 `tests/whiteboard/board-content-tools.test.tsx` 的 8 项失败；日志 `/private/tmp/survey-paper-failed-rerun.log`。单独复跑仍有 8 项失败，原因 `crypto.subtle.digest` 的输入跨 realm 类型不被接受；日志 `/private/tmp/survey-paper-board-isolated.log`。
- 干净主仓库（无本次修改）同组 110 项通过；并不把剩余失败认定为已经证明的历史失败。本 worktree 的剩余运行环境差异尚未解决。
- 阅读、编辑与窄屏截图已保存同目录，详细视觉结果见 `design-qa.md`。产品范围验收通过 ≠ 全仓门禁全绿。
- 隔离浏览器脚本正常清理资源。未推送、未创建 PR，保留独立分支和本次修改，等待剩余门禁问题解决。

## 继续排错：运行时差异

- 相同源码、配置、jsdom 版本下，`pnpm --filter web exec node -p process.version` 在验收 worktree 返回 `v22.14.0`，主仓库返回 `v22.23.2`。此前直接运行 `node` 的对比未覆盖 pnpm 实际子进程，遗漏了这一边界。
- 本命令显式使用本机已有 Node 22.23.2：`PATH=/Users/shenyangjun/.nvm/versions/node/v22.23.2/bin:$PATH pnpm --filter web exec vitest run tests/whiteboard/board-content-tools.test.tsx --minWorkers=1 --maxWorkers=1`。
- 原失败 8 项连同该文件全部 29 项通过、退出 0；日志 `/private/tmp/survey-paper-board-runtime-aligned.log`。没有改白板产品代码、测试断言或全局运行时配置。
- 正在用同一运行时重跑完整门禁；不将单文件通过等同全仓通过。

## 最新边界：2026-10-01 22:43

- 已将独立分支快进到最新 main `d1df49f49`，保留本次问卷修改，未混入其他模块差异。
- 最终类型检查退出 0：`/private/tmp/survey-paper-final-types.log`；最终 lint 退出 0：`/private/tmp/survey-paper-final-lint.log`；基础 init 退出 0：`/private/tmp/survey-paper-final-init.log`。
- 中文输入法 Enter、普通 Enter/Shift+Enter、Escape 焦点回归先失败再修复，修复后同组 49 项通过：`/private/tmp/survey-paper-keyboard-red.log`、`/private/tmp/survey-paper-keyboard-green.log`。独立代码复核未发现剩余 Critical/Important 项。
- 首次对齐运行时全量回归因 ENOSPC 退出，不能算通过。仅清理本会话生成的可重建 `.next-fullstack-e2e` 约 2.3GB，未删源码或其他会话产物。
- 最新全量回归日志 `/private/tmp/survey-paper-suite-final-green.log`（文件名不是通过判据）：持续推进且未出现测试失败，但主机 load average 升至 188.85，安全停止本会话精确进程，退出 143。完整门禁仍未完成。
- 未追加重型浏览器构建，未停止其他会话进程。此前真实浏览器 5 条流程通过仍是已有版本证据，不宣称最后键盘修复后的浏览器复验已完成。
- 尚未提交、推送或创建 PR；下一步在主机负载恢复后完成最终全量与真实浏览器复验，再提交仅含本次变更的 PR 到 main。

## 最新验收：2026-10-01 23:01

- main 已同步至 `df6062e94`，本次改动仍仅在独立分支 `codex/survey-paper-editing`。
- 按直接交办 SOP，提交门禁采用 typecheck / lint / 全部受影响问卷测试，非问卷全仓检查交给 PR CI，未将中断全量结果改称通过。
- 全部问卷回归：37 文件、336 项通过，退出 0；`/private/tmp/survey-paper-survey-final.log`。
- 最新 main 上类型检查与 lint 均退出 0；`/private/tmp/survey-paper-current-typecheck.log`、`/private/tmp/survey-paper-current-lint.log`。
- 最终浏览器复验未运行到产品断言：隔离服务启动时无法连接 Docker daemon，退出 1；`/private/tmp/survey-paper-current-browser.log`。该 run 的 compose 名 `wsx-53db55748187111eec1f`，清理同样因 daemon 不可用失败，未确认有成功创建的容器。
- 只读诊断确认 Docker backend 进程存在，但 `/Users/shenyangjun/.docker/run/docker.sock` 不存在，限时 `_ping` 探针失败。正常打开 Docker Desktop 后仍未恢复。未强制重启共享 Docker 服务。
- 当前需恢复 Docker daemon 后重跑真实浏览器验收并核对本 run 清理，再提交 PR；尚未提交、推送或创建 PR。

## Docker 重启后的尝试

- 用户已重启 Docker，限时 `_ping` 返回 `OK`；不是 Docker 不可用的旧阻塞。
- 重新运行相同真实浏览器命令，日志 `/private/tmp/survey-paper-recovered-browser.log`。等待资源门禁超过 5 分钟，主机 load average 升至约 440，远超门禁每核 2.5 的阈值，未获准起栈，未运行产品断言。
- 只读容器清单未发现本次验收栈；进程检查看到其他活跃 Vitest / TypeScript / Playwright 任务，未停止它们。
- 安全停止本会话尚未起栈的精确排队进程（15950/15943/15936/15919），不留下后台任务。等待用户暂停其他重型任务或主机负载恢复后重跑；未绕过资源门禁，未提交 PR。
