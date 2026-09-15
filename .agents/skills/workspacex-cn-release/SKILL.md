---
name: workspacex-cn-release
description: Prepare, promote, activate, roll back, and browser-verify WorkspaceX releases on the Aliyun China production environment. Use for devapp-to-production releases, main-cn promotion, CN release incidents, release timing, or improvements to that release lane.
---

# WorkspaceX 中国生产发布

用这套流程把一个已经在 Devapp 验证的 **exact commit SHA** 晋级到中国生产。发布开始后不跟随 `origin/main` 漂移；新提交进入下一次发布。

## 先读

- 执行发布、排障或复盘前，读 [references/release-sop.md](references/release-sop.md)。
- 修改聚合预检或其机器输出时，读 [references/preflight-contract.md](references/preflight-contract.md)。
- 排查 migration 通过后 bootstrap 失败时，读 [references/bootstrap-compatibility.md](references/bootstrap-compatibility.md)。
- 生成 runtime bundle、迁移密钥目录或跨版本验收时，读 [references/stable-secret-continuity.md](references/stable-secret-continuity.md)。
- 涉及准备/激活实现时，同时读 `docs/adr/ADR-111-separate-cn-release-preparation-from-traffic-activation.md`、`deploy/aliyun/fast-safe-release.md` 和 `.harness/instructions/deployment-verification-standard.md`。

## 不变量

1. 入口只有 exact 40 位 SHA、release 名和生产 baseline；不得用移动分支名代替版本身份。
2. 构建前运行 `phase=prebuild` 聚合预检，只证明 exact source、输入与只读数据库状态；目标镜像尚未存在，不能伪报其入口或 digest。任一失败时 `buildStarted=false`。镜像 seal 后再运行 `phase=preactivate`，必须机械复验未过期且同 attempt/source/baseline/release 的 prebuild 收据及 exact 目标镜像。
3. ACR 认证放在临时 `DOCKER_CONFIG` 中，并通过一次鉴权 registry 请求证明；只检查“有凭据”不算通过。
4. 中国生产发布不依赖运行时从 GitHub 补对象。必须先有完整、校验过的离线 source artifact；shallow/partial checkout 只可作缓存。
5. `package.json#packageManager` 是 pnpm 版本单一事实源，当前必须为 `pnpm@9.15.0`。使用进程级 wrapper/Corepack，不修改主机全局 pnpm。
6. 单一 release lock 覆盖 build、prepare、promotion 和 activate。发现孤儿进程只报告 PID/命令/lock owner 并失败；清理后从预检重跑。
7. build、manifest、seal、prepared receipt、`config.release`、`main-cn` 和运行容器必须指向同一 SHA。CAS 不通过就停止。
8. `prepare` 不切流；`activate` 不构建、不取源码、不装依赖，最多 300 秒。失败自动恢复旧 Nginx、Compose 指针和 exact image digests，并执行回滚浏览器验收。
9. 只有公网真实浏览器关键旅程和运行体版本身份都通过，才记录 `production.available_at`。
10. 不在日志、receipt、argv 或 issue 中写密钥、token、用户内容或原始 provider 错误。
11. bootstrap compatibility 构建前检源码入口、输入及只读数据库闭包；构建后检目标镜像入口与同一只读数据库闭包。两次事务均显式 `ROLLBACK`，并在 migration/activate 前完成。
12. 所有 `file:` secret 在激活前逐项验证为 root 私有普通文件，且值不含 CR/LF/NUL；必须对将写入的每个服务 env map 先执行同一个序列化器反证测试。
13. managed-data 的六项 Describe 权限必须在聚合预检中真实调用证明。若使用临时 RAM 策略，策略必须带绝对过期条件，并在 `trap` 中 detach/delete；不能在 activation 中才发现权限缺失。
14. bootstrap 必须可重复执行，并输出稳定、脱敏的失败阶段码。任何一次失败后先证明旧服务可用，再重试；不得靠读取生产日志猜测。
15. 12 个内部稳定密钥属于环境身份，不属于 release 身份。候选版必须复用当前生产的同一稳定目录和同一值；常规发布不得生成、复制替换或轮换它们。

## 执行入口

按 SOP 生成 `schemaVersion=2` 的 prebuild JSON 后，先运行：

```bash
python3 .agents/skills/workspacex-cn-release/scripts/validate_preflight.py preflight.json
```

只有输出唯一一行 `CN_RELEASE_PREFLIGHT_JSON=...` 且 `phase=prebuild`、`ready=true` 时才能开始构建。构建与 seal 后，用完整 prebuild 原始 JSON 及其 `receiptSha256` 生成 preactivate JSON，重新运行同一验证器；只有 `phase=preactivate`、`ready=true` 才能进入激活门。两次证据的 TTL 均不得超过一小时且激活时未过期。发布结束后记录 T0–T9 和实际时长；不要用估算冒充实测。

## 经验回流

同一失败签名第一次出现后，修复 PR 必须同时添加一个能在发布前复现它的 probe/反证测试，并更新本 Skill 的事故表。重复出现同一签名即视为 SOP 缺陷，先修门控再继续常规发布。
