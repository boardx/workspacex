#!/usr/bin/env bash

# Sourceable post-restart gate. It intentionally performs no privileged action.
# The root-owned deploy entry and the unprivileged CD wrapper share this contract.

health_payload_is_trustworthy() {
  local payload=$1
  [[ "$payload" == *'"trustworthy":true'* ]] &&
    [[ "$payload" == *'"rlsForced":true'* ]] &&
    [[ "$payload" == *'"appRoleIsOwner":false'* ]]
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

personal_realtime_asr_websocket_is_routed() {
  local url=$1 status
  status=$(curl -sS --http1.1 --connect-timeout 2 --max-time 5 \
    -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' \
    -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "$url" 2>/dev/null) || return 1
  [[ "$status" == "401" ]]
}

run_post_restart_smoke() {
  local api_url="http://127.0.0.1:${APP_API_PORT:-3200}/healthz"
  local web_url="http://127.0.0.1:${APP_WEB_PORT:-3100}/"
  local public_probe="https://${PUBLIC_DOMAIN:-devapp.boardx.us}/kernel/probe/identity-session"
  local personal_asr_probe="https://${PUBLIC_DOMAIN:-devapp.boardx.us}/recording/realtime-asr/sessions/probe-session/captures/probe-capture/stream"

  if ! wait_for_stable_api "$api_url"; then
    print_deploy_diagnostics
    return 1
  fi
  echo "  ${API_HEALTH_PAYLOAD}"

  if ! wait_for_stable_web "$web_url"; then
    print_deploy_diagnostics
    return 1
  fi

  if ! personal_realtime_asr_websocket_is_routed "$personal_asr_probe"; then
    echo "✗ personal realtime ASR WebSocket 未路由到 API（缺 ticket 时应立即返回 401）" >&2
    print_deploy_diagnostics
    return 1
  fi
  echo "  ✓ personal realtime ASR WebSocket 已路由到 API"

  if curl -fsS --connect-timeout 2 --max-time 5 -o /dev/null "$public_probe" 2>/dev/null; then
    echo "✗ /kernel/probe/* 从公网可达 —— 那是门控的被测面，不是对外 API" >&2
    print_deploy_diagnostics
    return 1
  fi
  echo "  ✓ 探针面未对外暴露"
}
