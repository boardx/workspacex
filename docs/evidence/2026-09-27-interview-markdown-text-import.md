# 原生文本文档导入

Refs #4460，依赖 #4459；同一 worktree，不等待前置 PR 合并。

原生浏览器读取有效 UTF-8 TXT / Markdown，最大 2 MB。Markdown 原文保留 CRLF、Unicode、表格和代码；TXT 包成足够长的字面量代码围栏，不执行附带指令。导入先追加编辑草稿，只有明确保存才进入 Markdown source API。

按钮明确为“导入文本文档”。不声称上传原始二进制资产、不支持 PDF/Word 提取、不冒充实时语音已接通；这些继续列入剩余工作。

RED：导入模块缺失。GREEN：原文、拒绝类型/超限、TXT 围栏、非法 UTF-8 四项通过。组件实测从文件输入到 source POST，确认原文字节一致。

2026-09-27：六文件 / 46 PASS；web typecheck PASS；web full lint PASS。尚未做真实浏览器文件选择、完整原型动态验收或整套 web 绿证明。
