# 会话交接 — Sprint 01/03

## 当前已验证
- F164 仍为 `in_progress`，不能宣称 passing。
- F164 的四条 feature verification 已由 harness 全部跑过并通过；证据在 `evidence/F164.verify.log`。
- 隔离数据库验收覆盖 create/list/read、名称与正文搜索、标签、owner/admin 边界、多 capture/final-only 聚合。

## 本轮改动
- 新增个人转录契约、迁移、application port/usecases、Postgres repository、RecordingController 路由与 Kernel provider。
- personal_transcriptions 只存元数据；正文不复制，final 继续存 recording_segments。
- recording_sessions 仅对 `source_type=personal` 允许 project_id 为空，并用 trigger 约束 capture 的 org/owner。
- 补齐契约覆盖矩阵与 `/rec` 导航可达性单源登记。

## 仍损坏或未验证
- `pnpm -w run verify:base` 在全套 850 条 harness 测试并发下，`.harness/scripts/fullstack-smoke.test.ts` 7 条固定 5s 超时；同文件隔离运行 13/13 通过。该已知基线问题阻止 harness 把 F164 升为 passing。
- 尚未创建 F164 PR，尚未合入 main；禁止开始 F165/F166 或声称用户已能实时转录。

## 下一步最佳动作
- 先解决/裁决 #954 的全套并发超时，重新跑 F164 harness verify；通过后按一 feature 一 PR 合入 main。
- F164 合入后再认领 F165，实现一次性 ticket、Fun-ASR 上游状态机、final 先落库与用量幂等；不要把它塞进 F164。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/03 --feature F164`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/recording/personal-transcription-persistence.test.ts`
