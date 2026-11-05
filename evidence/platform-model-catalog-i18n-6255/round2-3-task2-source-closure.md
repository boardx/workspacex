# Task 2 rounds 2–3 scoped SOURCE closure

Verdict: **两条 finding 均 ADDRESSED；此单 spec delta 内无新增 actionable finding。** 不代表 native、PNG、响应时序实测或整页验收通过。

精确绑定：固定提交 `5961383d73776382da5a27a3b47358623df207cf`；通过只读 `git show` 独立计算 spec SHA-256 为 `0079bd617a0ce2f6fb372be6439362e1b66b46f6e73c6a5d27a890cb1aa8e8f8`。审查输入 `round2-3-task2-source-review.diff` SHA-256 为 `65a0dacf64852fc3234b53aeac658704bd9415d5baab3325382b2f8bf4c05aad`，同样独立匹配。只看该 spec 的两处修复及直接影响；accepted 上游 chat 和完整 branch 不在本轮范围。

## 1. 登录响应体消费时序 — ADDRESSED

固定 spec `:32–39` 在原生 submit click 前，已把 HTTP 200 检查及 `auth.operations.login.out.safeParse(await actual.json())` 接在实际 `waitForResponse` promise 上；随后用 `Promise.all` 同时等待该消费结果与原生 click。不再等待 click（可能包含导航）完成后才启动响应体消费。该修改直接消除原 finding 指出的延后启动顺序。

`:40–44` 仍严格检查 canonical parse success、真实 actor userId、完整预期 organization 集合及 `/home` URL。没有额外 auth 请求、假 session、mock/intercept、force click、authority grant、宽松分支或敏感内容输出。状态断言只输出 HTTP 数字；schema failure 仅检查布尔 success/固定诊断，不把完整登录 body、token、headers 或 storage 放进 assertion。独立 read 的 token-in-browser-closure 边界未改。

这是 source ordering closure。并行启动消费不等于已经证明任意网络/导航调度下都不会再遇到 CDP resource 问题。`login-response-race-root-finding.md` 引用的是另一个旧 cloud journey 的实际失败，不能当作此 catalog spec 的运行证据。

## 2. 实际 TS18048 首行访问 — ADDRESSED

固定 spec `:174–177` 保留 `if (rows.length)`，单独取真实 `rows[0]`，并在不存在时明确 throw，然后才访问 row 字段。该 executable guard 为后续搜索、kind tag、detail/raw ID/vendor/price 断言提供类型收窄，不使用 cast/non-null assertion，不造数据、不静默 skip。真实空数组及依赖失败分支未放宽，首行及实际 card 断言未删减。

ROOT 的 covering web typecheck receipt 与日志在该固定提交上为 exit 0，支持此前 TS18048 diagnostics 已被覆盖；本 reviewer 未重跑 typecheck。

## 直接影响及已有 covering evidence

差异只调整实际响应的消费顺序和首行存在性 guard；没有增加请求、改变 model/core 写操作、case/PNG 数量、截图 helper、raw metadata/price 检查或权限结果。固定两提交之间 shared Playwright config diff 为空；没有新增 deadline/retry/worker override。沿用此前说明：默认 30s/test、5s/assertion，CI retry 1（非 CI 0），effective workers 依实际运行 artifact 决定。仍不可声称 120s/20s/1/0，也不可声称预算实际可容纳 native audit。

已只读核对 ROOT 的三份 `remaining-*.json` receipt、对应 private log，并独立核对 log SHA-256 匹配 receipt；均绑定 `5961383d…`：

| ROOT 已执行的检查 | 记录结果 | 本轮核对 |
| --- | --- | --- |
| scoped spec eslint | exit 0 / 1.997s | 命令为 `pnpm exec eslint e2e/platform-model-catalog-i18n.spec.ts`；空日志 hash 匹配 |
| canonical web typecheck | exit 0 / 8.378s | 命令为 `pnpm --filter web typecheck`，日志为 `tsc --noEmit`，hash 匹配 |
| canonical product/seeded-github-import discovery | exit 0 / 3.234s | `--no-deps … --list` 明确列出该文件恰好 3 tests，hash 匹配 |

这是读取 ROOT 既有执行记录，不是 reviewer 新执行，也不是 browser/native PASS。报告尾部的其他 gates 由 ROOT 负责，本次不重审或重复门控。

## 边界

本轮只读 source/diff/hash/指定私有报告与已有 gate receipt/log，仅写本文件；未运行测试、lint、typecheck、browser、service、DB 或网络，未改源码/Git、未派子 agent。三个 native case、最多 22 个计划 PNG 仍 **UNRUN**。实际登录竞态结果、native 时长/worker 数、真实行条件下 modal 可达性、几何/中间内容覆盖及逐图 QA 仍未知，须由 ROOT 的既有 cloud lane 取证，不能以本次 SOURCE closure 替代。
