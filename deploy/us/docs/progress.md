# 进度

- 2026-10-25：按用户指定路径在主checkout交付deploy/us材料；复用现有checkout，没有创建新worktree。先拉取main并通过init.sh基础检查；明确单机Ubuntu24/x86_64、本地FS、独立数据库与手动US发布。US源码接线以reviewable patch交付。
- 本地验证：运行tests/test_kit.py，检查配置与Compose解析、脚本语法、包完整性、US手动准入与拒绝规则；见verification.txt。真实主机/模型/浏览器/灾难恢复均待执行。
