# S3 call_skill 重复调用：只读源码审阅

本次只读定位，不调用模型、不新增DB/网络诊断、不改产品、权限或计量。它是未解决的性能缺陷，不因run最终成功而记为性能通过。

## 已证事实

[A1实际调用记录](../a1/s3-call-skill-repetitions.json)：run `e607b916-5555-4e12-9b5b-a2c0a90d2b67`，42条append-only开始/结束步骤对应 **21个不同tool_call_id**；全部指向`aidt-define`，首个failed、其后20个succeeded。不是42次调用，也不是一张卡的重复显示。整场约201秒/44次物理请求由root/A1单列；不能未经请求级关联把44机械拆成特定主/子模型公式。

[A1结果回传安全元数据](../a1/s3-result-delivery-metadata.json)：20个成功结果摘要全部非空、176–417字符，没有`large_tool_results`驱逐占位；最终223字符输出没有已建立的model/tool-limit关闭标记。实际rubric返工次数未从现有有界步骤建立，不能写0。后20个**公开args摘要**hash相同不证明完整task字节相同；首条公开task字段摘要为空也不证明真实入参为空，工具本身接受若干已知别名。

## 源码链与排除范围

| 触点 | 已读到的行为 | 可得结论与限制 |
| --- | --- | --- |
| [tools.py](../../../../../apps/deep-agent-service/src/deep_agent_service/tools.py):247、361–398 | `call_skill`读取本run挂载Skill，构造Skill正文+可选脚本协议；每次调用`_focused_call`独立`model.stream`，聚合文本后原样返回非空str。异常被译成“技能执行失败”文本。没有本turn成功结果缓存或相同任务重复调用守门。 | 重复请求都会产生新的focused工作；函数内部没有主动20次循环。失败文本没有建立“不要重试”的语义，但不能由此推定本次首次失败原因。 |
| [graph.py](../../../../../apps/deep-agent-service/src/deep_agent_service/graph.py):49–58、195–202；[skill-catalog.ts](../../../../../apps/api/src/application/agent-run/skill-catalog.ts):116–129 | 共享规则要求最终用`call_skill`执行，目录只给摘要、正文在focused子调用。成功返回后没有明确的AIDT“已有结果→对学生提问→等待其回答，同任务不重复”收敛规则。 | 存在可改善的编排提示缺口；**不足以证明它独自造成了本次循环**。不能为修AIDT全局禁用其他任务需要的Skill工具。 |
| [harness.py](../../../../../apps/deep-agent-service/src/deep_agent_service/harness.py):103–118、1321–1329 | 原生工具上限40、编排模型上限25，工具异常重试上限2；这些是通用总量上限，没有同一Skill成功后的针对性重复纠偏。focused调用不经过外层graph模型节点上限的同一入口。 | 现有总量限制不等于一个教学回合只需一次Skill。21个不同模型生成call ID不吻合同一个工具请求内部`ToolRetry`的2次重试解释；不能据25/40常量断言本场确实撞上限。 |
| 同[harness.py](../../../../../apps/deep-agent-service/src/deep_agent_service/harness.py):127–132、225–234、253–273 | rubric在模型准备结束（无更多工具调用）时评价，`max_iterations=2`，源码说明最多返工一次；只评本turn。 | 它能增加回合/模型请求，但并非强制连续`call_skill`的规则；当前没有实际grader轨迹证明本场由它触发，不能把20次成功调用归因于20次rubric返工。 |
| 同[harness.py](../../../../../apps/deep-agent-service/src/deep_agent_service/harness.py):302–345、1304–1325 | TurnWindow仅在before_agent清除新turn之前旧消息，本turnAI/Tool消息保留；工具大结果默认8000tokens才驱逐，汇总阈值60000tokens。 | 源码未发现每次工具执行后必然删除本turn结果的逻辑；A1观察摘要短且无驱逐占位，不支持“结果太大被逐出”作为当前首要解释。实际下一次供应商prompt未在本审阅捕获，不能排除所有中间层问题。 |
| [deep-agent-model-provider.ts](../../../../../apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts):348–376、445–465、1074–1107 | API端按AI tool_calls与同ID ToolMessage配对，按phase/id去重后投影开始/完成；startRun创建远端run，后续流/轮询读取state投影。 | 成功完成事件证明已有对应ToolMessage；这些投影函数不会重新执行工具。未发现由Web重复显示或TS轮询直接生成新call ID的机制。结果已进入state不等于已证明下一次模型实际看到了结果。 |
| [credit_aware_chat_model.py](../../../../../apps/deep-agent-service/src/deep_agent_service/credit_aware_chat_model.py) | 只代理父类generate/stream并恢复专门异常；本文件没有过滤ToolMessage或重写正文。 | 本处未见主动丢结果机制；不据此保证第三方完整payload链没有问题。 |

本次观测更符合“编排器收到工具结果后仍不断提出新调用，缺少教学回合收敛”的待证候选；**结果完全未回传、自动重复加载、rubric强制20轮、供应商SDK自动重试或摘要相同即原参数相同，都未被证实。**

## 最小后续修复候选（本轮不实施）

1. **先限定于服务器已授权、精确AIDT阶段/Skill版本与来源快照。** 明确一次成功focused结果后，应利用结果输出本回合有帮助的问题或反馈，然后等待学生；不为“再确认同一份Skill”重复调用，不自动代保存/代确认。普通Chat、文件任务、其他Skill和权限策略保持原语义。
2. 若采用确定性重复保护，键至少绑定本turn/run、身份/项目、真实Skill版本与完整规范化task字节（可只留hash），必要时含来源snapshot；不能从公开摘要hash反推相等，不能只按stable name跨版本/跨组复用。只复用**已成功且仍有访问权**的精确请求结果；失败/未知/权限拒绝不得缓存成成功，学生新输入、不同完整task/版本或来源变化不得误拦。
3. 只有精确重复且已有成功结果时，给出清楚的结果复用/收尾信号，促使隔离AIDT编排结束并等待学生，而不是仅重复返回缓存仍让外层模型转25圈。可在现有per-run工具预算/模型请求扩展点中做窄实现；不现在泛化禁用工具、不提高全局25/40上限、不调整收费记录或抹历史。
4. 修复前后用离线fake model故意连续请求同Skill，检查成功后不再产生focused模型调用；覆盖完整task不同但公开摘要相同、版本/来源变化、首失败后合法重试、权限撤回、同turn并发及普通非AIDT不受影响。另验证ToolMessage的call ID与非空结果确实进入下一次真实模型请求的消息序列。受控红绿之后再由root安排真实专项，不能先宣布本次201秒缺陷已解决。

本次性能问题留在最终报告；其余验收继续按独立实际结果推进，不为“全绿”临时隐藏或再付费重跑本步骤。
