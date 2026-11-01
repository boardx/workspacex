# 个人支付契约设计交接

唯一 worktree：/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui。UI branch worker/cn-us-pricing-ui（PR #6087），契约设计 branch worker/cn-us-pricing-contract（issue #6088）。继续复用，不创建第二个 worktree。

本增量源文件 packages/contracts/src/billing-pricing.ts，仅设计未接运行时；新 GET /billing/subscription/entitlement 保留原 GET /billing/subscription 的严格 schema。Free 到账后 30 天到期，Team 增员首期按剩余月度周期折算均已确认。

复验：pnpm --filter @repo/contracts test；pnpm --filter @repo/contracts typecheck；pnpm exec tsx .harness/scripts/lint-contract-route-coverage.mjs --strict。

必须按 GitHub 实时状态核对 #6087。先完成 UI 集成，再让契约 PR 仅包含 #6088 的 schema／设计与证据，不将两个 issue 的实现混在一个 PR。API/usecase 仍需本目录 design-signoff.md 对应人工签核；不得把 UI 确认当作尚未给出的 API 确认。

后续交付顺序：目录与充值包、Pro 月付、年度逐月权益、Free 注册30天批次；每项独立 issue/PR/数据库及浏览器证据。Team、Enterprise、旧订阅清理与发布随后推进，不跳过门控。所有开发基线 origin/develop，PR 目标 develop；开工前 fetch main/develop。部署由独占资源的部署会话安排窗口，本会话不占用其终端。
