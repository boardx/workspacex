#!/usr/bin/env bash
# live-evidence.sh —— rubric 正式评分的活体物理证据采集（在 devapp VM 上跑）。
#
# 用法（VM 上）：bash apps/deep-agent-service/scripts/live-evidence.sh
# 产物：/tmp/deepagent-evidence-<utc>/ 目录 + 同名 .tar.gz——整包拉回工作机，
# 交给独立评估会话按 .harness/rubrics/deepagent-capability-rubric.md 判分。
#
# 只做两类动作：① 对 deep-agent-service 回环端点的只读探测；② 新建探针 thread
# 并提交少量测试 run（不触碰任何既有用户 thread/数据）。不重启任何服务——
# TC-5 的 kill-恢复取证需要单独授权，本脚本刻意不做。
set -euo pipefail

BASE="${DEEP_AGENT_BASE:-http://127.0.0.1:2025}"
TS_UTC=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/tmp/deepagent-evidence-${TS_UTC}"
mkdir -p "$OUT"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }

log "== 0. 服务与版本指纹（D10 证据）"
curl -sf "$BASE/info" > "$OUT/00-info.json" 2>/dev/null || echo '{"info":"unavailable"}' > "$OUT/00-info.json"
docker inspect workspacex-deep-agent --format '{{.Config.Image}} {{.State.StartedAt}}' \
  > "$OUT/00-container.txt" 2>/dev/null || true
grep -E "STREAM_ENABLED|LANGSMITH_TRACING|CHECKPOINT_DB" /opt/workspacex/deploy.env 2>/dev/null \
  | sed 's/=.*KEY.*/=<REDACTED>/' > "$OUT/00-flags.txt" || true

log "== 1. TC-1 子集：多步任务 → SSE 原始流逐行落盘带毫秒时间戳（D1/D2/D3 唯一凭据）"
THREAD=$(curl -sf -X POST "$BASE/threads" -H 'content-type: application/json' -d '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["thread_id"])')
log "探针 thread: $THREAD"
# 2026-08-23 复盘：此前这条 POST 不带 stream_mode，LangGraph 的 join 流默认只回放
# values（全量状态快照），D2/D3 因此长期只看到 metadata+values 两种事件——不是引擎
# 缺逐 token/逐次工具调用事件，是这条探针从没问过要。同 apps/api 侧 deep-agent-model-provider.ts
# 那次真实修法：创建时声明 messages-tuple（逐 token）+ updates（逐节点，含独立工具调用）。
RUN=$(curl -sf -X POST "$BASE/threads/$THREAD/runs" -H 'content-type: application/json' -d '{
  "assistant_id": "Deep Agent",
  "stream_mode": ["messages-tuple", "updates"],
  "input": {"messages": [{"role": "user", "content": "请先用 write_todos 列出 3 步计划，然后调用 list_org_skills 查看可用技能，最后总结你看到了什么。"}]}
}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["run_id"])')
log "探针 run: $RUN"
# -N 不缓冲；perl 给每行盖毫秒时间戳——「到达时刻分散」是 D3 反伪造判定的全部依据
curl -sfN "$BASE/threads/$THREAD/runs/$RUN/stream" -H 'accept: text/event-stream' \
  | perl -MTime::HiRes=time -ne 'printf "%.3f %s", time, $_' > "$OUT/01-sse-stream.txt" || log "stream 中断（run 可能已终态）"
log "SSE 行数: $(wc -l < "$OUT/01-sse-stream.txt")"

log "== 2. 终态 thread state（todos/files/消息全量——D1/D5/D8 证据）"
for i in $(seq 1 60); do
  ST=$(curl -sf "$BASE/threads/$THREAD/runs/$RUN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))')
  [ "$ST" = "success" ] || [ "$ST" = "error" ] && break; sleep 2
done
log "run 终态: $ST"
curl -sf "$BASE/threads/$THREAD/state" > "$OUT/02-thread-state.json"

log "== 3. D4 证据：checkpoint 历史（time travel 的原料）+ 二轮续聊"
curl -sf "$BASE/threads/$THREAD/history?limit=50" > "$OUT/03-checkpoint-history.json" || echo '[]' > "$OUT/03-checkpoint-history.json"
RUN2=$(curl -sf -X POST "$BASE/threads/$THREAD/runs" -H 'content-type: application/json' -d '{
  "assistant_id": "Deep Agent",
  "input": {"messages": [{"role": "user", "content": "我上一条消息让你做的第一步是什么？只答那一步，不要重新执行。"}]}
}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["run_id"])')
for i in $(seq 1 60); do
  ST2=$(curl -sf "$BASE/threads/$THREAD/runs/$RUN2" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))')
  [ "$ST2" = "success" ] || [ "$ST2" = "error" ] && break; sleep 2
done
log "二轮终态: $ST2（跨轮召回看 04 里最后一条 AI 消息答没答对）"
curl -sf "$BASE/threads/$THREAD/state" > "$OUT/04-thread-state-after-turn2.json"

log "== 4. TC-3 子集：故障注入——调用不存在的技能，看错误是否如实（D7 证据）"
THREAD3=$(curl -sf -X POST "$BASE/threads" -H 'content-type: application/json' -d '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["thread_id"])')
RUN3=$(curl -sf -X POST "$BASE/threads/$THREAD3/runs" -H 'content-type: application/json' -d '{
  "assistant_id": "Deep Agent",
  "input": {"messages": [{"role": "user", "content": "请调用 call_skill 执行名为 definitely_nonexistent_skill_zzz 的技能，如实报告结果。"}]}
}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["run_id"])')
for i in $(seq 1 60); do
  ST3=$(curl -sf "$BASE/threads/$THREAD3/runs/$RUN3" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))')
  [ "$ST3" = "success" ] || [ "$ST3" = "error" ] && break; sleep 2
done
curl -sf "$BASE/threads/$THREAD3/state" > "$OUT/05-fault-injection-state.json"
log "故障注入终态: $ST3"

log "== 5. 打包"
tar -czf "${OUT}.tar.gz" -C /tmp "$(basename "$OUT")"
log "完成：${OUT}.tar.gz —— scp 拉回工作机交给评估会话"
