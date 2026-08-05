#!/usr/bin/env bash
#
# verify-runtime-gates.sh -- two-way assertions for the three runtime gates (UC-0.6 V7/V8/V9).
#
# Every gate is checked in BOTH directions:
#   G1/G2  auth:       no credentials -> 401,  valid credentials -> 200 with a principal
#   G3/G4  validation: bad body -> 400 + field-level,  good body -> passes
#   G5/G6  errors:     response carries only a code + traceId,  log carries the detail
#   G7     the test-injection channel is unreachable in production
#
# Only testing that violations are blocked would let an implementation that rejects
# everything pass. Only testing that valid input passes would let a missing gate pass.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pg_up
pg_reset
(cd "$API_DIR" && pnpm exec tsx src/infrastructure/db/migrate-cli.ts >/dev/null)

cd "$API_DIR"

# ⚠ 本门控**在同进程内**启动一次 app（`runtime-gate-assert.ts` 顶部 `import { createApp }`，
#   为的是截获 stdout 验 G6 的日志那一半）。所以生产启动的硬性依赖必须在**这里**就位——
#   只在 G7 那个 spawn 的 env 里给是不够的，父进程会先炸。
#
# 2026-08-05 实测（#548 合入 main 之后）：
#   Error: missing env var MODEL_CREDENTIAL_KEY
#     at credentialCipherFromEnv (aes-credential-cipher.ts:85)
#     at InstanceWrapper.useFactory (kernel.module.ts:477)
#   ⇒ backend-gates 当场红、deploy job 随之 skipped，整条部署链再次被挡住。
#
# 给假值的理由与 runtime-gate-assert.ts 里 EMAIL_VERIFICATION_SECRET 那段逐字相同：
# 本门控验的是「生产模式下测试注入通道不可达」，不是密钥强度；用真值反而把密钥
# 带进 CI 日志面。写死常量而非随机值，是为了让「这次为什么过/不过」可复现。
export MODEL_CREDENTIAL_KEY="${MODEL_CREDENTIAL_KEY:-runtime-gate-not-a-real-model-key-000000000000}"

pnpm exec tsx scripts/runtime-gate-assert.ts
