# main/develop 无损整合（#5986）

目标：先把 main 新增修复同步至 develop，保留优化，再将经过验证的 develop 晋级 main。用户已明确授权这次分支整合；不执行 CN 生产发布。

## 冻结输入与内容证明

SHA 与唯一共同修改文件见 [baselines.json](baselines.json)。`verify-preservation.py` 比较双方从共同祖先以来独有的文件 blob、已提交模式与删除状态，并要求最终提交包含两边历史；共同修改文件必须是经逐行审阅选择的 develop 版本。新建的本轮证据文件不属于原父分支内容。

冲突仅为图片附件 E2E 的两处注释/断言：保留 develop 的“已上传但解析失败”提示、不得假称就绪的反向断言与原有 fixme。main 的上传措辞及负向断言也已包含于此版本；main 所带旧注释声称前端没有 extractionStatus，与当前代码不符，不恢复该注释。不使用全局 ours/theirs 策略。

- 红：未解决冲突时，审计报告 conflict resolution 错误，见 preservation-red.json。
- 绿：工作树核对 main 独有 80 文件、develop 独有 143 文件、共同修改 1 文件，见 preservation-worktree-green.json。
- 提交后的祖先/文件核验：`python3 docs/evidence/main-develop-preservation-5986/verify-preservation.py --revision HEAD`。最终对 origin/main 重跑，禁止以工作树结果替代最终提交证明。

## 本轮验证

- `./init.sh` 快速路径通过；不是全仓完整验证。
- 用量面板、用量格式、管理员监控、聊天计划控制、焦点返回、任务时间线：6 文件，88 passed，4 个已有 skipped（不计为通过），见 usage-chat-tests.log。
- Web typecheck、lint 通过，见对应日志。
- `node docs/evidence/main-develop-preservation-5986/browser-check.cjs` 通过：优化总览、明细、模型下钻、日期选择、桌面/移动/暗色、无横向溢出和无运行错误，见 usage-browser.log 及截图。API 为显式 fixture，不是生产账单或真实后端验收。
- 访谈/研究/图表补充单测：8 文件、92 passed，见 research-interview-chart-tests.log。
- 图片附件真实浏览器链路：1 passed、1 个原有 test.fixme skipped，使用真实浏览器/API/PG，模型和视觉上游为显式 loopback；见 image-e2e-summary.log。隔离包装器退出 0 并清理栈，不代表真实视觉模型能力。
- 负控拒绝任一父分支单边版本，见 negative-controls.json；合并提交的 blob/祖先验证见 preservation-merge-commit.json。
- 独立审阅、两次 PR 门控和最终远端祖先审计状态以 issue #5986 评论及 PR 实时状态为准，不能从本地准备记录推断合并完成。

## 边界

内容一致性可证明原优化代码没有在整合中被覆盖，不能保证任何业务场景都无回归。真实模型、生产账单、CN 页面切流不在本次验证范围。

进度与下一步见 [plan.md](plan.md)。本轮沿用现有 worktree，未创建第二个工作树；本地真实栈验证必须通过隔离包装器并在结束后释放。

## Web 门控所需的既有测试夹具修正

附加问卷探针先得到 20 passed/1 failed：固定的新批次到期时间已经过期。main、develop 与最初整合候选的该测试 blob 均为 `60a1331b14c6c00f1346e097bacaa8472046ad56`，证明不是合并回归。为通过受影响 Web 门控，复用 #5983/PR #5984 中单独的测试提交 `b75c665`，只改该文件 3 增 2 删；不纳入其余 23 文件改动，不修改产品代码或原断言。修正后 21 passed，见 survey-red.log 与 survey-green.log。

保全审计新增一个精确 blob 锁定的 test-only 修正，同时要求双方均未改动的基线文件也保持原样，额外新增文件只能位于本轮证据目录。未登记夹具修正时审计确实失败，见 preservation-fixture-unreviewed-red.json；登记这一项后通过，不能用宽泛例外放过其他源文件变化。

此前对 `3624eaef` 的审阅只覆盖修正前候选；最终候选的补充审阅与 CI 以 PR 实时记录为准，不复用旧 SHA 结论。
