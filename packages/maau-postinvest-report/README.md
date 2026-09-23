# @repo/maau-postinvest-report

投后管理报告 MAAU 的**内容包**。

## 这个包装什么

一个 MAAU（Minimum Actionable Agentic Unit，最小可行动智能体工作单元）由两部分组成：

| | 属于 | 例子 |
|---|---|---|
| **运行时** | 通用能力，所有 MAAU 共用 | 编排、工具、沙箱、检索、证据记录、数值解析 |
| **内容** | 这一个 MAAU 特有 | 判据阈值、派生公式、自检算例、方法论正文、评测集、护栏 |

本包装的是**内容**那一半。运行时留在 `apps/api` 与 `apps/web` 的通用位置。

当前内容：

- **风险判据阈值**（`RISK_THRESHOLDS`）：增收不增利、应收异常、客户集中度等 12 条。
- **派生公式**（`DERIVED_FORMULAS`）：同比环比、资本化率、现金跑道等 6 条的文字定义。
- **自检算例**（`SELF_CHECK_CASES`）：模型写完沙箱脚本后用来验证自己的已知答案。
- **渲染函数**：把上面三者渲染成写给模型看的方法论正文片段。

## 为什么从 `@repo/contracts` 搬出来

搬家前这些阈值在 `packages/contracts/src/post-investment-rules.ts`。放那里当初有正当理由：
契约包是本仓既有的、两个 app 都能 import 的跨包单一事实源机制。但它混淆了两类不同的东西：

- **契约**描述系统之间**怎么通信**——请求长什么样、响应长什么样。它必须最开放，
  因为它是生态对接面：第三方要照着它写客户端。
- **MAAU 内容**描述这个工作单元**怎么判断**——什么算风险、阈值定在哪、公式怎么推。
  它随行业 know-how 积累，是资产。

两者的开放策略相反。把判据阈值放在契约包里，等于把最该积累的东西放进了最该开放的包。
`@repo/dev-mode-accounts` 当初出于同样的理由独立成包（「这不是 API 契约，只是测试/开发
夹具数据，因此不放进 `@repo/contracts`」），本包沿用那个先例。

**这次搬家不改变任何数值，也不改变单一事实源的地位。** 搬之前它是唯一事实源，
搬之后仍是——只是换了个位置，并且这个位置说明了它是什么。

## 依赖方向

```
@repo/maau-postinvest-report   ← apps/api（参照实现按常量判定）
                               ← apps/web（方法论正文按渲染函数生成）
```

**本包不依赖 `@repo/contracts`，`@repo/contracts` 也不依赖本包。** 这个方向必须保持：
契约包一旦依赖内容包，内容就会随契约一起分发。

与 `@repo/contracts` 一样，本包是**纯常量与纯函数，不 import 任何东西**——它被 web 与
api 两端同时 import，任何一侧的运行时依赖都会污染另一侧。

## 改判据的规则

改阈值**只改 `src/index.ts`**。方法论正文不得手抄任何数值，它由本包的渲染函数生成；
后端参照实现按本包的常量判定；参照实现的测试遍历 `SELF_CHECK_CASES` 用真实函数验证。
三条路径都指向同一份数字，改一处忘另一处会有东西变红。

数值的业务来源：`phases/phase-17-post-investment-report-agent/requirements/
03-analysis-standard-and-evidence.md` 的 C 节。那份文档说明判据**为什么**这么定，
本包只忠实记录**是什么**。

## 还没搬进来的

- **方法论正文**目前在 `apps/web/lib/post-investment/methodology.ts`，它 import 本包渲染阈值。
  正文本身也是 MAAU 内容，后续应一并搬入。
- **评测集**（测试方案的标准答案）按设计**从不进仓库**，也不进任何模型可读上下文。
- **投后评级 MAAU**（`packages/contracts/src/postinvest-rating-rules.ts`，评分档位与权重）
  是同一类内容，面临同样的问题，应照本包的样子独立成 `@repo/maau-postinvest-rating`。
  那份文件的头注释里已经写明它「最终应落在 skill 包内」，本次未动，属独立改动。
