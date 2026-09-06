# 新环境从零到能用（bring-up 执行书）

> 面向：要在一台新机器/新客户环境上把 WorkspaceX 跑起来的**人类**（部分步骤必须 root）。
> 判据与纪律见 `.harness/instructions/deployment-verification-standard.md`。
> 本文档只写"做什么、怎么验"，不复述那份标准里的道理。

## 0. 谁做什么（这一节先看，能省掉一整轮来回）

| 步骤 | 谁做 | 为什么不能自动化 |
|---|---|---|
| 装 Docker/Node/pnpm、建用户、写 systemd/Caddy、装特权脚本副本 | **人类，root** | 需要 root；且特权副本若允许 CI 安装，等于任何 PR 都能拿到 root |
| 放部署密钥、放 e2e 测试账号凭据 | **人类** | agent 不经手口令 |
| 建数据库、跑迁移、起服务、构建镜像、冒烟 | 自动（CD） | 已在 `deploy.sh` 里 |
| 后续更新特权脚本副本 | 半自动 | `devapp-install-trusted-scripts.yml` 手动触发（sudoers 白名单已由 provision 装好） |

## 1. 一次性 provision（人类，root，在目标机器上）

```bash
git clone git@github.com:<owner>/<repo>.git /opt/workspacex/app   # 首次
cd /opt/workspacex/app
PUBLIC_DOMAIN=<域名> DEPLOY_KEY_PATH=<部署私钥路径> RUNNER_USER=<CI runner 用户> \
  ./.harness/scripts/vm/provision.sh
```

`provision.sh` 幂等，可重复跑。它做的事与验收信号：

| 它装了什么 | 怎么确认真的成了 |
|---|---|
| app 用户 + 部署密钥 + clone | `sudo -u <app> git -C /opt/workspacex/app fetch origin main` 不报错 |
| `/opt/workspacex/deploy.env`（缺的键逐个补齐，已有值不动） | `grep -c '^DIAG_DB_PASSWORD=' /opt/workspacex/deploy.env` = 1 |
| systemd unit + Caddy | `systemctl is-enabled workspacex-api workspacex-web` |
| 特权脚本副本 + sudoers 两条 | `cat /etc/sudoers.d/workspacex-deploy`，两行都在 |

⚠ **`RUNNER_USER` 必须与真实的 CI runner 用户一致**（默认 `ghrunner`）。写错会把
sudoers 配给一个不存在的用户，症状是部署时 `sudo: I'm sorry ... I can't do that`。

## 2. 放凭据（人类；agent 不经手口令）

| 文件 | 内容 | 谁需要它 |
|---|---|---|
| `/opt/workspacex/deploy.env` | 由 provision 生成/补齐；模型与第三方的 key 由人填 | API / Web / 沙箱 |
| `/opt/workspacex/real-model-e2e.env` | `REAL_MODEL_E2E_EMAIL` + `REAL_MODEL_E2E_PASSWORD`（一个**专用测试账号**，别用真人账号） | 真实模型 e2e 取证通道 |

两个文件都是 `0600`。凭据**刻意不走 GitHub secret**：它们不离开这台机器。

## 3. 首次部署（CD 自动；也可手动触发）

merge 到 `main` 即触发 `backend-gates.yml`，四道门全绿后 `deploy` job 在目标机器上跑
`workspacex-deploy`。也可以 `gh workflow run backend-gates.yml --ref main` 手动来一次。

部署过程内建的验收（任何一条不过就红退，不会"绿着上线"）：

1. 特权副本与仓库逐字节一致 —— 否则报"这台机器上跑的不是本次要部署的那份脚本"；
2. `deploy.env` 必需键点名；
3. `docker compose up -d --build` —— **镜像每轮重建**；
4. 沙箱自检：`docker exec` 进跑着的容器，确认预装库与字体真的在里面；
5. 迁移幂等 + 角色密码对齐；
6. 冒烟：内核自检 + 稳定后置条件复核。

## 4. 就绪核对（人类跑一次，确认这套环境真的能用）

按 `deployment-verification-standard.md` 第二节，**用户可见能力**各跑一条：

```bash
gh workflow run devapp-probe.yml                    # 只读：我在这台机器上能做什么
gh workflow run devapp-sandbox-cjk-pdf-probe.yml    # 线上沙箱真出一份中文 PDF（不需凭据）
gh workflow run real-model-chat-evidence.yml        # 真实模型走完 chat → 产物（需第 2 步的凭据）
```

前两条**不需要任何凭据**，任何时候都能跑。第三条要花模型的钱，按需跑。

## 5. 常见坑（都是 2026-09-06 实测撞到的，不是设想）

| 现象 | 真因 | 修法 |
|---|---|---|
| `git fetch` 报 `Permission denied (publickey)` | 部署密钥在 app 用户下，root 没有 | `sudo -u <app> git fetch` |
| 部署绿，但改动没生效 | 特权脚本副本没更新 | 重跑 provision，或触发 `devapp-install-trusted-scripts` |
| 改了 Dockerfile 但容器行为不变 | `up -d` 不重建已存在的镜像 | 必须 `--build`（已在脚本里） |
| `XXX: unbound variable` | deploy.env 是在该键引入之前生成的 | 重跑 provision（逐键补齐，不动已有值） |
| 沙箱自检报"文件不存在"但构建日志说装好了 | 同一路径声明在 Dockerfile 与 compose 两处 | 删副本，只留镜像 ENV 那一份 |
| 冒烟全绿但用户拿到坏文件 | 验证层级比用户低一层 | 见验证标准第一、二节 |

## 6. 交给新团队时，把这三样一起交

1. 本文档 + `deployment-verification-standard.md`；
2. 谁持有哪些凭据、轮换怎么做（含 `MODEL_CREDENTIAL_KEY` 轮换会让存量加密凭据失效这条）；
3. 上面第 4 节那三条探针 —— 它们是"这套环境到底能不能用"的唯一权威答案，
   比任何部署日志都可靠。
