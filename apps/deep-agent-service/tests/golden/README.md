# 黄金压测场景 TC-1 ~ TC-5（DA-09，issue #2051）

`.harness/rubrics/deepagent-capability-rubric.md` 规定：**每次正式评分必须跑完这五个
场景，逐场景归档证据**，维度分必须能指向至少一个 TC 场景的实测输出。
在这个目录存在之前，连续三轮评分（5.0 / 6.5 / 7.5）都在评分史里如实写了
「TC-1~TC-5 黄金压测脚本目录仍不存在，未临时补写脚本凑数」——引擎分因此有个封顶。

## 怎么跑

```bash
# 全部五条（自动起一次性 Postgres 给 TC-5，退出时销毁）
bash apps/deep-agent-service/scripts/verify-golden-scenarios.sh

# 只跑不需要外部依赖的四条
cd apps/deep-agent-service && uv run --extra dev pytest tests/golden -v \
  --ignore tests/golden/test_tc5_checkpoint_kill_recovery.py
```

证据落在 `apps/deep-agent-service/.golden-evidence/<utc>/`（gitignore），逐场景一个
JSON。正式评分时整目录拷进 `.harness/state/deepagent-eval/<date>-<sha>/`。
落点可用 `DEEP_AGENT_GOLDEN_EVIDENCE_DIR` 改。

## 自动化分级（这张表是本目录最重要的一部分）

「CI 能跑其自动化子集」的前提是**说清楚哪些不在自动化子集里**。跑不了的不伪装成能跑：

| # | 场景 | 自动化程度 | 外部依赖 | 本目录**不覆盖**的部分 |
|---|---|---|---|---|
| TC-1 | 长链综合调研（≥5 步、≥2 次子代理委托） | 全自动 | 无 | D3 token 级流式；D1/D2 的**前端可见性** |
| TC-2 | 敏感技能中断 →「改参数后放行」 | 全自动 | 无 | 前端 HITL 交互（新轨道够不到真引擎，issue #2017） |
| TC-3 | 连续故障注入 + 会循环的任务 + 退出前自检 | 全自动 | 无 | 失败事件的前端逐条渲染；「不编造成功」的语义判断 |
| TC-4 | 30 轮超长上下文，第 30 轮追问第 2 轮细节 | 全自动 | 无 | **摘要质量**（假模型的摘要器不构成质量证据） |
| TC-5 | 执行中途 `SIGKILL` → 重启续跑 → 回溯历史节点 | 全自动**但需真 Postgres** | `DEEP_AGENT_TEST_POSTGRES_URL` | 生产服务级重启（这里 kill 的是测试自己拉起的进程，不是 `langgraph dev` 服务） |

三件贯穿全目录的边界，评分时必须记住：

1. **假模型**。五条都用脚本化的 `ScriptedChatModel`（TC-5 的被 kill 进程用同形的
   `_tc5_worker._Scripted`）。它们证明的是**引擎行为**——事件形状、中断与恢复、
   预算与熔断、摘要通路——不是模型答得好不好。任何需要判断「模型说得对不对」的
   维度（D3 的 token 流、D8 的摘要质量、D7 的「不编造成功」）必须另取活体证据。
2. **无前端**。D1/D2/D9 的 rubric 满分档都写着「前端可见/逐个渲染」。本目录到引擎
   边界为止，活体 SSE 与前端渲染见 `scripts/live-evidence.sh` 和
   `.github/workflows/live-evidence.yml`。
3. **反证与正证成对**。TC-2/TC-3/TC-4 各自带一条反证（关掉开关/换掉条件后必须变红），
   因为本仓已九次「全绿但空转」。加新场景时请照此办理：没有反证的绿灯不算证据。

## TC-4 顺手抓出来的一个真问题（存档）

写 TC-4 的过程本身就证明了这批脚本的价值：第一版怎么写都红——第 2 轮种下的事实
在第 30 轮怎么也召回不了。查下去发现 `SummarizationMiddleware` 的
`trim_tokens_to_summarize` 此前吃的是库默认 **4000**，而触发线是 60000：一次压缩要
丢掉的四万多 token 里，只有**最后 4000 token** 会被交给摘要器，更老的内容根本没进
摘要就没了。实测证据是摘要器只收到了第 15 轮一轮的内容。那不是「滚动语义摘要」，
是「摘一下尾巴、其余静默丢弃」，正是 rubric D8 里 0.3 档写的「只有截断」。
修法与理由钉在 `harness.py` 的 `build_middleware` 注释里，`test_harness.py` 有钉死
断言看守。
