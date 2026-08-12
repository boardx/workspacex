# 会话交接 — Sprint 04/03

## 当前已验证
- F03 精确验证：API 5/5、Web 2/2。
- 真实 PostgreSQL、实际 HTTP loopback 模型提供方、跨组织隔离和幂等转换均已覆盖。
- 迁移检查：106 个迁移从空库重建、逐文件强制回放、schema digest 一致。
- F02/能力目录受影响回归：5 files / 33 tests 全绿。

## 本轮改动
- 新增快捷访谈、消息和批量来源素材表、RLS、来源指针及复合租户外键。
- 接通数字专家快访的启动、恢复、发送问题和转批量 API。
- 新增 `/itv/quick/[interviewId]` 完整页面，并让历史快捷卡恢复到该页面。
- 用向前迁移修复 F02 profile trigger 对“目录先于 Agent”兼容数据的外键回归。

## 仍损坏或未验证
- 仓库 API 全量 typecheck 的 `fabric-markdown` DOM lib 错误为 main 既有基线，不在 F03 范围。
- 首轮独立 review 已打回，所有 finding 已返工；尚待新 exact SHA 复审，也尚未合入 main，因此不得宣称完成。

## 下一步最佳动作
- 提交、独立 review、修复 finding 后推送 PR，并由主协调者合并。

## 命令
- 验证：`pnpm harness verify --sprint 04/03`
- F03 API：`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/itv/quick-digital-interview.test.ts`
- F03 Web：`pnpm --filter web exec vitest run tests/ui/quick-digital-interview.test.tsx`
- 迁移：`pnpm --filter api run migrate:check`
