# US 手动触发镜像发布

目标：`main-us` → GitHub Environment `production-us` → Runner `workspacex-us-production` → `47.254.69.39`，访问地址 `https://appv1.boardx.us`。

构建仍在 GitHub 托管的 `ubuntu-24.04` 执行器上完成。US 的自托管 Runner 仅接收 deploy job、调用受限发布入口，不下载应用源码或在服务器构建镜像。填已有 tag 时跳过构建。

这是首次手动安装完成后的更新通道。首次安装继续看 [README.md](README.md)。新增机器不需要复制整套模板：通用逻辑在 `scripts/`，机器私有配置仍放 `/etc/workspacex-selfhost/`。

## 日常发布

1. 将要发布的代码通过正常 review 同步到 `main-us`。普通 push 不会部署 US。
2. GitHub → Actions → `image-release` → Run workflow。
3. `Use workflow from` 选 `main-us`；Environment 选 `us`（`auto` 在该分支也映射 US）；service 保持 `all`。
4. `build_only` 不勾选；tag 留空会构建并发布这次提交的五个镜像。已有正式版本可填同一完整 tag，例如 `40216660127-1`，跳过构建直接部署。
5. 等待 `deploy` job 成功，检查其日志中的 `SUCCEEDED` 和证据目录，再打开网站验证登录、聊天与文件。

CLI 等价命令：

```bash
gh workflow run image-release.yml --repo boardx/workspacex --ref main-us \
  -f environment=us -f service=all -F build_only=false -f tag=40216660127-1
```

`main + us`、`main-us + cn` 会拒绝；US 与 CN 分别使用独立 Runner、环境和并发组。默认打开时可能显示 `develop` 的旧表单。先将 `Use workflow from` 改为 `main-us`，等待参数重新加载，就会出现 `us`；已在真实 GitHub 页面核对。也可以使用上面的 CLI。

## 一次性接入已安装的 US 主机

由主机管理员从审核过的固定提交获取这些公共脚本（不要把 CI checkout 作为 root 执行）：

- `scripts/install-image-release.sh`：安装内容寻址的只读执行器，授予指定 Runner 用户仅执行 `us <固定格式tag>` 的 sudo 权限。
- `scripts/configure-us-image-release.py`：读取本机现有配置，生成 root 私有的 US 发布策略，固定 Compose、env 和业务探针摘要；不重新初始化数据。
- `install-image-release.sh` 中列出的六个 Python 依赖：通用拉取、结构兼容校验、切换、验证和回退实现。

先用 GitHub 仓库 Settings → Actions → Runners → New self-hosted runner 获取官方 Linux x64 安装包、校验摘要和一次性注册 token。创建专用普通用户 `wsx-runner`，不得加入 `docker`/`sudo` 组；将 Runner 安装在其独立目录，注册名称与自定义 label 均为 `workspacex-us-production`，通过官方 `svc.sh install wsx-runner` / `svc.sh start` 安装服务。注册 token 不写进 Git、文档或日志。

然后在存放上述审核脚本的目录执行：

```bash
sudo python3 scripts/configure-us-image-release.py wsx-runner
```

配置只允许首次创建。已有 `/etc/workspacex-image-release/us.json` 时拒绝覆盖；修改运行配置之后，管理员须审核差异并重新固定相关 SHA256，不能让 CI 自动更新信任边界。

GitHub 创建 `production-us` 环境，仅允许 `main-us` 部署。镜像发布继续使用仓库已有 `WSX_ACR_REGISTRY`、`WSX_REGISTRY_PREFIX` 与构建凭据，无需另建一套 US 镜像库。主机使用 root 已有 Docker 登录凭据拉取；密钥不交给 Runner。

## 主机文件与用途

| 目录/文件 | 用途与需要填写的值 |
|---|---|
| `/etc/workspacex-image-release/us.json` | 自动生成本机策略。固定 domain、registryPrefix、Compose 路径与摘要，管理员变更才更新；不包含模型或邮件明文。 |
| `/usr/local/bin/workspacex-image-release` | 通用受限 root 入口，参数仅 `us <tag>`。由安装脚本生成。 |
| `/usr/local/lib/workspacex-image-release/<hash>/` | 已审核执行器及依赖，不从 CI 工作区加载程序。 |
| `/usr/local/bin/workspacex-us-release-probe` | 固定业务验收入口；Agent 清理不确定时阻止重复探测。 |
| `/etc/sudoers.d/workspacex-image-release` | 仅给指定用户 US 发布和只读状态命令权限。 |
| `/etc/tmpfiles.d/workspacex-us-release.conf` | 重启后恢复现有部署锁，运行时不替换锁 inode。 |
| `/var/lib/workspacex-image-release/us/` | 当前镜像覆盖层、每次发布证据、失败待协调状态。root 私有。 |
| `/etc/workspacex-selfhost/` | 首次安装生成的私有运行配置；数据库、邮件、模型密钥和部署标识继续保留。 |

不需要为这条通道增加应用 `.env` 变量。主机策略中的项目必须为 `workspacex-selfhost`，五个应用服务为 api/web/agent/sandbox/sandbox-sessions。postgres 与 redis 不在自动切换范围。

## 验收与失败处理

执行器持有 `/run/workspacex-selfhost-deploy.lock`，与手动安装/维护互斥。先拉取五个同源镜像、固定 digest，核对当前容器配置和 API/Agent 数据结构文件相同，再验证当前基线、更新五个应用容器并跑真实登录/文件/Agent/模型/沙箱探针。失败时尝试恢复旧镜像并重新验证。

**这条通道只支持结构兼容的镜像更新。** 出现 `SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE` 时不执行数据库迁移；须安排有备份和恢复方案的迁移发布。不能为了让 Actions 变绿而绕过这个检查。

- `ROLLED_BACK`：新版失败，已验证恢复；Actions 仍失败，检查本次证据后修复版本。
- `pending.json` 存在或 `ROLLBACK_FAILED`：主机状态不确定，后续发布自动拒绝。管理员按证据核实容器和覆盖层，确认恢复后再协调状态，不直接删除文件重试。
- `business-probe-uncertain`：先核实远端 Agent 与本地会话清理；不能仅移动标记来绕过。
- 手动使用原始 Compose 命令可能忽略当前镜像覆盖层。接入后应用更新统一走发布入口；管理员检查当前版本看 `current.json` 和 `docker inspect`。
- 回退到已知版本：再次手动触发同一工作流，tag 填已验证的旧版本。仍需通过兼容性与业务验收，不执行数据库降级。

首次接入验收应记录 Runner 在线、GitHub 真实 job 成功、公开 HTTPS 健康与业务探针结果。仅单元测试通过不代表服务器接入完成。

## 接入验收记录

2026-10-27（北京时间）已完成真实接入：

- `main-us` 已创建；`production-us` 环境只允许 `main-us`。
- Runner `workspacex-us-production` 在线，systemd 服务使用普通用户 `wsx-runner`，未加入 docker/sudo 组。
- [工作流 40359371035](https://github.com/boardx/workspacex/actions/runs/40359371035) 使用 `main-us + us + 40216660127-1`，plan/deploy 成功，build/manifest 跳过。
- deploy job 运行机器为 `iZrj9hpmlpysbfv5apkov9Z`，返回 `SUCCEEDED`，主机证据目录 `/var/lib/workspacex-image-release/us/attempt-0b6a2e9840b54277b285a58a2a269d16`。
- 发布前后均通过真实业务探针；本次是相同正式镜像版本的接入验证，没有验证新版本迁移或在生产故意注入失败。回退分支由隔离测试覆盖。
- 首次工作流曾以 `LIVE_CONFIG_DRIFT` 在变更前拒绝。现场确认 Compose 2.40 的 `config --hash` 跳过 env_file 展开；执行器改用已解析模型计算摘要，保留严格比对。临时文件为 0600，禁止二次变量展开，计算后删除。

升级可信执行器只由管理员使用审核过的固定提交执行 `install-image-release.sh wsx-runner us`。不必再次运行一次性 configure 脚本，不会覆盖私有运行配置。
