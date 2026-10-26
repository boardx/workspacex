# 注册邮箱验证临时暂停 — #5939

## 2026-10-26

- 用户直接交办；复用当前 worktree，从最新 origin/main 创建分支。
- 共享 AUTH_POLICY.emailVerificationRequiredForLogin=false；注册成功后通过标准 login、SessionProvider 进入 /projects。原验证流程可通过该开关恢复。
- email_verified_at 保持 NULL；密码验证、锁定与会话权限沿用既有实现。
- 前端测试先出现 3 条预期失败，修改后 19/19 通过；真实 PG/Redis 注册、登录、锁定测试 47/47 通过。
- ./init.sh 通过；受影响 API/Web/contracts 的最终 typecheck/lint 11/11 任务通过。
- 独立只读 working-diff 审查 ACCEPT；PR 与提交 SHA 审查随后记录在 GitHub。
- harness readiness / active-features 已运行；tick 因 COORD_GATEWAY_URL 未配置失败，未认领或虚报协调租约。
