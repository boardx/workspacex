# 已有正式镜像：在一台新服务器安装 WorkspaceX

这是镜像消费者的安装方案。服务器不用下载应用源码、构建镜像、创建分支或注册 GitHub Runner。

交给部署者的是一个工具包：入口 `install.py`、一份 `.env.example`、一份 `compose.yaml` 和本说明。隐藏的 `.runtime/` 是随版本发布的程序实现，**无需手工编辑、复制其中的脚本**。日常只维护自己的 `.env`。`compose.yaml`是通用运行结构的可读视图；实际实例配置由安装器生成，不要在安装前单独对它执行up或手工修改内部模板。

**适用范围**：独占 Ubuntu 24.04 / 26.04 x86_64、Docker Engine + 新版 Compose、同机 PostgreSQL/Redis、本地文件持久化、HTTPS。五个正式镜像必须包含 api、web、deep-agent、skill-sandbox、postgres-age，同一个tag和完整OCI revision。Redis另行拉取。不同系统、托管数据库、共享主机、离线安装和多节点高可用不在这条安装路径中。

当前只有离线自动验证证据；真实Ubuntu主机的安装、浏览器、重启和恢复验收仍需部署者执行，不能据此宣称生产已验收。

## 1. 获取安装工具包

维护者在同版本源码根目录运行：

```bash
python3 scripts/image_install/installer.py package --output deploy/us/dist
```

将 `workspacex-install.tar.gz` 和独立可信渠道确认的SHA256交给用户。代码和示例不含实际凭据。维护者须确认五个镜像tag真的存在并提供给用户，不能猜测示例版本。

用户将包上传服务器后，以下命令均在目标服务器执行：

```bash
sudo install -d -m 0755 /opt/workspacex-installer
# 先运行sha256sum核对压缩包与维护者独立提供的摘要，再解压：
sha256sum workspacex-install.tar.gz
sudo tar -xzf workspacex-install.tar.gz --strip-components=1 -C /opt/workspacex-installer
sudo chown -R root:root /opt/workspacex-installer
sudo chmod -R go-w /opt/workspacex-installer
cd /opt/workspacex-installer
sudo sha256sum --quiet -c SHA256SUMS
```

不要将工具包放在普通用户可改写的目录里再以root执行。完整包无需应用源码，软件安装来自系统软件源，程序只运行用户提供的正式镜像。

## 2. 核对主机前置条件

已经拉取五个镜像可以直接复用；缺失的镜像由安装器拉取。先确认：

```bash
cat /etc/os-release
uname -m
docker version
docker compose version
docker compose run --help | grep -- --env-from-file
```

要求 Ubuntu 24.04 / 26.04、x86_64、可用的Docker daemon，Compose支持 `env_file.format=raw` 和 `run --env-from-file`。Ubuntu软件源的 `docker.io` 搭配 `docker-compose-v2`；Docker官方源搭配 `docker-compose-plugin`，不要混装。没有Docker时按[Docker官方Ubuntu安装文档](https://docs.docker.com/engine/install/ubuntu/)安装；不要同时混用snap/docker.io/Docker CE。

安装器不会卸载或升级已有Docker。目标机还要准备：

```bash
sudo apt-get update
sudo apt-get install -y python3 nginx apparmor apparmor-utils openssl util-linux curl
sudo systemctl enable --now apparmor nginx
sudo aa-enabled
```

系统应使用systemd、AppArmor处于启用状态。正式镜像固定linux/amd64。模板资源上限合计约12.5GiB，另留系统与镜像空间；这是容器上限总和，不是内存预留，也不是压测容量结论。7.5GiB主机不能保证各容器同时达到上限，首次小流量验收须监控内存/OOM，正式容量需实测后确定。数据磁盘要长期保留。

已有Nginx监听80不等于冲突：先用 `nginx -T` 核对是否仅为默认站点，存在其他业务时不要使用此独占主机安装路径（ACME会短暂停止Nginx）。

域名A记录指向该服务器；没有IPv6时不要留失效AAAA。防火墙/安全组允许运维SSH、80/443。不要把5432、6379、3000、3200开放到公网。容器需能访问模型服务、镜像仓库和本机的公网HTTPS地址。

## 3. 只填一份配置

```bash
sudo cp .env.example .env
sudo chmod 600 .env
sudo nano .env
```

| 配置项 | 填什么 |
|---|---|
| `IMAGE_TAG` | 五个镜像实际共有的版本，如维护者提供的 `v1.2.3` 或 `run-id-attempt`；不填写示例占位或latest。 |
| `PUBLIC_DOMAIN` | 如 `us.example.com`，不带协议、端口和路径。用于HTTPS、API链接和验收。 |
| `ADMIN_EMAIL` | 首位管理员邮箱；申请ACME证书时也用于到期通知。 |
| `MODEL_BASE_URL` | 可从服务器访问的HTTPS OpenAI-compatible根地址，如供应商的 `/v1` 地址。 |
| `MODEL_ID` | 上述供应商实际支持的模型ID。 |
| `MODEL_API_KEY` | 供应商真实密钥，只写私密 `.env`。 |
| `REGISTRY_PREFIX` | 截图中的公网registry/namespace默认值通常保留；不用 `-vpc` 地址。 |
| `REDIS_IMAGE` | 默认与现有仓库一致为 `redis:7-alpine`；可指定经验证的摘要引用。首次安装会解析并固定实际digest。 |
| `ADMIN_NAME` | 初始管理员显示名。 |
| `ORG_NAME` | 初始组织名称。 |

语法是 `KEY=value`，每项一行，可以用成对引号包住值；不要在值后加行尾注释，不支持shell变量展开。初始数据库角色口令、服务间密钥、加密密钥与管理员密码由程序随机生成，不需要填十几套密码。它们在 `/etc/workspacex-selfhost/stable-secrets.json`，必须加密离机备份；不能每次更新重新生成。

先看无副作用的安装计划，不会打印模型密钥：

```bash
sudo python3 install.py plan --config .env
```

若本地缺镜像，使用root身份登录私有仓库。已经拉齐全部镜像时无需重新登录就能复用本地镜像：

```bash
sudo docker login workspacex-cn-prod-registry.cn-shanghai.cr.aliyuncs.com
```

用户名与只读口令由镜像维护者提供；交互输入口令，不写进命令或Git。

## 4. 一次安装，自动完成初始化与启动

已有此域名的fullchain与私钥：

```bash
sudo python3 install.py install --config .env \
  --cert /root/fullchain.pem --key /root/private-key.pem
```

没有证书、域名与80端口已就绪，可选择ACME自动申请：

```bash
sudo python3 install.py install --config .env --acme
```

ACME会通过apt安装certbot，在本独占主机申请/续期时短暂停止Nginx，并安装持久续期hooks和timer。共享多个站点的主机不要使用本路径。

安装器依次执行：

1. 校验配置、系统条件、程序完整性和root目录权限。
2. 复用本机五个镜像；缺失才拉取，核对linux/amd64与同源OCI revision。Redis解析固定digest。
3. 自动生成私密运行配置、稳定密钥、Compose、Nginx与沙箱策略；安装持久AppArmor策略并保证Docker启动顺序。
4. 启动PostgreSQL/Redis，创建API/诊断/Agent/Memory独立角色与数据库；执行API和Memory迁移，创建管理员/组织/默认Agent。
5. 启动Web/API/Agent及两个隔离沙箱；配置/验证HTTPS。
6. 执行真实登录、上传下载、Agent、模型和沙箱探针。**会产生测试数据与模型用量。**

成功后访问 `https://<PUBLIC_DOMAIN>`。管理员账号是ADMIN_EMAIL，初始密码位于root私密文件 `/etc/workspacex-selfhost/stable-secrets.json` 的admin项；本机私密读取，不发到issue或聊天。

安装不是无条件反复覆盖。数据库初始化中断会保留started标记并拒绝自动重试；初始化已完成但TLS/验收失败时，可在修复原因后用**同一份配置与原密钥**再次执行安装命令，继续后半程。更换tag、域名、模型或凭据不会被当作安装重试自动覆盖。

### 初始化之前的宿主机目录创建失败

若Ubuntu26.04报 `install: invalid user: 1000`，先更新为已修复的工具包（重新解压不覆盖.env或.runtime/.local），再执行：

```bash
python3 install.py recover-host-setup --config .env
```

此命令只处理“运行文件已复制，但数据目录/状态目录完全为空”的早期失败：校验同一.env、暂存稳定密钥和全部运行文件一致、无本项目容器、无已安装的策略/入口文件，并在同一部署锁下将三处半成品目录移入 `/root/workspacex-host-setup-backup-*` 私密归档。它不删除数据，不移走 `.runtime/.local/runtime`，不生成新密钥。归档成功后用原配置再次执行安装命令。若提示拒绝恢复，保留现场交由维护者处理，不可删标记绕过。此命令不用于数据库初始化失败或任何已有业务数据的实例。

## 5. 查看、验收与日常运行

```bash
sudo python3 install.py status
sudo python3 install.py logs
sudo python3 install.py verify
sudo python3 install.py stop
sudo python3 install.py start
```

`verify`使用当前运行的API镜像做真实业务检查，会调用模型；它不等于浏览器自动化。必须实际用浏览器：登录、发起真实对话、刷新确认历史、上传文件、生成文件并下载打开。维护窗口重启服务器，确认容器和AppArmor恢复、历史与文件仍在，再宣布交付成功。

程序自动生成的路径无需用户逐个编辑：

| 路径 | 用途 |
|---|---|
| `/etc/workspacex-selfhost/` | 私密配置、稳定密钥、Compose、证书与socket目录。 |
| `/var/lib/workspacex-selfhost/{postgres,redis,objects}` | 三类持久化数据，禁止随意删除。 |
| `/var/lib/workspacex-selfhost-state/` | 初始化开始/完成、业务验收结果。 |
| `/etc/apparmor.d/workspacex-native-sessions` | 重启后自动加载的沙箱策略。 |
| `/etc/nginx/conf.d/workspacex-selfhost.conf` | HTTPS和流式/WebSocket代理配置。 |

## 6. 备份、更新边界与失败排查

```bash
sudo python3 install.py backup
```

备份会短暂停止应用，保存三个数据库、对象文件、原配置/密钥和真实镜像摘要到 `/var/lib/workspacex-selfhost/backups/<UTC>/`，然后恢复应用。备份包含客户数据与密钥，需加密离机保存并在新机器演练恢复。Redis登录会话/缓存不属于恢复承诺。不要只保存数据库而丢掉MODEL_CREDENTIAL_KEY等稳定密钥。

本入口用于新实例安装，**不提供无审核的升级/数据库回滚**。更新正式版本前先备份、查看该版本迁移要求并由维护者给出版本匹配的更新/恢复步骤；不能修改.env的tag后重跑安装，或认为换回旧镜像能撤销SQL。

| 失败 | 处理 |
|---|---|
| 镜像不存在/401 | 核对公网地址、namespace、tag、root的只读登录。 |
| 五个来源不同 | 使用维护者提供的同一完整镜像集合；不要混搭各仓库latest。 |
| 缺少主机程序/AppArmor | 按第2节补齐；安装器不会替你卸载Docker或关闭安全策略。 |
| 已存在部分安装 | 保留日志/数据/started标记，核对哪个DDL已完成；不要删目录或标记强行重试。 |
| HTTPS失败 | 核对DNS、端口、完整证书链、证书/key、有效期和容器对公网域名的访问。 |
| 探针退出79/出现business-probe-uncertain | 远端Agent清理状态不明，程序拒绝重试；运维先确认运行已结束、测试资源已清理，再处理标记，不可直接删除标记继续刷任务。 |
| 业务探针失败 | 检查模型配置、账户、Agent、文件权限；健康接口200不足以宣布成功。 |

默认只配置基础应用、文件、模型和沙箱，不包含邮件发送、ASR、受控浏览器、第三方连接器或客户数据迁移。管理员可登录不代表注册验证邮件和找回密码已配置。需要这些能力时由维护者提供对应配置并验收，不复用CN生产凭据。
