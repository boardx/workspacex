# 问卷单层输入边界 — #5695

按用户截图去掉输入外卡边框及 textarea 独立焦点环。输入区和工具栏共用 group 边界，focus-within 使用 inset 环，没有 offset；textarea 覆盖全局焦点环，但 group 保持可见焦点。未改输入/语音/错误/生成行为。基于 main 497940a42，复用3120 worktree。

17 个问卷输入/语音 UI 测试与完整 web lint通过。标准隔离 fullstack AI提案浏览器1 test通过；验证1440/375 textarea focus、内部ring为0、group inset、toolbar focus、blur、无溢出以及后续语音/文件/生成流程。受控供应商不代表生产ASR。隔离资源已清理。

实际截图：assets/issue-5695/survey-intake-1440.png、survey-intake-375.png；同目录survey-toolbar-focus-* 与 survey-blurred-* 展示按钮focus及失焦。
