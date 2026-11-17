# 上传配置后的独立真实模型开发验收

2026-11-16。此前 `config-and-desktop-status.md` 的“配置未同步”是当时的只读快照；随后用户上传私密文件，根 Agent materialize 在仓库外。本轮已用同一个安全解析器检查必需字段，未 source 整份文件，未输出或提交任何 key、endpoint、model、代理或原配置内容。

## 已发生的真实事实

- 有界无研究 PII 连通请求：先直接 Node 出网失败，无 HTTP 响应；改用环境已有代理后 HTTP 200，3022ms，回复非空，输入17/输出1/共18 tokens。脱敏结果见 `real-model-connection.json`。这只证明该次真实上游响应，不证明原生 Agent 或教学质量。
- 原生验收栈复用 `with-test-isolation.ts → e2e-up.sh` 的真实 PostgreSQL AGE、Redis、固定镜像 Minio、Node API、技能沙箱及 Python deep-agent；没有替身模型。测试身份来自既有专用 fullstack 种子，不从 CN 文件导入身份、权限或部署环境。
- 六个 AIDT 阶段 Skill 的真实 API 目录读取返回已启用且 currentVersionId 非空；当次32项目录没有 `dt-summarize-project`，该缺口已交给报告模块开发者，不能因 UI 支持挂载就声称该总结 Skill 已安装。
- API、Python deep-agent 与 Web 的就绪探测成功。原生 Chat v2 run、消息持久化、模型行为及 Design 两版实际生成由共享此唯一栈的专门验收场景继续验证；服务就绪不是这些场景通过。

后续新optional summary包完成后，在替代生产模式栈经既有bootstrap真实读取33项目录，`dt-summarize-project` 已启用且当前版本非空，见 `real-summary-skill-presence.json`。前一份32项目录记录保留为修复前事实，不再把目录缺失当作当前状态。

## 明确的开发 opt-in

```sh
pnpm real-model:doctor --model-env-file /private/path/cn.local.env
pnpm aidt:real-model:dev \
  --prebuild \
  --model-env-file /private/path/cn.local.env \
  --work-dir /private/path/aidt-model-acceptance \
  --uvicorn /private/path/python/bin/uvicorn \
  --sandbox-modules /private/path/sandbox/node_modules
```

使用 Node22/pnpm9.15，预先安装项目 Python 锁定依赖与沙箱依赖；`--sandbox-modules` 可省略以复用原 lane 的预装准备。当前开发入口复用已有本机 Docker 镜像，缺镜像会失败，不自动改用另一种数据库。私密工作目录保存专用测试账号、原始服务日志、PID和运行状态，均不应提交或入交付包。启动端口与数据库名由隔离外壳产生，不从上传的 CN 配置读取。

`--prebuild` 是明确的本地生产构建/启动模式：使用现有release顺序编译与单worker配置、4GB Node堆，`next build`成功后才`next start`。它不部署生产。省略该参数仍为开发模式；本轮dev复杂页出现69.7秒冷编译和后续Web退出，cgroup观察到oom_kill=1，因此改用预构建来稳定验收，不靠无界延长超时。构建期间status明确ready=false；冻结源码及暂停其他大测试后才开始构建。

默认诊断不请求模型；显式开发入口允许真实模型调用和费用。每次 completion 最大2048 tokens，原生内核沿用每 run 25次模型调用上限；验收场景另外限制学生发送次数、超时及无自动重试。首次启动仅作服务健康检查，不自动发送收费模型任务。当前环境的 Node 外部模型请求需要环境代理，开发 preload 只对已配置模型的 exact origin 使用现有 ProxyAgent；loopback和其他origin保持原行为。Python沿用已有HTTP客户端代理支持。

此入口**不是** `aidt:local`：没有修改 LocalRuntime `up.ts`、`config.ts`、默认Ollama或zero-egress配置，没有把云key持久化到本机profile。`safe smoke` 仍是独立PDF/Office验收；它不会自动执行六步教学场景。普通AIDT本机启动、真实供应商直连、原生Chat运行和教学人工审阅必须分别报告证据。

## 当前环境适配与回收

为复用既有真栈，仅为 `e2e-up.sh` 增加显式可选的外置uvicorn、沙箱依赖目录、私有log/PID目录与复用缓存镜像开关；旧调用默认路径不变。当前HOME只读，因此Docker配置、uv环境、npm cache和沙箱模块使用scratch私密目录；没有运行pnpm install或重装共享node_modules。启动遇到的seed协作项目字段命名差异仅在开发runner映射既有fixture坐标。

该开发runner持续持有它创建的子进程；收到SIGINT/SIGTERM时停止自己的进程组、仅处理私有目录的PID文件，并对本次隔离compose项目执行down -v。它不部署生产、不连接生产数据库、不读取CN文件里的域名/数据库/端口/权限字段，也不向真实受访者或教师发消息。验收完成后由持有该runner的Agent统一停止，其他验收者不另起第二份栈或杀共享端口。

## 已执行的代码回归

- `node --test scripts/tests/real-model-config.test.mjs`：16/16，新增明确stack opt-in、参数缺失拒绝、子进程白名单与模型exact-origin代理隔离；不调用供应商，不把传输捕获测试当模型验收。
- 原有 `real-model-smoke.test.ts` 与 `real-model-chat-evidence-env.test.ts`：6/6，04:00:37执行，退出0；旧smoke退出码/VM环境装载行为兼容。
- 新runner/preload的 `node --check`、`e2e-up.sh` 的 `bash -n` 与自身改动 `git diff --check` 均退出0。
- 首次真实工作区页面冷编译69.7秒（19680 modules），期间一次login请求65.495秒；API健康50ms。已把冷编译事实交给验收者修正导航等待，不把前端导航超时误报成模型失败，也没有因此重启或换成假模型。

## 首次原生运行揭示的计费回调接线问题

真实S1运行 `4eb4a9ff-6bca-44c9-a5ab-39b2d7584d82` 在adapter dispatch前因 `CREDIT_DISPATCH_ACCOUNTING_UNSUPPORTED` 失败，Python尚未收到模型运行请求。原因是既有e2e-up没有给API配置 `KERNEL_SUBTASK_CALLBACK_BASE_URL`；DeepAgentProvider必须确认该地址及内部key才能启用逐物理请求的计费回执。完整归属与阶段结论见 `native-accounting-preflight-failure.json`。该次只能记录为native尝试，不能记录真实供应商或教学通过。

修复为本次隔离API的回环callback，沿用已有认证与计费机制，没有关闭gate或替换模型。API-only刷新前核对自有进程父链，标准migrate-cli仅对同一隔离测试数据库应用待迁移且退出0，没有reset/reseed或手改业务数据；Web生产构建、账号和失败run保留。由于环境不允许读取/proc/environ，首个只读方案在任何停止动作前失败，随后按私密runtime的isolation seed调用既有deriveTestIsolation重建测试环境；模型仍只读白名单。新API健康5042ms恢复，见 `native-accounting-callback-repair.json`。后续真实run及收费额度仍由验收总账分别记录，不因修复自动当作已通过。
