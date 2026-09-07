# 固定来源和能力边界

适配 Anthropic canvas-design：
https://github.com/anthropics/skills/blob/ef740771ac901e03fbca3ce4e1c453a96010f30a/skills/canvas-design/SKILL.md
固定SHA为ef740771ac901e03fbca3ce4e1c453a96010f30a；上游该技能Apache-2.0许可证随包保留。修改：保留构图、层次、留白和二次检查原则，去掉假定用户评价、任意下载字体和本机目录要求，改为WorkspaceX真实工具与管理员治理边界。未复制上游字体资源。

生成式路径复用既有BailianImageProvider.generateImage。当前仅square 1024×1024单张文生图，编辑明确不支持；没有新供应商实现。下载复用既有公网址面和实际连接DNS安全检查，禁止跳转、限制字节和时间；已有Pillow在隔离沙箱内对实际bytes验证完整像素。文件继续走现有产物发布与writeback。

离线排版复用沙箱预装库和字体；方法包不意味着所有视觉任务已经通过真实模型G-SKILL。必须分别记录结构验证、实际视觉检查和正式交付证据。
