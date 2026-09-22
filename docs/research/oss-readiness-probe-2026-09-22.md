# 开源就绪度勘探报告（2026-09-22）

> 对 `open-source-business-model.md` v11 标为「尚未核实，需先勘探」的三项做实测，
> 并执行 v11 自己列出的「今天就能做的三件事」。
> **本报告的结论会推翻 v11 的一条核心假设**，见第 1 节。

## 摘要

| 项 | v11 的说法 | 实测结果 | 结论 |
|---|---|---|---|
| phase-16/17 可闭源 | 「行业 know-how，最不该无偿开源」 | 代码分布在 46 个文件，核心评分逻辑 362 行在 **domain 层**，并接进 `kernel.module.ts` | **假设被推翻**，按现状无法闭源 |
| skill 数量 17 | 抄自旧提案 | 实测 **18** 个 `SKILL.md`，分 10 组 | 数字修正 |
| 画布模板 20 个 | 抄自旧提案 | **未找到证据** | 标记为未核实，不再引用 |
| 依赖许可证 | 未盘点 | 脚本已就绪，清出 **2160** 个第三方包，**0 个解析到许可证** | 前置条件仍未满足 |
| git 历史凭据 | 未扫描 | 脚本已就绪；本副本历史被压平，**无法在此得出结论** | 需在完整 clone 上重跑 |

## 1. phase-16/17 无法按 v11 的切法闭源

v11 定了一条原则：`domain` 与 `application` **永远开源**。同时又说 phase-16/17 的
行业 agent 闭源。实测下来这两条**互相矛盾**：

| 位置 | 行数 | 层 |
|---|---|---|
| `apps/api/src/domain/postinvest-rating/scoring.ts` | 362 | domain |
| `apps/api/src/application/post-investment/derive-financial-metrics.ts` | 121 | application |
| `apps/api/src/application/postinvest-rating/rate-financials.ts` | 17 | application |

另有 `apps/api/src/interface/controllers/postinvest-rating.controller.ts`、
`apps/api/src/kernel.module.ts` 与 `main.ts` 的接线，`apps/web` 下 20 余个组件与
lib 文件，合计 **46 个文件**命中。

### 但 know-how 其实不在这 500 行里

`apps/web/lib/post-investment/methodology.ts`（172 行）自称是方法论正文的**唯一事实源**，
且它明确写着：判据阈值与派生公式**不在该文件**，由 `@repo/contracts/post-investment-rules`
渲染进来；测试方案的标准答案**不进任何模型可读上下文**。

这带来两个结论：

1. **真正的护城河是方法论正文与评测答案，不是那 500 行评分代码。** 评分代码是通用的
   加权打分，照抄不难；方法论与评测集才是壁垒。
2. **但方法论的阈值现在在 `packages/contracts` 里**，而 v11 把契约包定为**最宽松的
   Apache-2.0**。护城河的核心参数正躺在计划中最开放的那个包里。

### 改法

D4 的建议从 A（整体闭源付费包）改为 **C（模板与代码开源、方法论正文与评测集闭源）**，
理由不再是「视市场情况」，而是**当前架构只支持 C**：

- 评分代码与控制器留在 OSS，它们本来就是通用能力。
- 方法论正文与阈值从 `packages/contracts` 抽出，移入独立的付费 Skill 内容包。
- 评测集本来就没进仓库，保持不进。

若坚持 A，需要一次真实重构：把行业逻辑从 domain/application 抽到 `ee/` 或独立包。
**这个重构的成本必须先估，再决定 D4。**

## 2. 数字修正

- **Skill 实测 18 个**（`find skills -name SKILL.md`），分 10 组：standard-context 4、
  standard-methods 3、data-workflows 2、standard-audio 2、standard-web 2，
  其余 5 组各 1。另有 `.agents/skills` 30 个目录，那是 **agent 知识库**，不是平台 Skill，
  两者不可合并计数。
- **画布模板 20 个：未找到证据。** 只找到 `skills/standard-methods/maau-canvas/references/canvas-template.md`
  一个引用文件。在拿到机械清点结果前，任何对外材料都不应引用这个数字。

这正是项目自己那条铁律的又一例：旧提案里的数字写得越具体，读起来越像权威。

## 3. 依赖许可证盘点

新增 `.harness/scripts/oss-dependency-inventory.mjs`，从 `pnpm-lock.yaml` 清点第三方包，
装了依赖时从 `node_modules` 逐个读 license。

本次运行结果：

```
第三方包总数      2160
已解析许可证      0
未解析许可证      2160
需人工确认        0
⚠ node_modules 不存在，本次只清点了包名，没有读到任何许可证。
```

**「需人工确认 0」不是好消息**，它只是因为一个许可证都没读到。装完依赖后重跑才有结论。
脚本带 `--strict`，可直接接进 CI 作为开源就绪门控。

已知需要单独定性的包：`@firecrawl/anydoc@0.1.8`，同时被 `apps/api` 与
`apps/skill-sandbox` 依赖，需确认能否随产品再分发。

## 4. git 历史凭据扫描

新增 `.harness/scripts/oss-secret-scan.mjs`，10 条规则，覆盖云厂商 AK、GitHub/OpenAI/
Anthropic token、私钥块、JWT 与赋值式明文口令，带占位符白名单。

本次运行命中 96 处，但**本次运行不构成结论**：

- 本副本的历史已被压平成一个 9677 文件、149 万行的初始导入 commit，可见 commit 仅 68 个。
  脚本已检测并告警。**开源前必须在完整 clone 上重跑。**
- 命中绝大多数落在测试夹具（`apps/coord-gateway/test/`、`packages/coord-projection/test/`、
  `apps/api/tests/` 等），属预期内的假密钥。

**两处需要人工确认**，它们不在测试目录下，各 1 处。

**本报告刻意不记录这两处的文件名与行号。** 理由：这份报告本身要进一个计划公开的仓库，
把候选凭据的精确坐标写进版本控制，等于给未来的读者留一张寻宝图——而且这张图会跟着
git 历史永久留存，即使凭据后来被轮换。定位信息只存在于本地扫描输出里，交给人工处置。

处置方式：在完整 clone 上跑 `node .harness/scripts/oss-secret-scan.mjs`，
从输出里取命中位置，逐个确认是真凭据还是巧合匹配。若是真的，**立即轮换并假定已泄露**。

顺带一提，本次连「读一眼那个值确认真假」都没做成：环境的凭据保护策略拦下了取值动作。
这是正确的行为，也说明了同一件事——凭据的正确处理方式是不让它扩散，包括不让它扩散进
一份讨论它的文档里。

## 5. 对 v11 的一处自我纠正

v11 的「今天就能做的三件事」第 1 条写的是「给每个 package.json 补 `license` 字段」。
**这一条不是无悔动作。** 写上 `"license": "Apache-2.0"` 就是在执行 D1，而 D1 是
v11 自己标为**不可逆**的决策。

无悔的是**盘点**，不是**声明**。第 1 条应改为：生成 SBOM 与依赖许可证清单；
`license` 字段等 D1 拍板后再写。本次因此只做了盘点脚本，没有动任何 package.json。

## 下一步

1. 装依赖后重跑 `oss-dependency-inventory.mjs --strict`，拿到真实许可证分布。
2. 在完整 clone 上重跑 `oss-secret-scan.mjs`，并人工确认上面两处。
3. 估算「把行业逻辑从 domain/application 抽出」的重构成本，作为 D4 的输入。
4. 填 `SECURITY.md` 里的安全联系邮箱。
5. 机械清点画布模板数量，或从所有对外材料中删掉这个数字。
