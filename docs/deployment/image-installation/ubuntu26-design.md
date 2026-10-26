# Ubuntu 26.04 安装入口兼容性

用户目标：继续在已有US主机手动安装，保留其.env；不要求重装操作系统。

最小修复：Python入口和特权shell共用scripts/image_install/scripts/host.py。精确解析os-release的ID/VERSION_ID，仅允许Ubuntu24.04和26.04、Linux/x86_64，拒绝其他系统/架构及无效字段。保留既有Docker/Compose、AppArmor、镜像同源、根目录权限、完整性和稳定密钥门禁。不把Ubuntu26.04主机上的真实安装声明为已通过。

回归判据：先加入缺失共享校验器的失败测试，再实现并跑全部安装器离线测试（含Compose CLI解析、归档独立执行、策略单源）；新增系统允许/拒绝用例。独立review后生成替换包；新包不会包含.env。部署者校验新包摘要后重新解压，自己填写的.env不在归档中，不会被覆盖。

实施计划（writing-plans；inline）：
- [x] 测试允许24.04/26.04，拒绝Debian、22.04、ARM、Darwin与相似字段。
- [x] 提取共享validate_os(release, system, machine)，接入两处入口。
- [x] 更新README的软件源对应包、Nginx默认站点核对和7.5GiB容量边界。
- [x] 13项离线套件通过，留证ubuntu26-verification.txt；新包校验。
- [ ] 独立review与PR门禁通过。
- [ ] 用户核对Nginx及域名，执行真实安装并完成浏览器/重启验收（本次未执行）。

Ruling：不把镜像内存上限总和12.5GiB误当预留内存或最低配置；7.5GiB可进入小流量实测，但不能保证并发容量，不自动加swap或缩小隔离限额。
