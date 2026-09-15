# team2 投后评级 Agent — 验收标准（10 分制）

> 2026-09-15 人类要求「自己定一个验收标准，迭代到 9 分」。本文件就是那个标准。
>
> **它入库，不是活在对话里**——写在聊天里的标准，改起来没人看得见，那等于没有标准。
> 每一轮迭代只许改实现去满足它，不许改它去迁就实现；确需改标准，单独一条提交写明
> 为什么，让改动可审。
>
> **打分不由实现者做。** 自评是已知会自我说服的（`evaluator-rubric.md` 开篇逐字写过
> 「开箱即用的 evaluator 偏弱，会自我说服通过」）。终评由独立上下文的 `feature-evaluator`
> 依据本文件执行。

## 这个 10 分是对什么打的

对**「一个投后项目负责人能不能拿到一份可信的评级」**打分——可用性与可信度。

⚠ **它不等于 UC-16.1 的完成度。** UC-16.1 的阶段三（评级记录实体、版本链、
`draft → confirmed` 采纳、输入哈希到 run id 的审计追溯）已由人类在 2026-09-15 拍板
**不做**（team2 是临时 agent，按本仓 ad-hoc 惯例不落库，见
`team2-postinvest-rating-mvp.md`「明确不做」）。本标准把那部分排除在外，因此：

- 本标准满分 10 ≈ UC-16.1 完整需求的 **6 分**左右。
- 若要把阶段三计入，上限相应改变——那需要先撤销上述决定并签 `design-signoff.md`。

把这句话写在最前面，是为了「9 分」不会被读成「这个 Agent 完整实现了需求」。

## 计分规则

10 条，每条 1 分，**没有半分**。一条得分当且仅当：

1. **有机械检查**：一条能跑的命令/测试，不是"看代码觉得对"。
2. **检查现在是绿的**，且命令与输出记在本文件对应行。
3. **反证成立**：把该条的实现摘掉后那条检查必须变红。只会绿不会红的检查不算检查
   ——本仓栽过「`toContain("assertProjectMember")` 命中的是方法定义本身，把调用
   注释掉照样全绿」。

> 静态检查（tsc / lint）**不单独构成任何一条的证据**。2026-09-15 实测教训：
> 「点击开始没反应」时 typecheck 与 lint 全绿。类型对 ≠ 行为对。

## 十条

| # | 条目 | 机械检查 | 状态 |
|---|---|---|---|
| A1 | 落地页可发起：条件齐全时点击真的建线程、挂 Agent、传附件、发任务书并跳转 | `apps/web/tests/ui/rating-launcher-start-button.test.tsx` 用例 3 | ✅ |
| A2 | 永不静默失灵：任一前置条件缺失时按钮禁用**且**页面给出唯一一句原因 | 同上 用例 1、2 | ✅ |
| A3 | 失败可诊断：发起失败时把真实 reasonCode 显示出来，不是笼统文案 | 同上 用例 4 | ✅ |
| A4 | 发起链路本身被测：`launchRatingThread` 对 live-chat 的调用序列与参数正确（建线程→取编制→挂 Agent→逐个传附件→带 attachmentIds 发消息） | `apps/web/tests/postinvest-rating-launch-chain.test.ts` | ✅ |
| A5 | 人工确认事实不被模型推断：缺失原因表单结果逐字进任务书，且第二步声明以它为准 | `apps/web/tests/postinvest-rating-missing-reason.test.ts`「missing-reason」组 | ✅ |
| A6 | 评分规则单一事实源：档位表/分级带/阈值只声明一次，引擎与任务书同源 | `apps/web/tests/postinvest-rating-missing-reason.test.ts`「规则手册」组 + `.harness/scripts/postinvest-rating-rulebook.test.ts` | ✅ |
| A7 | 算分确定性且符合 PDF 口径：10 个业务场景逐条符合预期；确定性由「连跑两次逐位比对」**与**「评分模块不许出现非确定性来源」两道一起守 | `node --import tsx apps/api/scripts/postinvest-rating-acceptance.ts` + `.harness/scripts/postinvest-rating-purity.test.ts` | ✅ |
| A8 | 趋势记忆通道真实可用：写入与检索同源、不再指回搜不到的 knowledge_search、主观偏差不进记忆 | `tests/postinvest-rating-missing-reason.test.ts`「记忆协议」组 | ✅ |
| A9 | 部署即可用：补种脚本按 stable_name 幂等、展示名与前端查找键同源、deploy.sh 真的调用它 | `.harness/scripts/vm/deploy-team2-backfill-wiring.test.ts` | ✅ |
| A10 | 交接准备度：仅靠仓库内文件即可接手，且**已知缺口被写明**而不是隐去 | `.harness/scripts/team2-doc-honesty.test.ts`（断言文档点名了阶段三缺口、m4a 限制、部署仍需人的一步） | ✅ |


## 证据（2026-09-15，本地实跑）

```
# A1 A2 A3 A4 A5 A8（apps/web）
pnpm --filter web exec vitest run tests/ui/rating-launcher-start-button.test.tsx \
  tests/postinvest-rating-launch-chain.test.ts tests/postinvest-rating-missing-reason.test.ts
  → Tests  26 passed (26)

# A6 A9 A10（控制平面，CI 由 verify-control-plane 的 `vitest run --dir .harness` 跑）
npx vitest run .harness/scripts/team2-doc-honesty.test.ts \
  .harness/scripts/postinvest-rating-rulebook.test.ts \
  .harness/scripts/vm/deploy-team2-backfill-wiring.test.ts
  → Tests  20 passed (20)

# A7
cd apps/api && node --import tsx scripts/postinvest-rating-acceptance.ts
  → 10 个场景 A/A/D/E/E/—/A/B/A/A，全部 ✅ 符合预期
```

### 反证（把实现摘掉，对应检查必须变红——全部实跑过）

| 摘掉什么 | 结果 |
|---|---|
| `disabledReason` 的渲染 | A1–A3 组 `2 failed \| 2 passed` |
| 消息里的 `attachmentIds`（改成 `[]`） | A4 组 `1 failed \| 6 passed` |
| `deploy.sh` 里的补种调用 + 模板展示名改字面量 | A9 组 `3 failed \| 4 passed` |
| 文档里「审计追溯」那句 + 让标准引用一个不存在的测试 | A10 组 `2 failed \| 6 passed` |
| 把分级带硬编码回引擎 + 把手册里 C 档下沿改成 75 | A6 组 `1 failed \| 4 passed` |
| 往 `cashScore` 注入 `Date.now() % 2` | 纯度门 `1 failed \| 6 passed` |

#### 一条值得留下的教训：A7 的检查一开始并没有检查它声称的东西

最初 A7 只有「连跑两次比对」。注入 `Date.now() % 2` 之后，验收脚本**照样 exit 0**——
两次调用落在同一毫秒，时间依赖在那个尺度上看起来完全确定。双跑抓得住 `Math.random()`
和迭代顺序问题，抓不住时间依赖，而时间依赖恰恰最阴：今天两次一致，跨天重跑就变了分。

修法不是把双跑做得更花哨，是换一种证明方式——不证明「两次相同」，而证明「不可能不同」
（`postinvest-rating-purity.test.ts` 扫评分模块里的非确定性来源）。**是反证暴露了这件事**；
没有反证，这条会一直挂着一个绿勾。

### 本地跑不了、只能靠 CI 的部分（如实记）

`apps/api` 的 vitest globalSetup 无条件用 docker 起 pgvector 容器，而本环境的镜像拉取被
组织策略拒绝（403），**不绕**。因此 A6 那组一致性断言已从 `apps/api/tests/` 搬到
`.harness/scripts/`——它一行 SQL 都不跑，没有理由被容器挡住。搬家后本地与 CI 都能跑。
真正写库的 `ensureSystemAgent` 仍由 `apps/api/tests/agent-runtime/` 的既有真栈用例覆盖，
那部分只在 CI 跑。

## 记分板

每轮迭代后更新这一节：写清得分、当轮做了什么、下一轮打算拿哪几条。

| 轮次 | 得分 | 本轮做了什么 |
|---|---|---|
| 起点 | 6/10（A4/A9/A10 无任何检查 = 0 分） | — |
| 1 | 7/10 | A4：发起链路本身被测（建线程→挂编制→传附件→带 attachmentIds 发消息，含顺序） |
| 2 | 8/10 | A9：部署接线机械核对（deploy.sh 真调用、展示名与前端查找键同源、lock key 不撞） |
| 3 | 9/10 | A10：文档诚实度 + 标准不许引用不存在的门控（这条当场抓出我自己引用了两个不存在的文件） |
| 4 | 9/10 | A6 从需要容器的套件搬到控制平面套件——原位置在拿不到 docker 的环境里根本跑不了，等于没有检查 |
| 5 | 9/10 | 全量实跑 + 五组反证 + 证据入库；交由独立上下文的 `feature-evaluator` 终评 |

### 起点自评（实现者自评，仅作起点参照，不作数）

A5 / A6 / A7 / A8 有检查且绿；A1–A3 的检查随 PR #3697 一起进来；
A4 / A9 / A10 **没有任何机械检查**——按本文件的计分规则，它们此刻是 0 分，
不因为"代码看起来是对的"而给分。
