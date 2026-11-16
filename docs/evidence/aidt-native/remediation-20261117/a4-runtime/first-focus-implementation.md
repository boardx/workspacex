# 首次反馈 Skill 路由补修

真实 iteration02 S1 以 succeeded 结束但 persisted state 中 call_skill 为 0。直接回答保存一致不等于已执行挂载 Skill。原始只读证据保留于 iteration02-s1-actual-convergence.json。

在 FeedbackTurnMiddleware 的成功结果短路之后增加首次路由判断：仅单条有效挂载、正文首非空行精确 opt-in marker、有当前真实非空学生输入、本轮没有任何 call_skill attempt、当前工具表已有 call_skill 时，收窄现有工具并指定 tool_choice=call_skill。内部 classifier 无规划工具可覆盖该选择；内部 ToolBudget 仍能排除该工具。工具原有 admission 与 HITL 路径照常执行。

pending、deny、error 都以已有 AI tool_call 视为 attempted，不再次强制。普通 Chat、旧发布字节、多 pin、格式损坏的 pin 和引用 marker 原样通过。无新增 wire 字段，不直接调用 Skill，不伪造 ToolMessage。模型或 GraphBubbleUp 异常原样抛出，不在此层自动补发。

先加真图、恶意直接回答的 sync/async × classifier 开关共 4 例，原实现 4 failed；修后 4 passed。完整反馈文件 65 passed，原绿色回归命令扩展为 241 passed / 2 skipped / 2 上游 warning（13.99s），显式排除需独立 PG 的 TC5，未重复其既有独立验收。包含真实图 HITL pending→reject、excluded tool、错误/拒绝/pending attempt、GraphBubbleUp 与普通异常不重发。详细结果与源码 hash 见 first-focus-local-receipt.json。

这些是本地假供应商验证，模型请求为 0，未启动或重启栈、未写数据库和计量。sourceReady 不代表运行进程已加载；真实模型验收和环境 owner 的重启回执另行核对。
