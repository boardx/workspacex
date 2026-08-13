# 进度日志 — Sprint 01/05

## 当前已验证状态(唯一真相)
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- F169 已由 PR #1126 合入 `main`；阶段清单仍由其 owner 按 harness 门禁收尾。
- F173 已由 `pnpm harness verify --sprint 01/05 --feature F173` 门控为 `passing`，PR #1127 等待合入 `main`。

## 会话记录
### 2026-08-13 17:09:00 — F169
- 已完成: 候选/确认版本模型；方向与大纲生成、编辑和确认接口；主题确认时间；协作者写权限；越权 404；会话驱动 UI。
- 验证: contracts 194/194；F169 API 3/3（隔离数据库）；研究 UI 13/13；web/contracts typecheck；权限路径与架构依赖 lint。
- 证据: `evidence/F169.verify.log`。
- 合入: PR #1126 已进入 `main`。

### 2026-08-13 18:20:00 — F173
- 已完成: `/rec` 复用 Chat 的 `AsrProviderPort` 和 `KERNEL_ASR_*`；删除个人专用 Fun-ASR 双轨；final 先落库后推送；PCM 用量与停止/断线资源清理。
- 验证: F173 11/11、完整 `verify:base`、API/Web 定向回归与 typecheck 均通过。
- 证据: `evidence/F173.verify.log`；人类签核位于 `design-deltas/personal-shared-realtime-asr/design-signoff.md`。
- Review: 独立 feature review 对运行时实现 APPROVE，无 Critical/High。
- 下一步: PR #1127 合入 `main` 后核验 commit 祖先关系与 issue #1109 关闭状态。
