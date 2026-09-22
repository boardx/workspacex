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
桌面外壳不进登录页，先显示一屏账号密码 + 本次没起来的能力（随时可从「帮助 → 显示本地账号」调回）。

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
./scripts/local-bundle/fetch-models.sh            # 打 DMG 才需要：把聊天/嵌入模型（3.8 GB）导出到 apps/desktop/models 随包，首次启动不联网
```

## 打包（macOS，Night 0 目标）

```bash
./scripts/local-bundle/bundle-python.sh       # apps/desktop/python：可搬迁的 CPython + site-packages（随包进 resources/python）
                                              # ⚠ 不是 prepare-python.sh 的 .venv——venv 写死构建机绝对路径，装到别的 Mac 起不来
./scripts/local-bundle/fetch-ollama.sh        # apps/desktop/bin/ollama
./scripts/local-bundle/fetch-models.sh        # apps/desktop/models（Ollama manifests+blobs，随包 5.2 GB DMG）
NEXT_PUBLIC_API_URL=http://127.0.0.1:3200 pnpm --filter web build   # NEXT_PUBLIC_* 在 build 期烘焙；端口对不上时 `up` 会直接拒绝用这份产物（web-build.ts）
pnpm --filter @repo/desktop dist:mac          # apps/desktop/release/*.dmg（未签名）
```

装到另一台 Mac 的前提：Apple Silicon、≥ 8 GB 内存、≥ 12 GB 空闲磁盘。DMG 自带 Ollama、模型、ASR 模型、Node（Electron）
与 Python，不联网、不装东西。运行时优先用 `resources/python`，没有才回落到开发机的 `.venv`
（`packages/local-runtime/src/config.ts` `resolveDeepAgentLaunch`，启动日志一行 `[deep-agent] python runtime: bundled-python|venv`）。
``````


## 本地版性能相关开关（#3749，全部由 `packages/local-runtime/src/config.ts` 单点产出）

| 环境变量 | 本地值 | 云端默认 | 作用 |
|---|---|---|---|
| `OLLAMA_CONTEXT_LENGTH` / `OLLAMA_KEEP_ALIVE` | 8192 / 24h | — | 随包 Ollama 的上下文与常驻；备用端口上的旧实例启动时重启以应用 |
| `KERNEL_MODEL_STREAM_ENABLED` / `KERNEL_DEEP_AGENT_STREAM_ENABLED` | 1 | 关 | 流式首字 |
| `KERNEL_CANVAS_GUIDANCE_MODE` | matched | all | 只注入消息点名的画布模板；mermaid 规则按图意注入 |
| `KERNEL_MODEL_JSON_SCHEMA` | 1 | 关 | 追问 / 反馈结构化 / 研究方向与大纲走 `response_format: json_schema` |
| `KERNEL_GUIDED_RESEARCH_MODEL_ID` | 聊天模型 | 契约字面量 | 引导式研究实际调用的模型 id |
| `LOCAL_RUNTIME_ENDPOINT` / `LOCAL_RUNTIME_MODEL_ID` | 本机 Ollama / 聊天模型 | 11434 / 空 | 个人本地组织的 `/api/generate` |
| `KERNEL_RERANK_MODE` | embedding | — | 用嵌入余弦重排，不再每次检索调聊天模型 |
| `KERNEL_THREAD_TITLE_MODEL_ID` 等三个 | `qwen3.5:2b` | 主模型 | 标题 / 追问 / 反馈结构化走小模型 |
| `KERNEL_SKILL_CATALOG_MODE` / `_MAX` | matched / 8 | all | 目录只列与消息相关的 skill |

主模型：默认 `qwen3.5:4b`；机器 ≥16 GB 且 `qwen3.5:9b` 已在库里时自动用 9B（`preferredChatModel`，不代为下载）。

### 评测 lane
```bash
API=http://127.0.0.1:3200 PASSWORD=<local/secrets.json adminPassword> AGENT_ID=<默认 agent id> ORG_ID=<org id> \
PG_PORT=55432 DEEP_AGENT_URL=http://127.0.0.1:2024 DEEP_AGENT_KEY=<deepAgentInternalKey> \
node scripts/local-bundle/eval-local.mjs        # SUITE=chat|url|canvas|json|all，OUT=<json>
```
从外部打**安装版**：chat / url / canvas 各 5 题 + 追问、反馈结构化、标题三个 JSON 站点；从 deep-agent 账本取首块延迟与块/s，从线程状态取系统提示长度。结果在 `evidence/local-desktop/eval/`。

## 本地实时转写（ASR）是怎么接的

`apps/local-asr-gateway` 在 `ws://127.0.0.1:3320` 上说与 DashScope 实时接口**一字不差**的
OpenAI-Realtime 风格协议（`session.update` / `input_audio_buffer.append` / `commit` /
`session.finish` → `…transcription.text` / `…transcription.completed` / `session.finished`），
内部驱动 sherpa-onnx 的流式 Zipformer（中英双语，纯 onnxruntime，无 Python）。API 侧零改动：
模型在 `~/.workspacex-local/asr-models/` 时，local-runtime 自动设 `KERNEL_ASR_BASE_URL` 指过去。
兼容性由 `apps/api/tests/recording/local-asr-gateway-compat.test.ts` 用**生产的 provider 类**直连网关钉住。
换引擎（Qwen3-ASR / Whisper）= 在网关里加一个 `Engine` 实现，协议不动。

## 已知偏差（如实登记）

> ⚠ 这一节**不再逐条复述判据**。本地形态与云端形态的差异现在有两份机器可读的单一事实源，
> 它们各自带测试；这里只说哪份管什么，以及三条没法写进代码的偏差。
> （2026-09-21 起；此前这一节自己就是第四份副本，而 `up()` 与 `doctor` 还各自用**字符串
> 前缀**判断一条发现算不算致命——改一句提示语就会改变程序的行为。）

| 问题 | 去哪儿看 |
|---|---|
| API 读的某个环境变量，本地为什么没有？ | `packages/local-runtime/src/parity.ts`（四档闭集；`test/parity.test.ts` 扫 `apps/api/src` 机械核对，漏一个就红） |
| 本地缺哪些能力、为什么、用户能做什么？ | `packages/local-runtime/src/capabilities.ts`（与 parity 双向咬合；`pnpm --filter @repo/local-runtime run doctor` 直接打印本机结果） |

### 写不进代码的三条

- **数据库角色**：pglite-socket 忽略客户端登录角色——`current_user` 是 `app_rw`、RLS 生效，
  但 `session_user` 恒为 `postgres`，`SET ROLE postgres` 不会被拒（真 Postgres 会拒）。
  偏差本身与「API 从不发 `SET ROLE`」这条前提都已写成断言
  （`test/pglite-server.test.ts`、`test/no-set-role.test.ts`）。**仅适用于单用户本机回环，
  不是多机部署形态。**
- **API 启动时的平台 skill 目录自愈**会以 owner 凭据写 `organizations`，在 app 阶段被 RLS 拒绝，
  日志里留一条 `42501`。种子已在 owner 阶段完成，功能不受影响。这条是**噪声**，不是故障；
  没有顺手消掉它，是因为把它静音与掩盖一个真实的权限缺陷在代码里长得一模一样。
- **deep-agent 服务**在本机以 `app_rw` 建自己的表（线程账本 / 检查点 / 记忆 schema），
  owner 阶段给该角色授了 schema 与 database 的 CREATE；这些表不受 RLS 管辖，也不是 API 表。

### 其它已登记项

- 浏览器直连 API（3100 → 3200 跨域）：API 仅在 `KERNEL_CORS_ORIGINS` 列出精确 origin 时开启 CORS，
  本地版列 `127.0.0.1:3100` 与 `localhost:3100`；生产不设该变量，行为不变。
  （云端把 `NEXT_PUBLIC_API_URL` 设成相对路径 `/api`、按浏览器 origin 运行期解析，因而没有这个问题。）
- API 在开发模式会加载仓库根的 `.env.local`；local-runtime 设 `KERNEL_SKIP_LOCAL_ENV_FILE=1` 跳过它，
  并把 `NATIVE_SESSION_*` 钉空——本机不跑 bubblewrap 原生会话（Linux-only），运行走 legacy profile + TCP 沙箱。
- 本地版的 API 以 `NODE_ENV=development` 运行（它从源码跑）。凡是判据写成 `NODE_ENV !== production`
  的逃生口，在这里就只差一个环境变量——所以「这些变量不设」是 `parity.ts` 的 `must-stay-unset` 一档
  加上 `processes.ts` 的父进程过滤，两道都有测试，而不是一句约定。

## 启动时会做什么检查（2026-09-21 起）

| 时机 | 检查 | 不过时 |
|---|---|---|
| 起任何东西之前 | 要绑定的回环端口是否空闲（Ollama 除外：已在跑的会被复用） | 直接失败，并给出换端口的命令 |
| `--web start` 之前 | Web 产物是不是按本次运行的 API 地址构建的 | 直接失败——`NEXT_PUBLIC_*` 是构建期内联的，端口对不上时页面能打开、一个报错也没有，而每个请求都打向旧地址 |
| 每个子进程就绪等待 | 进程死了就立刻失败，并带上它最后 40 行输出 | 不再把就绪预算等满（API 那一条是 180 秒）再报超时 |
| Ollama 就绪后 | 配置的 chat / embedding 模型**真的能回话**（一个 token 的补全 + 一次 embedding） | 不中止启动：没有模型的本地版仍然可用；如实记进能力清单并把服务端原话带给用户 |
| 起来之后 | 任何子进程退出 | 在启动日志里说出来，桌面版弹提示并指向那份日志 |

### 运行期的几条（#3749 实测）

- 沙箱为 L0（子进程，无容器）；LibreOffice / tesseract / ffmpeg 未随附，对应 skill 会报缺依赖。脚本依赖（pptxgenjs 等）必须由 `prepare-sandbox-modules.sh` 装成扁平真实目录（Node 权限模型不认 pnpm 的二级软链），否则 `MODULE_NOT_FOUND`。
- PGlite 只有一个后端会话：所有 TCP 连接串行复用，排队器只在后端答 ReadyForQuery 后换人（Flush/Terminate 没有回复、大结果集跨块，都单独处理）；一条连接正忙时其它连接的 connect 会排队，所以 deep-agent 账本连接超时设 30 s + 2 次重试、run 总超时 15 min。排队器在兜底释放 / 等待超过 3 s 时各打一行诊断（`backend taken from idle connection …` / `waited …ms for the backend`），排查卡顿先看这两种行。
- 本地模型的 thinking 由 `KERNEL_MODEL_REASONING_EFFORT=none` 关闭，只对 **Ollama ≥ 0.34** 的 `/v1` 端点生效（`think:false` 在 `/v1` 上被忽略，实测见 evidence）。启动时若发现已在跑的 Ollama 低于 0.34，且随包二进制更新，会在下一端口自起随包版本；两者都旧则复用并如实警告「回复会慢」。
- 芯片提示词已改为「没聊到的分区按指引推理补全」（与 system prompt 画布指引同向）；小模型在新会话里遇到「留空/不要编造」会反问而不出围栏。
- 图片生成、web_search、浏览器工具、远程 MCP：本地版未配置，UI/API 走各自的「未配置」状态。ASR 见上节。
