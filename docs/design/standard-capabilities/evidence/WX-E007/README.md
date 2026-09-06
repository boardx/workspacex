# WX-E007：修复复用验证中的假模型缺陷

全量 Python 回归在既有预算测试进入 Rubric grader 后触发 120 秒硬超时，未通过，不覆盖成成功记录。审查确认 `_looping_graph` 的假模型忽略 grader 的结构化工具绑定，继续消费主任务脚本，最终无限输出普通文本，无法满足 `GraderResponse`。

仅修改该测试 helper：grader 使用独立假模型并返回官方 schema 校验过的响应，保留生产 middleware、原预算/重试断言和原超时上限。测试对象仍是生产预算和重试，不假装验证模型内容质量。

定向命令（`apps/deep-agent-service`，本 worktree `.venv`）：

```sh
PYTHONPATH=src .venv/bin/python -m pytest \
 tests/test_harness.py::test_model_call_budget_ends_run_with_notice \
 tests/test_harness.py::test_tool_call_limit_injects_correction \
 tests/test_harness.py::test_tool_retry_recovers_transient_failure -q
```

3 passed，45.07 秒，退出 0；一条既有 genai 弃用警告。主代理独立检查 fixture 差量后接受。未新增测试框架。

随后重跑 graph、selector、tools、harness、sandbox backend、skill packages 六文件：143 passed，13.78 秒，退出 0，原始输出见 `python-regression.txt`。该测试集合通过不等于所有 75 项已经验收。
