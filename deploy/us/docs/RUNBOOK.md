# 从零部署与后续手动发布

每条命令标注执行位置。`<...>` 是说明占位，必须换成实际值。脚本的显式参数表示操作者知道这一步会安装系统组件、初始化数据库或短暂停服。准备/执行时不要开启 `set -x`。

## A. 维护者：准备应用镜像、发布接线与交付包

在本地源码仓库：

```bash
cd /Users/shenyangjun/boardx/workspacex
python3 -m unittest discover -s deploy/us/tests -v
python3 deploy/us/scripts/package.py
```

将 `deploy/us/dist/workspacex-us.tar.gz` 及其 checksum 交给接收方。包只含部署工具及从仓库收集的受信发布工具，不含应用业务源码、真实配置、镜像、数据或凭据。

维护者必须先准备一组真实镜像。现有 image-release 可在 main 选择 `environment=cn,service=all,build_only=true` 只构建推送，**不会部署 CN**。记录完整 run、attempt、短 tag、release.json 中的完整 sourceRevision 和五个 digest。给接收方只读仓库权限。独立 Redis 镜像摘要也由维护者提供并验证。

要启用 US 的 Actions 手动更新，另开代码 PR：

```bash
git apply --check deploy/us/github/us-support.patch
git apply deploy/us/github/us-support.patch
python3 -m unittest discover -s tests -p 'test_registry_images.py' -v
python3 -m unittest discover -s tests -p 'test_deploy_registry_images.py' -v
python3 -m unittest discover -s tests -p 'test_release_branch_policy.py' -v
```

补充 US 分支映射测试并更新发布文档，按仓库审查/CI 流程合入 main。部分旧的字符串断言需随新增 us 一起更新，不可绕过红测试。补丁是接线材料，不声称自动完成审查或 main 集成；本包离线测试另外验证补丁可应用、US 手动准入/环境错配/US push 被拒绝。

然后创建 main-us（若已存在则核对，不覆盖）：

```bash
git fetch origin main
git branch main-us origin/main
git push -u origin main-us
bash deploy/us/github/configure-environment.sh boardx/workspacex --apply
```

在 Settings → Rules/Branches 给 main-us 配 PR、禁止强推和删除。该仓库的代码 PR检查是否覆盖 main-us 要一起核对；本包不冒充已配置所有 ruleset。

Repository Actions 配置：

```bash
gh variable set WSX_ACR_REGISTRY --repo <owner/repo> --body '<公网registry主机名>'
gh variable set WSX_REGISTRY_PREFIX --repo <owner/repo> --body '<公网registry主机名/namespace>'
gh secret set WSX_ACR_USERNAME --repo <owner/repo>
gh secret set WSX_ACR_PASSWORD --repo <owner/repo>
```

两个 secret 命令交互输入。已有可用值无需重设；不要打印 secret。无需设置旧的 WSX_IMAGE_RELEASE_ENABLED。

## B. 接收者本机：填写配置并离线生成私密文件

收到包后先在独立可信渠道核对 SHA256，再解压。以下以解压目录 `workspacex-us` 为工作目录：

```bash
shasum -a 256 workspacex-us.tar.gz
# 与维护者独立提供的摘要核对后：
tar -xzf workspacex-us.tar.gz
cd workspacex-us
# Linux 可用 sha256sum；macOS 本机用 Python 校验或在服务器解压后执行此项
mkdir -m 700 .local
cp config/settings.example.json .local/settings.json
chmod 600 .local/settings.json
```

按 VALUES.md 填完所有 `REPLACE_`，包括真实模型 key、镜像 tag/SHA、Runner 官方下载信息。没有 Actions 使用权限的人仍可让维护者填好非秘密 Runner 元数据，先完成主机安装，跳过 Runner 注册阶段。

```bash
python3 scripts/configure.py .local/settings.json .local/runtime
```

生成稳定密钥后不要重跑到另一个目录再拿新口令覆盖已运行服务器。将 `.local/runtime` 纳入加密、离机的运维备份。

## C. US 控制台/本机：主机、DNS与网络

1. 一台独占 Ubuntu 24.04 x86_64 主机，足够的 CPU/内存/持久磁盘。模板的服务上限合计超过 12 GiB，容量规划至少应覆盖这些上限与系统/镜像开销；这是静态预算，不是经过压测的采购规格。
2. SSH 仅向运维来源开放；公网开放 80/443；不开放 3000、3200、5432、6379。数据库只在 Docker 网络中，无公网端口映射。
3. DNS A 指向 US 公网 IP。IPv6 未配置不要发布 AAAA。确保 US 主机/容器能访问模型接口、ACR、GitHub、Ubuntu/Docker 软件源。
4. 确认目标主机 SSH host key，通过可信渠道核对。不要用 StrictHostKeyChecking=no。

把无秘密包和私密配置分别上传：

```bash
scp ../workspacex-us.tar.gz <SSH_USER>@<US_HOST>:/tmp/
scp -r .local/runtime <SSH_USER>@<US_HOST>:/tmp/us-private
```

后续 **在 US 服务器**：

```bash
sudo install -d -m 700 /root/us-deploy
sudo mv /tmp/workspacex-us.tar.gz /root/us-deploy/
sudo mv /tmp/us-private /root/us-deploy/private
sudo chown -R root:root /root/us-deploy
sudo chmod -R go-rwx /root/us-deploy
sudo -i
cd /root/us-deploy
sha256sum workspacex-us.tar.gz
# 再与独立可信摘要核对
tar -xzf workspacex-us.tar.gz
cd workspacex-us
sha256sum --quiet -c SHA256SUMS
bash scripts/00-system.sh --fresh-host
bash scripts/10-install.sh /root/us-deploy/private --new-install
```

`00-system` 只用于没有 Docker 的新机器，发现已有/冲突包会停止，不自动卸载。已有 Docker 的机器需人工核对版本、Compose `env_file.format=raw` 和 `run --env-from-file` 支持、AppArmor/systemd 后跳过本步。`10-install` 只安装一次；失败留下现场，不能删数据目录后蒙着重跑。

安装方法依据 [Docker 官方 Ubuntu 文档](https://docs.docker.com/engine/install/ubuntu/)。Compose 一次性迁移作业使用官方 [`run --env-from-file`](https://docs.docker.com/reference/cli/docker/compose/run/)；主机预检必须确认这些功能存在。

## D. US root：镜像登录与首次数据库初始化

```bash
docker --config /etc/workspacex-image-release/docker login <registry公网主机名>
chmod 600 /etc/workspacex-image-release/docker/config.json
bash scripts/20-bootstrap.sh --initialize-empty-us
```

交互输入只读账号。初始化会校验镜像平台与应用 OCI revision，拒绝非空数据目录，启动 PostgreSQL/Redis，创建独立角色与数据库，执行 API 与 Memory schema，创建管理员和默认 Agent，再启动所有应用。它会写 `/var/lib/workspacex-image-release/us/bootstrap-started` 与 `bootstrap-complete`。

任一迁移失败不要继续发布，也不要删除标记来重试。保存私密日志，核对实际 DB/角色/容器状态，修复后明确重试边界。此步尚不证明公网服务可用。

## E. US root：HTTPS、证书续期

已持有证书的情况：

```bash
bash scripts/30-ingress.sh /root/fullchain.pem /root/private-key.pem
```

没有证书且满足公网 DNS/80 可访问条件，可先申请：

```bash
bash scripts/25-certificate.sh --issue-public-certificate
# 将 <域名> 替换为 settings.domain：
bash scripts/30-ingress.sh /etc/letsencrypt/live/<域名>/fullchain.pem /etc/letsencrypt/live/<域名>/privkey.pem
```

这是独占主机，申请/standalone 续期会短暂停止 nginx。实际运行目录使用证书副本，必须安装复制/重载 hook：

```bash
bash scripts/35-renewal.sh --standalone-hooks
```

本脚本将stop/start nginx写入Certbot持久pre/post hooks，将证书复制脚本写入deploy hook，启用certbot.timer并执行dry-run；不是仅运行一次带钩子的命令。适用于本包独占主机，不能照搬到承载其它站点的共享主机。若由云证书管理器续期，则用该系统调用同等的证书/key匹配、复制、nginx -t和reload流程。

## F. US root：业务验收并封存发布策略

```bash
bash scripts/40-accept.sh
```

这会做公开 HTTPS 健康检查和真实登录/文件上传下载/Agent/模型/沙箱业务探针，**会产生模型用量与测试数据**。成功后封存 `/etc/workspacex-image-release/us.json`。浏览器实际操作仍须按 ACCEPTANCE.md 验证；此脚本没有假装是浏览器 E2E。

初始管理员口令在 `/etc/workspacex-us/stable-secrets.json` 的 admin 项，本机私密读取，勿贴到聊天/issue。更换验收账号/口令要同时更新 probe.env，经验证后重新审查策略哈希；不要让流水线因旧密码永远失败。

## G. 可选：US root 安装 Actions Runner

需要仓库管理权限。本机获取短期注册 token：

```bash
umask 077
gh api --method POST repos/<owner/repo>/actions/runners/registration-token --jq .token > .local/runner-registration-token
scp .local/runner-registration-token <SSH_USER>@<US_HOST>:/tmp/runner-registration-token
```

US root：

```bash
install -o root -g root -m 0600 /tmp/runner-registration-token /root/runner-registration-token
rm /tmp/runner-registration-token
bash scripts/50-runner.sh /root/runner-registration-token
```

脚本验证官方 archive 哈希，用普通用户注册，安装服务，成功后删除注册 token。本机临时 token 也应删除。GitHub 确认 Runner 在线且标签含 `self-hosted,linux,x64,workspacex-us-production`。

## H. 以后每次发布：只有手动触发

先在 GitHub 合并 `main → main-us` 同步 PR。然后 Actions → image-release → Run workflow：

- Branch=`main-us`
- environment=`us`
- service=`all`
- build_only=`false`
- tag 留空构建，或填已经存在的完整镜像集合 tag

CLI（本机）：

```bash
bash scripts/manual-release.sh <owner/repo>
# 复用实际已发布的镜像集合：
bash scripts/manual-release.sh <owner/repo> <run-id-attempt>
```

没有 Runner 的接收者可由运维在 US root 手动消费维护者提供的 tag：

```bash
/usr/local/bin/workspacex-image-release us <run-id-attempt>
```

两种方式进入同一个受信 consumer、同一 US 部署锁、同一业务验收和失败恢复路径。发布只替换应用镜像，不升级 PG/Redis、不迁移 SQL、不改固定配置。发布前按 ACCEPTANCE 做备份；如果候选 SQL/Memory schema 与基线不一致，门控会拒绝，需维护者提供单独迁移方案与演练，不能跳过。

## I. 备份与灾难恢复

备份（US root，短暂停服）：

```bash
bash scripts/backup.sh --brief-downtime
```

产物在 `/var/lib/workspacex-us/backups/<UTC时间>/`，包括三库逻辑 dump、文件对象、私密配置、当前真实镜像摘要和校验。通过加密私有通道离机保存，验证另一台机器读得到。Redis 缓存/登录会话不恢复，用户需重新登录。没有自动设置备份频率；由运维按 RPO 配置 timer/备份平台并监控失败。

恢复必须在 **新替代主机** 演练，不覆盖正在服务的生产机：

1. 同样的 OS/工具包，保持原服务离线或切断写入，准备原域名 TLS 与 DNS/hosts 验证策略。
2. 上传完整备份到 `/root/backup`，root 0700。配置原来镜像的只读拉取权限；镜像摘要必须仍可取到。
3. 在新主机已安装 python3 后，用包内脚本恢复私密输入，不重新生成密钥：

```bash
python3 scripts/prepare-restore.py /root/backup /root/restore-private
bash scripts/10-install.sh /root/restore-private --new-install
# 配置 root-only docker login
bash scripts/20-bootstrap.sh --initialize-empty-us
bash scripts/restore.sh /root/backup --replace-fresh-us
# 用原域名证书执行 30-ingress；再执行 40-accept
```

restore 只接受未封存策略的恢复专用新实例，用备份的原稳定密钥、当前镜像摘要和数据库权限恢复。失败时应用保持停止，不能把半恢复状态当上线；排查后重建新的替代机重新演练。备份自身不包含 redis 客户端会话、Docker镜像二进制或宿主系统，所以需要镜像保留策略与网络访问。

只有 SQL、对象文件、真实业务和浏览器都通过，才切换 DNS/流量；记录实际恢复耗时和数据损失边界。不能把镜像回滚当作数据库恢复。
