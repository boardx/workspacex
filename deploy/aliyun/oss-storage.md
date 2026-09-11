# OSS 文件存储运行参数与验收

Starter 和 production 均使用 OSS。本文是已实现的 API 存储入口，不表示完整 provision 或所有附件、Agent、沙箱链路已经验收。

## 初始化前提

- 专用私有桶，与应用同地域；版本控制从未启用。Enabled 和 Suspended 均拒绝启动或写入，避免覆盖保护失效、删除只产生删除标记。
- 运行身份不能更改桶 ACL、版本控制、覆盖保护或权限策略；运维也不得在服务运行时改变这些前提。检查与写入之间无法跨 OSS API 做原子事务。
- 在 OSS 控制台为部署前缀配置禁止覆盖规则：前缀为下表 OSS_PREFIX 加 `/`，后缀为空，Authorized User 为 `*`。上线前用受限身份验证不带保护请求头的覆盖也被拒绝。当前启动检查只自动验证版本控制和私有 ACL，尚未自动核验该规则。
- 网络、DNS、HTTPS 以及 ECS 实例角色提前准备。不要将凭据写入镜像、提交到仓库或放进参数样例。
- 桶级权限：`oss:GetBucketVersioning`、`oss:GetBucketAcl`；对象级权限限定部署前缀：`oss:PutObject`、`oss:GetObject`。合规清理能力另需该前缀 `oss:DeleteObject`。当前工厂为两端口使用同一运行身份；尚未实现独立清理进程/身份隔离，生产验收必须记录这一限制。
- 不以 OSS 版本控制作为本版本备份方案。备份副本使用独立目标与保留规则，恢复演练仍属后续交付。

## 运行环境变量

| 参数 | 值/用途 |
|---|---|
| WORKSPACEX_DEPLOY_PROFILE | `starter` 或 `production`，强制选择 OSS |
| WORKSPACEX_OBJECT_STORE | `oss` |
| OSS_REGION | 如 `cn-hangzhou` |
| OSS_BUCKET | 已创建的专用桶名 |
| OSS_ENDPOINT | `https://oss-cn-hangzhou-internal.aliyuncs.com`，或同地域公网 HTTPS 地址 |
| OSS_PREFIX | 独立部署前缀，如 `deployments/starter-a`；不接受点路径或空段 |
| OSS_AUTH_MODE | 默认 `ecs-role`；外部验收可用 `environment` |
| OSS_ROLE_NAME | ECS 实例角色名，ecs-role 必填；实例元数据禁用 IMDSv1 |
| OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET | 仅 environment 模式，由安全渠道注入 |
| OSS_SECURITY_TOKEN | environment 模式使用 STS 时注入 |

ECS 角色使用临时凭据并交由 SDK 刷新。静态环境凭据的替换需重启进程。部署 JSON 到这些运行变量的渲染仍属 provision 编排工作，不能把 JSON 验证通过视作应用已配置。

未指定云 profile 的本地开发可继续使用 `WORKSPACEX_OBJECT_STORE=fs` 与 `WORKSPACEX_OBJECT_ROOT`。云配置错误或 OSS 不可用时启动失败，绝不回退磁盘。

## 行为与边界

写入携带禁止覆盖头、Content-MD5 与 SHA-256 元数据；读取验证 SHA-256。SDK 的对象不存在与桶不存在通过桶检查进一步区分，权限/网络错误不会伪装成不存在。普通 ObjectStore 只有 putOnce/get/head；物理清理单独提供端口并逐个确认删除结果。

外部导入的旧文件若没有 SHA-256 元数据会被拒绝读取；迁移工具尚未完成。当前接口使用内存缓冲，不是大文件流式/分片上传实现。完整文件链路盘点、生命周期及清理 worker 接线仍待完成。

## 验证命令

本机契约和真实 SDK 隔离 HTTP 测试（不访问云）：

```sh
pnpm --filter @repo/api test:storage
```

预先注入上表参数，在专用测试桶上显式执行真实验收：

```sh
WORKSPACEX_OSS_SMOKE=1 WORKSPACEX_OBJECT_STORE=oss pnpm --filter @repo/api exec node --import tsx scripts/verify-oss-storage.ts
```

该命令写入随机 verification 子路径，验证读、元数据、重复写拒绝、原内容不变，再删除本次对象。清理失败返回非零并输出待清理对象键。没有参数不会跳过或输出成功。`ossVerified: true` 只代表存储探针通过，`provisionVerified` 仍为 false。

上线记录必须包括执行版本、身份与前缀、探针结果、云上覆盖保护验证、网络异常测试与清理结果；不得记录 Secret。当前尚无真实云端验收证据。

参考：[OSS 禁止覆盖规则](https://help.aliyun.com/en/oss/user-guide/prevent-file-overwrite)、[PutObject](https://help.aliyun.com/en/oss/developer-reference/putobject)、[Node.js 凭据配置](https://help.aliyun.com/en/oss/node-js-configure-access-credentials)。
