# WorkspaceX Local（桌面 / 单机版）— 开发者运行手册

> 状态：Night 0 alpha（issue #3716，设计见 `docs/proposals/PROP-LOCAL-WORKSPACE-001.md`）。
> 本文只写**实测过的**命令与数字；没测过的标「未测」。

## 这是什么

在一台没有 Docker、没有 Redis、没有外部 PostgreSQL 的电脑上跑完整 WorkspaceX：
PGlite（WASM Postgres + pgvector）当数据库，文件当会话存储，本地文件系统当对象存储，
Skill 沙箱以子进程跑（L0 隔离），模型走本机 Ollama 的 `qwen3.5:4b`。

编排层是 `packages/local-runtime`（纯 Node，CLI 可独立跑）；桌面外壳是 `apps/desktop`（Electron，只做窗口与打包）。

## 开发机上直接跑（不打包）

```bash
pnpm install
# 可选：本机 Ollama（安装后 local-runtime 会自动发现并拉取模型）
# 可选：深度 agent 的 Python 运行时（工具调用 / skill 执行需要它）
./scripts/local-bundle/prepare-python.sh
# 可选：本地实时语音转写模型（录音 / 访谈实时出字需要它；约 300 MB，纯 CPU）
./scripts/local-bundle/fetch-asr-model.sh
# 起全栈；首次会跑 258 条迁移 + 灌种子（平台库 17 个 skill、20 个画布模板、本地账号、默认 agent、本地模型行）
pnpm --filter @repo/local-runtime run up                # 默认数据目录 ~/.workspacex-local，Web 走 next dev
pnpm --filter @repo/local-runtime run up -- --web none  # 只起 API（验证用）
pnpm --filter @repo/local-runtime run doctor            # 硬件 / 工具链自检
```

启动完成后终端打印访问地址与登录账号（`me@local.workspacex` + 首次生成的密码，密码存在数据目录 `secrets.json`，0600）。

## 已实测（2026-09-16，Linux 容器，无 Docker / Redis / Ollama / Python venv）

| 项目 | 结果 |
|---|---|
| PGlite 跑全部迁移 | 258 applied，二次 skipped 258 |
| 平台库种子 | 17 skill pack + 20 画布模板灌入 `org-platform` |
| 本地账号 + 组织 | `provision-admin` 建号；登录时自动建 personal-local 组织 |
| `POST /auth/login`（文件会话存储） | 200，返回 sessionToken |
| `GET /models` | 列出 `qwen3.5-4b`（self-hosted，待测试） |
| `GET /canvas/templates?orgId=…` | 两个组织各可见 20 个模板 |
| Skill 沙箱子进程 | `127.0.0.1:3310` 监听 |
| 模型对话 / 工具调用 / 打 DMG | **未测**（本环境无 Ollama、无 Python venv、无 macOS） |

## 打包（macOS，Night 0 目标；本环境未执行）

```bash
./scripts/local-bundle/prepare-python.sh      # deep-agent-service/.venv
./scripts/local-bundle/fetch-ollama.sh        # apps/desktop/bin/ollama
pnpm --filter web build                       # apps/web/.next（桌面用 next start）
pnpm --filter @repo/desktop dist:mac          # apps/desktop/release/*.dmg（未签名）
```

## 本地实时转写（ASR）是怎么接的

`apps/local-asr-gateway` 在 `ws://127.0.0.1:3320` 上说与 DashScope 实时接口**一字不差**的
OpenAI-Realtime 风格协议（`session.update` / `input_audio_buffer.append` / `commit` /
`session.finish` → `…transcription.text` / `…transcription.completed` / `session.finished`），
内部驱动 sherpa-onnx 的流式 Zipformer（中英双语，纯 onnxruntime，无 Python）。API 侧零改动：
模型在 `~/.workspacex-local/asr-models/` 时，local-runtime 自动设 `KERNEL_ASR_BASE_URL` 指过去。
兼容性由 `apps/api/tests/recording/local-asr-gateway-compat.test.ts` 用**生产的 provider 类**直连网关钉住。
换引擎（Qwen3-ASR / Whisper）= 在网关里加一个 `Engine` 实现，协议不动。

## 已知偏差（如实登记）

- pglite-socket 忽略客户端登录角色：所有连接都是实例打开时的角色。启动分两段：先以 `postgres` 迁移 + 种子，再以 `app_rw` 对外服务；`session_user` 仍是 postgres，`SET ROLE postgres` 不会被拒。仅适用于单用户本机回环，**不是**多机部署形态。
- API 启动时的「平台 skill 目录自愈」以 owner 凭据写 `organizations`，在 app 阶段会被 RLS 拒绝并打一条 `42501` 日志；种子已在 owner 阶段完成，功能不受影响。
- 沙箱为 L0（子进程，无容器）；LibreOffice / tesseract / ffmpeg 未随附，对应 skill 会报缺依赖。
- 图片生成、web_search、浏览器工具、远程 MCP：本地版未配置，UI/API 走各自的「未配置」状态。ASR 见上节。
- deep-agent 服务在本机以 `app_rw` 建自己的表（线程账本 / 检查点 / 记忆 schema），owner 阶段给该角色授了 schema 与 database 的 CREATE；这些表不是 RLS 管辖的 API 表。
