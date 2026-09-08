#!/usr/bin/env bash

# Sourceable post-restart gate. It intentionally performs no privileged action.
# The root-owned deploy entry and the unprivileged CD wrapper share this contract.

health_payload_is_trustworthy() {
  local payload=$1
  [[ "$payload" == *'"trustworthy":true'* ]] &&
    [[ "$payload" == *'"rlsForced":true'* ]] &&
    [[ "$payload" == *'"appRoleIsOwner":false'* ]]
}

# issue #3073 —— 在跑的 Caddyfile 与 provision.sh 里那份模板之间的漂移门。
#
# 为什么需要它：deploy.sh 一个字节都不碰 /etc/caddy/Caddyfile，只有人手动重跑
# provision.sh 才会重写它。#2795 把 agent-run 事件 WS 的 handle 补进模板、CI 钉住了
# 模板、deploy 全绿——而机器上跑的仍是旧配置，那条 WS 面照旧落进兜底 handle 打到
# Next.js，Upgrade 请求在那断了（2026-09-08 devapp 复现，与 2026-08-08/08-14 三次
# 事故同一签名）。「模板里有」是静态痕迹，不是「在跑的有」。
#
# 比对的是**路由集合**，不是文件字节：模板里带 ${APP_API_PORT} 这类变量与实际域名，
# 逐字比对必然假红。缺任何一条模板声明的 handle 路径就红，并指名缺的是哪一条。
caddy_route_patterns() {
  # `handle {`（兜底，无路径）不产出路径 token——第二个字段是 `{`，在这里过滤掉。
  grep -Eo '^[[:space:]]*handle(_path)?[[:space:]]+[^[:space:]]+[[:space:]]*\{' "$1" \
    | awk '{ if ($2 != "{") print $2 }' \
    | sort -u
}

assert_caddy_routes_current() {
  local template=$1 live=$2 pattern missing=0 live_patterns
  [ -r "$template" ] || { echo "✗ 读不到 Caddyfile 模板：$template" >&2; return 1; }
  [ -r "$live" ] || { echo "✗ 读不到在跑的 Caddyfile：$live" >&2; return 1; }
  live_patterns=$(caddy_route_patterns "$live")
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    printf '%s\n' "$live_patterns" | grep -qxF -- "$pattern" || {
      echo "✗ 在跑的 Caddyfile 缺路由：$pattern" >&2
      missing=1
    }
  done <<< "$(caddy_route_patterns "$template")"
  ((missing == 0)) || {
    echo "  在跑的反代配置落后于 ${template} 的模板。修法（在目标机器上以 root 跑一次）：" >&2
    echo "    PUBLIC_DOMAIN=<域名> DEPLOY_KEY_PATH=<部署密钥> ${APP_DIR:-/opt/workspacex/app}/.harness/scripts/vm/provision.sh" >&2
    return 1
  }
  return 0
}

redact_deploy_diagnostics() {
  sed -E \
    -e 's/(AUTHORIZATION|Authorization|authorization|TOKEN|Token|token|PASSWORD|Password|password|COOKIE|Cookie|cookie)=[^[:space:]]+/\1=<redacted>/g' \
    -e 's/([Bb]earer)[[:space:]]+[^[:space:]]+/\1 <redacted>/g'
}

print_deploy_diagnostics() {
  local lines=${DEPLOY_DIAGNOSTIC_LINES:-80}
  local service
  echo "══════ bounded service diagnostics (secrets redacted) ═════=" >&2
  for service in workspacex-api workspacex-web; do
    {
      systemctl status "$service" --no-pager --lines=20 || true
      journalctl -u "$service" -n "$lines" --no-pager || true
    } 2>&1 | redact_deploy_diagnostics >&2
  done
}

wait_for_stable_api() {
  local url=$1
  local attempts=${DEPLOY_API_READINESS_ATTEMPTS:-100}
  local required=${DEPLOY_API_STABLE_SAMPLES:-3}
  local interval=${DEPLOY_READINESS_INTERVAL_SECONDS:-1}
  local stable=0 payload attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if payload=$(curl -fsS --connect-timeout 1 --max-time 2 "$url" 2>/dev/null); then
      if health_payload_is_trustworthy "$payload"; then
        stable=$((stable + 1))
        echo "  API trustworthy sample=${attempt} stable=${stable}/${required}"
        if ((stable >= required)); then
          API_HEALTH_PAYLOAD=$payload
          echo "  API trustworthy stable=${stable}"
          return 0
        fi
      else
        stable=0
        echo "  API sample rejected: security assertions are not all true"
      fi
    else
      stable=0
      echo "  API sample=${attempt} unavailable; stability reset"
    fi
    ((attempt < attempts)) && sleep "$interval"
  done
  echo "✗ API readiness timed out after ${attempts} bounded samples" >&2
  return 1
}

wait_for_stable_web() {
  local url=$1
  local attempts=${DEPLOY_WEB_READINESS_ATTEMPTS:-60}
  local required=${DEPLOY_WEB_STABLE_SAMPLES:-2}
  local interval=${DEPLOY_READINESS_INTERVAL_SECONDS:-1}
  local stable=0 attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl -fsS --connect-timeout 1 --max-time 2 -o /dev/null "$url" 2>/dev/null; then
      stable=$((stable + 1))
      echo "  Web response sample=${attempt} stable=${stable}/${required}"
      ((stable >= required)) && return 0
    else
      stable=0
      echo "  Web sample=${attempt} unavailable; stability reset"
    fi
    ((attempt < attempts)) && sleep "$interval"
  done
  echo "✗ Web readiness timed out after ${attempts} bounded samples" >&2
  return 1
}

run_post_restart_smoke() {
  local api_url="http://127.0.0.1:${APP_API_PORT:-3200}/healthz"
  local web_url="http://127.0.0.1:${APP_WEB_PORT:-3100}/"
  local public_probe="https://${PUBLIC_DOMAIN:-devapp.boardx.us}/kernel/probe/identity-session"

  if ! wait_for_stable_api "$api_url"; then
    print_deploy_diagnostics
    return 1
  fi
  echo "  ${API_HEALTH_PAYLOAD}"

  if ! wait_for_stable_web "$web_url"; then
    print_deploy_diagnostics
    return 1
  fi

  if curl -fsS --connect-timeout 2 --max-time 5 -o /dev/null "$public_probe" 2>/dev/null; then
    echo "✗ /kernel/probe/* 从公网可达 —— 那是门控的被测面，不是对外 API" >&2
    print_deploy_diagnostics
    return 1
  fi
  echo "  ✓ 探针面未对外暴露"
}
