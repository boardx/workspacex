# A1 验证与交接

环境：Node 22（`/tmp/aidt-node/node_modules/node/bin`），pnpm 9.15（`/tmp/aidt-tools/node_modules/.bin`），隔离 worktree `aidt-complete-model_config`。未安装依赖、未修改锁文件、未启动 Docker/服务、未进行真实模型网络请求。

| 命令 / 动作 | 本轮实际结果 | 证据与边界 |
|---|---|---|
| `./init.sh` | 主 Agent 回报退出 0 | 基础验证由主 Agent 统一留证；本分支不重复整仓检查 |
| `node --test scripts/tests/real-model-config.test.mjs` | 13/13 通过，退出 0 | `config-tests.txt`；含真实 pnpm doctor 入口、模型字段白名单、配置不执行、脱敏、缺文件 fail closed、OpenAI-only 拒绝、显式 safe smoke 子进程接线及退出码回传 |
| `pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/real-model-smoke.test.ts .harness/scripts/vm/real-model-chat-evidence-env.test.ts` | 2 文件、6/6 通过，退出 0 | 首轮运行于 01:29:40，436ms；既有 smoke 退出状态和 VM env 可 source 回归，Vite CJS 弃用提示不影响结果 |
| `bash -n scripts/real-model-env.sh scripts/real-model-smoke.sh` | 退出 0 | shell 语法检查 |
| `node --check scripts/real-model-config.mjs` | 退出 0 | JS 语法检查 |
| `git diff --check` | 退出 0 | 无 whitespace error |
| `pnpm real-model:doctor --model-env-file /workspace/cn.local.env` | 预期退出 2 | `missing-file-diagnostic.txt`；所有模型字段 missing，connectivity=not_checked，modelAcceptance=not_run |
| `rg --files --hidden -g cn.local.env -g '!.git' /workspace` | 无匹配路径 | 云环境无该用户文件；未假设 Mac 文件在云中存在 |

## 本轮修正记录

1. 原 loader 会 source 整份配置：新增只解析七个模型字段的 data-only 工具，保留默认 loader 兼容；安全入口标记让两层 loader 不再 source 原文件。
2. 单纯非空检查易被误读为真实连通：输出结构状态及 `not_checked / not_run`，显式拒绝占位、明显回环、含 endpoint 凭据的配置。
3. OpenAI-only 与 DashScope smoke 路径不同：仅复用现有 DashScope 映射，其他 provider 明确 unsupported。
4. pnpm 9 抢先消费 `--env-file`：首个命令试验退出 9（Node 报文件缺失，未执行模型），改用 `--model-env-file` 并加真正 pnpm 入口回归；最终诊断正确进入工具并以退出 2 报缺文件。
5. 配置完整仍不应自动起栈：默认命令始终只读；收费/全栈动作需要显式 safe smoke，且要求文件实际可读。

## 尚未解决

- 当前云环境无可读 `cn.local.env`，无凭据与有效 endpoint/model 的实时证据；真实模型连通、真实 AIDT 引导质量与原生 Chat 端到端均未在本子任务验收。
- 非 DashScope 模型提供方没有接入本条 smoke；没有新增 provider 支持或服务契约。
- 原有非 safe smoke 仍会 source 原 env；兼容保留是明确范围，CN 配置应使用新安全入口。
- 父 Agent 报告协调层缺 `COORD_GATEWAY_URL`；未声称取得协调租约。按用户限制不发 GitHub issue/PR、不 merge、不部署、不改签核；本地提交由父 Agent 集成。
- 没有启动持久服务，无本任务 Docker 栈或模型进程需回收；保留 worktree 供父 Agent cherry-pick 与审查。
