# CN 手动镜像发布

2026-10-25 已通过真实 GitHub Actions 手动发布验收。适用于应用配置和数据库结构不变的镜像更新；结构迁移与初始化仍按 [CN 数据库策略](cn-schema-release-policy.md) 单独准备。

## 网页操作

打开 [image-release](https://github.com/boardx/workspacex/actions/workflows/image-release.yml)，Run workflow：

| 参数 | 构建当前 main 并部署 | 部署已有镜像 |
|---|---|---|
| Branch | main | main |
| environment | cn | cn |
| service | all | all |
| build_only | 不勾选 | 不勾选 |
| tag | 留空 | 完整不可变 tag |

空 tag 只冻结触发时的提交，构建期间不会追随 main。已有 tag 不重新构建。等待 deploy 成功；仅 build/manifest 成功不是已上线。

## 服务器实际执行

固定 `/usr/local/bin/workspacex-image-release cn <tag>` 通过既有 ghrunner scoped sudo 权限进入 systemd，配置来自 root0600 `/etc/workspacex-image-release/cn.json`；不 checkout 或执行 runner 工作目录代码。

1. 使用本机既有 ECS 角色刷新短期 ACR 拉取凭据，拉取完整五镜像清单，核对 tag/source/digest/平台。
2. 持有 CN canonical 发布锁，核对受保护配置及当前指针。
3. root 固定 admission 核对当前/候选 API SQL 和 Agent schema/lock 字节，结构变化立即拒绝。只读事务完整核对当前应用同一个 RDS/database 的迁移名称与 checksum。
4. 创建 CN 当前数据库一致性 pg_dump 快照，流式加密存储 root 私有目录；完整解密到匿名内存后验证 TOC。应用仍运行，收据明确 `writersStopped=false`。这不是停写 epoch，也不是恢复演练；本通道没有数据库迁移。
5. 基线通过公网健康及真实 Chromium 登录、通知、首页/对话/项目/计费页面和计费只读契约后，仅切换四个应用镜像。数据库和 Redis 不切换，不启动可选 sandbox-sessions。
6. 候选实际镜像和公网浏览器通过才提交 current 指针。候选失败自动恢复旧镜像并重新验收；恢复失败保留 pending，阻止后续发布。

每次 admission/部署原始收据都在 `/var/lib/workspacex-image-release/cn/`，当前版本指针是该目录 `current.json`。历史 `/etc/workspacex-image-release/cn-active-release.json` 只记录上一次固定维护升级，不代表此通道之后的当前状态。判断线上版本同时读取实际容器，不能只看历史收据。

## 主机安装与信任边界

部署实现及 admission/browser/ledger 文件放在内容寻址 root-owned closure，verificationFiles 固定其完整字节。未增加 runner sudo 或 IAM 权限。私有 cn.json/admission policy 包含实测 Compose、migration env、数据库目标和 ECS 身份，不应复制到别的环境。

本机 Compose2.40.3 对带 env_file 的原始配置执行 `config --hash` 与容器标签不一致。完整 `config --format json` 解析结果保存为 root0600 canonical-baseline.json；其二次渲染与原始对象完整相等，四个服务哈希均匹配当前容器后才安装。原始 Compose/env 文件仍逐个 hash pin。没有关闭 LIVE_CONFIG_DRIFT 或修改 Docker Compose。

浏览器不从 runner-owned `/opt/workspacex-cn/repository` 加载依赖。`install-cn-image-browser-runtime.py` 对本机既有、逐项 root-owned 不可写的固定 Playwright 包，以 no-follow fd 读取后冻结到 `/usr/local/lib/workspacex-cn-browser-runtime`；不联网安装，目标存在则拒绝。包中每个文件和 package.json 均写入 root 私有 manifest。每次 browser probe 在加载代码前检查 manifest 的文件哈希、symlink 和全部父目录所有权/写权限。Chromium 使用既有系统安装，正常 TLS 校验保持。

初始化该环境需要 root 操作员按照观察到的运行配置生成受保护 policy，并通过配置完整等价、容器哈希及公网基线验收。普通发布不用再次安装；配置变化必须重新准备，不能忽略 hash 拦截。

## 失败如何处理

- 构建失败：没有上线，不复用不完整镜像集合。
- 构建/manifest 成功、主机尚未切换即失败：修复明确原因后可仅重试 deploy，复用原 tag。结构差异不得靠重试绕过。
- 部署已开始但终态不明：先核对 pending、systemd、实际容器和原始收据，不盲目重放。
- 数据库结构有变更：此通道拒绝。完成独立结构升级、明确数据操作及相应准入更新后再发布，不能直接重用历史固定候选迁移脚本。
