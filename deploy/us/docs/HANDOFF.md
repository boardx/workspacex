# 交付状态

本包为人类明确交办的部署材料，关联 issue #5928。基线 main d291bdd3ecc6（2026-10-25）。

## 本轮已验证

目标仓库已fast-forward到最新main，init.sh快速基础检查成功。离线测试覆盖输入/占位值拒绝、私密权限、稳定密钥及角色分离、Docker Compose CLI解析、shell语法、包内完整性与密钥目录排除、补丁后的US手动准入/CN/DevApp兼容/US push拒绝。完整输出见verification.txt。

## 本轮交付

完整无应用源码的部署工具包生成器、Ubuntu24单机FS方案、全部配置生成脚本、首次初始化/HTTPS/业务验收/Runner/手动发布/备份恢复脚本，以及逐文件逐字段说明。US支持以补丁交付，不改现行发布通道。

## 未验证/限制

未连接US服务器，未安装系统软件，未创建main-us/Environment/Runner，未执行生产DDL/发布/付费模型探针；未做真实Linux首次安装、浏览器、证书续期、故障恢复或备份恢复演练。离线通过不能证明真实交付成功。coord tick因未配置COORD_GATEWAY_URL失败，不虚报已注册/续约。未修改feature passing。

## 下一步

维护者审查github/us-support.patch并走独立代码PR/CI；接收者读RUNBOOK A→I，填写settings私密副本，在独立演练机执行。按ACCEPTANCE逐项收集证据后再签生产交付。
