# 在自己的电脑试用 AIDT

这是一套 WorkspaceX 原生本机运行工具，数据不会在测试窗口结束后失效。首次安装依赖需要网络；运行时不要求 Docker、外部 PostgreSQL、Redis 或额外通话服务器。所有应用服务监听本机回环地址，供当前电脑试用。

## 准备

安装 Node.js 22 与 pnpm 9.15。现有 Local Runtime 的硬件检查要求至少 8GB 内存、12GB 可用磁盘；依赖安装、页面编译及可选模型还会占空间，请预留余量。

在交付源码的根目录打开终端，首次运行：

```sh
pnpm install --frozen-lockfile
pnpm aidt:local doctor
pnpm aidt:local start
```

启动窗口需要保持打开。首次迁移与页面编译会比再次启动慢；看到 `AIDT ready` 后，在**这台电脑**的浏览器打开 <http://127.0.0.1:3100/aidt>。该地址仅适用于运行了上述启动工具的电脑。它不是在线演示地址。

另开一个终端，进入同一源码目录，获取本机账号：

```sh
pnpm aidt:local credentials
```

账号由原生 Local Runtime 创建，首次生成的密码保存在个人数据目录。请仅在自己的终端查看，不要分享密码或 `secrets.json`。

## 健康检查、停止和重启

```sh
pnpm aidt:local status
pnpm aidt:local health
pnpm aidt:local stop
pnpm aidt:local start
```

`status` 查询真实 owner 及本次 HTTP 探测；`health` 只有 API `/healthz` 与 Web `/login` 均返回 200 且 owner 处于 running 时退出 0。它不代表模型或所有业务能力都通过验收，须同时查看 `capabilities` 和 `warnings`。启动中、断线、停止中或凭据校验失败不会冒充健康。

停止也可以在启动窗口按 Ctrl-C。工具仅通过私有本机 IPC 请原启动进程停止自己创建的服务，不根据 PID 或端口去杀别人的服务。停止不会删除小组、成果、消息、附件或账号。

若在首次迁移、模型预检或服务就绪等待期间请求停止，原生启动流程需要先返回才能清理；窗口会明确显示等待提示，可能持续数分钟。stop 命令等待两分钟仍无法确认时退出失败，不表示数据或服务已删除。保持启动窗口打开并检查后续结果。停止异常时保留 owner，健康检查不会报成已停止；首版没有强制终止或自动接管功能。

默认持久目录为 `~/.workspacex-aidt`，与普通 WorkspaceX Local 的 `~/.workspacex-local` 分开。Windows 下 `~` 表示当前用户主目录。保持数据目录不变即可重新进入原账号与小组。

可显式指定目录或端口；后续每条命令都使用**同一数据目录**：

```sh
pnpm aidt:local start --data-dir ./aidt-data --ports web=3110,api=3210
pnpm aidt:local health --data-dir ./aidt-data
pnpm aidt:local credentials --data-dir ./aidt-data
pnpm aidt:local stop --data-dir ./aidt-data
```

以上示例浏览器地址改为 `http://127.0.0.1:3110/aidt`。以启动窗口或 status 实际返回地址为准。不要使用生产数据库目录。

## 启动文件

macOS/Linux 可在源码根目录执行：

```sh
sh scripts/aidt-local/start.sh
sh scripts/aidt-local/health.sh
sh scripts/aidt-local/stop.sh
```

Windows 的对应文件是 `scripts\aidt-local\start.cmd`、`health.cmd`、`stop.cmd`，可从命令提示符执行。脚本会回到源码根目录并调用同一工具。当前运行验证环境为 Linux；macOS 与 Windows 的实机安装和进程生命周期仍待验证。

## 试用顺序

1. 原生登录后打开 AIDT，创建教学小组，进入第一步，填写并保存自己的命题。
2. 打开全局成员文字插件，发送一条文字；查看已发送回执。
3. 浏览六步，核对每步输入、学生确认成果与下一步继承。没有真实材料时保留缺失状态。
4. 停止并重新启动，在同一数据目录登录，确认原小组、阶段正文与文字消息仍在。

此本机回环入口不能供另一台电脑直接加入；跨电脑课堂协作应使用已有授权 WorkspaceX 实例。本轮不开放局域网、不提供公网隧道。

## AI 与其他能力边界

本工具显式启用 AIDT 与成员文字模块，普通启动方式仍默认关闭。原生 Chat、Artifact、Board、Research、Design 使用既有服务；工具不会把未连接的模型或生成服务标成可用。

没有可用本地模型、Python Agent 运行环境或 ASR 时，其状态会显示缺失或不可用，AI 教学对话、图片生成、录音转写不能据此宣称已接通。工具不会自动下载模型，也不会把云端密钥注入本机运行器。需要使用真实模型时，按现有 WorkspaceX Local 配置流程安装与验证；模型质量另行验收。

共享成果和成员文字无需调用 AI 模型。访谈录音及语音房仍按本轮范围后置；自动图像与静态方案生成受本机现有能力限制，不能用占位结果冒充生成成功。

## 常见问题

- **连接被拒绝**：确认启动窗口仍在运行；执行 health。未看到 ready 或 API/Web 探测失败时，检查 `~/.workspacex-aidt/logs` 和启动日志。
- **第二次启动提示目录已有 owner**：不要重复启动。先用相同目录运行 status/stop，回到原启动窗口正常停止。
- **电脑异常断电后 owner unreachable**：工具会拒绝不确定的进程接管，不会按旧 PID 杀进程。确认原进程及所有本机子服务均已退出后，保留整个数据目录并人工检查 `run/aidt-owner.json` 与原生日志；不要删除 pgdata、objects、sessions 或 secrets 来“修复”。此首版没有自动崩溃接管命令。
- **端口冲突**：使用 `--ports` 指定未占用端口，工具不会清理其他应用。AIDT 不重启无法证明所有权的 Ollama 备用实例。
- **AI 不回答**：先查看 capabilities；Web/API 健康不等于模型已安装、已配置或已通过真实调用。
- **停止后找不到成果**：确认重启时使用相同用户与相同 `--data-dir`，不要更换目录或覆盖密钥文件。

初始依赖安装在不同操作系统上的可用性取决于包源和本机环境；本次交付的已执行命令与真实浏览器证据见 `docs/evidence/aidt-native/module-isolation/local-runtime/`。
