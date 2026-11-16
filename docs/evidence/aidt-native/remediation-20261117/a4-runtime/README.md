# A4：教学反馈回合收敛修复

本轮仅修改 `apps/deep-agent-service/src/deep_agent_service/tools.py`、`harness.py`，新增 `tests/test_aidt_feedback_turn.py`。没有调用真实供应商模型、起栈、修改数据库或计量、发布、提交。以下真实 LangChain / LangGraph / deepagents 测试使用故意不合作的假模型；它们证明编排行为，不证明真实模型的教学质量或线上时延。

## 旧故障与首红

已读 [S3/S5 只读根因审阅](../../completion-20261117/a4/native-skill-repetition-review.md) 及其中实际调用、结果传递记录。S3 已记录 21 个不同 `call_skill` ID（首失败、其后 20 成功）；S5 已记录 8 个（首失败、其后 7 成功），不能从公开摘要断言完整任务字节相同。

先新增故障模型测试，未改生产实现时执行：

```bash
PYTHONPATH=/tmp/aidt-pytest:apps/deep-agent-service/src \
  /workspace/scratch/aidt-real-model-20261116/python/bin/python -m pytest \
  apps/deep-agent-service/tests/test_aidt_feedback_turn.py -q
```

结果：**3 failed / 5 passed**，2.27 秒。三个失败为：

1. 同步 graph：成功结果已经回到图中，focused 调用仍发生 3 次，预期 1 次。
2. 异步 graph：同上，focused 仍发生 3 次，预期 1 次。
3. 第一次 focused 失败后，合法第二次成功仍重复，发生 3 次，预期 2 次。

红对照 router 收到真实 `ToolMessage` 后仍请求同一个 Skill，第三次后自行停止，避免测试挂死。新实现后的红对照仍不挂收敛 middleware，仍产生 3 次 focused 请求；它不是被改成“配合”的模型。

## 修复边界

- 仅已挂载 Skill 正文第一条非空正文行（可在 frontmatter 后）精确为 `<!-- aidt-feedback-turn: return-after-student-feedback-v1 -->` 时启用。它是作者明确选择的反馈行为，不是权限授权；原有 mounted Skill 与 HITL 仍执行。用户输入或正文示例内的 marker 不启用。
- 仅非空真实成功结果生成内部 `ToolMessage.artifact`，绑定完整 Skill 字节、完整 task、结果的 SHA-256。未知 Skill、异常、空输出不创建成功标记，仍可合法重试。
- middleware 在本次学生 turn 中核对当前 mounted 内容、真实 call ID、完整 task 与结果，再直接把真实 focused 文本投影为最终 `AIMessage`，不再次请求 outer/focused 模型。结束的是这次反馈动作，不是阶段，不代替学生确认或保存。
- 使用既有 `InjectedState("messages")` 接收图中的真实消息，把本次运行已有的用户/助手参考和学生原话交给 focused 调用。TS 的快照在 `:hN` history 中、位于 `:user` 之前，也被完整保留；不把任何资料提升成 system 指令，不复制 outer system，不增加 TS/Python wire 字段。模型可见工具 schema 仍仅有 `skill_stable_name` 和 `task`。
- 无跨 run 缓存。新学生输入、插话、Skill 内容改变或撤回、call/task/result 不匹配均不沿用旧结果。普通 Chat、不带 opt-in 的旧 Skill 继续原有行为。
- 已验证实际候选 `aidt-methods/1.3.1.json`、`aidt-project-summary/1.0.1.json` 的 7 份 SKILL.md 均启用；旧 1.3.0 / 1.0.0 不启用，旧文件未改。
- 不取消同一次模型响应中已经并行启动的批内工具调用。此实现阻止成功反馈之后的新一轮请求，不把它描述成批内取消机制。

## 最终绿色回归

使用环境 owner 按仓库锁文件准备的独立 QA 依赖，不修改模型运行 venv：

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

结果：**206 passed / 2 skipped**，15.08 秒；另有上游 `Send` 导入弃用和 `langchain-community` 弃用两个 warning。`git diff --check` 在本轮修改文件上通过。

新增回归覆盖同步与异步恶意重复 router、首次失败再试、未知/空结果、完整 task 差异、结果及 call ID 篡改、mounted 撤回和改版、旧 turn / 新学生输入 / 插话、内部 rubric 重试、独立 turn 并发，以及旧包/普通 Skill 不变。另有实际图请求观察器证明原始非空 ToolMessage 与 call ID 到达下一次 runtime ModelRequest，随后投影回学生而非重新发模型请求。完整上下文测试证明：即使 outer 省略快照或试图传入伪造的 `turn_messages`，ToolNode 仍使用真实注入 state；精确快照和学生原文进入 focused 的 user 消息。

## 未验证及失败保留

此前不排除 TC5 的广测命令为同一 Python/PYTHONPATH，目标 `test_graph.py test_native_graph.py tests/golden -q`：**54 passed / 2 skipped / 1 failed**，10.33 秒。唯一失败 `test_tc5_sigkill_midrun_then_resume_and_time_travel` 明确要求 `DEEP_AGENT_TEST_POSTGRES_URL`；本环境当时缺少该值。未修改该测试使其静默跳过，也未自行启动 PG。最终命令显式排除该需 PG 文件，因此 **206 绿不包含 TC5**；首次缺环境的红色结果保留。

环境 owner 随后在其 owned PostgreSQL 容器中建立独立空测试库 `aidt_tc5_remediation_20261117`，补跑原 `tests/golden/test_tc5_checkpoint_kill_recovery.py`，实际结果 **5 passed**，3.72 秒、退出码 0。该补验使用真实 PG，覆盖进程被 SIGKILL 后的 checkpoint 恢复及时间回溯；未用业务数据库、未写业务或钱包数据、模型请求为 0。结果及日志见 [TC5 补验回执](../a1/tc5-checkpoint.json) 与 [原始测试日志](../a1/tc5-checkpoint.log)。测试库由环境 owner 随 owned compose 栈清理。这是独立补验，不将它改写为上面 206 项同一命令的结果，也未为本记录重复执行测试。

真实供应商新包挂载后的 S3/S5 质量、请求次数和延迟仍需 root 专项验收；上述本地假模型通过不能替代该结果。原 S3/S5 失败/耗时/计量记录没有被重置或覆写。

## 独立审阅后的第二轮红绿：混合工具 batch

A2 只读独立审阅发现：第一版逆序查找成功 `call_skill`，会忽略同 batch 的其他工具失败、拒绝、未知结果或尚未配对的新调用，直接交付早先的反馈。上面的 **206 通过没有覆盖这个反例**，不能将其写成该边界已经通过。

先加 11 个反例，未修改第一版生产逻辑时执行：

```bash
PYTHONPATH=/workspace/scratch/aidt-remediation-20261117/qa-tools:apps/deep-agent-service/src \
  /workspace/scratch/aidt-real-model-20261116/python/bin/python -m pytest \
  apps/deep-agent-service/tests/test_aidt_feedback_turn.py -q \
  -k 'mixed_batch or later_tool_batch or actual_graph_keeps'
```

结果 **11 failed / 30 deselected**，2.10 秒。覆盖同 batch 中的其他 error / denied / unknown / success / pending，新 batch 未完成或失败，游离结果与重复结果；真实 graph 同步和异步反例均证明：另一未知工具已有 error ToolMessage，却未到达第二次外层处理，原 helper 直接返回了旧反馈。

root 允许为此关键缺陷解冻 Python。窄修仅更新 `harness.py`：只检查当前最新 AI 工具 batch，要求它恰好一个 `call_skill`，其后恰好一个匹配 call ID / name、status=success 的真实结果，再检查既有完整 task、mounted 字节及结果摘要。所有 mixed / multi-call batch（包括其他工具表面成功）、错误、拒绝、未知、未配对调用、重复或游离结果都继续原 handler；不猜测其他工具的字符串成功语义，不吞掉额外成功结果，不改变权限或缓存范围。

修复后单文件 **41 passed**，2.66 秒。真实 graph 两条混合 unknown-tool 场景的第二次 outer 请求实际收到了 error ToolMessage，并返回说明该失败的回复；单 Skill 成功收敛和首失败后合法重试仍通过。

随后重新执行上面完整绿色回归命令（依然显式排除需 PG 的 TC5 文件），结果 **217 passed / 2 skipped**，14.55 秒，两个上游弃用 warning。`git diff --check` 通过。TC5 的独立 PG 5/5 仍按前节回执列出，没有为此次 middleware 窄修重复执行或混算为同一命令。生产文件再次 sourceReady 后由环境 owner 正常重启 Python；本 worker 未自行重启服务或发送真实模型请求。

## 真实运行的独立只读收敛审计：iteration 1 / S1

root 提供实际 S1 run `cc29fef8-3cb3-4cc4-8969-2df5e2e2631a`。审计使用 owned stack 的实际映射端口、`app_rw`、`BEGIN READ ONLY`、`app.current_org` 限定 SQL SELECT；另经 root 明确授权，仅 GET 该运行对应 owned Python 的持久化 run / thread state，不 invoke、resume 或 schedule。完整消息和正文仅存 mode 0600 的私有诊断文件；公开文件只含计数、状态及哈希。

[S1 实际收敛回执](iteration01-s1-actual-convergence.json) 显示：

- SQL 步骤账本只有 1 个不同的 `call_skill` ID；执行事件对应 1 次 start 和 1 次成功 end。
- Python state 的 `metadata.run_id` 精确匹配该 run 的 `remote_run_id`，找到该应用 run 的 canonical 学生 turn。其内只有 1 个工具 batch、1 个 `call_skill` 和 1 个配对 success ToolMessage；无待执行 next node。
- 原始完整 ToolMessage 内容非空、285 字符，含反馈成功 artifact；完整 task 和完整结果 SHA-256 与 artifact 一致。
- `agent_runs.model_output`、原始完整 ToolMessage 内容与最后 AIMessage 完全相等，SHA-256 均为 `a9fdcc66b0d26ebbf1d03be29d140bf0328d06cab68b99397630e2f3196e4cd8`。该比较依据匹配运行的原始持久化消息，不是依据公开 500 字摘要冒充全文。
- 当前 GET run 响应不暴露 mounted `org_skills` config，故该审计没有独立建立 mounted 完整字节；相应 hash 比较为 null，不能写成不匹配或通过。源码及离线绑定测试与此实际观测分开列出。

可复用只读脚本为 owned 私有诊断目录中的 `audit-feedback-convergence.mjs`，本次命令：

```bash
/tmp/aidt-node/node_modules/node/bin/node --import ./node_modules/tsx/dist/loader.mjs \
  /workspace/scratch/aidt-remediation-20261117/stack-01/audit-feedback-convergence.mjs \
  iteration01-s1 cc29fef8-3cb3-4cc4-8969-2df5e2e2631a iteration01-runtime-private.json
```

本次审计未发送模型请求，也不重复财务 owner 的结算审计。S1 的教学措辞未通过、正在准备新不可变包的后续迭代，这是独立的教学质量结论；本条只证明这次运行的实际单次 Skill 收敛与完整结果交付，不将其写成教学或全流程验收通过。S3/S5/SUM 仍待各自实际 run 的同样审计。
