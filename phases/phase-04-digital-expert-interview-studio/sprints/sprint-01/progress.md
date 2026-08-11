# 进度日志 — Sprint 04/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `/Users/shenyangjun/boardx/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: `F02 / 访谈 Studio 首屏：历史访谈与专家列表`
- 当前 blocker: F01 已由 harness 转为 passing；等待 Delivery PR 与独立 review 后合入 main。

## 会话记录
### 2026-08-11 15:57:39
- 本轮目标: 交付 F01 的契约、八态状态机、权限安全读取与 PostgreSQL 可恢复存储。
- 已完成: 八态契约；名称/标签/主题校验；草稿创建；状态投影；非法跳步拒绝；乐观版本迁移；同表 SQL 迁移；Guarded 可见性读取。
- 运行过的验证: 契约 169 tests；itv 362 tests；contracts/api typecheck；API lint；95 migrations 空库重放与强制 replay。
- 已记录证据: `evidence/F01.verify.log`；GitHub issue #973 进展评论。
- 提交记录: `e0c99ede chore(interview): register phase 04 design materials`；业务实现待最终验证后提交。
- 已知风险或未解决问题: main 的 `admin-limits.ts` mock 债务遗漏已按 PR #924 来源补登记；同时修复 `harness verify` 外层隔离标记泄漏到独立 fullstack 测试夹具的问题。
- 最终验证: `pnpm harness verify --sprint 04/01 --feature F01` 通过，F01 已机械转为 passing；基础门禁 39/39 tasks、API 5041 tests、harness 840 tests 全绿。
- 下一步最佳动作: 提交并推送 Delivery PR，按 exact SHA 做独立 review；合入后再认领 F02。
