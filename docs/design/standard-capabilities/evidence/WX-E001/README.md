# WX-E001：锁定运行时基线验证

本次是现有实现的验证任务，不增加 runtime lock、工具实现或运行注册权威。

## 环境与源码

- 新 worktree 从主线 `11d1c9e417b45fa7900779e862248482d8a96946` 开始。
- 实际编译时 commit：`2e973a92f`；后续 `5825e1cea` 只补文档中的公共验收定义。
- 在本 worktree 的 `apps/deep-agent-service` 运行 `uv sync --frozen --extra dev`，创建自己的 `.venv`，没有借用旧工作树的可编辑安装。
- 实际安装：deepagents 0.7.6、langchain 1.3.15、langgraph 1.2.11、langgraph-api 0.12.4；pytest-timeout 已安装。

## 真实执行结果

工作目录：`apps/deep-agent-service`。

```sh
.venv/bin/python -m pytest tests/test_graph.py tests/test_tools.py tests/test_harness.py -q
```

退出码 0；**95 passed, 1 warning in 129.06s**。输出见 [pytest-baseline.txt](pytest-baseline.txt)。警告来自 Google SDK 的 Python 弃用类型；没有旧环境的 pytest timeout 配置未知警告。

使用实际安装的 Deep Agents 编译图及生产 `build_tools/build_middleware/build_subagents/build_interrupt_on` 配置，配以 FakeListChatModel（只编译、不调用外部模型），导出了 [native-tool-schema.json](native-tool-schema.json)。

实际暴露 16 个工具：

- 原生 10 个：`delete`、`edit_file`、`execute`、`glob`、`grep`、`ls`、`read_file`、`task`、`write_file`、`write_todos`。
- 现有自定义 6 个：`call_skill`、`choose_execution_option`、`confirm_task_intent`、`fill_run_params`、`list_org_skills`、`spawn_async_task`。

快照通过 `graph.nodes['tools']` 的 `tools_by_name` 读取，并对每工具调用 `get_input_schema().model_json_schema()`；版本来自 `importlib.metadata.version`。所有 schema 都是测试证据，不被生产代码反向加载。

## 不包含的证明

这 95 条测试使用测试模型；快照只证明实际安装的图暴露了工具参数。它们不证明外部模型可用、真实 Backend 可执行、MCP 能调用、长期记忆/调度已完成、生产上线或全量 E001/G-PLATFORM 验收。

后续真实提供者和部署链路证据仍需补齐；本记录不修改任何 passing 状态。
