# 进度日志 — Sprint 01/05

## 当前已验证状态(唯一真相)
- 仓库根目录: `/Users/shenyangjun/boardx/workspacex/.worktrees/coord-voice-unify-rec-chat-asr`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: F173 `/rec 复用 Chat 实时 ASR Provider`
- 当前 blocker: F173 11/11 专属验证通过；`verify:base` 两轮分别被 identity/skill 无关测试在机器高负载下超时阻断，F173 保持 `in_progress`。

## 会话记录
### 2026-08-13 06:29:48
- 本轮目标: 统一 `/rec` 与 Chat 的实时 ASR Provider，删除个人 Fun-ASR 双轨。
- 已完成: controller/gateway/main/kernel 改用 `ASR_PROVIDER`；PCM 用量、final 写序、停止竞态和延迟 open 断线清理已有覆盖。
- 运行过的验证: F173 11/11；API/Web typecheck；gateway 3/3；无关 identity 失败用例单跑 7/7。
- 已记录证据: `evidence/F173.verify.log`（包含两轮完整基础门控及环境失败原文）。
- 提交记录: `ce8c77ff`、`26f6749b`。
- 已知风险或未解决问题: `verify:base` 尚未退出 0，不能标 passing；exact SHA 独立 review 进行中。
- 下一步最佳动作: 等机器负载恢复后重跑 `pnpm harness verify --sprint 01/05 --feature F173`；review 无重要问题后推分支并开 `Closes #1109` PR。
