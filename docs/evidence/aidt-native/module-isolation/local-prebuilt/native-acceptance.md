# AIDT 本机预构建实测

运行源码候选 `ab4c529551669bbe835de9239adc003682af3073`。**真实构建只执行一次**，退出码 0，耗时 **248.570 秒**；构建前后已存在的 PGlite 全部文件字节摘要相同，没有启动 API／Web／数据库服务。构建中实际 status=0、health=1，phase=building，没有把编译状态当成已启动。

构建后的第一条完整测试因空闲磁盘跌至 11.6GiB，被原有 12GB doctor 拒绝，所以该尝试仍为失败。负责人授权后，仅清理已经退出的我方 `.next-aidt-local/cache`；server、static、receipt、学生数据均未修改。实际检查 receipt 在清理前后 usable=true，receipt 字节不变。

之后**复用同一个成功产物**，独立重新完成两轮生产启动闭环：Playwright **1 passed、exit0**，expected=1、skipped=0、unexpected=0、flaky=0、errors=[]，耗时约 64.15 秒。本轮没有再次构建，也没有将此前失败用例拼成绿色。

## 最终真实行为

- 父进程明确 `NODE_ENV=development`；两次实际 health 均为 `webMode=start`，Web 日志分别 Ready 429ms／368ms，没有 dev 编译回退。包含 PGlite、迁移检查、API 与探测在内，核心就绪实测 13.900 秒／13.719 秒。
- 新登录后真实 UI 创建 AIDT 小组：创建 API 241ms，首次工作区显示 1.144 秒。此前同机 dev 单次测量为 89.522 秒；这是有限场景实测，不是通用性能保证，也不是全新数据目录首次安装基准。
- 第一阶段 V1 经真实“保存到小组”写入；全局成员文字等待服务器 stored 回执。真实 stop 后全部 native 端口释放，pgdata 保留。
- 同 data-dir 重新 start，新 browser context 重新登录，从 UI／HTTP 精确回读同组阶段和成员文字；secrets 未重建，再次正常 stop。
- 最终同一 buildId 仍在，真实 `checkAidtWebBuild` 检查 API／flags／source／runtime artifact 均有效。运行源码 hash 无漂移；复用分支仅改 E2E 文件，该目录被实际 producer 源指纹排除。
- AI、Python 工具循环、ASR 仍如实 unavailable；未下载模型、未用供应商 fixture、未起 Docker／外部 PostgreSQL。截图已实际查看，仅留 scratch，不上传 Library。

## 租约与两次失败

第二个尝试只传原 SEED 重新申请标准租约，但首轮失败的 13 个端口处于 starting quarantine，harness 实际选中了 API24375。receipt 绑定 API24756，明确 guard 在启动服务前拒绝；没有编辑 receipt 或注入旧 lease env。

负责人逐一验证这两次我方 dead-owner／原 token／创建时间窗口、26 端口独占 bind、无 native／output owner 后，才精确清理隔离记录。随后仍通过原标准 wrapper、只传 SEED，真实获取新的 PID／token 租约；实际 API24756／Web25756／PG20756 与 receipt 匹配，才执行最终双循环。未修改 harness、未杀其它进程或改变权限。

最终 13 个租约端口均无监听、advisory lease 目录全部释放，native／output owner 均不存在，持久数据库保留。见 [cleanup.json](final/cleanup.json) 与 [quarantine 清理证明](final/released-owned-quarantine.json)。

## 命令与证据

首次真实构建由既有 opt-in 测试在标准租约内执行：`AIDT_LOCAL_WEB_MODE=start` 时调用 `pnpm aidt:local build`，20 分钟上限、无自动重试，然后两次显式 `start --web start`。

最终复用测试仍是同一套真实浏览器流程；额外设置如下，明确复用证据而非跳过校验：

```sh
export NODE_ENV=development
export WORKSPACEX_ISOLATION_SEED=run-mwhgvwzo-259148c1
export AIDT_LOCAL_WEB_MODE=start
export AIDT_LOCAL_REUSE_BUILD=1
export AIDT_LOCAL_BUILD_EVIDENCE=/workspace/scratch/aidt-local-prebuilt-acceptance/attempt-1/results/native-build.json
export AIDT_LOCAL_BUILD_RECEIPT=/workspace/aidt-module-latest/apps/web/.next-aidt-local/aidt-local-build-receipt.json
export AIDT_LOCAL_DATA_DIR=/workspace/scratch/aidt-local-persistent-acceptance/data
export AIDT_LOCAL_OUTPUT_DIR=/workspace/scratch/aidt-local-prebuilt-acceptance/attempt-3-reuse/results
```

在本环境的 Node22／pnpm9 PATH、已装 Playwright 浏览器下，执行：

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter web exec playwright test \
    --config playwright.aidt-local.config.ts --workers=1
```

这些是内部可复现的测试设置，不是用户工作区入口。用户正常使用 `pnpm aidt:local build` 和 `pnpm aidt:local start --web start`，不需要 E2E 复用开关。

[final/manifest.json](final/manifest.json) 汇总唯一构建结果、独立双循环、source、receipt、清理、原始 JSON 与日志 SHA。[attempts.json](final/attempts.json) 保留两次失败与最终通过的边界。日志仅清 ANSI；本地密码、加密 secrets、会话 token 精确值扫描零命中，未复制账户 data-dir 或 IPC token，trace 关闭。

真实模型／ASR、物理手机、macOS／Windows、课堂负载与多机器协作未验收。没有部署、公共访问或权限变动；最终运行服务已停止，数据库和成功构建仍在本机保留。
