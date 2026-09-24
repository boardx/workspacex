# 会话交接 — Sprint 09/01

## 当前已验证
- 无 passing feature。已验证仓库快速初始化通过，Sprint 09/01 可由 harness 重建。

## 本轮改动
- 新增 F04 问卷可信发布设计文档与实施计划。
- 将 Phase 09 F04 领入 Sprint 09/01，生成派生工作集。

## 仍损坏或未验证
- F04 产品代码尚未实现，API/UI/Playwright 验证均未跑。
- F03 依赖尚未 passing；束级三项人工签核仍待完成。
- `coord-survey` 网关请求目前 `fetch failed`，无法完成权威租约握手。

## 下一步最佳动作
- 先解除上述门禁，再按 `docs/superpowers/plans/2026-09-24-survey-trusted-publishing-foundation.md` 以 TDD 顺序实施。
- 不要手改 `active-features.json`，不要在产品实现和真实浏览器验证之前将 F04 标记为 passing。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 09/01`
- 调试:`pnpm harness readiness`
