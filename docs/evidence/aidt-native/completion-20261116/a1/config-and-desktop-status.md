# 当前云环境：模型配置与用户访问准备

2026-11-16 01:58 UTC 只读观察。仅新增本文件，不提交、不修改应用或配置、不执行模型请求、不启动服务或浏览器。此前配置工具提交 `3c54f5ca89a3d02b47990ebcda3905dd3aae6b4b` 不变。当前仓库 `/workspace/aidt-module-latest`；已经释放的 worker 副本不再使用。

## 模型配置未同步到当前环境

当前环境 ID：`ccarenv_b64_Y2NhcmVudl8xNDMxZDBiZWFlMDQ4MTkxODI5YTg3ZDE5ZDY4NTdlNA`。环境状态工具返回 `observed_phase=running`、`connectivity=connected`、`observations_current=true`，绑定的 secrets 和 runtime_variables 数量均为 0。这里的 connected 指环境连接状态，不代表模型服务连通。

检查未读取或输出任何凭据值：

| 检查 | 实际观察 |
|---|---|
| `rg --files --hidden --no-ignore -g cn.local.env -g '!node_modules' -g '!.git' /workspace` | 无匹配；范围限于当前 `/workspace` 可检索路径，不证明用户 Mac 或其他机器上没有该文件 |
| `/workspace/cn.local.env` | 文件不存在 |
| `/workspace/aidt-module-latest/cn.local.env` | 文件不存在 |
| `/workspace/aidt-module-latest/.env.local` | 文件不存在 |
| `DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / DASHSCOPE_MODEL` | 当前进程均未设置或为空 |
| `KERNEL_MODEL_PROVIDER / KERNEL_MODEL_API_KEY / KERNEL_MODEL_BASE_URL / KERNEL_DEFAULT_AGENT_MODEL_ID` | 当前进程均未设置或为空 |
| `OPENAI_API_KEY / KERNEL_OPENAI_API_KEY / WORKSPACEX_ENV_FILE` | 当前进程均未设置或为空 |

已执行只读安全诊断：

```bash
/tmp/aidt-node/node_modules/node/bin/node scripts/real-model-config.mjs \
  --model-env-file /workspace/aidt-module-latest/cn.local.env
```

独立执行返回 **退出码 2**：`configuration=blocked`、`source.fileStatus=missing`、`provider=unresolved`，三个 DashScope 必需字段均 missing，错误类型 `env_file_missing`。`connectivity=not_checked`、`modelAcceptance=not_run`、`localProfileChanged=false`。未将缺文件静默切换到其他配置，未执行真实模型请求。没有发现可读 `cn.local.env`，因此没有进行内容解析或接线调用；如后续同步文件，应先仅报告字段状态与安全 doctor 结果，由根 Agent 决定下一步。

公开参数使用 `--model-env-file`；不要使用会被 pnpm 提前消费的 Node `--env-file` 参数。安全工具只提取七个模型字段，不执行 shell 表达式或 source 整份 CN 文件。数据库、端口、权限和 egress 字段不在导入白名单；调用者事先已经 export 的非模型环境不属于此文件过滤保证。原始非 safe smoke 默认 source 行为为兼容保留，不应拿它装载 CN 配置。配置结构完整与真实模型鉴权、教学质量验收是不同结论。

## 共享桌面已声明，但当前缺少控制与打开入口

已使用 `cloud-environment:cloud-desktop` 技能并查询环境状态。`remote_desktop.enabled=true`、`state=unknown`；工具说明明确表示这是按需能力，首次有效桌面 JS 调用或授权 viewer 连接才启动，单纯查询不会启动。**unknown 不能解释成用户未开启 Desktop。**

本轮对 `ALL_TOOLS` 精确发现的结果：有 `mcp__codex_apps__cloud_environment_environment_status`，没有 `cua_repl`／桌面 NodeREPL JS、`open_in_codex`、`open_cloud_preview`、Sky 或浏览器 tab 控制工具。因此此 Agent 目前不能通过受支持工具创建共享 Chrome 标签页、打开 viewer 或给出转发后的用户本机 URL；没有再要求用户确认 Desktop 是否开启，也没有尝试开放公网或修改权限。

| 本机只读检查 | 实际观察 |
|---|---|
| `DISPLAY / WAYLAND_DISPLAY / XDG_RUNTIME_DIR` | 均未设置或为空 |
| 已运行 Chrome、Chromium、Xvfb、Xorg、Wayland、VNC、noVNC、websockify 进程名 | 无匹配 |
| Chromium | `/usr/bin/chromium` 可执行文件存在；此前只读版本检查为 151.0.7922.173 |
| Xvfb / xvfb-run | 命令不存在 |
| xwininfo | `/usr/bin/xwininfo` 存在；缺 display 仍不能据此声称共享桌面已运行 |
| Playwright 浏览器路径 | 此前只读包查询返回 `/home/agent/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`；路径查询不代表已启动浏览器 |

已有 Chromium／Playwright 可供根 Agent 最终实例 ready 后进行本机 headless 验收；截图不能替代用户可接管的共享桌面。容器 `127.0.0.1` 地址不能当作用户设备可访问的外部链接。当前没有导航到待验收 UI，没有启动第二份应用或浏览器，也没有把本机路径伪装成公网入口。

## 原生构建所需文件：仅存在性快照

当前观察中以下文件均存在且可读到元数据：

- `/tmp/aidt-node/node_modules/node/bin/node`
- `apps/web/node_modules/next/package.json`、`next/dist/bin/next`：包元数据版本 `14.2.15`
- `apps/web/node_modules/react/package.json`、`react/index.js`、`react/jsx-runtime.js`：包元数据版本 `18.3.1`
- `apps/web/node_modules/react-dom/package.json`、`react-dom/client.js`：包元数据版本 `18.3.1`
- `apps/web/.next-aidt-local/BUILD_ID`、`build-manifest.json`、`routes-manifest.json`、`prerender-manifest.json`、`server/app-paths-manifest.json`、`server/pages-manifest.json`

仓库根 `node_modules/next/package.json` 不存在，Web 包局部的 Next 文件存在；不能把根路径缺少直接判为 Web 依赖缺失。上述文件存在不证明构建 receipt 与最终源码匹配、全部 chunk 完整、服务健康或浏览器端到端通过；这些由根 Agent 当前集成与原生验收任务确认。本轮没有运行构建或干扰构建输出。
