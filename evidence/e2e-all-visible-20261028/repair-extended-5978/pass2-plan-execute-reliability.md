# deep-agent 计划→执行 成功率

**总成功率 12 / 24（50%）**

每个场景重复 3 次（`PLAN_EXEC_REPEATS` 可调）。
⚠ 跑在确定性替身上：量的是**我们这条链稳不稳**（竞态、状态污染、跨轮次互踩），
不是真实模型/网络的抖动。人类说的「低于 60%」发生在真实联网环境，那一层归真实模型车道。

| 场景 | 成功 / 次数 | 成功率 | 中位耗时 | 失败详情 |
|---|---|---|---|---|
| 计划多步 | 0 / 3 | 0% | 23s | #1 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#2 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#3 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m |
| 计划全部跑完 | 0 / 3 | 0% | 8s | #1 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#2 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#3 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m |
| Office · docx | 3 / 3 | 100% | 23s | — |
| Office · xlsx | 3 / 3 | 100% | 21s | — |
| Office · pptx | 3 / 3 | 100% | 24s | — |
| 画布 · 多张 | 0 / 3 | 0% | 9s | #1 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#2 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#3 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m |
| 深度研究形态 · 长链多步 | 0 / 3 | 0% | 13s | #1 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#2 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m；#3 [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m |
| 混合 · 画布→Office 同线程 | 3 / 3 | 100% | 31s | — |
