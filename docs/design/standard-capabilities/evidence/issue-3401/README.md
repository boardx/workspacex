# issue #3401 —— 一次 PDF 生成的分段耗时实测

实测 SHA `551c8e97f71629f7cefeaa995cbcfdb6e2ecf108`（origin/main），本机 10 核，
每次 run 的 `load average` 记在下表；同一句人类原话
「生成一个 pdf，总结你可以做的事情」，真实 DashScope 模型 + 生产 native graph +
真实 skill 沙箱容器。

**devapp 那台机器的逐段数字本 issue 拿不到**：`real-model-chat-evidence` workflow 在
preflight 就红退（run 34556746631），因为那台机器上没有 `/opt/workspacex/real-model-e2e.env`
（缺 `REAL_MODEL_E2E_EMAIL` / `REAL_MODEL_E2E_PASSWORD`，刻意不走 GitHub secret）。
所以下面所有毫秒都是**本机**的，别把它当成 devapp 的分段——#3309 明确吃过这个亏。

## 怎么复现

```sh
# 一次性：自己的沙箱容器
docker compose -p wx3401 -f apps/skill-sandbox/docker-compose.sessions.yml up -d --build

# 每次测量（只从 .env.local 取模型凭据，别整份 source——会把 PG 口令一起覆盖掉）
set -a; eval "$(grep -E '^DASHSCOPE_(API_KEY|BASE_URL|MODEL)=' .env.local)"; set +a
export WX_NATIVE_SANDBOX_CONTAINER=wx3401-skill-sandbox-sessions-1
export WX_PDF_PERF_EVIDENCE=$PWD/.perf-evidence
export WX_PDF_PERF_LABEL=run1
export WX_PDF_PERF_PACKS=all     # 17 个 starter-pack skill + 4 个 office = 用户看到的 21 个
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter @repo/api exec vitest run --config vitest.pdf-perf-measure.config.ts

# 收尾
docker compose -p wx3401 -f apps/skill-sandbox/docker-compose.sessions.yml down -v
```

产物 `<label>-timeline.json`：每个 graph 节点的墙钟时刻、每次工具调用的参数字符数、
每个工具回执的状态与正文（失败的报错原文逐字保留）。

## 结果

| run | 技能数 | load1（起测时） | 端到端 | 固定开销 | 模型轮次 | 工具执行 | `Invalid color` |
|---|---|---|---|---|---|---|---|
| baseline1 | 4  | 7.6  | 65.2s  | 4.9s | 51.0s (78%) | 4.4s (7%) | 无 |
| rich1     | 4  | 7.6  | 109.4s | 1.9s | 93.0s (85%) | 8.1s (7%) | **命中，38.4s（35%）** |
| b21_1     | 21 | 2.9  | 83.4s  | 8.0s | 65.0s (78%) | 4.4s (5%) | **命中，8.2s（10%）** |
| b21_2     | 21 | 2.5  | 73.3s  | 7.9s | 56.7s (77%) | 3.9s (5%) | **命中，9.0s（12%）** |
| b21_3     | 21 | 3.4  | 95.0s  | 13.7s| 63.9s (67%) | 10.1s (11%)| **命中，12.2s（13%）** |
| fix_1     | 21 | 5.6  | 77.2s  | 12.8s| 54.2s (70%) | 3.7s (5%) | 无 |
| fix_2     | 21 | 6.1  | 65.6s  | 7.8s | 50.0s (76%) | 3.1s (5%) | 无 |
| fix_3     | 21 | 4.0  | 83.0s  | 9.0s | 61.4s (74%) | 6.6s (8%) | 无 |
| fix_4     | 21 | 8.6  | 70.0s  | 8.9s | 52.1s (74%) | 4.1s (6%) | 无 |

`fix_*` = 本 PR 给 `pdf-create` 正文补上 `rgb()` 那一节之后，其余一字未改。

**每一次 `execute` 都退出码 0 或 1，没有任何一次超时或传输失败**——沙箱本身不是瓶颈
（单次 0.17–2.4s）。
