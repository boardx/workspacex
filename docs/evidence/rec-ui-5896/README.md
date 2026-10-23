# #5896 三轮语音 UI 优化

基线 origin/develop `4c36c4cb5ff9cd3316bee3936a0c5d394887b1d1`；同一worktree，分支 `worker/coord-voice-ui-20261023`。旧#5842的轮次、执行结果和截图均不计入本次。

|轮次|产品提交|变化|验证与证据|
|---|---|---|---|
|R1|f43b5c55a|阅读状态说明、可读行宽、连续长词折行、窄屏动作布局|65组件测试；2浏览器用例；r1/|
|R2|c8e1a4993|编辑/保存期间禁止开始采音；保留停止/连接取消出口|新增2项先红；122 consumer通过；2浏览器用例；r2/|
|R3|fc08b26d8503b70a4c6da89d2844ab69f0d28fa3|修正空正文可复制提示误导；三档长内容实测|新增1项先红；123 consumer通过；2浏览器用例；r3/|

范围仅 `apps/web/components/rec/realtime-transcription-workspace.tsx` 和 `apps/web/tests/ui/realtime-transcription-workspace.test.tsx`，以及本证据目录。未改共享壳、token、API或签核状态。

## 命令

consumer命令：`pnpm --filter web exec vitest run tests/ui/create-transcription-focus.test.tsx tests/ui/rec-session-gating.test.tsx tests/ui/rec-fidelity-gaps.test.tsx tests/ui/rec-review-navigation.test.tsx tests/ui/personal-transcription-history.test.tsx tests/ui/realtime-transcription-workspace.test.tsx tests/ui/realtime-transcription-history.test.tsx`。

浏览器命令：`WORKSPACEX_ISOLATION_SEED=coord-voice-5896 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config /Users/shenyangjun/.codex/worktrees/4986/workspacex/.harness/state/.cache/voice-5896/shots.config.ts --grep '步骤 7' --workers=1`。脚本/config存r3/的.txt档案；恢复至上述cache目录可重跑，不接入默认CI重复执行core-loop。

`pnpm --filter web run typecheck`、受影响两文件eslint、`./init.sh`均exit0。init为快速路径，未声称全仓或生产构建通过。

## 验证边界与资源

每轮独立执行真实浏览器，Next dev，真实登录/API/隔离PostgreSQL，Chromium假媒体设备、确定性回环ASR。故障界面为浏览器独占503/clipboard注入，正文编辑及录音刷新走真实API。不能替代生产ASR质量或生产构建证明。

最终本任务compose `wsx-9d8a77959f82dabfa890` 已自动释放，最终API24997/Web25997无监听；Next临时tsconfig include已恢复。未停止他人服务、未创建worktree、未创建PR或合并，待主会话产品验收。
