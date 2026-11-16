# 新上下文桥接真实栈：只读准备

本轮未预约端口、未启动服务、未发送供应商请求。配置检查仅证明字段完整，不证明当前连通或上下文已进入模型。检查回执为 `context-stack-preparation.json`。

## 已存在的前提

- Node 22、pnpm 9.15；使用 `/tmp/aidt-pnpm/store` 和独立 XDG 路径，不安装或重置共享依赖。
- 外置私密配置仍可读，权限 0600；只由 `scripts/real-model-config.mjs` 七字段白名单作为数据解析。
- 已有私密 Python/uvicorn 与沙箱依赖目录可读。旧 stack06 及其第二 Web 已完整清理，旧 runtime 仅保留历史证据，不用于新栈。
- Docker daemon 可达。新目录 `stack-context-01` 尚未创建。

## root 给定固定源码与 green 后的最小入口

以下是本环境工程验收命令，不是用户本机路径或长期在线交付。此处只记录命令，尚未执行。

```bash
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH \
npm_config_store_dir=/tmp/aidt-pnpm/store \
XDG_DATA_HOME=/tmp/aidt-context-xdg \
pnpm run aidt:real-model:dev \
  --model-env-file /workspace/scratch/aidt-private-config-20261116/cn.local.env \
  --work-dir /workspace/scratch/aidt-real-model-20261116/stack-context-01 \
  --uvicorn /workspace/scratch/aidt-real-model-20261116/python/bin/uvicorn \
  --sandbox-modules /workspace/scratch/aidt-real-model-20261116/sandbox/node_modules \
  --prebuild
```

启动前先核对 root 指定 SHA、业务源冻结、当前没有继承的旧完整 isolation 环境。新调用由现有 `with-test-isolation` 进行真实 OS listener 预约和 PID/token ownership；不能复用 stack06 runtime 或猜端口。只有包装器实际打印的新端口可分享给 A6。

入口复用既有离线 Python accounting/proxy/spool doctor，然后使用新合成 Docker 隔离库、正常迁移与种子、原生 Python/API，再单 worker/4GB production Web build/start。模型 max output 2048，callback 只指向新隔离 API；CN 的 DB、域名、端口、权限和部署变量均不导入。普通 `aidt:local` 继续其原有零外部模型默认行为。

ready 需要分别验证 API `/healthz`、Web 登录页及同源 API 路由；私密 `runtime-private.json` 只在 scratch 中供测试读取，不打印身份或配置内容、不入包。先确认新的 summary/focus 目录、计费/spool和课程/原件代理可达，再由 root 分配明确付费 run 数；启动 ready 本身不是模型或教学验收通过。

## 停机与证据

保留原 owner、PID 文件、独立 workdir及 lease；不脱离监督器长期遗留 Web/API。完成所有验收后，先核 active runs=0 和本轮 ownership；若替换过独立进程先停已证明自有的进程，再让 owner 正常中断并确认外层退出 0、own Docker/端口/lease释放。不删除上传私密配置或本机持久基线数据。

## Guarded 交叉审阅进度

- A1 的 prepare/persist/revalidateAccepted 三个事务口未被 Guarded 类型变更改变；最初受理及 replay 继续传入同一 tenant session。
- 新 store 的 `readIn` 返回 `Guarded`，`readScopeIn` 仅返回授权定位所需元数据；claim 不展开正文。
- A5 resolve 成功后才用授权 payload 校验 org/run/project/thread/message/作者与 canonical hashes。其旧 raw fixture 已由 owner 转为真实 guard，后续以 owner sourceReady 为准。
- 已只读核对 A2 provider：`accessIn` 同 session 依次取得 project、organization、org membership、general membership、thread 锁；Stage service 只重入同 project，replay 读取准确旧修订与旧 focus，不读取新 head/活动 mount。`resolve` 在当前授权和 Guarded ref 匹配后才 disclose。此为源码审阅，不代替 A2/A6 实库验证。
- 已请 A2 检查最终纯计算结束后的总时限和 frozen focus 的显式 versionId 守卫，未修改其文件。
- root 已明确窄 transport 语义：fresh 有 selector 的冲突用 AIDT 闭码并实际 HTTP409；旧 AIDT 同 ID 删除 selector 的请求保留普通 Chat 已开 SSE 路径，由 A3 映射为 `RUN_ERROR IDEMPOTENCY_CONFLICT`，不得新 run 或模型调用。A1 已修复两层闭码；不宣称所有方向都是 HTTP409。
