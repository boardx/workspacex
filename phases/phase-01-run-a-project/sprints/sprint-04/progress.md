# 进度日志 — Sprint 01/04

## 当前已验证状态(唯一真相)
- 仓库根目录: `/Users/shenyangjun/boardx/workspacex/.worktrees/coord-deep-research-flow`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: F166、F168（不同 owner 并行）
- 当前 blocker: F166 等待其独立 PR 合并；F168 正在实现并等待独立 review。

## 会话记录
### 2026-08-12 02:54:39
- 本轮目标: 实现个人实时转录服务端真实链路。
- 已完成: HTTP ticket、一次性原子消费、个人 capture、BoardX WS、Fun-ASR 状态机、final 先落库后推送、用量幂等、超时与背压。
- 运行过的验证: contracts 186/186；F166 五条 harness 专项；扩展隔离 6 files/8 tests；migration 空库重建与强制重放；API lint；doctor。
- 已记录证据: GitHub issue #1050 评论；本 sprint evidence 将由 verify/PR 继续固化。
- 提交记录: 见 F166 独立分支。
- 已知风险或未解决问题: 前端 AudioWorklet/ticket/WS 接线属 F167；真实阿里账号端点需部署环境变量后做 E2E。
- 下一步最佳动作: review/合并 F166，再领取 F167。

### 2026-08-12 09:48:52
- 本轮目标: 实现 F168 研究首页与可恢复会话。
- 已完成: 建立 F168 sprint 工作集。
- 运行过的验证: 待实现后执行 feature verification。
- 已记录证据: 待 harness verify 生成。
- 提交记录: 当前 rebase 链。
- 已知风险或未解决问题: 与 F166 共用 sprint 04，但 owner 独立；不得互相覆盖状态或证据。
- 下一步最佳动作: 只推进 F168，不修改 F166 范围。
