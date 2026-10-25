#!/usr/bin/env bash
set -euo pipefail
APP_RUNTIME=/etc/workspacex-selfhost
APP_PROJECT=workspacex-selfhost
APP_DATA=/var/lib/workspacex-selfhost
APP_STATE=/var/lib/workspacex-selfhost-state
require_root() { [[ $EUID == 0 ]] || { echo 'Run as root' >&2;exit 2; }; }
compose() { docker compose -p "$APP_PROJECT" --env-file "$APP_RUNTIME/compose.env" -f "$APP_RUNTIME/compose.json" "$@"; }
release_lock() { exec 9>/run/workspacex-selfhost-deploy.lock;chmod 0600 /run/workspacex-selfhost-deploy.lock;flock -n 9 || { echo 'US deployment busy' >&2;exit 2; }; }
