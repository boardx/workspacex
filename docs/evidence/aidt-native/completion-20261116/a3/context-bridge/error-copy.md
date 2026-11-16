# A3：已批准上下文错误的安全中文反馈

仅修改 `apps/web/lib/copilotkit-v2-error-copy.ts` 与其既有测试。七个`AidtContextErrorCode`按合同闭枚举完整映射，区分选择无效、请求过大、当前不可使用、同消息键冲突、服务不可用、原记录缺失与不一致；不把快照或读取失败写成模型已经收到/没有收到，也不声称已保存学习成果。普通Chat既有文案保持。

真实本地依赖读取确认：`@ag-ui/client@0.0.57` 的 `src/run/http-request.ts`（安装包sourcemap）会把非2xx JSON响应构造成 `Error('HTTP <status>: <JSON>')`；`@copilotkit/core@1.69.0` 的 `run-handler.ts`保留原Error通过`agent_run_failed`/`agent_run_failed_event`发出；现有panel从`runError.message`调用同一描述函数。因此除精确闭码，还解析该有界HTTP封装中的封闭reasonCode。嵌入在任意诊断字符串中的码、未知码、畸形JSON、过大wrapper均不提取；debug/source/trace字段不显示。

实际命令（Node22/pnpm9.15）：

- `pnpm --filter web exec vitest run tests/lib/copilotkit-v2-error-copy.test.ts tests/lib/agent-run-failure-reason-copy.test.ts tests/chat-runtime-display-i18n.test.ts`：退出0，3文件45/45（37+5+3），见`error-copy-targeted.txt`。
- `pnpm --filter web exec tsc -p /tmp/aidt-error-copy-tsconfig.json`：退出0，仅本路源文件与对应测试，见`error-copy-typecheck.txt`。
- `git diff --check`：退出0。

首次命令误用不存在的filter `@repo/web`，未收集任何项目，未计入通过；改用真实package名`web`后执行上述45项。未调用模型、未启动服务，未新增英文文案或改变普通Chat错误协议。实际浏览器HTTP错误显示仍需根最终构建后验证；本次证明安装SDK传输shape对应的纯函数行为与既有文案回归。
