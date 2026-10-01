# 端到端测试执行 SOP

适用于开发 session 委托独立测试、feature 验收和缺陷复测。测试负责人对测试结果与证据负责；开发负责人修复实现；review 与合并权限遵循仓库既有流程。

本文规定接单到反馈的操作流程。验证标准以 [testing-standards.md](./testing-standards.md) 为准；账号与资源分别遵循 [dev-mode-testing.md](./dev-mode-testing.md)、[agent-resource-cleanup-sop.md](./agent-resource-cleanup-sop.md)；真实模型、产物及性能验收分别引用 [real-model-e2e.md](./real-model-e2e.md)、[deployment-verification-standard.md](./deployment-verification-standard.md)、[chat-agent-performance-acceptance.md](./chat-agent-performance-acceptance.md)。不另设账号表、性能阈值或 CI 完成标准。

## 1. 接单与确认范围

委托通过已授权的 session 消息或约定收件箱提交。每次只执行一个任务，收到后回复测试对象、计划场景和缺失信息；任务不足以执行时先标为阻塞，不猜验收标准。

```json
{
  "task_id": "issue-1234-retest-01",
  "requester_thread_id": "请求 session ID",
  "issue_or_pr": "GitHub issue 或 PR URL",
  "sha": "完整提交 SHA；探索测试可为 null",
  "worktree": "被测代码的绝对路径",
  "environment": "isolated-local",
  "behavior": "用户角色、操作及可观察结果",
  "steps": ["从已有导航进入目标功能", "执行核心操作"],
  "expected": ["页面结果", "持久化结果或产物"],
  "verification": ["已有可执行验证命令"],
  "model_lane": "deterministic",
  "scope_exclusions": []
}
```

`model_lane` 为 `deterministic` 或 `real`。真实模型任务须说明上游及凭据文件来源，值不进任务正文。本地端口和进程归属记录在环境清单中，不写死进测试规格。

任务状态为 received → running → reported；缺环境或规格则 blocked，补齐后重入 running。`reported` 只表示已反馈，结论可以是失败，不能代替 feature passing。

## 2. 固定被测版本

在指定工作目录执行并保存输出：

```bash
git rev-parse HEAD
git status --short
git diff --stat
```

验收指定 SHA 时，HEAD 必须与委托一致，工作树须无影响被测范围的未提交改动。使用独立 worktree，不在共享 checkout 切分支、reset 或 stash。版本不符先纠正环境，不能把当前页面结果归给目标 SHA。

探索测试允许 dirty checkout，但报告须注明“探索证据，不构成该 PR SHA 的独立验收”。测试结束再核一次 HEAD 和工作树；测试期间被测代码变化时，该轮结果不用于版本验收，固定版本后重测。

## 3. 环境预检与选择

1. 新环境按根 AGENTS.md 执行 `./init.sh`；失败先处理基础状态。
2. 记录浏览器、服务地址、数据库隔离标识、compose project、模型 lane、启动命令和服务归属。
3. 检查本任务环境的容器状态、API 健康响应与真实登录；Web 页面可加载只是预检。
4. 确认测试角色、组织和业务数据满足场景前提。权限反证使用实际不同权限的账号。
5. 使用共享人工测试服务时串行预约账号，禁止重置共享库。数据库测试、故障注入及自动化验收按测试标准使用隔离外壳。

服务连接失败、迁移失败、账号不可用、模型配置缺失均属于环境阻塞。不要以跳过用例、改成 mock 或降低断言获得通过。可继续执行不依赖阻塞项的场景，结论保留未验证边界。

## 4. 编排用例

先将每条 `behavior` / `expected` 映射到用例和证据位置，至少包含主链路及相关失败路径；不适用的场景写明原因。

| 场景 | 用户操作 | 核对结果 |
|---|---|---|
| 主链路 | 从真实导航进入，完成核心操作 | 页面、API 与落库或产物一致 |
| 持久化 | 刷新或重新进入 | 数据仍可读，状态未丢失 |
| 权限边界 | 无权限角色访问同一资源 | 拒绝操作且不泄漏受限内容 |
| 输入边界 | 空值、非法值、必要的极端输入 | 明确反馈，不产生错误业务数据 |
| 依赖失败 | 在本任务隔离环境注入失败 | 显示真实失败，已有数据可恢复 |
| 中断恢复 | 适用时取消、重试或重连 | 终态一致，无重复业务副作用 |
| 产出物 | 下载并实际打开文件 | 类型、内容、可读性与用户预期一致 |

异步任务须证明进入过执行态，再走到符合预期的终态；初始空态或按钮消失不构成完成。涉及导航的功能至少一条用例走实际点击路径，不能所有用例都直达 URL。

## 5. 执行与取证

优先复用仓库现有配置与命令，先确认被选中的 spec/project 确实覆盖本任务。以下是入口示例，不意味着全栈烟测覆盖所有功能：

```bash
# 确定性浏览器烟测：内部已带隔离外壳，不重复包裹
pnpm run verify:fullstack-smoke

# 指定用例：替换实际存在且覆盖目标场景的 spec 与 project
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter web exec playwright test \
  --config playwright.fullstack-smoke.config.ts \
  --project=<实际项目名> <实际spec路径>

# 真实模型通道：按 real-model-e2e.md 准备配置
pnpm run e2e:real-model-smoke
```

需要浏览器交互的行为必须实际操作浏览器。组件测试、HTTP 预检或静态检查只能证明各自覆盖的层级。测试输出显示零用例、关键用例 skipped，或未达到预期断言数量时，不判通过。

确定性模型用于稳定回归；真实模型用于验证模型自主决策、流式传输和真实工具产出。报告明确本轮是哪条 lane，不能互相替代。第三方上游失败仍保留证据，区别于实现失败。

取证包括：步骤与结果、截图或 trace、失败请求状态和脱敏响应、控制台异常、必要的服务日志、业务资源 ID 与只读持久化核对。对文件按用户实际消费方式下载并打开；文件存在和 HTTP 200 不证明内容正确。异常可复现时保留首次失败，修复后另开一次 run，不覆写旧证据。

命令保存日志时保留原始退出码。Bash 模板：

```bash
set -o pipefail
pnpm run verify:fullstack-smoke 2>&1 | tee "$RUN_DIR/command.log"
rc=${PIPESTATUS[0]}
printf '%s\n' "$rc" > "$RUN_DIR/exit-code.txt"
exit "$rc"
```

`RUN_DIR` 为事先创建的本次运行目录。该模板用于独立 Bash 脚本，不能把 `tee` 成功当测试成功。新增断言按 verification-writer 做反证，确认破坏目标性质时确实失败；只在独占环境注入故障。

## 6. 证据包与判决

每次运行独立目录，使用 task_id + run_id。session 本地缓存可作临时收件箱，但正式验收证据应按 feature 的 evidence 位置入库，或上传可访问的 CI artifact；不能只有缓存绝对路径。

```text
<task_id>/<run_id>/
  context.json       # 时间、SHA、dirty 状态、环境、角色、lane、版本
  cases.json         # 每条用例：预期、实际、结论、证据引用
  command.log        # 原始执行输出及测试计数
  exit-code.txt
  report.md          # 判决、缺陷和未验证范围
  screenshots/       # 按用例命名
  traces/            # 浏览器 trace（适用时）
  artifacts/         # 用户产物（适用时）
```

凭据、Cookie、session token 和用户敏感数据按已有脱敏规则处理；不导出环境表。证据引用须真实存在、非空且接收方可访问。

| 结论 | 条件 |
|---|---|
| PASS | 本任务全部必需场景在指定版本通过，证据完整 |
| FAIL | 出现与验收预期不符的可观察行为或断言失败 |
| BLOCKED | 环境、账号、版本或规格问题使关键场景无法执行 |
| PARTIAL | 已执行部分场景，其余明确未验证；不作为完整验收通过 |

测试 PASS 是测试结论。feature 状态、PR 全绿与完成定义仍按根 AGENTS.md 和 harness 门控执行，测试负责人不手改 passing、不越权合并。

## 7. 反馈、修复与复测

反馈原请求 session；授权范围内将正式结论关联对应 issue/PR。使用以下格式：

```text
任务：<task_id>；结论：PASS / FAIL / BLOCKED / PARTIAL
版本：<完整 SHA>；工作树：clean / dirty；环境与模型 lane：<记录>
场景：<通过数>/<计划数>；失败或未执行：<用例 ID>
缺陷：<触发步骤 → 预期 → 实际 → 用户影响>
证据：<接收方可访问的日志、截图、trace、产物链接>
未验证：<具体能力或原因>
下一步：<开发负责人修复项 / 环境补齐项 / 无>
```

发现缺陷先保存复现步骤和证据，再交开发负责人。测试任务默认不扩展为实现修改；修复另按仓库开发流程执行。收到新 SHA 后核对版本，复测原失败场景和直接受影响的回归场景；新旧结论分别保留，不能靠重试直到偶然通过消除失败记录。

## 8. 收尾与持续服务

按资源清理 SOP 释放本次亲手创建的一次性栈及进程，记录清理结果。共享长期测试环境按维护委托保留，环境清单写明负责人、进程和用途；一次性任务不得关闭它。

持续测试 session 检查收件箱和环境，正常且无任务时安静；故障、完成或需要人类操作时反馈。协调身份与 tick 遵循 agent-bootstrap.md；缺少已注册身份或网关配置时记录阻塞，不自行认领。最终提交报告和未完成边界，确保下一位能复现本轮结果。
