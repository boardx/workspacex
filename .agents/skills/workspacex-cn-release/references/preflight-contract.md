# 聚合预检机器契约（schemaVersion 2）

`validate_preflight.py` 接受一个不含密钥的 UTF-8 JSON 对象，按 `phase` 分两次验证同一个 exact `sourceSha`、`baselineSha`、`release` 和 `attemptId`。构建前 `phase=prebuild`、`buildStarted=false`；镜像构建且 seal 完成后、流量激活前 `phase=preactivate`、`buildStarted=true`。`ready=true` 只允许进入该阶段的下一步：prebuild 允许开始构建，preactivate 允许进入激活门。验证器机械比较两次身份、原始证据 hash 和时效；不能把 prebuild 收据单独用作激活收据。

两阶段顶层都必须有 `issuedAt`、`expiresAt`，格式严格为 UTC `YYYY-MM-DDTHH:MM:SSZ`。收据签发时间不能超过验证器时钟未来 5 分钟，必须已生效、未过期，TTL 必须大于零且不超过一小时。prebuild 不能包含 `prebuildEvidence` 或 `prebuildReceiptSha256`。preactivate 必须携带完整的 prebuild 输入 JSON 到 `prebuildEvidence`，以及 prebuild 输出的 `receiptSha256` 到 `prebuildReceiptSha256`；验证器重新计算 canonical JSON SHA-256、重跑 prebuild 全部检查，要求它仍 `ready=true`，四项身份完全相同、preactivate 签发时间不早于 prebuild。任何缺失、篡改、过期或阶段倒序都 schema 红退。

两阶段都必须提供验证脚本的 `REQUIRED` 集合中全部 19 项检查，每项是 `{"status":"passed","evidenceSha256":"64 位小写 hex","metadata":{...}}`；失败项需附非空稳定 `code`。未知或缺失检查拒绝，证据 hash 对脱敏原始 probe 输出计算。`BOOTSTRAP_*`、`STABLE_SECRET_*` 失败码以及两项 metadata 字段使用脚本的 allowlist。阶段相关字段如下：

| 字段 | prebuild：只有源码/输入，无目标镜像 | preactivate：目标镜像已构建 |
|---|---|---|
| `config.release_manifest.metadata` | `{"kind":"source-plan","sourceSha":"exact 40hex","release":"固定版本"}`；禁止 `imageDigest` | `{"kind":"sealed-image","sourceSha":"exact 40hex","release":"固定版本","imageDigest":"sha256:64hex"}` |
| `bootstrap.compatibility.metadata` | 只读事务、零生产写入、`sourceEntrypoint=true`、输入/schema/权限/状态/Agent seed/单记录均验证；禁止 `imageEntrypoint` | 同样的只读 DB 检查，但必须是目标镜像的 `imageEntrypoint=true`；禁止源码入口替代 |
| `build.target_image` | 禁止出现；不能伪称目标镜像已存在 | 必填。metadata 为 `{"sourceSha":"exact 40hex","digest":"sha256:64hex","entrypointVerified":true}`；digest 必须与 sealed manifest 相同 |

`bootstrap.compatibility` 的 DB probe 应在构建前检查输入和只读数据库兼容性；构建后重新执行镜像入口和 DB probe，尤其在迁移/激活前。镜像 digest 必须来自可鉴权的 registry manifest，不能用源码 hash 冒充。preactivate 阶段还需 canonical Prepare/影子业务与浏览器验收，独立于本 JSON 结构。

成功或 blocker 只向 stdout 写一行 `CN_RELEASE_PREFLIGHT_JSON={...}`，内含 `phase`、`ready`、`checkedCount`、`blockers`、四项身份、`issuedAt`、`expiresAt` 和对原始输入 canonical JSON 计算的 `receiptSha256`。诊断写 stderr。成功退出 0；blocker 退出 1；schema 错误退出 2。调用方解析固定前缀，不能假设 pnpm 或 shell stdout 只有 JSON。
