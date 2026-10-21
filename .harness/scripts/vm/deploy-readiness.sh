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
# 为什么需要它：模板更新不会自动改变 /etc/caddy/Caddyfile。#2795 把 agent-run
# 事件 WS 的 handle 补进模板、CI 钉住了
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

# #4733 / #4853: repair only the reviewed Board and realtime voice WebSocket routes.
# The installed helper is root-owned and sourced by the trusted deploy entry. Never render an
# arbitrary checkout's Caddy template as root: deploy can also receive a tag or
# preview ref. Every other missing route still fails the drift gate.
ensure_reviewed_websocket_caddy_routes() {
  local live=$1 api_port=$2 candidate backup anchor_count patterns missing="" route
  [[ "$live" == /etc/caddy/Caddyfile ]] || { echo "✗ WebSocket route repair requires /etc/caddy/Caddyfile" >&2; return 1; }
  [[ "$api_port" =~ ^[0-9]+$ ]] && ((api_port >= 1 && api_port <= 65535)) || {
    echo "✗ Invalid API port for WebSocket route repair" >&2
    return 1
  }
  [ -r "$live" ] || { echo "✗ Cannot read live Caddyfile" >&2; return 1; }
  patterns=$(caddy_route_patterns "$live")
  for route in '/whiteboards/*/sync' '/chat/realtime-digital-human'; do
    if ! printf '%s\n' "$patterns" | grep -qxF "$route"; then
      missing="${missing}${route} "
    fi
  done
  [ -n "$missing" ] || return 0
  anchor_count=$(grep -Ec '^[[:space:]]*handle[[:space:]]+/kernel/probe/\*[[:space:]]*\{' "$live" || true)
  [[ "$anchor_count" == 1 ]] || { echo "✗ Cannot locate unique Caddy insertion point" >&2; return 1; }

  candidate=$(mktemp /etc/caddy/.Caddyfile.websocket.XXXXXX)
  backup=$(mktemp /etc/caddy/.Caddyfile.backup.XXXXXX)
  cp -p "$live" "$backup"
  awk -v port="$api_port" -v routes="$missing" '
    /^[[:space:]]*handle[[:space:]]+\/kernel\/probe\/\*[[:space:]]*\{/ {
      count = split(routes, route, " ")
      for (i = 1; i <= count; i++) if (route[i] != "") {
        print "\thandle " route[i] " {"
        print "\t\treverse_proxy 127.0.0.1:" port
        print "\t}"
      }
    }
    { print }
  ' "$live" > "$candidate"
  chmod --reference="$live" "$candidate"
  chown --reference="$live" "$candidate"
  if ! caddy validate --config "$candidate" --adapter caddyfile; then
    rm -f "$candidate" "$backup"
    echo "✗ Repaired Caddyfile did not validate; live config untouched" >&2
    return 1
  fi
  mv -f "$candidate" "$live"
  if ! (systemctl reload caddy 2>/dev/null || systemctl restart caddy); then
    cp -p "$backup" "$live"
    systemctl reload caddy 2>/dev/null || systemctl restart caddy || true
    rm -f "$backup"
    echo "✗ Caddy reload failed; restored previous Caddyfile" >&2
    return 1
  fi
  rm -f "$backup"
  echo "  已补齐并加载 WebSocket 路由：${missing}"
}

redact_deploy_diagnostics() {
  local repo=${APP_DIR:-/opt/workspacex/app}
  local scrubber="$repo/apps/web/e2e/support/real-model-evidence.ts"
  local loader="$repo/node_modules/tsx/dist/loader.mjs"
  # Reuse the existing shape + exact-environment-value scrubber. Never dump
  # secrets when bootstrap dependencies are absent: consume and suppress instead.
  if [[ ! -r "$scrubber" || ! -r "$loader" ]]; then
    cat >/dev/null
    printf '%s\n' '<redacted> diagnostics suppressed: shared scrubber unavailable'
    return 0
  fi
  WORKSPACEX_DEPLOY_SCRUBBER="$scrubber" node --import "$loader" --input-type=module -e '
    import { pathToFileURL } from "node:url";
    import { createInterface } from "node:readline";
    let evidence;
    try { evidence = await import(pathToFileURL(process.env.WORKSPACEX_DEPLOY_SCRUBBER).href); } catch {}
    const scrubSecrets = evidence?.scrubSecrets ?? evidence?.default?.scrubSecrets;
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    if (typeof scrubSecrets !== "function") {
      for await (const line of lines) { /* Drain without exposing unredacted input. */ }
      console.log("<redacted> diagnostics suppressed: shared scrubber unavailable");
    } else {
      for await (const line of lines) {
        console.log(scrubSecrets(line).replaceAll("<REDACTED>", "<redacted>"));
      }
    }
  ' 2>/dev/null
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

# #4874 (related #4869): local health and a route declaration do not prove the public Upgrade reaches
# the gateway. An anonymous RFC6455 handshake must be refused with 401; accepting
# 101 would mask an authentication regression. No token, cookie, redirect or curlrc.
assert_public_realtime_voice_handshake() {
  local url=$1 status
  if ! status=$(curl -q --http1.1 -sS --connect-timeout 2 --max-time 5 \
    -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$url" 2>/dev/null); then
    echo "✗ public realtime voice handshake transport failed (bounded timeout)" >&2
    return 1
  fi
  if [[ "$status" != 401 ]]; then
    [[ "$status" =~ ^[0-9]{3}$ ]] || status=invalid
    echo "✗ public realtime voice handshake expected 401, received ${status}" >&2
    return 1
  fi
  echo "  ✓ public realtime voice anonymous Upgrade=401"
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

  if ! assert_public_realtime_voice_handshake "https://${PUBLIC_DOMAIN:-devapp.boardx.us}/chat/realtime-digital-human"; then
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

# A payment-only root operation. The Python source is part of the installed trusted
# helper; stdin is data only. No checkout code, shell evaluation, or caller paths.
configure_devapp_billing() {
  /usr/bin/python3 -I -c "$(cat <<'BILLING_RUNTIME_PYTHON'
# BILLING_RUNTIME_PYTHON_BEGIN
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import select
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

LIMIT = 65536
ENV_PATH = Path('/etc/workspacex-billing/billing.env')
DROPIN_PATH = Path('/etc/systemd/system/workspacex-api.service.d/90-billing.conf')
SERVICE = 'workspacex-api.service'
BILLING_STAGE = 'initialization'
BILLING_ENVIRONMENT_MISMATCH = []


def report_failure(error):
    # Only fixed stage identifiers and numeric errno escape the root boundary.
    # Never print exception text, paths, provider responses, or process output.
    stages = {'initialization', 'input', 'directories', 'lock', 'stored-files',
              'validation', 'service-before', 'write-environment', 'write-dropin',
              'restart', 'process-environment', 'readiness', 'rollback'}
    stage = BILLING_STAGE if BILLING_STAGE in stages else 'unknown'
    code = 'os-error' if isinstance(error, OSError) else 'operation-failed'
    number = getattr(error, 'errno', None)
    suffix = ' errno=' + str(number) if type(number) is int else ''
    fields = sorted(set(BILLING_ENVIRONMENT_MISMATCH) & (WECHAT | STRIPE))
    if stage == 'process-environment' and fields:
        suffix += ' fields=' + ','.join(fields)
    print('Billing runtime configuration failed: stage=' + stage + ' code=' + code + suffix,
          file=sys.stderr)

WECHAT = {'WECHAT_PAY_APP_ID', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_API_V3_KEY',
          'WECHAT_PAY_MCH_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY',
          'WECHAT_PAY_PLATFORM_PUBLIC_KEY', 'WECHAT_PAY_PLATFORM_KEY_ID', 'WECHAT_PAY_NOTIFY_URL'}
STRIPE = {'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PAYMENT_LINK',
          'STRIPE_MANAGEMENT_PORTAL', 'STRIPE_RETURN_URL'}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate key')
        result[key] = value
    return result


def match(pattern, value):
    return re.fullmatch(pattern, value) is not None


def pem_shape(value, labels):
    normalized = value.replace('\\n', '\n').strip()
    for label in labels:
        prefix, suffix = '-----BEGIN ' + label + '-----\n', '\n-----END ' + label + '-----'
        if normalized.startswith(prefix) and normalized.endswith(suffix):
            try:
                der = base64.b64decode(''.join(normalized[len(prefix):-len(suffix)].splitlines()), validate=True)
                return len(der) >= 256 and der[0] == 0x30
            except ValueError:
                return False
    return False


def validate_payload(raw, previous):
    if len(raw) > LIMIT:
        raise ValueError('payload too large')
    data = json.loads(raw, object_pairs_hook=unique_object)
    if (not isinstance(data, dict) or set(data) != {'schemaVersion', 'target', 'environment'}
            or type(data['schemaVersion']) is not int or data['schemaVersion'] != 1 or data['target'] != 'devapp'):
        raise ValueError('invalid envelope')
    update = data['environment']
    if not isinstance(update, dict) or not update or set(update) - (WECHAT | STRIPE):
        raise ValueError('unsupported environment keys')
    for key, value in update.items():
        if (not isinstance(value, str) or len(value.encode()) > 16384 or not value.strip()
                or any(ord(char) < 32 and char != '\n' for char in value)
                or ('\n' in value and key not in {'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PLATFORM_PUBLIC_KEY'})):
            raise ValueError('invalid environment value')
    config = dict(previous, **update)
    providers = set()
    if set(update) & WECHAT:
        providers.add('wechat')
        trust_keys = {'WECHAT_PAY_PLATFORM_PUBLIC_KEY', 'WECHAT_PAY_PLATFORM_KEY_ID'}
        if not WECHAT - trust_keys <= set(config):
            raise ValueError('incomplete WeChat configuration')
        if (not match(r'wx[A-Za-z0-9]+', config['WECHAT_PAY_APP_ID'])
                or not match(r'[0-9]{6,32}', config['WECHAT_PAY_MCH_ID'])
                or not match(r'[A-Za-z0-9]{32}', config['WECHAT_PAY_API_V3_KEY'])
                or not match(r'[A-Fa-f0-9]{1,128}', config['WECHAT_PAY_MCH_SERIAL_NO'])
                or not pem_shape(config['WECHAT_PAY_PRIVATE_KEY'], ['PRIVATE KEY', 'RSA PRIVATE KEY'])
                or config['WECHAT_PAY_NOTIFY_URL'] != 'https://devapp.boardx.us/api/billing/webhooks/wechat'):
            raise ValueError('invalid WeChat configuration')
        # Match the reference backend when both optional verification fields are
        # absent. Supplied platform trust must remain a complete, valid pair.
        if trust_keys & set(config):
            if (not trust_keys <= set(config)
                    or not pem_shape(config['WECHAT_PAY_PLATFORM_PUBLIC_KEY'], ['PUBLIC KEY', 'CERTIFICATE'])
                    or not match(r'(PUB_KEY_ID_[A-Za-z0-9_]+|[A-Fa-f0-9]{1,128})', config['WECHAT_PAY_PLATFORM_KEY_ID'])):
                raise ValueError('invalid WeChat platform trust')
    if set(update) & STRIPE:
        providers.add('stripe')
        if not STRIPE - {'STRIPE_MANAGEMENT_PORTAL'} <= set(config):
            raise ValueError('incomplete Stripe configuration')
        if (not match(r'sk_(test|live)_[A-Za-z0-9]+', config['STRIPE_SECRET_KEY'])
                or not match(r'whsec_[A-Za-z0-9]+', config['STRIPE_WEBHOOK_SECRET'])
                or not match(r'https://buy\.stripe\.com/[A-Za-z0-9_]+', config['STRIPE_PAYMENT_LINK'])
                or ('STRIPE_MANAGEMENT_PORTAL' in config and not match(r'https://billing\.stripe\.com/p/login/[A-Za-z0-9_]+', config['STRIPE_MANAGEMENT_PORTAL']))
                or config['STRIPE_RETURN_URL'] != 'https://devapp.boardx.us/billing?subscription_return=1'):
            raise ValueError('invalid Stripe configuration')
    if len(encode_environment(config)) > LIMIT:
        raise ValueError('merged configuration too large')
    return config, providers


def encode_environment(config):
    # systemd EnvironmentFile quoting: literal PEM newlines remain inside quotes.
    # Dollar/backtick characters are never evaluated by systemd or this parser.
    return ''.join(key + '="' + value.replace('\\', '\\\\').replace('"', '\\"') + '"\n'
                   for key, value in sorted(config.items())).encode()


def decode_environment(raw):
    tokens = shlex.split(raw.decode(), comments=False, posix=True)
    result = dict(token.split('=', 1) for token in tokens)
    if set(result) - (WECHAT | STRIPE) or encode_environment(result) != raw:
        raise ValueError('invalid stored environment')
    return result


def check_directory(path, owner=0):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise ValueError('unsafe configuration directory')


def prepare_directory(path):
    for directory in reversed([path] + list(path.parents)):
        if not directory.exists() and not directory.is_symlink():
            directory.mkdir(mode=0o700)
        check_directory(directory)


def read_owned(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
            raise ValueError('unsafe configuration file')
        data = stream.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError('stored configuration too large')
        return data


def atomic_write(path, data):
    fd, name = tempfile.mkstemp(prefix='.billing-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_DIRECTORY | os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def command(*args):
    return subprocess.run(['/usr/bin/systemctl', *args], check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, timeout=5 if args[0] in {'show', 'is-active'} else 35,
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}).stdout.decode().strip()


def invocation():
    if command('is-active', SERVICE) != 'active':
        raise RuntimeError('service inactive')
    return command('show', SERVICE, '--property=InvocationID', '--value')


def restart_service():
    command('daemon-reload')
    command('restart', SERVICE)


def fetch(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:3200' + path, timeout=2) as response:
        raw = response.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('response too large')
        return json.loads(raw)


def verify_process_environment(config):
    global BILLING_ENVIRONMENT_MISMATCH
    pid = command('show', SERVICE, '--property=MainPID', '--value')
    if not match(r'[1-9][0-9]*', pid):
        raise RuntimeError('service has no process')
    raw = Path('/proc/' + pid + '/environ').read_bytes()
    environment = dict(item.split(b'=', 1) for item in raw.split(b'\0') if b'=' in item)
    BILLING_ENVIRONMENT_MISMATCH = [key for key, value in config.items()
                                    if environment.get(key.encode()) != value.encode()]
    if BILLING_ENVIRONMENT_MISMATCH:
        raise RuntimeError('service environment did not update')


def wait_ready(providers, old, invocation=invocation, fetch=fetch, sleep=time.sleep, attempts=30,
               verify_environment=lambda: None):
    stable = 0
    last = None
    deadline = time.monotonic() + 90
    for _ in range(attempts):
        if time.monotonic() >= deadline:
            break
        try:
            current = invocation()
            if not current or current == old:
                raise RuntimeError('service did not restart')
            verify_environment()
            health = fetch('/healthz')
            public = fetch('/billing/config')
            if (health.get('trustworthy') is not True or health.get('rlsForced') is not True
                    or health.get('appRoleIsOwner') is not False
                    or not providers <= set(public.get('enabledProviders', [])) or invocation() != current):
                raise RuntimeError('readiness rejected')
            if current != last:
                stable = 0
            last = current
            stable += 1
            if stable == 3:
                return
        except Exception:
            stable = 0
        sleep(1)
    raise RuntimeError('billing readiness failed')


def configure_transaction(config, providers, env_path, dropin_path, restart, ready, old):
    # Called only after the production entry checks root-owned ancestors/files.
    global BILLING_STAGE
    previous = {path: path.read_bytes() if path.exists() else None for path in (env_path, dropin_path)}
    try:
        BILLING_STAGE = 'write-environment'
        atomic_write(env_path, encode_environment(config))
        BILLING_STAGE = 'write-dropin'
        atomic_write(dropin_path, ('[Service]\nEnvironmentFile=' + str(env_path) + '\n').encode())
        BILLING_STAGE = 'restart'
        restart()
        BILLING_STAGE = 'readiness'
        ready(providers, old)
    except BaseException:
        for path, data in previous.items():
            if data is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, data)
        try:
            restart()
        except Exception:
            raise RuntimeError('billing failed; previous files restored but service recovery failed') from None
        # Keep the original type/errno for report_failure; it never prints exception text.
        raise


def read_stdin():
    data = bytearray()
    deadline = time.monotonic() + 20
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([0], [], [], remaining)[0]:
            raise ValueError('input timed out')
        chunk = os.read(0, min(4096, LIMIT + 1 - len(data)))
        if not chunk:
            return bytes(data)
        data.extend(chunk)
        if len(data) > LIMIT:
            raise ValueError('input too large')


def main():
    global BILLING_STAGE
    if os.geteuid() != 0:
        raise ValueError('root required')
    def interrupted(signum, frame):
        raise RuntimeError('configuration interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    BILLING_STAGE = 'input'
    raw = read_stdin()
    BILLING_STAGE = 'directories'
    prepare_directory(ENV_PATH.parent)
    prepare_directory(DROPIN_PATH.parent)
    # The lock lives inside a root-only directory, inaccessible to runner users.
    BILLING_STAGE = 'lock'
    lock_fd = os.open(ENV_PATH.parent / '.lock', os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        BILLING_STAGE = 'stored-files'
        previous = read_owned(ENV_PATH)
        read_owned(DROPIN_PATH)
        BILLING_STAGE = 'validation'
        config, providers = validate_payload(raw, decode_environment(previous) if previous is not None else {})
        BILLING_STAGE = 'service-before'
        old = invocation()
        def ready(requested, previous_invocation):
            global BILLING_STAGE
            def verify_environment():
                global BILLING_STAGE
                BILLING_STAGE = 'process-environment'
                verify_process_environment(config)
                BILLING_STAGE = 'readiness'
            # A simple systemd unit may return from restart before its child has
            # received the requested environment. Retry within the same bounded
            # readiness window; never accept an HTTP-only healthy process.
            BILLING_STAGE = 'readiness'
            wait_ready(requested, previous_invocation, verify_environment=verify_environment)
            verify_environment()
        configure_transaction(config, providers, ENV_PATH, DROPIN_PATH, restart_service, ready, old)
    print('Billing runtime configured; requested providers available: ' + ', '.join(sorted(providers)))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        report_failure(error)
        sys.exit(1)
# BILLING_RUNTIME_PYTHON_END
BILLING_RUNTIME_PYTHON
)"
}
