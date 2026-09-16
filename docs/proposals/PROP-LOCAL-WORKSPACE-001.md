# PROP-LOCAL-WORKSPACE-001 — WorkspaceX Local：一键安装、本机运行的桌面发行版

> 状态：**提案，待人类批准后执行**（2026-09-16）。
> 目标读者：批准人（usamshen）+ 执行本提案的 agent。
> 本文只做设计；批准后按第 8 节的分阶段计划开 issue / 分支 / PR 执行。

---

## 0. 一句话

把 **WorkspaceX 现有的 API + Web + 深度 agent 运行时 + 17 个 skill + 20 个画布模板 + 45 个原生工具**
打成一个 Mac / Windows 安装包；安装后在本机拉起千问 **qwen3.5:4b**（Ollama 运行时），
不注册、不付费、不出网就能用；需要云端能力时再登录账号连接 WorkspaceX 云。

---

## 1. 现状盘点（勘探结论，全部有代码出处）

### 1.1 已经具备、可直接复用的

| 能力 | 现状 | 出处 |
|---|---|---|
| 模型接入 | 唯一通用适配器是 **OpenAI 兼容 `/chat/completions`**，靠 `KERNEL_MODEL_BASE_URL/API_KEY/ID/PROVIDER` 四个 env 指向任意端点；Bailian 专有扩展遇到非 DashScope 域名自动关闭 | `apps/api/src/infrastructure/agent-run/configured-model-provider.ts` |
| 本地模型/零出网 | 已有 **personal-local 组织**（F16）：`LOCAL_RUNTIME_ENDPOINT` 默认 `http://127.0.0.1:11434`（Ollama），非回环地址启动即拒；进程级 egress guard 保证该组织的请求不出本机 | `infrastructure/identity/http-local-model-runtime.ts`、`infrastructure/egress/local-egress-guard.ts`、`packages/contracts/src/identity.ts`（`OrgKind = personal-local`） |
| 本地模型种子 | 模型池已有 `qwen3.5-4b` 自托管种子（`http://localhost:11434/v1`） | `apps/api/scripts/lib/local-models.ts` |
| 机密路由 | 含机密内容的轮次只允许 `self-hosted` 模型，不回退云端 | `domain/model/route-call.ts` |
| 画布模板 | 20 个内置模板全在代码里（`BUILTIN_CANVAS_TEMPLATES` + `packages/fabric-markdown` 的 TemplateSpec），迁移刻意**不种**，靠 `backfill-canvas-builtin-templates.ts` / `backfill-platform-org.ts` 一次性灌入；前端 fabric 渲染离线可用 | `packages/contracts/src/canvas.ts`、`apps/api/scripts/backfill-*.ts` |
| Skills | 9 个 starter pack / 17 个 skill 以签名 JSON 形态随仓库发布，`FileSkillStarterPackSource` 从磁盘读，幂等导入平台组织 | `skills/starter-packs/`、`infrastructure/skill/ensure-standard-skill-packs.ts` |
| 工具 | 45 个原生工具单源在 `NATIVE_PROFILE_TOOLS`，跨语言产物 `native_profile_tools.json` | `application/agent-run/native-invocation.ts` |
| 深度 agent | Python LangGraph 服务，用**同一组** `KERNEL_MODEL_*` env，自带 `Dockerfile`/`uv.lock`；embedding / rerank 也经它走 OpenAI 兼容端点 | `apps/deep-agent-service/` |
| 对象存储 | **本地文件系统适配器是默认值**（`WORKSPACEX_OBJECT_STORE` 未设且非云 profile → `fs`），不需要 MinIO | `packages/cloud-deploy/src/storage-config.ts`、`infrastructure/storage/fs-object-store.ts` |
| 前端离线 | Monaco / mermaid / fabric 都已自托管进 `public/`，不依赖 CDN | `apps/web/next.config.mjs` |
| 免注册 | `WORKSPACEX_DEV_MODE=1` 预置账号；personal-local 组织本身就是"个人本地"语义 | `packages/dev-mode-accounts`、`local-org.controller.ts` |

### 1.2 本地化的硬障碍（必须解决）

| 障碍 | 现状 | 本提案的解法 |
|---|---|---|
| **PostgreSQL + pgvector** | 强制依赖，258 条迁移，RLS 依赖"应用连接不是表 owner"多角色 | 见 §3.2：首选 PGlite（内建 pgvector，零原生二进制）+ `pglite-socket` 暴露 pg 线协议；兜底方案是随包分发 PG16 二进制 + pgvector |
| **Redis** | 会话令牌存储硬依赖，无 Redis → 503 `auth_unavailable`，真实组合里没有内存实现 | 新增 `SessionTokenStore` 的**文件/内存实现**（应用层端口已存在，只加一个 infrastructure 适配器 + env 开关 `KERNEL_SESSION_STORE=memory`） |
| **Skill 沙箱** | 真实隔离靠 Docker（network none / read-only / seccomp）；镜像内含 LibreOffice / tesseract / ffmpeg / Python 科学栈 | 桌面版走**子进程模式**（沙箱 `src/main.ts` 直接以受限子进程跑，L0 隔离，复用 `loopback-skill-sandbox.ts` 的接线）；LibreOffice/tesseract/ffmpeg 作为**可选扩展包**后装 |
| **工具调用在 Python 侧** | TS 适配器已移除 tools，工具循环全在 deep-agent-service | 桌面包**必须带** Python 运行时（python-build-standalone + uv 同步的 site-packages）；否则聊天有回复但没有任何工具/skill |
| **Docker 假设** | `KERNEL_SKILL_SANDBOX_SOCKET`（unix socket）、browser-runtime、MCP 执行器都假设容器 | Windows 走 `KERNEL_SKILL_SANDBOX_BASE_URL`（TCP 回环）；browser-runtime / 远程 MCP 第一版**明确不可用**（UI 上灰掉，不是静默失败） |
| **供应商形态的能力** | 视觉抽取（DashScope 原生接口）、ASR（DashScope WebSocket）、图片生成（Bailian/OpenAI）、web_search（`web-search.boardx.us`） | 第一版全部标为"本地版不可用 / 连接云端后可用"；后续用 whisper.cpp（ASR）、qwen3.5:4b 自带视觉（agent-run 路径已是 OpenAI 兼容）逐项本地化 |

### 1.3 已被上一份计划验证过的方向

`docs/deployment/self-host-refactor-plan.md` 的阶段 0（必需 env 收敛为单一清单）与阶段 1
（API/Web 容器化）**尚未落地**（仓库里没有 `apps/api/Dockerfile`、`setup.sh`、`docker-compose.selfhost.yml`）。
桌面版不走 Docker，但阶段 0 的"必需 env 单一清单"正是桌面版启动器要读的同一份事实，本提案把它一并落地，不再第三处复述。

---

## 2. 目标用户体验（终端用户视角）

```
官网下载  →  双击安装（DMG / NSIS exe）  →  首次启动
   ├─ 硬件自检：内存 / 磁盘 / GPU（不达标就明说缺什么，不硬跑）
   ├─ 模型就位：包内自带 qwen3.5:4b（"完整包"）或后台下载（"精简包"，带进度条、可断点）
   ├─ 本地服务拉起：PG → API（跑迁移 + 灌种子）→ deep-agent → Web
   └─ 自动创建"我的本地工作区"（personal-local 组织 + 本地账号，无需注册）
→ 打开主窗口，直接开聊 / 套画布模板 / 跑 skill，全程不出网、不付费
→ 侧栏「连接 WorkspaceX 云」：登录账号 → 解锁云端模型、多人协作、云备份（商业模式入口）
```

**硬件门槛**（qwen3.5:4b，Q4_K_M ≈ 2.5–3 GB 权重；Ollama 自动识别 GPU）：

| 档位 | 内存 | 磁盘 | GPU | 体验 |
|---|---|---|---|---|
| 最低 | 8 GB | 12 GB 空闲 | 无（CPU AVX2） | 能用，约 5–10 tok/s |
| 推荐 | 16 GB | 20 GB | Apple M1+ / NVIDIA ≥ 6 GB 显存 | 流畅，30+ tok/s |

磁盘构成：应用 ≈ 600 MB + Python 运行时 ≈ 400 MB + 模型 ≈ 3 GB + 数据增长；可选扩展包（LibreOffice/OCR/ffmpeg）另 +1.5 GB。

---

## 3. 系统设计

### 3.1 进程拓扑（一台机器上）

```
WorkspaceX Local（Electron 主进程 = 服务监督器 + 托盘 + 主窗口）
 ├─ ollama serve                 127.0.0.1:11434   （随包二进制；模型 qwen3.5:4b）
 ├─ postgres（PGlite socket 或 PG16 二进制） 127.0.0.1:55432
 ├─ api（NestJS, node）          127.0.0.1:3200    fs 对象存储 → ~/WorkspaceX/objects
 │    └─ skill-sandbox 子进程    127.0.0.1:3310    （TCP 回环，L0 隔离）
 ├─ deep-agent-service（python） 127.0.0.1:2024    同一组 KERNEL_MODEL_* env
 └─ web（Next.js standalone）    127.0.0.1:3100    主窗口加载 http://127.0.0.1:3100
```

全部端口只绑回环；`local-egress-guard` 对 personal-local 组织保持零出网承诺不变。

### 3.2 数据库：两条路线，先 spike 后定

| 路线 | 优点 | 风险 | 决策规则 |
|---|---|---|---|
| **A. PGlite + `@electric-sql/pglite-socket`**（首选） | 纯 npm，零原生二进制，pgvector 内建，Mac/Win 一份代码 | 单连接语义：`pg` Pool、pg-boss、多 DB 角色（app/migration/diag）是否兼容**未验证**；258 条迁移里的 RLS/`SET ROLE` 是否全过未验证 | 执行第一小时 spike：跑全部迁移 + `verify:quick`。过 → 用 A；不过 → B |
| **B. 随包 PG16 二进制 + pgvector** | 与生产完全同构，零兼容风险 | 需要为 Mac(arm64/x64) 与 Windows 各出一份含 pgvector 的二进制（CI 上用 `embedded-postgres` 的 zonky 二进制 + 编译 pgvector）；安装包 +60 MB | A 失败即切；也是 Windows 首发前的保底 |

两条路线对 API 都只是 `PGHOST/PGPORT/...` 的差别，应用代码不改。

### 3.3 模型运行时：Ollama（随包分发）

- 选 Ollama 而非直接嵌 llama-server：Ollama 已在库里提供 `qwen3.5:4b`（标签含 **tools / vision / thinking**，256K 上下文，`4b-q4_K_M`）；自动识别 Metal / CUDA / CPU；模型拉取自带断点续传；Mac 与 Windows 都有独立二进制可随包分发。
- API 侧配置（全部是现有 env，不改代码）：
  `KERNEL_MODEL_PROVIDER=ollama`、`KERNEL_MODEL_BASE_URL=http://127.0.0.1:11434/v1`、`KERNEL_MODEL_API_KEY=local`、
  `KERNEL_MODEL_ID=qwen3.5:4b`、`KERNEL_DEEP_AGENT_MODEL_ID=qwen3.5:4b`、`KERNEL_MODEL_VISION_IDS=qwen3.5:4b`、
  `KERNEL_EMBEDDING_MODEL_ID=qwen3-embedding:0.6b`（Ollama 提供，走 `/v1/embeddings`）、`LOCAL_RUNTIME_ENDPOINT=http://127.0.0.1:11434`。
- 思考模式：4B 开思考会明显拖慢，默认把 `qwen3.5:4b` 加进 `KERNEL_MODEL_THINKING_DISABLE_IDS`；此处需实测 Ollama 对 `enable_thinking` 的接受方式（若不接受，用 `/no_think` 或 Ollama 的 `think:false`，作为 spike 项）。
- 安装包两种：**完整包**（内含模型 blob，展会离线场景）与**精简包**（首启后台下载）。

### 3.4 会话存储：新增内存/文件 `SessionTokenStore`

- 在 `apps/api/src/infrastructure/auth/` 新增 `file-session-token-store.ts`（JSON 落盘 + 内存索引，保留 TTL / 撤销语义），
  组合根按 `KERNEL_SESSION_STORE=redis|file` 选择；默认仍是 redis，云端行为零变化。
- 这是本提案**唯一需要改 API 业务代码**的地方，改动限定在 infrastructure 一层 + 组合根一处。

### 3.5 Skill 沙箱：子进程模式

- 新增启动模式：`apps/skill-sandbox` 以 Node 子进程监听 TCP 回环，API 用现有 `KERNEL_SKILL_SANDBOX_BASE_URL` 接入（dev 已走这条路）。
- 隔离等级在 UI 与日志里如实标注为 L0（无容器）；Node 侧 pptx/docx/xlsx/pdf-lib 生成、数据分析（Python 已随包）离线可用；LibreOffice 转换 / tesseract OCR / ffmpeg 为**可选扩展包**，未装时对应 skill 返回明确的"缺扩展"错误码，不静默降级。

### 3.6 首启灌数（复用既有脚本，不写第二份）

顺序：`migrate` → `backfill-platform-org.ts`（平台组织 + 17 skill pack + 20 画布模板主库）→ `backfill-default-agents.ts` → `seed-local-models.ts` → 创建 personal-local 组织 + 本地账号（走现有 `getLocalOrg`/注册用例，不绕过鉴权）。
全部幂等，二次启动只校验不重灌。

### 3.7 桌面外壳：Electron + electron-builder

- 选 Electron（不选 Tauri）：整栈是 Node，Electron 自带的 Node 直接跑 API/Web/沙箱，不需要第二套运行时；electron-builder 一次产出 DMG（签名+公证）与 NSIS exe，并带自动更新。
- 新目录 `apps/desktop/`：主进程 = 服务监督器（启动顺序、健康检查、崩溃重启、日志目录）、硬件自检、模型下载器、托盘、主窗口；渲染层就是现有 `apps/web`，**不另写 UI**。
- 新目录 `packages/local-runtime/`：与 Electron 无关的纯 Node 库——进程编排、端口探测、`.env.local-desktop` 生成（读 §1.3 那份"必需 env 单一清单"）、种子编排；CLI 也能直接跑（`pnpm local-runtime up`），这是 CI 与无 GUI 验证的入口。

### 3.8 「连接云端」（商业模式入口，第一版只做接口留位）

- 本地版默认只有一个 personal-local 组织。登录 WorkspaceX 账号后：
  1. 模型池新增 `closed-api` 云端模型（走现有 registry + 凭据保险库，凭据只写不读）；
  2. 加入云端组织 → 多人协作 / 云备份 / 云端 ASR、图片生成、web_search 等本地缺的能力；
  3. 机密路由规则不变：标记机密的轮次永远留在本地 `self-hosted`。
- 第一版：登录按钮 + 账号状态 + 「哪些能力需要云端」的清单页；真正的双向同步是后续阶段。

---

## 4. 一晚（Night 0）能做出什么——诚实的范围

**目标：一台 Apple Silicon Mac 上，从 DMG 安装到"本地模型回话 + 套一个画布模板 + 跑一个 pptx skill"，端到端走通并留证据。**

| 小时 | 事项 | 产出 / 判据 |
|---|---|---|
| 0–1 | Spike：PGlite socket 跑全部迁移 + `verify:quick` | 过/不过决定 §3.2 路线；同时 spike Ollama `qwen3.5:4b` 的 thinking 关闭方式 |
| 1–2 | `packages/local-runtime`：进程编排 + env 生成 + 种子编排 CLI | `pnpm local-runtime up` 在裸机（无 Docker）拉起全栈，`curl /health` 绿 |
| 2–3 | `file-session-token-store` + `KERNEL_SESSION_STORE` 开关 + 单测 | api 单测绿；无 Redis 能登录 |
| 3–4 | 沙箱子进程模式 + deep-agent Python 运行时打包脚本（python-build-standalone + uv） | 一个 pptx skill 在无 Docker 环境跑出文件 |
| 4–6 | `apps/desktop` Electron 主进程 + electron-builder DMG（未签名） | 安装后首启自检 → 拉起 → 主窗口可用 |
| 6–7 | 端到端验证脚本 + 证据（截图 / 日志 / 耗时） | 三个用户可见行为可复现 |
| 7–8 | 收尾：issue 评论、PR、README 一页 | PR 绿 |

**明确不在 Night 0**：Windows 安装包、代码签名与公证、自动更新、扩展包（LibreOffice/OCR/ffmpeg）、本地 ASR、云端连接的真实同步、任何 UI 新页面（只用 env/日志与现有页面）。

**Night 0 的两个最大不确定项**（做不成就当晚改道，不硬撑）：PGlite 多连接兼容（兜底 B 路线要多花约半天出二进制）；Python 运行时打包在 macOS 上的动态库相对路径（兜底：首启用随包 `uv` 现场创建 venv，需要外网一次）。

---

## 5. 不做 / 不改

- 不改任何契约（`packages/contracts`）与领域规则；机密路由、零出网、模型池凭据只写不读全部原样。
- 不改 devapp / 阿里云 CD 路径；桌面版是第三条部署形态（单机私有 / 多云容器 / **本机桌面**）。
- 不引入第二份"必需 env 清单"、第二份模板/skill 清单；桌面启动器读现有单源。
- 不在桌面版里悄悄放宽安全：沙箱 L0 隔离在 UI/日志里如实标注；非回环端点一律拒绝。

---

## 6. 仓库落点

```
apps/desktop/                 Electron 主进程、electron-builder 配置、资源清单（ollama 二进制、模型 blob 可选）
packages/local-runtime/       进程编排 / env 生成 / 种子编排（纯 Node，CLI 可独立跑）
apps/api/src/infrastructure/auth/file-session-token-store.ts   + 组合根开关
apps/skill-sandbox/           新增 TCP 子进程启动模式（不动 Docker 路径）
.harness/scripts/lib/required-config.ts   必需 env 单一清单（self-host 计划阶段 0，一并落地）
scripts/local-bundle/         打包脚本：python 运行时、ollama 二进制、模型 blob 拉取与校验
docs/deployment/LOCAL-DESKTOP.md   面向用户的安装说明（实测数字，不写估算）
```

---

## 7. Roadmap（Night 0 之后）

| 阶段 | 内容 | 商业意义 |
|---|---|---|
| **R1（第 1 周）** | Windows NSIS 包（CUDA/CPU 自动）、Mac 签名公证、自动更新、硬件自检 UI、模型下载进度 UI、完整包/精简包两种发行 | 展会可分发 |
| **R2（第 2–3 周）** | 扩展包机制（LibreOffice / tesseract / ffmpeg）、本地 ASR（whisper.cpp）、视觉走本地 qwen3.5:4b、本地 web_search 可插拔（SearXNG / 自带 key） | 本地版功能与云端趋齐 |
| **R3（第 4–6 周）** | 「连接云端」：账号登录、云端模型池、加入云端组织、云备份/同步；用量与订阅 | **开源本地免费 + 云端增值**的商业闭环 |
| **R4** | 模型可选（9B/27B、Qwen3.8 系列）、多模型池、局域网多机（`self-hosted-only` 组织策略） | 团队私有部署升级路径 |

---

## 8. 批准后的执行方式（遵守 AGENTS.md）

1. 建 issue「WorkspaceX Local Night 0」，本提案链接进去；每小时的进展 / 撞墙 / 改道写在 issue 评论。
2. 分支 `worker/<owner>-local-desktop-night0`；一个 issue 一个 PR，PR 带 `Closes #<issue>`。
3. 验证：`verify:quick` + 新增 `packages/local-runtime` 单测 + 端到端脚本三条用户可见行为，证据落 `evidence/`。
4. PR 绿才算完；Night 0 结束时如有未完成项，如实写在 issue 与 `session-handoff.md`，不假 passing。

**请批准或修改：** ① 路线 A/B 的 spike 决策规则；② Night 0 只做 Mac；③ Electron 而非 Tauri；④ 沙箱 L0 隔离在第一版可接受。
