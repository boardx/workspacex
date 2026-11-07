# Sandbox 容量配置与检查

适用于包含 #5966 改动的新镜像；发布状态必须由运行体与当前版本验证，不能从文档推断。机制图、错误语义和交付边界见 [设计说明](../../../docs/design/sandbox-capacity/README.md)。

## 配置入口

默认数值只声明在 [契约 limits](../../../packages/contracts/src/sandbox-session.ts)，服务读取生成契约。用私有 `/capacity` 返回值确认运行时实际限额。

| 环境变量 | 控制内容 |
|---|---|
| `SKILL_SANDBOX_CONCURRENCY` | 本服务同时占用的执行空位 |
| `SKILL_SANDBOX_MAX_QUEUE` | 本服务允许等待的请求数量 |
| `SKILL_SANDBOX_USER_CONCURRENCY` | 同一用户在本服务同时执行的数量 |
| `SKILL_SANDBOX_USER_MAX_QUEUE` | 同一用户在本服务等待的请求数量 |
| `SKILL_SANDBOX_QUEUE_WAIT_MS` | 单次排队最大等待时间；仍受请求自身剩余时限约束 |
| `SKILL_SANDBOX_MAX_SESSIONS` | 原有 Session 数量限制，与执行并发分开 |

新旧部署入口不同：

- 统一云部署生成器、镜像安装模板和 US 模板中的两个 sandbox 服务均加载可选的稳定文件 `/etc/workspacex/sandbox-capacity.env`，文件由 Docker Compose 在宿主读取，无需挂载进不可信执行目录。未创建文件时采用运行时默认值。不要把它放在会被版本切换替换的 release 目录中。
- 旧源码部署 `apps/api/docker-compose.deploy.yml` 从原有 Compose 环境/`deploy.env` 传入这些变量。
- 本地直接启动 Node 服务时，在该服务进程环境配置。只有修改 API 的环境变量不会自动改变另一个 sandbox 容器的环境。

配置样例（是一个保守的试验配置，不是另一份默认值定义，也不是人数容量承诺）：

```dotenv
SKILL_SANDBOX_CONCURRENCY=1
SKILL_SANDBOX_MAX_QUEUE=8
SKILL_SANDBOX_USER_CONCURRENCY=1
SKILL_SANDBOX_USER_MAX_QUEUE=2
SKILL_SANDBOX_QUEUE_WAIT_MS=10000
```

文件只放这些非敏感容量项，不放凭据；权限按本机部署用户限制。修改后需要按该环境的标准发布/重建流程重新创建 sandbox 容器，单纯重启进程或修改文件不会改变已有容器环境。本文不授权发布，也不建议临时编辑活动 Compose 或直接操作生产容器。

空值使用默认值。非法数值、用户额度大于服务额度会使服务启动失败，并返回固定配置错误；不得悄悄回退。执行并发/个人并发上限、队列上限和等待上限的校验见 [capacity-config](../../../apps/skill-sandbox/src/capacity-config.ts)。调大 Session、队列或并发之前同时评估容器 CPU、内存、PID 和临时文件空间；队列会保留请求参数，不是零内存。

## 查看实际容量

Compose 的文件、项目名必须使用当前环境的真实部署指针。通过已有 API 容器的 Socket 挂载读取内部指标，例如：

```bash
docker compose <当前部署参数> exec -T api node -e '
const http = require("node:http");
http.get({socketPath: process.env.NATIVE_SESSION_SOCKET, path: "/capacity"}, response => {
  response.pipe(process.stdout);
}).on("error", () => { process.stderr.write("capacity probe failed\n"); process.exitCode = 1; });
'
```

普通 sandbox 使用 API 环境中的 `KERNEL_SKILL_SANDBOX_SOCKET`。此端点只服务于原有私有 Socket/本地测试通道，不添加 Nginx 公网代理。

返回内容包括实际限额、`active`、`queued`、`completed`、`failed`、`rejected`、`timedOut`、`cancelled`、`totalWaitMs`，不含用户键、令牌、脚本或文件路径。

- `completed/failed` 统计执行回调的完成/异常，不代表脚本退出码或产出物质量。
- `timedOut/cancelled` 计数排队前/排队期间的超时和取消；运行中取消由原命令结果与运行状态判断。
- `totalWaitMs` 是开始执行的命令累计等待时间；当前排队长度与拒绝计数需结合观察，不能只看完成请求的平均等待。
- 计数器随服务重启清零；采集端计算增量时要处理重置。现有 `/healthz` 继续只报告存活，不代表还有执行空位。

## devapp 验证，再推广 CN

1. 先记录当前镜像版本、服务器可用 CPU/内存、容器资源限额与 `/capacity` 返回值。
2. 在 devapp 用独立测试账号混合提交真实 PDF、Office 和数据任务，分别覆盖普通脚本及 Native；先少量并发，再逐步增加到目标的任务到达率。
3. 同时测量排队等待 P50/P95、任务成功率、执行时长、容器内存峰值/PID、OOM 与重启次数，并保留失败样本。不能以“200 个登录连接成功”代替 200 人的实际任务负载验证。
4. 验证超额会返回明确繁忙、取消后没有迟到执行、一个用户不能耗尽所有等待名额、跨组织文件不可见；以同一负载比较变更前后。
5. 当前服务器资源耗尽时，保留排队和拒绝机制。只有压测证明有余量时才增加并发；若等待仍不可接受，增加计算容量属于后续扩容阶段。
6. 将通过的 exact 镜像和经过验证的参数走 CN 标准发布流程。观察无新增失败后再扩大负载，不直接复制 devapp 的人数结论。

并发较高时应保持足够空闲内存；单条脚本仍可能耗尽整个容器的资源。本阶段提供执行准入保护，不能据此宣称已实现逐任务资源隔离或跨机高可用。

## 回滚与排障

先停止提高并发；通过标准发布机制恢复此前已验证的配置或镜像。检查固定容量错误、私有指标、容器 OOM/重启和原运行状态，避免直接收集带用户数据的原始脚本日志。

回滚或重建前停止接收新工作，等待当前执行与有效 Session 结束；不能假定此版本支持跨进程搬迁 Session。重启后的未确认命令不得自动重放。
