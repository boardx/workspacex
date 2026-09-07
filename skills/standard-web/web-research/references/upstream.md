# 上游来源和本地适配

来源：LangChain Deep Agents 官方 web-research Skill，固定提交 `07d2952d346d81d06bd181db8c560a77f2b51bc8`：
https://github.com/langchain-ai/deepagents/blob/07d2952d346d81d06bd181db8c560a77f2b51bc8/libs/code/examples/skills/web-research/SKILL.md

复用“研究规划→按子题收集→读取来源笔记→综合并引用”的方法，以及只用 fetch_url 读URL、read_file 读文件的边界。当前路径由官方Git tree确认；旧搜索索引中的 libs/cli 路径已经迁移。

适配：上游默认带网页工具的研究子代理；WorkspaceX 当前 general-purpose 子代理无工具，故顺序执行、不声称能委派联网。上游 list_files 换为真实工具场景，不引入不存在名称。增加实际Google五候选/无日期筛选语义、SSRF/媒体限制、来源哈希与截断、预算和 staged/ready交付边界。包不携带模型、搜索引擎、工作流调度或检查点实现。

MIT许可证与原版权声明见包根 LICENSE。此包为方法适配，不代表已部署到每个组织或通过真实模型 G-SKILL 验收。
