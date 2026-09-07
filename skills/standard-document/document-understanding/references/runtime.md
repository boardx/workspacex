# 当前部署边界

本方法包是 WorkspaceX 对现有工具链的原创适配；没有复制另一套解析引擎。
实际转换引擎为仓库现有的 `@firecrawl/anydoc@0.1.8`（MIT），复用其官方CLI，固定版本与完整性
由仓库 pnpm-lock.yaml 记录。官方接口说明：
https://github.com/firecrawl/anydoc/tree/main/node

当前工具只把受当前源权限和固定manifest约束的 `/inputs/` 文本PDF、DOCX、XLSX、PPTX、CSV
转换为Markdown（TXT/Markdown原样验证后复制）。执行发生在现有无网络沙箱里，30秒超时；
输入与输出大小沿用沙箱限制。不安装运行时依赖，不访问托管转换服务。

OCR、页坐标、跨页表格完整性、结构化chunks仍待实现。Docling官方技能和结构化API是后续复用
研究来源，不代表本运行时已经安装或允许调用Docling：
https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/SKILL.md

本包通过分发文件/哈希测试也不等于真实模型 G-SKILL；必须另有模型实际加载与完成任务的证据。
