# 文件目录与用途

表中的“本机”指部署人员电脑，“US root”指目标服务器；源目录内只有模板，真实副本在.local，未执行脚本不会改远端。

| 相对deploy/us路径 | 使用位置/目标路径 | 用途与替换规则 |
|---|---|---|
| `.gitignore` | 本机/仓库 | 忽略真实配置、密钥、交付压缩包和Python缓存。无需替换。 |
| `README.md` | 交付入口 | 说明支持范围、目录和默认未开通的能力。 |
| `config/settings.example.json` | 接收者本机 | 唯一人工输入模板；复制到.local/settings.json，按VALUES逐项填写。 |
| `templates/compose.json` | 生成→/etc/workspacex-us/compose.json | 由现有cloud-deploy Compose生成器导出的基础服务快照，适配本地FS；镜像变量由compose.env填入，不直接手改。 |
| `templates/nginx.conf` | 生成→/etc/workspacex-us/nginx.conf→/etc/nginx/conf.d/workspacex-us.conf | 来自现有Nginx生成器；REPLACE_US_DOMAIN由configure自动填，保留CopilotKit/WebSocket和API路径路由。 |
| `templates/provenance.json` | 维护者本机 | 记录所依赖的canonical实现及沙箱策略SHA256；发现漂移拒绝打包。 |
| `github/us-support.patch` | 维护者源码仓库 | 四处US手动发布支持的reviewable补丁；不自动应用到当前仓库，不开启US push发布。 |
| `github/configure-environment.sh` | 有管理权限的本机 | 显式--apply创建production-us且限定main-us；既有Environment拒绝覆盖。输入owner/repo。 |
| `scripts/package.py` | 维护者本机 | 收集无秘密部署材料、已打补丁的canonical发布工具和安全策略，生成dist工具包/摘要。 |
| `scripts/configure.py` | 接收者本机 | 校验settings、生成一次性稳定密钥、完整env/Compose/Nginx；目标存在则拒绝覆盖。 |
| `scripts/common.sh` | US root/被其它脚本引用 | 固定US目录、Compose项目与部署锁函数；无需替换。 |
| `scripts/00-system.sh` | 新US主机root | 仅Ubuntu24.04 x86_64，安装Docker官方apt组件、Nginx/AppArmor等；已有Docker拒绝自动处理。 |
| `scripts/10-install.sh` | US root | 校验包/根目录所有权，安装私密运行配置、安全策略、受信consumer、sudoers；拒绝覆盖现有安装。 |
| `scripts/20-bootstrap.sh` | US root | 显式初始化空US数据库、角色、API/Memory schema、管理员、应用；失败留标记，不假装幂等重试。 |
| `scripts/25-certificate.sh` | US root/可选 | 公网DNS/80就绪后，用certbot standalone申请TLS证书；会短暂停Nginx。 |
| `scripts/30-ingress.sh` | US root | 验证证书域名/有效期/key匹配，安装Nginx配置并检查/reload；不覆盖既有US站点配置。 |
| `scripts/35-renewal.sh` | US root/可选 | 为standalone证书安装持久pre/post/deploy hooks、启用timer并dry-run；拒绝覆盖既有hook。 |
| `scripts/renew-tls.sh` | US root/Certbot deploy hook | 续期后校验新证书/key，复制到runtime，nginx检查失败恢复原证书；作为hook安装。 |
| `scripts/business-probe.sh` | US root→/usr/local/bin/workspacex-us-business-probe | 用当前API镜像跑既有登录/文件/Agent/模型/沙箱真实探针；有测试数据及模型用量。 |
| `scripts/40-accept.sh` | US root | 公网健康与业务验收成功后调用seal-policy；真实浏览器检查仍由交付者执行。 |
| `scripts/seal-policy.py` | US root/40-accept调用 | 生成root-private us.json和文件摘要，固定探针/Compose/凭据边界；拒绝覆盖已封存策略。 |
| `scripts/50-runner.sh` | US root/可选 | 校验官方Runner归档摘要，用普通用户注册安装服务；输入短期token文件，用完删除。 |
| `scripts/manual-release.sh` | 接收者本机/有Actions权限 | 手动派发main-us image-release，固定environment=us；可选已有tag。 |
| `scripts/backup.sh` | US root | 短暂停应用，备份三库、对象、配置、真实镜像摘要；恢复应用，提醒离机保存。 |
| `scripts/prepare-restore.py` | 新替代主机root | 离线校验备份并准备原稳定配置/当前镜像摘要；不生成新口令，不覆盖已有输出。 |
| `scripts/restore.sh` | 新替代主机root | 只允许恢复专用、未封存的新实例；还原三库与文件，失败保持应用停止。 |
| `docs/FILES.md` | 说明 | 本文件；包括源文件、打包生成文件、服务器生成文件的用途与位置。 |
| `docs/VALUES.md` | 说明 | 每个输入值、自动生成秘密及运行值的来源、替换规则与关联。 |
| `docs/RUNBOOK.md` | 逐步操作 | 按维护者、本机、US root区分命令；覆盖首次安装、Actions、离线更新、证书和恢复。 |
| `docs/ACCEPTANCE.md` | 部署者 | 真实浏览器、数据持久化、恢复和失败验收表；常见失败的处理边界。 |
| `docs/HANDOFF.md` | 接手人员 | 本轮实际验证、未验证内容与下一步动作。 |
| `docs/progress.md` | 工程记录 | 本轮变更与验证的增量日志；不替代生产验收。 |
| `docs/session-handoff.md` | 下一位维护者 | 当前范围、已验证/未验证与继续入口。 |
| `docs/PLAN.md` | 工程记录 | 本次整理任务的着色执行计划。 |
| `docs/verification.txt` | 验证证据 | 本地离线测试输出；不包含服务器/生产成功声明。 |
| `tests/test_kit.py` | 维护者本机 | 无root/网络/应用容器的配置、Compose解析、发布准入和打包契约测试。 |

## 打包时增加的文件

这些文件由 package.py 从当前已核对的源代码收集，放进独立工具包；不需要接收者下载应用源码，也不在模板目录维护第二份源代码。

| 工具包路径 | 用途 |
|---|---|
| `tools/install-image-release.sh` | 安装root-owned受信发布闭包与sudo白名单，含同一US补丁。 |
| `tools/deploy-registry-images.py` | US/CN/DevApp镜像消费入口，校验固定环境配置，持锁、systemd隔离执行。 |
| `tools/registry-images.py` | 镜像集合/来源校验与分支规划；安装包版本含US映射。 |
| `tools/minimal-docker-release.py` | 既有实际容器/配置/schema检查、替换与失败恢复引擎。 |
| `tools/hosted-release.py` | 既有服务与镜像身份契约依赖。 |
| `tools/canonical_control.py` | 既有canonical控制工具依赖。 |
| `templates/docker-seccomp.json` | 来自apps/skill-sandbox/security的真实沙箱系统调用策略。 |
| `templates/docker-apparmor-sessions` | 来自同一目录的真实AppArmor会话策略，不替换docker-default。 |
| `SHA256SUMS` | 包内所有文件的完整性清单；独立渠道核对压缩包hash才证明来源。 |
| `dist/workspacex-us.tar.gz`（维护者输出） | 不含密钥/应用源码/数据/镜像的工具包；不可夹带.local。 |
| `dist/workspacex-us.tar.gz.sha256` | 压缩包校验文件。 |

## configure生成的文件

均先生成到 `.local/runtime/`，安装时复制到 `/etc/workspacex-us/`。不需要分别替换占位值；改唯一settings输入后生成一次。所有实际秘密与.env都是0600。

| 文件 | 用途 |
|---|---|
| `settings.json` | 实际输入副本；供安装、域名、Runner和策略脚本读取。 |
| `stable-secrets.json` | 同一安装的稳定密钥与初始管理员口令；备份/恢复不可丢失。 |
| `compose.json` / `compose.env` | 服务结构与固定初始镜像；日常更新叠加consumer生成的override。 |
| `api.env` | API受限数据库角色、模型、服务间密钥、FS与公网域名配置。 |
| `web.env` | Web服务端的API内部地址；公共浏览器请求使用同源/api。 |
| `agent.env` | 独立Agent/Memory数据库、Redis、模型和服务调用配置。 |
| `migration.env` | 只在初始化/经审查迁移任务使用的数据库所有者及角色准备参数。 |
| `memory-migration.env` | 独立Memory owner与runtime连接；常驻Agent不持有owner口令。 |
| `bootstrap.env` | 创建初始管理员/组织/默认Agent；含敏感口令。 |
| `postgres.env` | PostgreSQL初始owner密码与主库名。 |
| `redis.conf` | Redis认证和AOF持久化；安装时归真实Redis uid。 |
| `probe.env` | 专用业务探针配置，初始化时自动填真实组织/Agent ID；包含验收凭据。 |
| `nginx.conf` | 替换域名后的Nginx http-context include。 |
| `restore-probe.env`（仅恢复准备生成） | 原备份探针身份；新机初始化后恢复原数据库时恢复原ID。 |

## 服务器安装/执行时生成的文件与目录

| 绝对路径 | 用途 |
|---|---|
| `/etc/workspacex-us/{sandbox,sessions}` | uid1000的隔离Unix socket目录。 |
| `/etc/workspacex-us/{certs,agent-certs}` | 本机档位空CA目录；其它TLS拓扑需单独设计。 |
| `/etc/workspacex-us/tls/{fullchain.pem,private-key.pem}` | 实际HTTPS证书/私钥；续期复制与reload。 |
| `/etc/nginx/conf.d/workspacex-us.conf` | Nginx安装的站点include。 |
| `/etc/letsencrypt/` | 可选ACME账号、证书、renewal参数及deploy hook。 |
| `/etc/workspacex-image-release/docker/config.json` | root-only镜像只读登录凭据，不是构建写凭据。 |
| `/etc/workspacex-image-release/us.json` | 验收后封存的运行基线、文件hash与固定探针；发布前必须存在。 |
| `/usr/local/bin/workspacex-image-release` | 清空调用环境的固定发布入口。 |
| `/usr/local/lib/workspacex-image-release/<closure-hash>/` | 内容寻址、root-owned发布闭包。 |
| `/etc/sudoers.d/workspacex-image-release` | Runner只能调用固定受信入口，无任意sudo或Docker组权限。 |
| `/usr/local/bin/workspacex-us-business-probe` | 固定业务验收入口，策略中固定hash。 |
| `/usr/local/lib/workspacex-us/` | 安装的common/business-probe/backup脚本副本。 |
| `/etc/apparmor.d/workspacex-native-sessions` | 持久化沙箱AppArmor策略，系统重启后重新加载；策略摘要纳入封存。 |
| `/etc/systemd/system/docker.service.d/workspacex-us-apparmor.conf` | Docker启动依赖/晚于AppArmor，避免重启时先启动容器却缺少策略。 |
| `/etc/tmpfiles.d/workspacex-us.conf` | 重启后按固定权限创建同一部署锁。 |
| `/run/workspacex-us-deploy.lock` | 初始化/备份/恢复/镜像更新共享的并发锁；禁止删除绕过。 |
| `/var/lib/workspacex-us/{postgres,redis,objects}` | 持久化数据；应用发布不替换数据服务/删除卷。 |
| `/var/lib/workspacex-us/backups/<UTC>/` | 私密备份；三库dump/objects/runtime/images/SHA256SUMS。 |
| `/var/lib/workspacex-image-release/us/bootstrap-*` | 首次初始化开始/完成标记与管理员ID输出；不等于公网验收成功。 |
| `/var/lib/workspacex-image-release/us/current.json` | 成功发布后实际镜像override的受信引用。 |
| `/var/lib/workspacex-image-release/us/pending.json` | 持久发布intent；异常残留必须对账，禁止直接删除。 |
| `/var/lib/workspacex-image-release/us/attempt-*/` | 每次发布的manifest/配置/schema检查/前后镜像/receipt证据。 |
| `/opt/workspacex-us-runner/` | GitHub Runner程序与服务配置；注册token不是长期留存配置。 |

不把真实settings、env、数据库dump、证书私钥、registry config或注册token放入GitHub issue/PR/公开交付包。
