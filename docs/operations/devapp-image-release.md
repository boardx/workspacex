# DevApp 镜像发布

本环境采用 `.github/workflows/image-release.yml`，目标 `devapp`。构建来源由 **Use workflow from** 选择；选择 `main` 不会自动使用 `develop`。

## 手动发布

1. Actions → image-release → Run workflow。
2. 分支选择目标代码分支，例如 `main`；Target environment 选择 `devapp`。
3. 服务选择 `all`；不勾选 build_only；tag 留空会构建该次选中提交。
4. 如复用已有完整镜像，填写构建成功的不可变 tag。无需重新构建。
5. 以 deploy 成功及应用验收为准；build 成功只代表镜像就绪。

部署通过本机 self-hosted runner 调用固定 root 入口，ECS 只读角色换取临时 ACR 凭据。五个镜像解析为 digest，实际替换 API/Web/Agent/两个 Sandbox；数据库、Redis 不进入镜像替换列表。失败时恢复上一次应用镜像并重新验收。状态记录在 `/var/lib/workspacex-image-release/devapp/`；存在未决 `pending.json` 时阻止继续发布，应先核对运行状态和回执。

## 数据库变更

普通镜像发布不执行迁移或初始化。当前与候选 API、Agent 的 SQL 清单必须完全相同，否则拒绝切换，先走独立数据库发布：审查结构变更、保留各环境数据和历史校验、备份与隔离演练，再按批准内容应用结构；初始化数据单独批准、执行和记录。

DevApp 有四项历史 checksum 差异和一条已移除源码的历史记录。`devapp-image-admission.py` 根据 root 保护的已审查计划核对完整账本，保留这些值；不得批量改 checksum 或删除历史记录。它不允许自动修复或导入其他环境的数据。

首次从旧 systemd 转镜像使用 `devapp-first-image-activation.py` 的固定一次性入口：维护隔离 → 外部 503 见证 → 停写 → 冷备核验 → 分别提交结构/初始化 → 镜像启动 → 健康/浏览器/镜像 ID 验收 → 开放公网。开放请求发出前即持久化禁止数据库回退意图，防止响应超时后误把已经接收新写入的数据库恢复为旧副本。该一次性入口不能作为普通发布入口，也不能在已开放公网后直接重跑。

## 服务器运维

配置 `/etc/workspacex-image-release/devapp.json` 和运行环境含敏感内容，仅在服务器 root 目录保存，不提交 Git。验证命令直接使用 root 保护、可执行的脚本路径，不使用系统解释器符号链接作为受信命令首项。浏览器 npm 依赖通过文件哈希清单核验。

旧 API/Web systemd 单元及旧应用容器保留用于人工恢复证据，正常服务由 `workspacex-image` Compose 项目的五个容器提供。备份、冷副本和已停止的演练容器保留，未经审查不清理数据库副本。
