#!/usr/bin/env bash
set -euo pipefail
US_RUNTIME=/etc/workspacex-us
US_PROJECT=workspacex-us
US_DATA=/var/lib/workspacex-us
US_STATE=/var/lib/workspacex-image-release/us
US_DOCKER_CONFIG=/etc/workspacex-image-release/docker
require_root() { [[ $EUID == 0 ]] || { echo 'Run as root' >&2;exit 2; }; }
compose() { docker compose -p "$US_PROJECT" --env-file "$US_RUNTIME/compose.env" -f "$US_RUNTIME/compose.json" "$@"; }
release_lock() { exec 9>/run/workspacex-us-deploy.lock;chmod 0600 /run/workspacex-us-deploy.lock;flock -n 9 || { echo 'US deployment busy' >&2;exit 2; }; }
