# 单机自托管：根 compose 与升级命令

面向在一台机器上自托管开源版 WorkSpaceX 的用户（backlog E7）。

## 组成

- **`compose.yaml`（仓库根）**：只用 `include:` 引用 `apps/api/docker-compose.deploy.yml`，
  也就是生产 `deploy.sh` 起的那一份依赖栈（PostgreSQL + pgvector、MinIO、Redis、两个脚本沙箱），
  项目名同为 `workspacex`。服务定义只写在 app 目录下，根文件不复制。
- **API / Web 是宿主进程**（生产是 systemd 单元 `workspacex-api`），不在 compose 里。
- **不包含**：dev compose（数据在 tmpfs，重启即清库）、内部运营平面
  （`.harness/scripts/lib/ops-plane.mjs`）。受控浏览器（`apps/browser-runtime/docker-compose.browser.yml`）
  是可选组件，和生产一样作为独立项目运行：
  `docker compose -f apps/browser-runtime/docker-compose.browser.yml -p wsx-browser-runtime up -d`。

## 首次启动

```bash
cp selfhost.env.example selfhost.env   # 把每个值换成真实值；selfhost.env 已被 gitignore
export SOURCE_REVISION=$(git rev-parse HEAD)
docker compose --env-file selfhost.env up -d --build --wait
pnpm install --frozen-lockfile
set -a; . ./selfhost.env; set +a
pnpm --filter api exec tsx src/infrastructure/db/migrate-cli.ts
```

`selfhost.env.example` 列出的是必填变量；可选变量（端口等）的默认值见各 compose 文件。
备份要求 `MIGRATION_DB_PASSWORD` 至少 16 个字符。

## 升级

```bash
pnpm selfhost:upgrade -- --env-file selfhost.env --ref v1.2.3   # 或直接 scripts/upgrade.sh
scripts/upgrade.sh --dry-run --env-file selfhost.env           # 只打印要执行的命令
```

执行步骤：
1. 在 `.selfhost/upgrades/<时间戳>/` 记录当前 git 版本和镜像清单；
2. 用 `@repo/cloud-deploy` 的 `starter-backup-cli` 做数据库备份，存到 `.selfhost/backups/<时间戳>/`
   （`--skip-backup` 可跳过，但不建议）；
3. `git checkout --detach <ref>` 后执行 `pnpm install`；
4. 执行 `docker compose pull --ignore-buildable` 和 `up -d --build --wait`；
5. 用与 `deploy.sh` 第 4 步相同的 `migrate-cli` 执行迁移；如果设置了 `APP_DB_PASSWORD`，会同步 `app_rw` 的密码；
6. 执行 `systemctl restart workspacex-api`（`--api-service` 可改名；没有该单元时会提示你手动重启）；
7. 轮询 `http://127.0.0.1:${APP_API_PORT:-3200}/healthz`，最多等 60 秒。

无论成功还是失败，脚本最后都会打印**回滚步骤**：切回旧版本、重建依赖栈，
以及用升级前的备份恢复数据库（迁移只能前进，不能回退）。

## 门控

`pnpm run lint:self-host-compose` 检查：include 非空且每个文件都存在；compose.yaml 没有复制
service 定义；没有引入运营平面或 dev compose；必填变量都在样例 env 中；`upgrade.sh` 语法正确；
本机有 docker compose 时，还会执行 `docker compose config`，否则明确打印 SKIP。
反证测试：`.harness/scripts/lint-self-host-compose.selftest.mjs`。
