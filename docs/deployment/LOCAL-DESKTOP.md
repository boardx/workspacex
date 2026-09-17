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
| 模型对话 / 工具调用 / 打 DMG | 见下节 Mac 实测 |

## 已实测（2026-09-17，Apple Silicon Mac，本机 Ollama `qwen3.5:4b`）

完整记录与逐模板数据见 `evidence/local-desktop/mac-e2e-2026-09-17.md`；根因与修法见 issue #3716 评论。

| 项目 | 结果 |
|---|---|
| 全栈拉起 | ~75 s 就绪（含 ASR 网关、deep-agent） |
| 聊天（本地模型真实回复） | 一句话自我介绍 73 s（Ollama 直连约 39 s，含 thinking） |
| 本地实时转写 | 网关直推真实中文语音：0.8 s 首个 partial，8 s final 与原句逐字一致；API 生产 provider 真实模型车道 1/1 |
| 录音页麦克风 | **未测**（内置浏览器禁麦克风，需人类实测） |
| 画布模板 | **20/20** 在聊天里生成并出围栏（单个 21 s–637 s，个别要点一次意图/权限确认） |
| pptx skill | 沙箱 + 预装模块链路通（直连沙箱 59 KB 真文件）；聊天里 4b 模型 0/3 拿到文件（`call_skill` 参数反复错），换更大模型再测 |
| DMG | 见 evidence 文件末尾 |

必须先跑的准备脚本（少一个就少一项能力，启动日志会如实警告）：
```bash
./scripts/local-bundle/prepare-python.sh          # deep-agent 运行时
./scripts/local-bundle/prepare-sandbox-modules.sh # pptx/docx/xlsx/pdf skill 的预装模块（扁平 npm ci，随 apps/skill-sandbox/** 进 DMG）
./scripts/local-bundle/fetch-asr-model.sh         # 本地实时转写模型
./scripts/local-bundle/fetch-ollama.sh            # 打 DMG 才需要
```

## 打包（macOS，Night 0 目标）

```bash
./scripts/local-bundle/prepare-python.sh      # deep-agent-service/.venv
./scripts/local-bundle/fetch-ollama.sh        # apps/desktop/bin/ollama
NEXT_PUBLIC_API_URL=http://127.0.0.1:3200 pnpm --filter web build   # NEXT_PUBLIC_* 在 build 期烘焙，端口须与运行时一致
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

- 浏览器直连 API（3100 → 3200 跨域）：API 仅在 `KERNEL_CORS_ORIGINS` 列出精确 origin 时开启 CORS，本地版列 `127.0.0.1:3100` 与 `localhost:3100`；生产不设该变量，行为不变。

- API 在开发模式会加载仓库根的 `.env.local`；local-runtime 设 `KERNEL_SKIP_LOCAL_ENV_FILE=1` 跳过它，并把 `NATIVE_SESSION_*` 钉空——本机不跑 bubblewrap 原生会话（Linux-only），运行走 legacy profile + TCP 沙箱。

- pglite-socket 忽略客户端登录角色：所有连接都是实例打开时的角色。启动分两段：先以 `postgres` 迁移 + 种子，再以 `app_rw` 对外服务；`session_user` 仍是 postgres，`SET ROLE postgres` 不会被拒。仅适用于单用户本机回环，**不是**多机部署形态。
- API 启动时的「平台 skill 目录自愈」以 owner 凭据写 `organizations`，在 app 阶段会被 RLS 拒绝并打一条 `42501` 日志；种子已在 owner 阶段完成，功能不受影响。
- 沙箱为 L0（子进程，无容器）；LibreOffice / tesseract / ffmpeg 未随附，对应 skill 会报缺依赖。脚本依赖（pptxgenjs 等）必须由 `prepare-sandbox-modules.sh` 装成扁平真实目录（Node 权限模型不认 pnpm 的二级软链），否则 `MODULE_NOT_FOUND`。
- PGlite 只有一个后端会话：所有 TCP 连接串行复用，排队器只在后端答 ReadyForQuery 后换人（Flush/Terminate 没有回复、大结果集跨块，都单独处理）；一条连接正忙时其它连接的 connect 会排队，所以 deep-agent 账本连接超时设 30 s + 2 次重试、run 总超时 15 min。排队器在兜底释放 / 等待超过 3 s 时各打一行诊断（`backend taken from idle connection …` / `waited …ms for the backend`），排查卡顿先看这两种行。
- 芯片提示词已改为「没聊到的分区按指引推理补全」（与 system prompt 画布指引同向）；小模型在新会话里遇到「留空/不要编造」会反问而不出围栏。
- 图片生成、web_search、浏览器工具、远程 MCP：本地版未配置，UI/API 走各自的「未配置」状态。ASR 见上节。
- deep-agent 服务在本机以 `app_rw` 建自己的表（线程账本 / 检查点 / 记忆 schema），owner 阶段给该角色授了 schema 与 database 的 CREATE；这些表不是 RLS 管辖的 API 表。
