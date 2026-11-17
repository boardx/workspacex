# AIDT 新 develop 基线 Python 回归实际回执

完成时间：2026-11-17T01:29:59Z（主矩阵）；工作树 `/workspace/aidt-pr-20261117`。

**主矩阵实际退出码 0：241 passed / 2 skipped / 2 warnings，15.11 秒。** 这是此次新工作树上的实际执行，不引用旧 241 项记录充数。

## 被测源码

- HEAD：`1a2ec212d38635a60b1337cc4a949ec564c0d7a8`。
- 本地 origin/develop：`4060bcf2017ef5775b762f2135f22042f8a96d19`；`git merge-base --is-ancestor <该 develop SHA> HEAD` 实际退出码 0。
- `apps/deep-agent-service/src/deep_agent_service/harness.py` SHA256：`d307e67bf95772149c84218d81af35df15ba1a143fb8ee0d653db804abded5ec`。
- `apps/deep-agent-service/src/deep_agent_service/tools.py`：`aa859d6b92f54599b4ada2326a36c042935f744f3793fc9227bb477f8e8ce7bb`。
- `apps/deep-agent-service/src/deep_agent_service/self_hosted_runtime.py`：`ea90fa04f25780cf9d3f526a2e3eba9fa8da6d90f19506eda219ee9fae9a5eaa`。
- `apps/deep-agent-service/src/deep_agent_service/error_diagnostics.py`：`29cb826c02b01a93c5fa794956ae98069ae3da8b01a31e4b03cdc394761871ff`。
- `apps/deep-agent-service/tests/test_aidt_feedback_turn.py`：`6f87580d4caa52ff0e291b8decafd4b00893fcea5ad964592c25e9617e40505e`。

## 实际命令与日志

准确复用 `docs/evidence/aidt-native/remediation-20261117/a4-runtime/first-focus-local-receipt.json` 的解释器、PYTHONPATH、测试矩阵和排除项，仅 cwd 换成新工作树：

```bash
PYTHONPATH=/workspace/scratch/aidt-remediation-20261117/qa-tools:apps/deep-agent-service/src \
  /workspace/scratch/aidt-real-model-20261116/python/bin/python -m pytest \
  apps/deep-agent-service/tests/test_aidt_feedback_turn.py \
  apps/deep-agent-service/tests/test_tools.py \
  apps/deep-agent-service/tests/test_harness.py \
  apps/deep-agent-service/tests/test_tool_budget.py \
  apps/deep-agent-service/tests/test_graph.py \
  apps/deep-agent-service/tests/test_native_graph.py \
  apps/deep-agent-service/tests/golden \
  --ignore=apps/deep-agent-service/tests/golden/test_tc5_checkpoint_kill_recovery.py -q
```

完整原始日志：`/tmp/aidt-pr-python-final.log`，SHA256 `e883a099c2aa6135b2cf2e4a1a9965b55d220b65ce678cfae7ca659b31d024dd`。两项上游 warning 分别为 trustcall 从 langgraph.constants 导入 Send 的弃用提示及 langchain-community 维护终止提示；没有测试失败。

为确认准确 skip 节点，另只运行以下两项，加 `-q -rs`，同解释器与 PYTHONPATH，退出码 0，**2 skipped / 1.30 秒**：

- `apps/deep-agent-service/tests/test_native_graph.py::test_real_pinned_skill_executes_in_isolated_session`
- `apps/deep-agent-service/tests/test_native_graph.py::test_real_execute_waits_for_official_approval`

两项共同原因：`native_sandbox_fixture.py:44: Requires an explicitly owned E003 integration container`。独立原始日志 `/tmp/aidt-pr-python-skips.log`，SHA256 `073d07204e390470afc95a4bafdf0249b8124090a81180065deab5abd49adc79`。这不是额外通过项，不与主矩阵累加。

## 边界

本次仅执行既有假模型/真实 LangGraph 回归；没有真实供应商模型请求、依赖安装、Docker 创建、服务启动/重启、运行环境配置更改或源码修改。没有将 E003 缺席替换成假容器或 loopback；两项仍未执行，历史镜像构建磁盘阻塞回执保留。TC5 在本矩阵中明确排除，未声称在新 HEAD 上完成 PostgreSQL checkpoint 验收；历史独立 PG 5/5 仍是历史证据。

本任务没有额外运行 `test_error_diagnostics.py`，因为本轮授权要求准确复现历史 241+2skip 矩阵；不能据本结果单独宣称该文件已在新 HEAD 测过。真实供应商教学质量、时延、计量、devapp 运行字节、人类课堂验收与 PR CI 另由主任务核实。

测试前及主矩阵后 `git status --short` 为空；skip 核对后共享工作树显示 `apps/api/tests/aidt-stages/shared-stage-unit.test.ts` 有其他任务修改。本 worker 未修改该文件或任何工作树源码，也未覆盖别人的修改。
