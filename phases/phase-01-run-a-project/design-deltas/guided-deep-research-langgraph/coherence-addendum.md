# Guided Research LangGraph · 阶段一致性复核增量

人类确认本 delta 时需核对以下交叉边界，并在 phase `design-coherence.md` 刷新确认记录：

1. **research ↔ agent-runtime**：Graph 服务只复用模型准入、凭据和可观测端口；研究节点状态与通用 AgentRun
   不互相冒充，浏览器不能选择模型或工具。
2. **research ↔ skills**：Skill proposal 只修改前端 draft；只有统一 Node Command 才写入 Graph checkpoint，
   Skill 消息和 proposal 身份持久化但不成为研究证据。
3. **research ↔ files/artifact**：来源正文、抓取快照和报告大内容使用稳定内容/Artifact ID；checkpoint 不复制
   大正文，citation 只引用同 revision 已采纳来源。
4. **research ↔ org-identity**：所有公开读写先以 Principal 鉴权 session；未知与无权不可区分，
   内部 thread/checkpoint 身份不可泄露。
5. **旧 guided delta ↔ 本 delta**：F168/F169/F180 仍由旧 delta 覆盖；未开工 F170/F171 与新增
   F195–F198 只由本 delta 覆盖，签核归属无重叠。
