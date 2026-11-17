# A1：只读模型诊断与安全接线

此改动只涉及开发验收工具，不新增服务 API 或产品 UI，不修改任何设计签核。基线 `15ca37c4d`；AIDT 本机 profile 的 Ollama / zero-egress 默认保持不变。`./init.sh` 基础验证由主 Agent 统一运行。

## 在实际持有配置文件的机器上使用

```bash
pnpm real-model:doctor --model-env-file /absolute/path/to/cn.local.env
# 或以现有变量选择文件（相对路径按仓库根解析）
WORKSPACEX_ENV_FILE=/absolute/path/to/cn.local.env pnpm real-model:doctor
```

诊断不发网络请求、不起服务、不写配置、不运行 shell 文件、不连接数据库。输出仅包含字段状态和有界错误类型，不打印密钥、endpoint、model、原始异常或配置行。退出码 `0` 仅表示适合现有 DashScope smoke 的配置结构齐全，`2` 表示缺文件、缺字段或不受支持的结构。`connectivity=not_checked`、`modelAcceptance=not_run` 始终明确保留；非空或格式正确不能证明凭据有效、模型可用或教学质量达标。

公开参数刻意使用 `--model-env-file`：pnpm 9 会提前消费 `--env-file` 并让 Node 装入整个文件，所以不要把该 Node 参数用于此入口。

明确指定的文件缺失或不可读会失败，不偷换另一个文件或环境凭据。未指定文件时沿用默认 `.env.local`；默认文件不存在才检查已经导出的模型变量。此工具不自动搜索 Mac 路径或选择 `cn.local.env`，也不要求将该敏感文件复制进仓库。`cn.local.env` 不保证被现有 gitignore 覆盖，应留在仓库外。

## 白名单及兼容边界

- 支持既有 `DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / DASHSCOPE_MODEL` 三件套。
- 当 `KERNEL_MODEL_PROVIDER=dashscope` 时复用既有映射：`KERNEL_MODEL_API_KEY / KERNEL_MODEL_BASE_URL / KERNEL_DEFAULT_AGENT_MODEL_ID` 填充未设置的 DashScope 字段；显式 DashScope 字段优先。
- `openai-compatible`、OpenAI-only 或 Ollama 配置不属于现有 DashScope smoke 路径；报告 unsupported，不据此声称完成接入。
- 仅支持单行字面量 dotenv 赋值、`export`、单双引号和行注释。模型字段中的 shell 插值、命令替换、反引号、转义和多行结构明确失败。其他部署字段直接忽略且不执行。
- endpoint 必须是无 userinfo、query、fragment 的 HTTPS 地址，拒绝明显回环与 `.invalid` 占位地址。这仍是语法检查，不是网络可达或服务身份认证。

## 显式复用现有真实模型 smoke

在配置实际可读、诊断可通过并准备执行既有隔离全栈验收时：

```bash
pnpm e2e:real-model-smoke:safe --model-env-file /absolute/path/to/cn.local.env
# 同一安全入口可选择既有矩阵
pnpm e2e:real-model-smoke:safe --model-env-file /absolute/path/to/cn.local.env --lane office
```

该入口只把白名单模型字段加入子进程，再调用现有 `with-test-isolation.ts → real-model-smoke.sh → e2e-up.sh`。`WORKSPACEX_MODEL_ENV_ONLY=1` 确保两次 shell loader 都跳过 source 原文件；CN 数据库、端口、生产内部服务和外联 profile 不从文件进入子进程。旧 `e2e:real-model-smoke` 及默认 loader 行为兼容保留；不要用旧入口 source 整份 CN 部署配置。

安全 smoke 额外要求所选配置文件确实可读；仅有已经导出的变量可用于 doctor 结构诊断，不能绕过此安全入口的文件前提。

显式 smoke 会复用既有本地 Docker 栈、隔离数据库种子与真实模型收费请求，不是只读命令；它不部署生产。原工具仍需 Docker、Python deep-agent 依赖及应用构建等前提。调用前须使用干净的开发进程环境；此工具过滤所选文件，并不清洗调用者已导出的所有非模型变量。

## 本轮验收边界

配置测试是无网络、无模型的回归检查，不算真实模型、原生 Chat 或课堂验收。当前云环境尚无实际可读的用户 `cn.local.env`，因此本轮仅能完成安全诊断及接线开发；真实连通与教学场景验收仍阻塞，不使用 fake 模型替代。
