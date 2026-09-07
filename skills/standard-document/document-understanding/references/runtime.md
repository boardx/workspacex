# 当前部署边界

本方法包是 WorkspaceX 对现有工具链的原创适配；没有复制另一套解析引擎。
实际转换引擎为仓库现有的 `@firecrawl/anydoc@0.1.8`（MIT），复用其官方CLI，固定版本与完整性
由仓库 pnpm-lock.yaml 记录。官方接口说明：
https://github.com/firecrawl/anydoc/tree/main/node

当前工具把受当前源权限和固定manifest约束的 `/inputs/` 文本PDF、DOCX、XLSX、PPTX、CSV
转换为Markdown（TXT/Markdown原样验证后复制）。执行发生在现有无网络沙箱里，30秒超时；
输入与输出大小沿用沙箱限制。不安装运行时依赖，不访问托管转换服务。

显式 OCR 复用 Tesseract 5.3.0（Apache-2.0）及预装 chi_sim/eng 模型；PDF由已有Poppler逐页渲染，PNG/JPEG直接识别。返回真实页号、渲染页像素框和词置信度，默认文本路径保持不变。页数、像素、输出和时间有界，超限拒绝，不静默截断。

`outputMode:"chunks"` 保留AnyDoc Markdown，同时用锁定的 `pdfplumber 0.11.10`、`python-docx 1.2.0`、
`python-pptx 1.0.2`、`openpyxl 3.1.5` 读取原生位置。依赖在镜像构建期按哈希安装，运行时不下载。
PDF坐标是左上原点的点空间；OOXML只有原生结构索引，不映射到渲染像素。XLSX保留公式但不计算。
PDF跨页分组只使用“相邻页、同列数、完全相同非空表头”规则，并明确标记 heuristic；没有这些证据
就不合并。Docling 仍是统一文档模型的重要候选，但截至本实现其官方跨页表格问题仍未闭合，因此
没有虚假声明本运行时已用Docling完成跨页合并。参考：
https://github.com/docling-project/docling/blob/main/docling/.agents/skills/docling/SKILL.md
https://github.com/docling-project/docling/issues/2976

本包通过分发文件/哈希测试也不等于真实模型 G-SKILL；必须另有模型实际加载与完成任务的证据。
