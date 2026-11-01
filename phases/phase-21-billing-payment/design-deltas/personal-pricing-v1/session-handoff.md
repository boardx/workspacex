# 个人支付契约设计交接

唯一 worktree：/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui。UI branch worker/cn-us-pricing-ui（PR #6087），契约设计 branch worker/cn-us-pricing-contract（issue #6088）。继续复用，不创建第二个 worktree。

本增量源文件 packages/contracts/src/billing-pricing.ts，仅设计未接运行时；新 GET /billing/subscription/entitlement 提供完整新读模型；旧计费入口分阶段替换后退役，不兼容旧订单和余额。Free 到账后 30 天到期，Team 增员首期按剩余月度周期折算均已确认。

复验：pnpm --filter @repo/contracts test；pnpm --filter @repo/contracts typecheck；pnpm exec tsx .harness/scripts/lint-contract-route-coverage.mjs --strict。

必须按 GitHub 实时状态核对 #6087。先完成 UI 集成，再让契约 PR 仅包含 #6088 的 schema／设计与证据，不将两个 issue 的实现混在一个 PR。本目录用例/API已另获用户明确确认并授权回填签核（区别于此前仅UI确认），可按逐项实现计划推进。

后续交付顺序：目录与充值包、Pro 月付、年度逐月权益、Free 注册30天批次；每项独立 issue/PR/数据库及浏览器证据。Team、Enterprise、旧订阅清理与发布随后推进，不跳过门控。所有开发基线 origin/develop，PR 目标 develop；开工前 fetch main/develop。部署由独占资源的部署会话安排窗口，本会话不占用其终端。

最新用户裁决：清空全部旧计费订单、订阅、余额、流水。不清用户和组织业务资料。任何早先“保留旧余额／兼容旧订单”的材料均被本裁决覆盖；生产重置必须与部署会话协调，版本屏障防止重放旧回调再次入账。

2026-11-02 实时核对：#6087 已合入 develop（25320a892a74ffa90c12e4169637a3be84ced661），#6086 已由该 PR 关闭，解除上述 UI 集成依赖。本契约分支已重基，7 项 schema 测试重新通过。用户已明确授权本次定价任务逐 PR 检查、独立审查通过后正常合入 develop；禁止 admin bypass，生产部署另行协调。目录、充值、年付发放、Free 增量已分支保存，待按依赖逐个重基并独立提 PR，不混入本 PR。
