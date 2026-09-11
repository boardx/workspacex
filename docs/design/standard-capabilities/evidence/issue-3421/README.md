# issue #3421 —— 一次 PPTX 生成的分段耗时实测（含两个**失败**的修法）

实测 SHA `866d29b53be1a82e7cb85e2b468d51f7dc2862ae`（= 测试线在 #3421 里报的同一个 SHA），
本机 10 核，真实 DashScope 模型 + 生产 native graph + 真实 skill 沙箱容器，
同一句手册任务原文「做一个 5 页的 PPT，讲团队协作」，21 个 skill（17 starter-pack + 4 office）。

**这份 README 的结论是：本 issue 没有交付性能修复。** 两个候选修法都实测**更慢**，
已全部撤回；正文 `office-docs-skill-content.ts` 逐字节未改。下面是数据和该怎么继续。

⚠ **本机数字只能当下界**：这套仪器跑的是**模型侧核心链路**，不含 chat 往返、HITL 审批门、
run 续跑。测试线在真栈上测得（扣人为停顿后）03:41，本机基线均值 02:07——差的那约 94s
在 chat/审批链路上，别把两个数字直接相减当结论。

## 怎么复现

```sh
# 一次性：自己的沙箱容器（别占用别人的项目名）
docker compose -p wx3421 -f apps/skill-sandbox/docker-compose.sessions.yml up -d --build
# apps/deep-agent-service 需要 venv：cd apps/deep-agent-service && uv sync --frozen

set -a; eval "$(grep -E '^DASHSCOPE_(API_KEY|BASE_URL|MODEL)=' .env.local)"; set +a
export WX_NATIVE_SANDBOX_CONTAINER=wx3421-skill-sandbox-sessions-1
export WX_PDF_PERF_EVIDENCE=$PWD/.perf-evidence
export WX_PDF_PERF_LABEL=run1
export WX_PDF_PERF_PACKS=all
export WX_PDF_PERF_PROMPT='做一个 5 页的 PPT，讲团队协作'
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter @repo/api exec vitest run --config vitest.pdf-perf-measure.config.ts

docker compose -p wx3421 -f apps/skill-sandbox/docker-compose.sessions.yml down -v
```

仪器沿用 #3401 的 `pdf-perf-measure.live.ts`（已经支持 `WX_PDF_PERF_PROMPT`，**无需改代码**）。
分析：`summarize-timelines.py`（分段表）、`analyze-timeline.py`（逐节点明细 + 报错原文）、
`turn-latency-split.py`（读图前/后的模型轮次耗时，见下）。

## 一、基线分段（10 次，全部 0 报错）

| run | load1 | 端到端(graph) | 固定开销 | 写脚本那一轮 | execute 合计 | 读回图(字符) | 读图后模型轮次 | 轮数 |
|---|---|---|---|---|---|---|---|---|
| base1 | 3.5 | 102.9s | 7.1s | 42.3s | 2.2s | 451,087 | 33.9s | 13 |
| base2 | 3.1 | 159.6s | 6.6s | 43.7s | 2.5s | 655,421 | 87.8s | 18 |
| base3 | 3.1 | 109.4s | 6.8s | 48.0s | 1.7s | 500,939 | 35.2s | 13 |
| ab_base1 | 7.3 | 103.8s | 9.5s | 39.0s | 2.9s | 319,856 | 31.3s | 13 |
| ab_base2 | 3.5 | 147.0s | 8.0s | 57.3s | 5.2s | 696,817 | 56.2s | 18 |
| ab_base3 | 7.0 | 130.2s | 10.7s | 51.2s | 4.1s | 522,387 | 43.2s | 14 |
| c_base1 | 5.4 | 114.2s | 7.8s | 52.6s | 2.2s | 472,427 | 32.3s | 13 |
| c_base2 | 5.9 | 105.4s | 7.1s | 48.4s | 2.7s | 506,863 | 29.6s | 13 |
| c_base3 | 7.0 | 179.1s | 6.8s | 49.7s | 8.0s | 654,585 | 93.4s | 18 |
| c_base4 | 9.8 | 114.8s | 7.9s | 48.0s | 5.0s | 473,059 | 35.0s | 13 |

**均值 126.6s，范围 102.9–179.1s。**

### 被证伪的两个前提

- **「同一个错反复出现」不成立**：10 次基线里 `execute` **一次都没失败**（0 报错），
  没有任何一条报错原文可贴——因为根本没有报错。#3403/#3407 修掉孙进程管道泄漏之后，
  `execute` 合计只要 1.7–8.0s，**沙箱确实已经不是瓶颈**。
- **「PPTX 也是模型反复改脚本」不成立**（基线态）：基线只有 1 次 `write_file`，0 次 `edit_file`。

### 时间实际在哪

两个大头，合计占七成以上：

1. **写脚本那一个模型轮次 39–57s**（单次 `write_file`，6.6k–8.5k 字符）。
2. **读回预览图之后的模型轮次 29–93s**，且轮数越多越长（13 轮的 run ≈30s，18 轮的 ≈90s）。

## 二、关键机制：预览图进上下文后，每个模型轮次慢 4.2 倍

包内 `references/editing-and-qa.md` 要求 `visualInspection=required`，模型于是
`python3 render-office.py` 渲染每页 PNG，再用 `read_file` 逐张读回。`read_file` 对 PNG
返回的是**整张图的 base64**（`[{"type": "image", "base64": "iVBORw0KGgo..."}]`），
一次 5 页 = **32 万–88 万字符**进上下文，而且此后每一轮都带着它。

同 run 比较（同负载、同模型，剔除写/改脚本那几轮）：

```
POOLED pre  1.80s (n=80)     # 读图之前的模型轮次
POOLED post 7.57s (n=50)     # 读图之后的模型轮次
RATIO 4.2x
```

10 个 run 全部同向（2.8x–5.8x），`pre` 稳定在 1.7–1.9s。
按此估算：读图后平均 5 轮 × 7.57s ≈ 37.9s，若上下文不被图撑大（按 1.80s 计）只需 ≈9.0s
⇒ **单次生成约 29s 花在"图在上下文里"这件事上**，轮数多的 run 更贵。

渲染本身不贵（`execute` 全部 ≤8s）；**贵的是图留在上下文里**。

## 三、两个失败的修法（都已撤回，别再重试）

### 修法 A：照搬 pdf-create 的「脚本要短」——实测更慢，反向

`pdf-create` 在 #3406 靠补 `rgb()` 指引提速。照此给 `pptx-create` 补一节「脚本要短」，
**目标指标确实达成**：写脚本轮次 39–57s → 14.9–20.7s，脚本 8.5k → 1.9k 字符。
**但端到端反而更慢**：

| 组 | n | 端到端均值 |
|---|---|---|
| 基线 | 10 | **126.6s** |
| 修法 A（短脚本） | 6 | **141.3s** |

机制（`ab_base1` vs `ab_v2_1` 的逐轮对照，见 `analyze-timeline.py` 输出）：
短脚本让**第一次渲染看起来更空**，模型看完预览图就开始润色——
`edit_file` ×5（11.2+6.2+10.3+11.9+11.2 = 50.8s）+ 重新 `execute` + 重新渲染 + 重新读图，
轮数 13 → 23。**省下的 18s 被往返吃回去三倍。**

> 教训：pdf 的提速来自**消除报错**，不是来自"脚本变短"。PPTX 基线本来就没有报错，
> 所以那一招没有可迁移的部分；强行迁移会**触发**本来不存在的润色循环。

### 修法 B：给渲染检查定界（「只查缺陷、查完就交付」）——无效

针对上面的润色循环，改成明确只查三类真缺陷（溢出/截断、方框乱码、元素重叠），
没缺陷就直接发布。交替 A/B（4 对，丢 1 个因争用失败的点）：

| 组 | n | 端到端均值 |
|---|---|---|
| 基线（同批） | 4 | **128.4s** |
| 修法 B | 3 | **138.7s** |

修法 B 的 run 仍是 17 轮、读图后仍 67–80s ——**措辞没能阻止润色循环**。无收益，撤回。

（`c_v3_2` 退出码 1，报 `NativeArtifactPublishError: Artifact staging unavailable or refused`，
发生在 load≈7.6 且本机另有两套 wsx-* 栈在跑时——**争用红，不是修法 B 引入的回归**。）

## 四、还剩什么可做，各能省多少

1. **别让整张预览图留在上下文里**（最大的、我方可控的杠杆，约 **29s/次**，长尾更多）。
   `read_file` 的图片块构造在**上游 deepagents**里，不在本仓——
   `native_file_delegation.py:44` 逐字写着 "Formatting, image blocks and line pagination
   remain upstream"。可选路径：检查用低 DPI 另渲一套（`render-office.py` 现在把
   `-r 96` 写死，渲染只要 ~2s，再渲一套很便宜），交付仍用 96 DPI；或在上游给
   `read_file` 的图片块加尺寸上限。**两条都要先按本 README 的仪器取证再动手。**
2. **#3420（同一 run 内二次拦截）**由另一条线在修——测试线那次 run 被多拦一道门，
   省掉的是「多一次模型往返 + 多一次续跑」的固定开销。
3. **写脚本那一轮 39–57s**：模型必须逐字吐出脚本，这部分**我方消不掉**；
   已证明"让它写短点"会让总时间变差，不要再从这个方向下手。

**综合判断：端到端的大头（写脚本轮次 + 读图后轮次）在模型侧，本轮没有找到我方能消掉
且经得起端到端复测的修法。** 第 1 条是唯一有量化依据的下一步。

## 五、本 PR 实际交付的东西

只有一条**行为门**：`apps/api/tests/skill/pptx-create-example-executes.test.ts`——
把 `pptx-create` 正文里的建稿示例原样交给真实 pptxgenjs 跑，产物必须是真 OOXML（zip，magic `PK`）。
这是改正文的过程中发现的缺口：那段示例是模型照抄的模板，却没有任何门保证它还能跑
（对照 pdf-create 的同类缺口，#3401 实测代价是端到端的 10–35%）。

三步反证（真实输出见 PR 正文）：注入 `addText({text:'…'}, {...})` → 真实 pptxgenjs 抛
`TypeError: newObject.text.forEach is not a function` 红；换一种落盘 API 让替换失配 →
防空转断言红；撤掉 → 绿，且正文逐字节还原到 `origin/main`。
