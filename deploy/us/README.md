# US 单机部署交付包

面向接手部署的运维人员。入口是本文件，然后逐项执行 [RUNBOOK](docs/RUNBOOK.md)。

**状态：本包提供可审阅的配置、安装/初始化/备份恢复脚本和 US 发布补丁；尚未在真实 US Linux 主机验收，不代表 US 已上线。**

## 支持范围

- 独占的 Ubuntu 24.04 x86_64 主机，systemd + Docker Compose。镜像来自维护者发布的完整、同源镜像集合。
- 同机 PostgreSQL（含项目扩展）、Redis；本地持久化文件存储。API/Web/Agent/两个沙箱均为容器。
- US 更新只通过 `main-us` 手动运行 `image-release`；推送 `main-us` 不自动部署。
- 当前源代码的 US 参数支持以 `github/us-support.patch` 提供，必须先由维护者审阅、验证并合入。包内安装工具使用相同补丁的版本；不修改应用业务代码。
- 不要求目标服务器拿到应用源码；依赖网络、镜像拉取账号、TLS 证书、模型接口、Linux 软件源和（使用 Actions 时）GitHub。
- 默认不接邮件、ASR、受控浏览器和外部连接器；不会把这些能力报为已验收。邮件未配置时注册验证/找回密码不可用，先用脚本创建的管理员登录。需要这些能力时按 VALUES 中的扩展项单独配置验收。
- 这是单机方案，不承诺高可用。托管数据库、阿里云 ECS/OSS 专用 cloud profile 属于另一部署档位，不能只替换本包连接字符串。AWS S3 不是当前应用可直接使用的存储后端。

## 先看哪份文档

| 文件 | 内容 |
|---|---|
| [docs/FILES.md](docs/FILES.md) | 每个文件的用途、执行位置与部署目标路径 |
| [docs/VALUES.md](docs/VALUES.md) | 所有输入值、自动生成密钥、输出配置和替换规则 |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | 从准备资源、打包到首次上线、后续手动发布的逐条命令 |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | 真实验收、备份恢复演练和故障处理 |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 验证证据、边界与接手事项 |

## 目录

```text
config/       唯一人工输入 settings.example.json
templates/    来自现有实现的 Compose/Nginx 快照及来源哈希
github/       US 手动发布接线补丁、Environment 配置脚本
scripts/      配置生成、系统安装、初始化、证书、验收、Runner、备份恢复、打包
tests/        本地离线验证
.local/       本机私密副本和生成配置（忽略，不随交付包分发）
dist/         可分发的无密钥部署工具包（忽略，不入库）
```

## 维护者验证与打包

从仓库根目录执行：

```bash
python3 -m unittest discover -s deploy/us/tests -v
python3 deploy/us/scripts/package.py
```

交付 `dist/workspacex-us.tar.gz` 和 `.sha256`。通过独立可信渠道核对包哈希；包内 SHA256SUMS 仅用于完整性检测，不是发布者身份签名。接收者不得把自己的实际 settings、模型 key、注册 token、稳定密钥或备份回传到仓库。

一份仓库中的默认 US Runner 标签只指向一台 US 主机。给多位客户交付时，每位客户使用独立仓库和数据、凭据，或由维护者另行接入独立 Environment/Runner 标签；不要给多台独立生产机注册同一部署标签让 Actions 随机选机器。
