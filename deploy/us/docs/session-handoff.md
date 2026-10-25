# 会话交接

- 已验证：见HANDOFF与verification；仅离线配置、脚本及镜像发布准入测试，未虚报生产可用。
- 改动：仅deploy/us；生成的dist/.local被忽略。目标路径为/Users/shenyangjun/boardx/workspacex/deploy/us。
- 待办边界：US接线补丁需维护者审查合入；真实Linux安装、TLS、模型/Agent、浏览器、恢复演练待做。coord-gateway未配置，不声称已挂监控。
- 接手入口：先读README、docs/FILES、docs/VALUES、docs/RUNBOOK；验证命令python3 -m unittest discover -s deploy/us/tests -v；打包命令python3 deploy/us/scripts/package.py。
