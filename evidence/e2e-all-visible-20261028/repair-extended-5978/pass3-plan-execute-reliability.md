# deep-agent 计划→执行 成功率

**总成功率 21 / 24（88%）**

每个场景重复 3 次（`PLAN_EXEC_REPEATS` 可调）。
⚠ 跑在确定性替身上：量的是**我们这条链稳不稳**（竞态、状态污染、跨轮次互踩），
不是真实模型/网络的抖动。人类说的「低于 60%」发生在真实联网环境，那一层归真实模型车道。

| 场景 | 成功 / 次数 | 成功率 | 中位耗时 | 失败详情 |
|---|---|---|---|---|
| 计划多步 | 3 / 3 | 100% | 18s | — |
| 计划全部跑完 | 3 / 3 | 100% | 7s | — |
| Office · docx | 3 / 3 | 100% | 22s | — |
| Office · xlsx | 3 / 3 | 100% | 22s | — |
| Office · pptx | 3 / 3 | 100% | 24s | — |
| 画布 · 多张 | 3 / 3 | 100% | 9s | — |
| 深度研究形态 · 长链多步 | 0 / 3 | 0% | 41s | #1 expect(received).toBeGreaterThanOrEqual(expected) Expected: >= 5 Received: 1 Call Log: - Timeout 30000ms exceeded while waiting on the predicate；#2 expect(received).toBeGreaterThanOrEqual(expected) Expected: >= 5 Received: 1 Call Log: - Timeout 30000ms exceeded while waiting on the predicate；#3 expect(received).toBeGreaterThanOrEqual(expected) Expected: >= 5 Received: 1 Call Log: - Timeout 30000ms exceeded while waiting on the predicate |
| 混合 · 画布→Office 同线程 | 3 / 3 | 100% | 30s | — |
