# #5249 研究思考策略

按用户要求关闭深度思考。研究模型调用显式传 thinkingMode=off：runtime 计划、资料筛选与报告；独立方向/大纲/Skill；兼容方向/大纲接口。结构化生成、逐字来源证据和独立质量核验依旧保留。ConfiguredModelProvider 仅在百炼 endpoint 且已知可关闭 thinking 的 hybrid model 双维门满足时发送 enable_thinking=false 和 reasoning_effort=none；未指定策略的流式调用、其他端点/模型保持原行为。配置不是跨模型静默 fallback。

## 验证
- 28 policy/provider tests passed，包括真实 HTTP 请求体与 endpoint/model 反证、兼容 checkpoint generator。
- API research 277 tests passed，保留引用、证据、质量、超时门。
- API typecheck passed。
- 真实 qwen3.8-max：方向 16109ms、5项；大纲 7587ms、5项；公开 Node.js 定义样例流式首段 517ms、总2347ms，JSON正文有效（208字符）。样例首段速度不等于复杂完整报告 SLA。
- 恢复 UI 测试确认首次全量恢复后增量更新正文/章节且不重放 execute command。服务端 SSE close 仅 detach observer，不取消 runtime；persist 先落盘再发布。

## 边界
原会话仍有来源准备超时、章节质量警告和第五章格式失败，完整五章报告未通过。禁止把这些样例数据宣称为原报告成功。恢复改动独立在 PR #5248；本 PR 仅负责思考策略。
