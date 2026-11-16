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

### 可选：预构建后启动

为避免每次进入步骤工作区时现场编译，可先停止本机实例，构建一次，再启动：

```sh
pnpm aidt:local build
pnpm aidt:local start --web start
```

构建本身需要时间；成功后会明确提示 `AIDT build verified`。构建不启动数据库或生成小组，实际账号在首次 start 时初始化。已有成果、附件和密钥不因构建而重置。程序会校验构建使用的 API 地址、功能开关、源码和产物是否匹配；不匹配会拒绝启动并提示重建，不会悄悄退回开发模式。

更改 API 端口时，build 与 start 需使用同一个 `--ports api=...`。更新应用源码或安装不同依赖后需重新 build。默认 `start` 仍为开发模式，便于修改代码；运行 dev 会覆盖同一个 AIDT 专用构建目录，之后使用预构建模式前需要重新 build。不同数据目录也不能同时使用同一份 AIDT 构建目录；请先正常停止原实例，不要手工删除运行中的锁文件。

构建会额外占用磁盘；完成后仍需满足运行器的12GB空闲门槛。若空间不足，确认所有 AIDT dev/start/build 进程已正常停止后，可仅删除 `apps/web/.next-aidt-local/cache` 编译缓存，再启动。保留该目录的其他文件，以及用户主目录 `.workspacex-aidt` 中的小组数据。

回溯修复版 Linux 验收：一次完整构建241.520秒，两次原生服务就绪分别14.165秒、13.869秒；新建小组后进入Dashboard为2.560秒。已验证原生Chat加载、工具切换及刷新保留反思轮次；两次停止均正常退出，重新登录精确读回阶段字段、问题快照、回溯行动、报告和成员消息。另有501项Web与38项本机运行测试通过。这些是隔离环境实测，具体时间随电脑变化，不代表30人课堂性能。

启动窗口需要保持打开。首次迁移与页面编译会比再次启动慢；看到 `AIDT ready` 后，在**这台电脑**的浏览器打开 <http://127.0.0.1:3100/aidt>。该地址仅适用于运行了上述启动工具的电脑。它不是在线演示地址。首次进入复杂工作区需要现场编译，可能等待数分钟；这是源码开发模式的限制，后续使用缓存会快。AIDT 使用独立 `.next-aidt-local` 编译目录，不覆盖普通 WorkspaceX 的 `.next`。

另开一个终端，进入同一源码目录，获取本机账号：

```sh
pnpm aidt:local credentials
```

账号由原生 Local Runtime 创建，首次生成的密码保存在个人数据目录。请仅在自己的终端查看，不要分享密码或 `secrets.json`。

## 更新试用版本

先在旧源码目录执行 `pnpm aidt:local stop`。将新包解压到新文件夹，保留原源码副本及自己的修改，再执行安装、build 和 `start --web start`。默认个人数据目录仍是同一个 `~/.workspacex-aidt`，会重新进入原账号与小组；它独立于解压目录。使用自定义 `--data-dir` 时，新目录的所有命令继续指定原来的完整数据路径。新旧版本按顺序启动，使用各自匹配的构建。

## 健康检查、停止和重启

```sh
pnpm aidt:local status
pnpm aidt:local health
pnpm aidt:local stop
pnpm aidt:local start
```

`status` 查询真实 owner 及本次 HTTP 探测，并显示实际 `webMode`。`health` 只有 API `/healthz` 与 Web `/login` 均返回 200 且 owner 处于 running 时退出 0。它不代表模型或所有业务能力都通过验收，须同时查看 `capabilities` 和 `warnings`。构建中、启动中、断线、停止中或凭据校验失败不会冒充健康。

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

另有 `sh scripts/aidt-local/build.sh` 用于预构建；使用 `sh scripts/aidt-local/start.sh --web start` 启动已验证产物。Windows 的对应文件是 `scripts\aidt-local\build.cmd`、`start.cmd`、`health.cmd`、`stop.cmd`，可从命令提示符执行。脚本会回到源码根目录并调用同一工具。当前运行验证环境为 Linux；macOS 与 Windows 的实机安装和进程生命周期仍待验证。

## 试用顺序

1. 原生登录后打开 AIDT，创建教学小组，进入第一步，填写并保存自己的命题。
2. 打开全局成员文字插件，发送一条文字；查看已发送回执。
3. 浏览六步，核对每步输入、学生确认成果与下一步继承。没有真实材料时保留缺失状态。
4. 停止并重新启动，在同一数据目录登录，确认原小组、阶段正文与文字消息仍在。

此本机回环入口不能供另一台电脑直接加入；跨电脑课堂协作应使用已有授权 WorkspaceX 实例。本轮不开放局域网、不提供公网隧道。

## AI 与其他能力边界

本工具显式启用 AIDT 与成员文字模块，普通启动方式仍默认关闭。原生 Chat、Artifact、Board、Research、Design 使用既有服务；工具不会把未连接的模型或生成服务标成可用。

没有可用本地模型、Python Agent 运行环境或 ASR 时，其状态会显示缺失或不可用，AI 教学对话、图片生成、录音转写不能据此宣称已接通。工具不会自动下载模型，也不会把云端密钥注入本机运行器。需要使用真实模型时，按现有 WorkspaceX Local 配置流程安装与验证；模型质量另行验收。

新增的 `real-model:doctor` 是单独的安全配置诊断，不会把 `cn.local.env` 注入本机 AIDT。持有该文件的电脑可运行 `pnpm real-model:doctor --model-env-file /实际完整路径/cn.local.env`；诊断不发送请求，也不证明连通。后续 `e2e:real-model-smoke:safe` 是需要 Docker/Python 等前提、会发送真实收费请求的独立开发验收，不是这套无需 Docker 的本机启动工具，也不等于六步教学引导已验收。具体方法见 [安全模型配置说明](../evidence/aidt-native/completion-20261116/a1/model-configuration.md)。不要将密钥上传或贴到对话。

共享成果和成员文字无需调用 AI 模型。访谈录音及语音房仍按本轮范围后置；自动图像与静态方案生成受本机现有能力限制，不能用占位结果冒充生成成功。

### 独立工程验收：显式使用云模型

`aidt:local` 使用本机 Ollama 与原有零外部模型配置。把 `cn.local.env` 放在电脑上、执行安全诊断或跑过真实模型 smoke，都不会自动给 `aidt:local` 注入云端 key。`AIDT ready`、API/Web 健康和六步表单可用，也不代表 AI 已连通。

`aidt:real-model:dev` 是**单独的工程验收工具**，用于合成练习材料的真实供应商、原生 Chat 和 Design 验收，不能替代上文交付给学生的持久本机启动方式。它使用隔离 Docker PostgreSQL/Redis/Minio、Python deep-agent 与专用测试账号；退出时清理该次测试栈，不保留为学生的长期小组数据。它需要 Docker、Python 3.11+、uv、Node22/pnpm9.15、项目依赖与沙箱模块，安装和显式模型调用需要联网并可能产生费用。本轮实际运行环境为 Linux，以下 macOS/Linux 工程命令不等于 Mac 实机验收已完成。

先在源码根目录准备工程依赖；已安装的项目依赖不必重复安装：

```sh
pnpm install --frozen-lockfile
UV_PROJECT_ENVIRONMENT="$HOME/.cache/workspacex-aidt-python" \
  uv sync --project apps/deep-agent-service --frozen --no-dev
sh scripts/local-bundle/prepare-sandbox-modules.sh
docker compose -f apps/api/docker-compose.dev.yml build postgres
docker compose -f apps/api/docker-compose.dev.yml pull redis minio
```

配置文件留在仓库外，替换为你自己的实际完整路径；不要照搬开发云环境的 scratch 路径：

```sh
pnpm real-model:doctor --model-env-file "/你自己的私密目录/cn.local.env"

# doctor 仅检查结构；ready 后，显式启动独立工程验收栈。
# 每次使用新的工作目录，不能与正在运行的验收栈共用。
pnpm aidt:real-model:dev --prebuild \
  --model-env-file "/你自己的私密目录/cn.local.env" \
  --work-dir "$HOME/.workspacex-aidt-real-model-$(date +%Y%m%d-%H%M%S)" \
  --uvicorn "$HOME/.cache/workspacex-aidt-python/bin/uvicorn"
```

doctor 不发模型请求；显式开发入口只导入模型白名单字段，不执行配置里的 shell 表达式，不导入其中的生产数据库、站点域名、应用端口或权限配置。当前仅支持既有 DashScope 路径，其他 provider 会明确报不支持。参数必须是 `--model-env-file`，不要使用会被 pnpm 提前装载整份文件的 `--env-file`，也不要 `source` 整份 CN 部署配置。

`--prebuild` 先执行受限内存、单 worker 的本地生产构建，成功才 `next start`；它不部署生产。保持启动终端打开，等它输出 `ready: true` 后再使用输出的本机 Web 地址。该工程栈端口由隔离工具产生，**不要固定使用**持久本机入口的3100端口。构建期间不会自动发送收费模型任务；后续界面操作是否成功调用供应商，要检查真实 run、消息和产物，不能由配置 ready 推断。

两种运行工具的控制路径分开：

| 操作 | `aidt:local` 持久本机 | `aidt:real-model:dev` 工程验收 |
|---|---|---|
| 启动 | `pnpm aidt:local start`；已 build 后可用 `start --web start` | 上述显式命令，不复用持久小组目录 |
| 状态与健康 | `pnpm aidt:local status`、`pnpm aidt:local health` | 查看所选 `--work-dir/status.json` 的 ready、API/Web地址；在自己的终端对 API地址加 `/healthz`、Web地址加 `/login` 作 HTTP200 检查。服务健康仍不代表教学行为通过 |
| 账号 | `pnpm aidt:local credentials` | 所选 `--work-dir/runtime-private.json` 内的专用测试账号，仅在自己的电脑查看，不分享、提交或上传 |
| 停止 | 相同 `--data-dir` 的 `pnpm aidt:local stop` | 在持有工程栈的启动终端按 Ctrl-C，由它清理本次隔离栈；`aidt:local stop` 不控制它 |

工程工作目录里的账号、原始服务日志和运行文件均属私密验收材料，不入交付包；不要把真实受访者材料放入测试。默认本机功能、真实供应商连通、原生 Agent 运行、Design 文件真实性与教学人工审阅分别验收。独立 `e2e:real-model-smoke:safe` 仍用于既有 PDF/Office smoke，不会自动运行六步或总结报告场景。

需要实际收费模型验证时，工程种子已有测试余额的身份在私密文件的 `fundedAdminEmail`／`fundedAdminPassword`；它用于技术验收，并不代表学生或教师的权限。普通合成账号自己的钱包可能仍为0，本轮也实际读到该状态；不能据技术管理员成功宣称学生已具备模型额度或课堂可免配置使用。工具不会自动充值、升级计划或修改角色。真实学生资金与权限前提应另行核对。

## 常见问题

- **连接被拒绝**：确认启动窗口仍在运行；执行 health。未看到 ready 或 API/Web 探测失败时，检查 `~/.workspacex-aidt/logs` 和启动日志。
- **第二次启动提示目录已有 owner**：不要重复启动。先用相同目录运行 status/stop，回到原启动窗口正常停止。
- **电脑异常断电后 owner unreachable**：工具会拒绝不确定的进程接管，不会按旧 PID 杀进程。确认原进程及所有本机子服务均已退出后，保留整个数据目录并人工检查 `run/aidt-owner.json` 与原生日志；不要删除 pgdata、objects、sessions 或 secrets 来“修复”。此首版没有自动崩溃接管命令。
- **端口冲突**：使用 `--ports` 指定未占用端口，工具不会清理其他应用。AIDT 不重启无法证明所有权的 Ollama 备用实例。
- **AI 不回答**：先查看 capabilities；Web/API 健康不等于模型已安装、已配置或已通过真实调用。
- **停止后找不到成果**：确认重启时使用相同用户与相同 `--data-dir`，不要更换目录或覆盖密钥文件。

初始依赖安装在不同操作系统上的可用性取决于包源和本机环境；本次交付的已执行命令与真实浏览器证据见 `docs/evidence/aidt-native/module-isolation/local-runtime/`。

## V2 学习闭环试用

当前验收结论见 `docs/evidence/aidt-native/completion-20261116/acceptance-boundaries.md`。原生教学上下文桥接已获用户批准并实现：浏览器在 `forwardedProps.aidtContext` 中只传精确版本坐标，服务端核权限并冻结保存版本，原生学生消息保持原文。来源回执分别显示材料已固定、输入已组装及实际派发；页面预览不能代替运行回执。真实PG/本机HTTP适配集成22项通过；新构建真实浏览器已通过queued受理、独立HTTP回执、折叠/展开和取消检查（供应商调用0）；六步及总结的完整真实模型与课堂验收尚未通过。可先验证输入、共享保存、课程入口、成员文字、材料与打印，使用合成材料练习。

此包按用户直接提供的 Markdown（FR15–19）更新，不按旧 PDF。进入 AIDT 专用入口，创建或打开所属小组；成员文字沟通继续使用页面全局聊天入口。六步中的 AI 对话复用原生 Chat。

1. 第1步“本步成果”：填写初始命题、为什么值得研究、观察/抱怨/猜测来源及说明，核对后确认，再“保存到小组”。猜测不会标成已验证。
2. 第3步：在画像前选择有材料支持的意外发现，或选“暂无”。“暂无”可以直接确认并保存，不需要补造材料。
3. 第4步：先写点子，再用三个分类多选标签并说明理由。确认分类与拟选择候选互不替代；描述单仍要求三个不同点子，图像应使用已上传材料，打印预览可另存PDF。
4. 第5步：填写并确认本轮最想知道的问题，再打开原生Design。填写实际被测原型及版本引用、先前看法和验证边界，然后共享保存。编辑问题会撤销原确认。
5. 第6步：主动带入第5步**已保存**的问题和原型引用。后续第5步更新不会替换本轮快照。记录真实测试材料、前后认识（可未改变或证据不足）、返回1至5哪一步及理由行动，或暂未决定并写明所需支持。返回前四步无需新版原型。
6. 确认并保存本轮记录后，可带着反思返回对应阶段，也可明确开始下一轮测试草稿；已保存记录在“查看本步历史版本”中浏览，其他阶段与旧原型保留。最后生成、审阅并保存小组报告，缺失项保留。

新建教学对话使用已安装的阶段Skill。旧会话保留原来的固定版本；若实际目录有新版，宿主提供“使用新版另开本步对话”，原对话与未发送内容不覆盖。只有新线程挂载回读成功才可打开。

这些步骤验证学生输入、记录、共享保存与学习回溯。真实模型生成、静态原型生成质量、原型引用所指文件真实性、访谈录音与转写、30人课堂仍需独立验收。原生Design支持已有服务，教学表单的问题/版本引用不伪装成新增后端原型绑定契约；真实来源与访问权限由原服务核对。

## 小组引导行为的额外验收

本轮额外提供8个双轮引导场景（强势成员、创意卡住、决策僵局、冲突与证据、AI草稿审阅、真实共情、隐私退出、包容性HMW），详见根目录下 `docs/evidence/aidt-native/facilitation-acceptance/README.md`。它们复用原生Chat和现有真实模型通道，需要先配置受控本机模型/Agent与专用测试账号；默认不付费运行。当前只有目录/采集器准备与未配置路径检查通过，真实模型行为仍未验收，不以2项skip或35项定向代码测试当作引导质量通过。现有V2界面、服务契约与已发布Skill保持原样。

## 本轮新增功能的试用入口

- 从第6步已保存的历史反思返回1–5步时，原生 Chat 可展开查看同一旧版的学习记录；读取失败有重试，不会用最新反思替换旧轮次。
- 报告页先读取历史学习记录，再勾选审阅并追加章节。读取和追加不会自动共享保存；仍须主动保存。历史最多每步10份，读取失败或超出范围会标明，不称完整课程档案。
- 第5、6步可以从本组已关联、当前账号有原生访问权的 Design 中选择实际版本；加载和选择均会重读核对。手工填版本仍是学生记录，不升级为文件真实性或测试成功。第6步保存的问题快照不会被新版第5步覆盖。
- 在第5或6步打开关联的原生Design后，先读取已保存的制作说明，点击“带入制作说明到输入框”，自行审阅、修改后发送。说明包含入选描述单、HMW、验证问题与前看法；旧轮次不换成最新问题。已有输入不会被覆盖，读取失败或撤权会阻止此教学入口的新生成。图片引用只是文字，视觉参考图仍需通过原生Design上传。
- 成员文字聊天支持主频道和单层话题回复。已发送内容持久保存；关闭插件、换步再打开会保留当前页面会话内的频道与话题草稿。刷新、退出或浏览器重启后的未发草稿不在保留承诺内。

本轮工程反馈与能力边界见 `docs/evidence/aidt-native/completion-20261116/`。其中真实模型、模型生成的图片或原型质量、Mac/Windows实机和30人课堂验收各自记录，不能以Linux页面与保存通过替代。
