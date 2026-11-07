#!/usr/bin/env bash
# Called as root by the canonical release consumer; no dependency on a source checkout.
set -euo pipefail
runtime=/etc/workspacex-selfhost
cid=$(docker compose -p workspacex-selfhost --env-file "$runtime/compose.env" -f "$runtime/compose.json" ps -q api)
[[ -n $cid && $cid != *$'\n'* ]] || exit 1
image=$(docker inspect --format '{{.Image}}' "$cid")
# Reuse the running image and private runtime network; perform real login/file/Agent/model probes.
docker run --rm --pull never --network workspacex-selfhost-runtime \
 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g --cpus 2 \
 --env-file "$runtime/probe.env" \
 --mount "type=bind,src=$runtime/sandbox,dst=/run/sandbox" \
 --mount "type=bind,src=$runtime/sessions,dst=/run/sessions" \
 --entrypoint node "$image" --import tsx scripts/cloud-business-probe.ts
