# 接手快照

已实现：scripts/image_install/installer.py统一入口，打包、无副作用plan、新实例install、状态/日志/启停、真实业务verify及备份。deploy/us/README.md是用户操作手册，.env.example是唯一待填输入，compose.yaml是机械核对的模板生成视图。

已验证：init.sh基础通过；python3 -m unittest discover -s tests -p test_image_installer.py -v；包含真实Docker Compose CLI配置解析（没有启动容器）、打包完整性、私密权限、角色密钥分离、镜像错配拒绝、重试保持稳定密钥、shell语法。见verification.txt。

未验证：真实Ubuntu/系统权限/AppArmor重启/HTTPS签发/正式镜像/模型/浏览器；不声称生产可用。当前不提供升级、SQL回滚、托管DB和高可用部署承诺。备份恢复需维护者按版本提供并演练。未修改feature_list或标passing。coord gateway未配置，不声称已续约。

下一步：构建独立包 python3 scripts/image_install/installer.py package --output deploy/us/dist；维护者提供真实五镜像tag；用户按README填写.env并在独立主机执行安装及验收。PR关联#5931。

2026-10-26补充：Ubuntu26.04适配见ubuntu26-design.md/ubuntu26-plan.md/ubuntu26-verification.txt；用户.env已有appv2.boardx.us和40216660127-1，未读取密钥。目标Docker镜像列表无输出；Nginx80已有监听，需要确认仅默认站点，DNS待核对。尚未连接或修改目标服务器。

真实失败点更新：旧10-install在数值UID1000目录创建前失败，runtime/data/state为空目录（runtime仅生成配置），无项目容器。新recover-host-setup入口仅允许该早期失败现场，归档不删除、保留.local/runtime。需上传新包后recover，再执行原install；不得手动删数据或bootstrap标记。
